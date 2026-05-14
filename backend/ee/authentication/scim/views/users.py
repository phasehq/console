import json
import logging
import re

from django.db import IntegrityError
from django.http import JsonResponse
from django.http import HttpResponse
from rest_framework.decorators import (
    api_view,
    authentication_classes,
    parser_classes,
    permission_classes,
    renderer_classes,
)
from rest_framework.parsers import JSONParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.renderers import JSONRenderer

from ee.authentication.scim.negotiation import SCIMJSONParser, SCIMJSONRenderer

from api.models import SCIMUser
from backend.quotas import can_add_account
from ee.authentication.scim.auth import SCIMTokenAuthentication
from ee.authentication.scim.exceptions import (
    SCIMDeactivationForbidden,
    SCIMProvisioningConflict,
    scim_bad_request,
    scim_conflict,
    scim_forbidden,
    scim_invalid_filter,
    scim_not_found,
    scim_server_error,
)
from ee.authentication.scim.filters import (
    InvalidSCIMFilter,
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
    resolve_external_id,
)

logger = logging.getLogger(__name__)


def _get_base_url(request):
    return f"https://{request.get_host()}/service"


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
@renderer_classes([SCIMJSONRenderer, JSONRenderer])
@parser_classes([SCIMJSONParser, JSONParser])
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
@renderer_classes([SCIMJSONRenderer, JSONRenderer])
@parser_classes([SCIMJSONParser, JSONParser])
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
        try:
            qs = scim_filter_to_queryset(qs, filter_str, SCIM_USER_ATTR_MAP)
        except InvalidSCIMFilter as e:
            return scim_invalid_filter(str(e))

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
    # externalId is OPTIONAL per RFC 7643 §3.1 — synthesize one if the IdP omits it.
    external_id = resolve_external_id(external_id)

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
    except SCIMProvisioningConflict as e:
        log_scim_event(
            request, "user_created", "user", "", email,
            status="error", response_status=409,
            response_body={"detail": str(e)},
        )
        return scim_conflict(str(e))
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
        return scim_server_error()

    if not active:
        # In practice provision_scim_user always assigns the Developer role,
        # so the owner-deactivation guard is unreachable here — but a stale
        # OM that's now linked could theoretically trip it. Treat as a
        # warning, leave the user active, and let the IdP reconcile.
        try:
            deactivate_scim_user(scim_user)
        except SCIMDeactivationForbidden as e:
            logger.warning("SCIM post-create deactivate refused: %s", e)

    # Notify the user they need to sign in to complete account setup
    # (SSO + first-time key ceremony). Skip if they ended up deactivated,
    # or if they're adopting an OM that already has crypto material.
    if scim_user.active and scim_user.org_member and not scim_user.org_member.identity_key:
        try:
            from api.tasks.emails import send_scim_provisioned_email_job
            send_scim_provisioned_email_job(scim_user)
        except Exception:
            logger.exception("Failed to enqueue SCIM provisioning email for %s", email)

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
    event_type = "user_updated"
    if active and not scim_user.active:
        reactivate_scim_user(scim_user)
        event_type = "user_reactivated"
    elif not active and scim_user.active:
        try:
            deactivate_scim_user(scim_user)
        except SCIMDeactivationForbidden as e:
            log_scim_event(
                request, "user_deactivated", "user", scim_user.id, scim_user.email,
                status="error", response_status=403,
                response_body={"detail": str(e)},
            )
            return scim_forbidden(str(e))
        event_type = "user_deactivated"

    response_data = serialize_scim_user(scim_user, _get_base_url(request))
    log_scim_event(
        request, event_type, "user", scim_user.id, scim_user.email,
        response_status=200, response_body=response_data,
    )
    return JsonResponse(response_data)


_EMAILS_FILTERED_PATH_RE = re.compile(r"^emails\[.*\]\.value$", re.IGNORECASE)


def _coerce_bool(value):
    return value if isinstance(value, bool) else str(value).lower() == "true"


def _resolve_email_from_emails_value(value):
    """Extract an email string from a SCIM `emails` array value.
    Returns the primary entry's value if marked, else the first entry's value."""
    if not isinstance(value, list):
        return None
    primary = next((e for e in value if isinstance(e, dict) and e.get("primary")), None)
    chosen = primary or next((e for e in value if isinstance(e, dict)), None)
    if chosen is None:
        return None
    v = chosen.get("value")
    return v.strip() if isinstance(v, str) and v.strip() else None


def _set_email(scim_user, new_email):
    new_email = new_email.lower().strip() if isinstance(new_email, str) else ""
    if not new_email or new_email == scim_user.email:
        return False
    scim_user.email = new_email
    if scim_user.user:
        scim_user.user.email = new_email
        scim_user.user.username = new_email
        scim_user.user.save(update_fields=["email", "username"])
    scim_user.save(update_fields=["email"])
    return True


def _set_display_name(scim_user, new_name):
    if not isinstance(new_name, str):
        return False
    scim_user.display_name = new_name
    scim_user.save(update_fields=["display_name"])
    return True


def _set_name_part(scim_user, key, value):
    """key is 'givenName' or 'familyName'."""
    if not isinstance(value, str):
        return False
    name_data = scim_user.scim_data.get("name", {}) if isinstance(scim_user.scim_data, dict) else {}
    name_data[key] = value
    if not isinstance(scim_user.scim_data, dict):
        scim_user.scim_data = {}
    scim_user.scim_data["name"] = name_data
    given = name_data.get("givenName", "")
    family = name_data.get("familyName", "")
    scim_user.display_name = f"{given} {family}".strip() or scim_user.display_name
    scim_user.save(update_fields=["scim_data", "display_name"])
    return True


def _apply_active(scim_user, value):
    active = _coerce_bool(value)
    if active and not scim_user.active:
        reactivate_scim_user(scim_user)
        return "user_reactivated"
    if not active and scim_user.active:
        deactivate_scim_user(scim_user)
        return "user_deactivated"
    return "user_updated"


def _apply_pathed_op(scim_user, path, value):
    """Apply a single pathed op. Returns event_type if active was toggled,
    else 'user_updated' if a field changed, else None for unsupported paths."""
    lower = path.lower()
    if lower == "active":
        return _apply_active(scim_user, value)
    if lower == "username":
        return "user_updated" if _set_email(scim_user, value) else None
    if lower == "displayname":
        return "user_updated" if _set_display_name(scim_user, value) else None
    if lower == "name.givenname":
        return "user_updated" if _set_name_part(scim_user, "givenName", value) else None
    if lower == "name.familyname":
        return "user_updated" if _set_name_part(scim_user, "familyName", value) else None
    if lower == "emails" or _EMAILS_FILTERED_PATH_RE.match(path or ""):
        # `emails` (whole-array replace/add) takes a list; the filtered
        # subpath `emails[type eq "..."].value` takes a single string.
        email = value if isinstance(value, str) else _resolve_email_from_emails_value(value)
        return "user_updated" if email and _set_email(scim_user, email) else None
    return None


def _apply_valueless_dict(scim_user, value):
    """Apply a valueless replace/add where `value` is a dict of attribute->value."""
    if not isinstance(value, dict):
        return None
    event_type = None
    for k, v in value.items():
        kl = k.lower()
        if kl == "active":
            e = _apply_active(scim_user, v)
            if e in ("user_reactivated", "user_deactivated"):
                event_type = e
            elif event_type is None:
                event_type = "user_updated"
        elif kl == "username":
            if _set_email(scim_user, v):
                event_type = event_type or "user_updated"
        elif kl == "displayname":
            if _set_display_name(scim_user, v):
                event_type = event_type or "user_updated"
        elif kl == "name" and isinstance(v, dict):
            changed = False
            if "givenName" in v:
                changed |= _set_name_part(scim_user, "givenName", v["givenName"])
            if "familyName" in v:
                changed |= _set_name_part(scim_user, "familyName", v["familyName"])
            if changed:
                event_type = event_type or "user_updated"
        elif kl == "emails":
            email = _resolve_email_from_emails_value(v)
            if email and _set_email(scim_user, email):
                event_type = event_type or "user_updated"
    return event_type


def _patch_user(request, scim_user):
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return scim_bad_request("Invalid JSON body")

    operations = data.get("Operations", [])
    if not operations:
        return scim_bad_request("No operations provided")

    event_type = "user_updated"

    try:
        for op in operations:
            op_type = op.get("op", "").lower()
            path = op.get("path", "")
            value = op.get("value")

            # SCIM Add on a single-valued attribute behaves as Replace (RFC 7644 §3.5.2.1);
            # we only model single-valued user attrs, so the two ops are equivalent here.
            if op_type in ("replace", "add"):
                e = _apply_pathed_op(scim_user, path, value) if path else _apply_valueless_dict(scim_user, value)
                if e in ("user_reactivated", "user_deactivated"):
                    event_type = e
            # `remove` and unknown ops fall through — IdPs send paths we don't model
            # (phoneNumbers, addresses, etc.); rejecting them would break interop.
    except SCIMDeactivationForbidden as e:
        log_scim_event(
            request, "user_deactivated", "user", scim_user.id, scim_user.email,
            status="error", response_status=403,
            response_body={"detail": str(e)},
        )
        return scim_forbidden(str(e))

    response_data = serialize_scim_user(scim_user, _get_base_url(request))
    log_scim_event(
        request, event_type, "user", scim_user.id, scim_user.email,
        response_status=200, response_body=response_data,
    )
    return JsonResponse(response_data)


def _delete_user(request, scim_user):
    if scim_user.active:
        try:
            deactivate_scim_user(scim_user)
        except SCIMDeactivationForbidden as e:
            log_scim_event(
                request, "user_deactivated", "user", scim_user.id, scim_user.email,
                status="error", response_status=403,
                response_body={"detail": str(e)},
            )
            return scim_forbidden(str(e))
    log_scim_event(
        request, "user_deactivated", "user", scim_user.id, scim_user.email,
        response_status=204,
    )
    return HttpResponse(status=204)
