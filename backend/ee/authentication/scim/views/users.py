import json
import logging

from django.db import IntegrityError
from django.http import JsonResponse
from django.http import HttpResponse
from rest_framework.decorators import (
    api_view,
    authentication_classes,
    permission_classes,
)
from rest_framework.permissions import IsAuthenticated

from api.models import SCIMUser
from backend.quotas import can_add_account
from ee.authentication.scim.auth import SCIMTokenAuthentication
from ee.authentication.scim.exceptions import (
    scim_bad_request,
    scim_conflict,
    scim_forbidden,
    scim_not_found,
    scim_server_error,
)
from ee.authentication.scim.filters import (
    SCIM_USER_ATTR_MAP,
    scim_filter_to_queryset,
)
from ee.authentication.scim.constants import SCIM_DEFAULT_COUNT
from ee.authentication.scim.serializers import (
    serialize_list_response,
    serialize_scim_user,
)
from ee.authentication.scim.logging import log_scim_event
from ee.authentication.scim.utils import (
    deactivate_scim_user,
    provision_scim_user,
    reactivate_scim_user,
)

logger = logging.getLogger(__name__)


def _get_base_url(request):
    return f"{request.scheme}://{request.get_host()}"


def _extract_user_fields(data):
    """Extract user fields from a SCIM User resource."""
    email = data.get("userName", "").strip()
    if not email:
        # Try emails array
        emails = data.get("emails", [])
        for e in emails:
            if e.get("primary") or not email:
                email = e.get("value", "").strip()

    external_id = data.get("externalId", "")
    display_name = data.get("displayName", "")

    # Build display name from name object if not provided
    if not display_name:
        name = data.get("name", {})
        parts = [name.get("givenName", ""), name.get("familyName", "")]
        display_name = " ".join(p for p in parts if p).strip()

    active = data.get("active", True)

    return email, external_id, display_name, active


@api_view(["GET", "POST"])
@authentication_classes([SCIMTokenAuthentication])
@permission_classes([IsAuthenticated])
def users_list(request):
    """
    GET  /scim/v2/Users — List/filter users
    POST /scim/v2/Users — Create a new user
    """
    org = request.auth["organisation"]

    if request.method == "GET":
        return _list_users(request, org)
    else:
        return _create_user(request, org)


@api_view(["GET", "PUT", "PATCH", "DELETE"])
@authentication_classes([SCIMTokenAuthentication])
@permission_classes([IsAuthenticated])
def users_detail(request, scim_user_id):
    """
    GET    /scim/v2/Users/:id — Get user
    PUT    /scim/v2/Users/:id — Replace user
    PATCH  /scim/v2/Users/:id — Partial update
    DELETE /scim/v2/Users/:id — Deactivate user
    """
    org = request.auth["organisation"]

    try:
        scim_user = SCIMUser.objects.select_related("user", "org_member").get(
            id=scim_user_id, organisation=org
        )
    except SCIMUser.DoesNotExist:
        return scim_not_found("User not found")

    if request.method == "GET":
        return JsonResponse(
            serialize_scim_user(scim_user, _get_base_url(request))
        )
    elif request.method == "PUT":
        return _replace_user(request, scim_user)
    elif request.method == "PATCH":
        return _patch_user(request, scim_user)
    elif request.method == "DELETE":
        return _delete_user(request, scim_user)


def _list_users(request, org):
    filter_str = request.GET.get("filter", "")
    start_index = max(int(request.GET.get("startIndex", 1)), 1)
    count = min(int(request.GET.get("count", SCIM_DEFAULT_COUNT)), SCIM_DEFAULT_COUNT)

    qs = SCIMUser.objects.filter(organisation=org).order_by("created_at")
    if filter_str:
        qs = scim_filter_to_queryset(qs, filter_str, SCIM_USER_ATTR_MAP)

    total = qs.count()
    # SCIM pagination is 1-indexed
    offset = start_index - 1
    page = qs[offset : offset + count]

    base_url = _get_base_url(request)
    resources = [serialize_scim_user(u, base_url) for u in page]
    return JsonResponse(serialize_list_response(resources, total, start_index, count))


def _create_user(request, org):
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return scim_bad_request("Invalid JSON body")

    email, external_id, display_name, active = _extract_user_fields(data)

    if not email:
        return scim_bad_request("userName (email) is required")
    if not external_id:
        return scim_bad_request("externalId is required")

    # Check seat quota
    if not can_add_account(org):
        return scim_forbidden("Organisation has reached its seat limit")

    try:
        scim_user = provision_scim_user(
            organisation=org,
            external_id=external_id,
            email=email,
            display_name=display_name,
            scim_data=data,
        )
    except IntegrityError:
        log_scim_event(
            request, "user_created", "user", "", email,
            status="error", response_status=409,
            response_body={"detail": f"User with externalId '{external_id}' or email '{email}' already exists"},
        )
        return scim_conflict(
            f"User with externalId '{external_id}' or email '{email}' already exists"
        )
    except Exception as e:
        logger.exception("SCIM user creation failed")
        log_scim_event(
            request, "user_created", "user", "", email,
            status="error", response_status=500,
            response_body={"detail": str(e)},
        )
        return scim_server_error(str(e))

    if not active:
        deactivate_scim_user(scim_user)

    response_data = serialize_scim_user(scim_user, _get_base_url(request))
    log_scim_event(
        request, "user_created", "user", scim_user.id, email,
        response_status=201, response_body=response_data,
    )
    return JsonResponse(response_data, status=201)


def _replace_user(request, scim_user):
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return scim_bad_request("Invalid JSON body")

    email, external_id, display_name, active = _extract_user_fields(data)

    if email and email != scim_user.email:
        scim_user.email = email
        if scim_user.user:
            scim_user.user.email = email
            scim_user.user.username = email
            scim_user.user.save(update_fields=["email", "username"])

    if external_id:
        scim_user.external_id = external_id
    if display_name:
        scim_user.display_name = display_name

    scim_user.scim_data = data
    scim_user.save()

    # Handle activation state change
    if active and not scim_user.active:
        reactivate_scim_user(scim_user)
    elif not active and scim_user.active:
        deactivate_scim_user(scim_user)

    response_data = serialize_scim_user(scim_user, _get_base_url(request))
    log_scim_event(
        request, "user_updated", "user", scim_user.id, scim_user.email,
        response_status=200, response_body=response_data,
    )
    return JsonResponse(response_data)


def _patch_user(request, scim_user):
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return scim_bad_request("Invalid JSON body")

    operations = data.get("Operations", [])
    if not operations:
        return scim_bad_request("No operations provided")

    for op in operations:
        op_type = op.get("op", "").lower()
        path = op.get("path", "").lower()
        value = op.get("value")

        if op_type == "replace":
            if path == "active":
                active = value if isinstance(value, bool) else str(value).lower() == "true"
                if active and not scim_user.active:
                    reactivate_scim_user(scim_user)
                elif not active and scim_user.active:
                    deactivate_scim_user(scim_user)
            elif path == "username":
                scim_user.email = value
                if scim_user.user:
                    scim_user.user.email = value
                    scim_user.user.username = value
                    scim_user.user.save(update_fields=["email", "username"])
                scim_user.save(update_fields=["email"])
            elif path == "displayname":
                scim_user.display_name = value
                scim_user.save(update_fields=["display_name"])
            elif path == "name.givenname" or path == "name.familyname":
                name_data = scim_user.scim_data.get("name", {})
                if path == "name.givenname":
                    name_data["givenName"] = value
                else:
                    name_data["familyName"] = value
                scim_user.scim_data["name"] = name_data
                # Update display_name from name parts
                given = name_data.get("givenName", "")
                family = name_data.get("familyName", "")
                scim_user.display_name = f"{given} {family}".strip()
                scim_user.save(update_fields=["scim_data", "display_name"])
            elif not path:
                # Valueless replace — value is a dict of attributes
                if isinstance(value, dict):
                    if "active" in value:
                        active = value["active"]
                        if isinstance(active, str):
                            active = active.lower() == "true"
                        if active and not scim_user.active:
                            reactivate_scim_user(scim_user)
                        elif not active and scim_user.active:
                            deactivate_scim_user(scim_user)

    response_data = serialize_scim_user(scim_user, _get_base_url(request))

    # Determine the most specific event type from operations
    event_type = "user_updated"
    for op in operations:
        op_type = op.get("op", "").lower()
        path = op.get("path", "").lower()
        value = op.get("value")
        if op_type == "replace" and path == "active":
            active = value if isinstance(value, bool) else str(value).lower() == "true"
            event_type = "user_reactivated" if active else "user_deactivated"
        elif op_type == "replace" and not path and isinstance(value, dict) and "active" in value:
            active = value["active"]
            if isinstance(active, str):
                active = active.lower() == "true"
            event_type = "user_reactivated" if active else "user_deactivated"

    log_scim_event(
        request, event_type, "user", scim_user.id, scim_user.email,
        response_status=200, response_body=response_data,
    )
    return JsonResponse(response_data)


def _delete_user(request, scim_user):
    if scim_user.active:
        deactivate_scim_user(scim_user)
    log_scim_event(
        request, "user_deactivated", "user", scim_user.id, scim_user.email,
        response_status=204,
    )
    return HttpResponse(status=204)
