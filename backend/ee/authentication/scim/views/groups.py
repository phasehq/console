import json
import logging

from django.db import IntegrityError
from django.http import HttpResponse, JsonResponse
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

from api.models import (
    SCIMGroup,
    SCIMUser,
    ServiceAccount,
    ServiceAccountToken,
    Team,
    TeamAppEnvironment,
    TeamMembership,
)
from api.utils.keys import provision_team_environment_keys, revoke_team_environment_keys
from ee.authentication.scim.auth import SCIMTokenAuthentication
from ee.authentication.scim.constants import SCIM_DEFAULT_COUNT
from ee.authentication.scim.exceptions import (
    scim_bad_request,
    scim_conflict,
    scim_not_found,
    scim_server_error,
)
from ee.authentication.scim.logging import log_scim_event
from ee.authentication.scim.filters import (
    SCIM_GROUP_ATTR_MAP,
    parse_patch_path_filter,
    scim_filter_to_queryset,
)
from ee.authentication.scim.serializers import (
    serialize_list_response,
    serialize_scim_group,
)

logger = logging.getLogger(__name__)


def _get_base_url(request):
    return f"https://{request.get_host()}/service"


def _provision_keys_for_membership(team, membership):
    """Provision environment keys for a new team member across all team apps."""
    app_ids = (
        TeamAppEnvironment.objects.filter(team=team)
        .values_list("app_id", flat=True)
        .distinct()
    )
    for app_id in app_ids:
        from api.models import App

        try:
            app = App.objects.get(id=app_id, is_deleted=False)
            if app.sse_enabled:
                provision_team_environment_keys(team, app, members=[membership])
        except App.DoesNotExist:
            continue
        except Exception:
            logger.exception("Failed to provision keys for team %s, app %s", team.id, app_id)


def _add_member_to_team(team, scim_user, org):
    """Add a SCIM user to a team, creating TeamMembership and provisioning keys."""
    if not scim_user.org_member:
        return None

    membership, created = TeamMembership.objects.get_or_create(
        team=team,
        org_member=scim_user.org_member,
    )

    if created:
        _provision_keys_for_membership(team, membership)

    return membership


def _remove_member_from_team(team, scim_user):
    """Remove a SCIM user from a team, revoking keys and deleting membership."""
    if not scim_user.org_member:
        return

    membership = TeamMembership.objects.filter(
        team=team, org_member=scim_user.org_member
    ).first()

    if membership:
        revoke_team_environment_keys(team, member=scim_user.org_member)
        membership.delete()


@api_view(["GET", "POST"])
@authentication_classes([SCIMTokenAuthentication])
@permission_classes([IsAuthenticated])
@renderer_classes([SCIMJSONRenderer, JSONRenderer])
@parser_classes([SCIMJSONParser, JSONParser])
def groups_list(request):
    """
    GET  /scim/v2/Groups — List/filter groups
    POST /scim/v2/Groups — Create a new group
    """
    org = request.auth["organisation"]

    if request.method == "GET":
        return _list_groups(request, org)
    else:
        return _create_group(request, org)


@api_view(["GET", "PUT", "PATCH", "DELETE"])
@authentication_classes([SCIMTokenAuthentication])
@permission_classes([IsAuthenticated])
@renderer_classes([SCIMJSONRenderer, JSONRenderer])
@parser_classes([SCIMJSONParser, JSONParser])
def groups_detail(request, scim_group_id):
    """
    GET    /scim/v2/Groups/:id — Get group
    PUT    /scim/v2/Groups/:id — Replace group
    PATCH  /scim/v2/Groups/:id — Partial update (Azure Entra's primary method)
    DELETE /scim/v2/Groups/:id — Delete group
    """
    org = request.auth["organisation"]

    try:
        scim_group = SCIMGroup.objects.select_related("team").get(
            id=scim_group_id, organisation=org
        )
    except SCIMGroup.DoesNotExist:
        return scim_not_found("Group not found")

    if request.method == "GET":
        return JsonResponse(
            serialize_scim_group(scim_group, _get_base_url(request))
        )
    elif request.method == "PUT":
        return _replace_group(request, scim_group)
    elif request.method == "PATCH":
        return _patch_group(request, scim_group)
    elif request.method == "DELETE":
        return _delete_group(request, scim_group)


def _list_groups(request, org):
    filter_str = request.GET.get("filter", "")
    start_index = max(int(request.GET.get("startIndex", 1)), 1)
    count = min(int(request.GET.get("count", SCIM_DEFAULT_COUNT)), SCIM_DEFAULT_COUNT)

    qs = SCIMGroup.objects.filter(organisation=org).order_by("created_at")
    if filter_str:
        qs = scim_filter_to_queryset(qs, filter_str, SCIM_GROUP_ATTR_MAP)

    total = qs.count()
    offset = start_index - 1
    page = qs[offset : offset + count]

    base_url = _get_base_url(request)
    resources = [serialize_scim_group(g, base_url) for g in page]
    return JsonResponse(serialize_list_response(resources, total, start_index, count))


def _create_group(request, org):
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return scim_bad_request("Invalid JSON body")

    display_name = data.get("displayName", "").strip()
    external_id = data.get("externalId", "")
    description = (data.get("description") or "").strip() or None

    if not display_name:
        return scim_bad_request("displayName is required")
    if not external_id:
        import uuid
        external_id = str(uuid.uuid4())

    # Create Team
    try:
        team = Team.objects.create(
            name=display_name[:64],
            description=description,
            organisation=org,
            is_scim_managed=True,
            created_by=None,
        )
    except Exception:
        logger.exception("Failed to create team for SCIM group")
        return scim_server_error()

    # Create SCIMGroup
    try:
        scim_group = SCIMGroup.objects.create(
            external_id=external_id,
            organisation=org,
            team=team,
            display_name=display_name,
            scim_data=data,
        )
    except IntegrityError:
        team.delete()
        log_scim_event(
            request, "group_created", "group", "", display_name,
            status="error", response_status=409,
            response_body={"detail": f"Group with externalId '{external_id}' already exists"},
        )
        return scim_conflict(
            f"Group with externalId '{external_id}' already exists"
        )

    # Add initial members
    members = data.get("members", [])
    for member_ref in members:
        member_id = member_ref.get("value")
        if member_id:
            scim_user = SCIMUser.objects.filter(
                id=member_id, organisation=org
            ).first()
            if scim_user:
                _add_member_to_team(team, scim_user, org)

    response_data = serialize_scim_group(scim_group, _get_base_url(request))
    log_scim_event(
        request, "group_created", "group", scim_group.id, display_name,
        response_status=201, response_body=response_data,
    )
    return JsonResponse(response_data, status=201)


def _replace_group(request, scim_group):
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return scim_bad_request("Invalid JSON body")

    org = scim_group.organisation
    display_name = data.get("displayName", "").strip()
    external_id = data.get("externalId", scim_group.external_id)
    description = (data.get("description") or "").strip() or None

    if display_name:
        scim_group.display_name = display_name
        if scim_group.team:
            scim_group.team.name = display_name[:64]
            scim_group.team.description = description
            scim_group.team.save(update_fields=["name", "description", "updated_at"])

    scim_group.external_id = external_id
    scim_group.scim_data = data
    scim_group.save()

    if scim_group.team:
        # Diff membership: incoming vs current
        incoming_ids = {m.get("value") for m in data.get("members", []) if m.get("value")}

        current_memberships = TeamMembership.objects.filter(
            team=scim_group.team, org_member__isnull=False
        ).select_related("org_member")

        current_scim_ids = set()
        for tm in current_memberships:
            scim_user = SCIMUser.objects.filter(
                org_member=tm.org_member, organisation=org
            ).first()
            if scim_user:
                current_scim_ids.add(scim_user.id)

        # Add new members
        for scim_id in incoming_ids - current_scim_ids:
            scim_user = SCIMUser.objects.filter(id=scim_id, organisation=org).first()
            if scim_user:
                _add_member_to_team(scim_group.team, scim_user, org)

        # Remove departed members
        for scim_id in current_scim_ids - incoming_ids:
            scim_user = SCIMUser.objects.filter(id=scim_id, organisation=org).first()
            if scim_user:
                _remove_member_from_team(scim_group.team, scim_user)

    response_data = serialize_scim_group(scim_group, _get_base_url(request))
    log_scim_event(
        request, "group_updated", "group", scim_group.id, scim_group.display_name,
        response_status=200, response_body=response_data,
    )
    return JsonResponse(response_data)


def _patch_group(request, scim_group):
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return scim_bad_request("Invalid JSON body")

    org = scim_group.organisation
    operations = data.get("Operations", [])
    if not operations:
        return scim_bad_request("No operations provided")

    for op in operations:
        op_type = op.get("op", "").lower()
        path = op.get("path", "")
        value = op.get("value")

        if op_type in ("replace", "add") and path.lower() == "displayname":
            scim_group.display_name = value
            scim_group.save(update_fields=["display_name"])
            if scim_group.team:
                scim_group.team.name = str(value)[:64]
                scim_group.team.save(update_fields=["name", "updated_at"])

        elif op_type in ("replace", "add") and path.lower() == "description":
            if scim_group.team:
                scim_group.team.description = (str(value).strip() if value else None)
                scim_group.team.save(update_fields=["description", "updated_at"])

        elif op_type == "add" and path.lower() == "members":
            members = value if isinstance(value, list) else [value]
            for member_ref in members:
                member_id = member_ref.get("value") if isinstance(member_ref, dict) else member_ref
                if member_id and scim_group.team:
                    scim_user = SCIMUser.objects.filter(
                        id=member_id, organisation=org
                    ).first()
                    if scim_user:
                        _add_member_to_team(scim_group.team, scim_user, org)
                        log_scim_event(
                            request, "member_added", "group", scim_group.id,
                            scim_group.display_name,
                            detail={"member_email": scim_user.email, "member_id": str(scim_user.id)},
                            response_status=200,
                        )

        elif op_type == "remove":
            if not scim_group.team:
                continue

            member_ids = []

            # Azure Entra format: members[value eq "abc-123"]
            filtered_id = parse_patch_path_filter(path)
            if filtered_id:
                member_ids.append(filtered_id)

            # Okta format: path="members", value=[{"value": "id"}]
            if path.lower() == "members" and value:
                refs = value if isinstance(value, list) else [value]
                for ref in refs:
                    mid = ref.get("value") if isinstance(ref, dict) else ref
                    if mid:
                        member_ids.append(mid)

            for member_id in member_ids:
                scim_user = SCIMUser.objects.filter(
                    id=member_id, organisation=org
                ).first()
                if scim_user:
                    _remove_member_from_team(scim_group.team, scim_user)
                    log_scim_event(
                        request, "member_removed", "group", scim_group.id,
                        scim_group.display_name,
                        detail={"member_email": scim_user.email, "member_id": str(scim_user.id)},
                        response_status=200,
                    )

    response_data = serialize_scim_group(scim_group, _get_base_url(request))
    log_scim_event(
        request, "group_updated", "group", scim_group.id, scim_group.display_name,
        response_status=200, response_body=response_data,
    )
    return JsonResponse(response_data)


def _delete_group(request, scim_group):
    log_scim_event(
        request, "group_deleted", "group", scim_group.id, scim_group.display_name,
        response_status=204,
    )
    if scim_group.team:
        from django.utils import timezone
        now = timezone.now()

        revoke_team_environment_keys(scim_group.team)

        # Soft-delete team-owned service accounts and their tokens — mirrors DeleteTeamMutation
        for sa in ServiceAccount.objects.filter(
            team=scim_group.team, deleted_at__isnull=True
        ):
            sa.deleted_at = now
            sa.save()
            ServiceAccountToken.objects.filter(
                service_account=sa, deleted_at__isnull=True
            ).update(deleted_at=now)

        scim_group.team.deleted_at = now
        scim_group.team.save(update_fields=["deleted_at"])

    scim_group.delete()
    return HttpResponse(status=204)
