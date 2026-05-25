"""REST endpoints for managing Teams — mirrors the GraphQL teams mutations
with our usual REST conventions (declarative access PUT, METHOD_TO_ACTION
gating, audit events, plan-gated creation).

Teams is a Pro+ feature. Creation calls go through `can_use_teams(org)`.
SCIM-managed teams reject manual edits to name/description, manual user
membership changes, and deletion — service-account membership changes
are permitted since SAs are out of SCIM scope.
"""

import logging

from django.core.exceptions import ObjectDoesNotExist
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from rest_framework import status
from rest_framework.exceptions import MethodNotAllowed, PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from djangorestframework_camel_case.render import CamelCaseJSONRenderer

from api.auth import PhaseTokenAuthentication
from api.models import (
    App,
    Environment,
    OrganisationMember,
    Role,
    ServiceAccount,
    Team,
    TeamAppEnvironment,
    TeamMembership,
)
from api.throttling import PlanBasedRateThrottle
from api.utils.access.middleware import IsIPAllowed
from api.utils.access.permissions import (
    role_has_global_access,
    user_can_access_app,
    user_has_permission,
)
from api.utils.audit_logging import (
    audit_team_cascade_sas,
    log_audit_event,
    get_actor_info,
    get_member_display_name,
)
from api.utils.keys import (
    provision_team_environment_keys,
    revoke_team_environment_keys,
)
from api.utils.rest import (
    METHOD_TO_ACTION,
    get_resolver_request_meta,
    validate_text_field,
)
from backend.quotas import can_use_teams

logger = logging.getLogger(__name__)

USER = "user"
SERVICE_ACCOUNT = "service_account"
_VALID_MEMBER_TYPES = {USER, SERVICE_ACCOUNT}


# ────────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────────


def _get_org(request):
    if request.auth.get("organisation"):
        return request.auth["organisation"]
    if request.auth.get("app"):
        return request.auth["app"].organisation
    raise PermissionDenied("Could not resolve organisation from request.")


def _caller_org_member(request, org):
    """Returns the calling user's OrganisationMember in `org`, or None for
    SA callers / non-members."""
    if request.auth["auth_type"] != "User":
        return None
    try:
        return OrganisationMember.objects.get(
            user=request.auth["org_member"].user,
            organisation=org,
            deleted_at=None,
        )
    except OrganisationMember.DoesNotExist:
        return None


def _caller_account(request):
    """The auth principal — OrganisationMember for User, ServiceAccount for SA."""
    if request.auth["auth_type"] == "User":
        return request.auth["org_member"].user
    return request.auth["service_account"]


def _caller_has_global_access(request):
    if request.auth["auth_type"] == "User":
        return role_has_global_access(request.auth["org_member"].role)
    return role_has_global_access(request.auth["service_account"].role)


def _is_team_member(request, team):
    """True if the caller belongs to the team. Global-access callers
    short-circuit to True at call sites that allow that."""
    if request.auth["auth_type"] == "User":
        return TeamMembership.objects.filter(
            team=team,
            org_member=request.auth["org_member"],
            team__deleted_at__isnull=True,
        ).exists()
    return TeamMembership.objects.filter(
        team=team,
        service_account=request.auth["service_account"],
        team__deleted_at__isnull=True,
    ).exists()


def _is_team_owner(request, team):
    if request.auth["auth_type"] != "User":
        return False
    return team.owner_id is not None and team.owner_id == request.auth["org_member"].id


def _ensure_caller_can_see_team(request, team):
    """Read-side gate: hides team-internal detail (members, app scope)
    from non-team-members. Global-access callers always pass."""
    if _caller_has_global_access(request):
        return
    if not _is_team_member(request, team):
        raise PermissionDenied("You don't have access to this team.")


def _serialize_role_ref(role):
    if role is None:
        return None
    return {"id": role.id, "name": role.name}


def _serialize_member_ref(membership):
    if membership.org_member_id is not None:
        m = membership.org_member
        return {
            "type": USER,
            "id": str(m.id),
            "email": getattr(m.user, "email", ""),
            "full_name": getattr(m.user, "full_name", ""),
        }
    sa = membership.service_account
    return {
        "type": SERVICE_ACCOUNT,
        "id": str(sa.id),
        "name": sa.name,
    }


def _serialize_team(team, include_detail=False):
    data = {
        "id": team.id,
        "name": team.name,
        "description": team.description,
        "is_scim_managed": team.is_scim_managed,
        "member_role": _serialize_role_ref(team.member_role),
        "service_account_role": _serialize_role_ref(team.service_account_role),
        "owner": {
            "id": str(team.owner.id),
            "email": getattr(team.owner.user, "email", ""),
        }
        if team.owner_id is not None
        else None,
        "created_at": team.created_at,
        "updated_at": team.updated_at,
    }
    if include_detail:
        memberships = team.memberships.select_related(
            "org_member__user", "service_account"
        ).filter(
            Q(org_member__deleted_at__isnull=True)
            | Q(service_account__deleted_at__isnull=True)
            | Q(org_member__isnull=True, service_account__isnull=True)
        )
        data["members"] = [_serialize_member_ref(m) for m in memberships]

        app_envs = (
            TeamAppEnvironment.objects.filter(team=team)
            .select_related("app", "environment")
        )
        apps_grouped = {}
        for tae in app_envs:
            entry = apps_grouped.setdefault(
                str(tae.app_id), {"id": str(tae.app_id), "name": tae.app.name, "environments": []}
            )
            entry["environments"].append(
                {"id": str(tae.environment_id), "name": tae.environment.name}
            )
        data["apps"] = list(apps_grouped.values())
    return data


def _resolve_role_or_404(role_id, org):
    """Resolves a role by id within the given org. Returns (role, None) on
    success or (None, Response) on error."""
    try:
        return (
            Role.objects.get(id=role_id, organisation=org),
            None,
        )
    except (ObjectDoesNotExist, ValueError):
        return None, Response(
            {"error": "Role not found."},
            status=status.HTTP_404_NOT_FOUND,
        )


def _provision_keys_for_team_membership(team, membership):
    """Server-side key wrap for every SSE-enabled app the team has access
    to, scoped to one new membership."""
    team_app_ids = (
        TeamAppEnvironment.objects.filter(team=team)
        .values_list("app_id", flat=True)
        .distinct()
    )
    for app in App.objects.filter(
        id__in=team_app_ids, sse_enabled=True, is_deleted=False
    ):
        provision_team_environment_keys(team, app, members=[membership])


def _audit_team_event(request, org, team, event_type, **extra):
    actor_type, actor_id, actor_meta = get_actor_info(request)
    ip_address, user_agent = get_resolver_request_meta(request)
    log_audit_event(
        organisation=org,
        event_type=event_type,
        resource_type="team",
        resource_id=str(team.id),
        actor_type=actor_type,
        actor_id=actor_id,
        actor_metadata=actor_meta,
        resource_metadata={"name": team.name},
        ip_address=ip_address,
        user_agent=user_agent,
        **extra,
    )


# ────────────────────────────────────────────────────────────────────
# Collection: list + create
# ────────────────────────────────────────────────────────────────────


class PublicTeamsView(APIView):
    authentication_classes = [PhaseTokenAuthentication]
    permission_classes = [IsAuthenticated, IsIPAllowed]
    throttle_classes = [PlanBasedRateThrottle]
    renderer_classes = [CamelCaseJSONRenderer]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)

        action = METHOD_TO_ACTION.get(request.method)
        if not action:
            raise MethodNotAllowed(request.method)

        org = _get_org(request)
        account = _caller_account(request)
        is_sa = request.auth["auth_type"] == "ServiceAccount"
        if not user_has_permission(account, action, "Teams", org, False, is_sa):
            raise PermissionDenied(
                f"You don't have permission to {action} teams."
            )

    def get(self, request, *args, **kwargs):
        org = _get_org(request)
        teams = (
            Team.objects.filter(organisation=org, deleted_at__isnull=True)
            .select_related("member_role", "service_account_role", "owner__user")
            .order_by("name")
        )
        return Response(
            {"data": [_serialize_team(t) for t in teams]},
            status=status.HTTP_200_OK,
        )

    def post(self, request, *args, **kwargs):
        org = _get_org(request)

        if not can_use_teams(org):
            return Response(
                {"error": "Teams are not available on your organisation's plan."},
                status=status.HTTP_403_FORBIDDEN,
            )

        name, err = validate_text_field(
            request.data.get("name"), "name", max_length=64
        )
        if err:
            return Response({"error": err}, status=status.HTTP_400_BAD_REQUEST)

        description = request.data.get("description")
        if description is not None:
            description, err = validate_text_field(
                description, "description", max_length=10000, required=False
            )
            if err:
                return Response({"error": err}, status=status.HTTP_400_BAD_REQUEST)

        # Optional role overrides — must be roles in the same org.
        member_role = None
        member_role_id = request.data.get("member_role_id")
        if member_role_id:
            member_role, err_response = _resolve_role_or_404(member_role_id, org)
            if err_response is not None:
                return err_response

        sa_role = None
        sa_role_id = request.data.get("service_account_role_id")
        if sa_role_id:
            sa_role, err_response = _resolve_role_or_404(sa_role_id, org)
            if err_response is not None:
                return err_response

        # Reject is_scim_managed from the request — that flag is only set
        # by the SCIM provisioning flow itself. Use `in` rather than a
        # truthy check so `is_scim_managed: false` is also rejected (a
        # truthy check silently accepted false, which was misleading).
        if "is_scim_managed" in request.data:
            return Response(
                {
                    "error": (
                        "The is_scim_managed flag is set automatically by the "
                        "SCIM provisioning flow and cannot be set via this endpoint."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            caller_member = _caller_org_member(request, org)
            team = Team.objects.create(
                organisation=org,
                name=name,
                description=description or "",
                member_role=member_role,
                service_account_role=sa_role,
                owner=caller_member,  # None for SA-created teams — fine
                created_by=caller_member,
                is_scim_managed=False,
            )
            # Auto-add the creator as a member so they can manage the
            # team they just created. Users become members under their
            # OrganisationMember; SA callers become members under the SA
            # itself — without this, an SA-created team is unreachable
            # to its own creator on every subsequent request (the access
            # gate enforces membership for non-global-access callers).
            if caller_member is not None:
                TeamMembership.objects.create(team=team, org_member=caller_member)
            elif request.auth["auth_type"] == "ServiceAccount":
                TeamMembership.objects.create(
                    team=team, service_account=request.auth["service_account"]
                )

        _audit_team_event(
            request,
            org,
            team,
            event_type="C",
            new_values={
                "name": team.name,
                "description": team.description,
                "member_role": team.member_role.name if team.member_role else None,
                "service_account_role": (
                    team.service_account_role.name
                    if team.service_account_role
                    else None
                ),
            },
            description=f"Created team '{team.name}'",
        )

        return Response(
            _serialize_team(team, include_detail=True),
            status=status.HTTP_201_CREATED,
        )


# ────────────────────────────────────────────────────────────────────
# Detail: get + update + delete
# ────────────────────────────────────────────────────────────────────


class PublicTeamDetailView(APIView):
    authentication_classes = [PhaseTokenAuthentication]
    permission_classes = [IsAuthenticated, IsIPAllowed]
    throttle_classes = [PlanBasedRateThrottle]
    renderer_classes = [CamelCaseJSONRenderer]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)

        action = METHOD_TO_ACTION.get(request.method)
        if not action:
            raise MethodNotAllowed(request.method)

        org = _get_org(request)
        account = _caller_account(request)
        is_sa = request.auth["auth_type"] == "ServiceAccount"
        if not user_has_permission(account, action, "Teams", org, False, is_sa):
            raise PermissionDenied(
                f"You don't have permission to {action} teams."
            )

    def _get_team(self, team_id, org):
        try:
            return (
                Team.objects.select_related(
                    "member_role", "service_account_role", "owner__user"
                ).get(id=team_id, organisation=org, deleted_at__isnull=True)
            )
        except (ObjectDoesNotExist, ValueError):
            return None

    def get(self, request, team_id, *args, **kwargs):
        org = _get_org(request)
        team = self._get_team(team_id, org)
        if team is None:
            return Response(
                {"error": "Team not found."},
                status=status.HTTP_404_NOT_FOUND,
            )
        _ensure_caller_can_see_team(request, team)
        return Response(
            _serialize_team(team, include_detail=True),
            status=status.HTTP_200_OK,
        )

    def put(self, request, team_id, *args, **kwargs):
        org = _get_org(request)
        team = self._get_team(team_id, org)
        if team is None:
            return Response(
                {"error": "Team not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Write-side gate: only team members or global-access callers can
        # mutate team settings, on top of the org "update Teams" permission
        # already verified in initial().
        if not _caller_has_global_access(request) and not _is_team_member(
            request, team
        ):
            raise PermissionDenied("You don't have access to this team.")

        if team.is_scim_managed:
            return Response(
                {
                    "error": (
                        "This team is managed by SCIM. Name, description, and "
                        "role overrides must be updated via the SCIM provider."
                    )
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        # Mirror the POST handler: is_scim_managed is set only by the
        # SCIM provisioning flow itself. Silently dropping it on PUT
        # (the previous behaviour) hid mistakes and was inconsistent
        # with POST returning a clear 400.
        if "is_scim_managed" in request.data:
            return Response(
                {
                    "error": (
                        "The is_scim_managed flag is set automatically by the "
                        "SCIM provisioning flow and cannot be set via this endpoint."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        old_name = team.name
        old_description = team.description
        old_member_role = team.member_role.name if team.member_role else None
        old_sa_role = (
            team.service_account_role.name if team.service_account_role else None
        )

        raw_name = request.data.get("name")
        raw_desc = request.data.get("description")
        raw_member_role = request.data.get("member_role_id", None)
        raw_sa_role = request.data.get("service_account_role_id", None)

        if (
            raw_name is None
            and raw_desc is None
            and raw_member_role is None
            and raw_sa_role is None
        ):
            return Response(
                {"error": "At least one field must be provided."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if raw_name is not None:
            name, err = validate_text_field(raw_name, "name", max_length=64)
            if err:
                return Response({"error": err}, status=status.HTTP_400_BAD_REQUEST)
            team.name = name

        if raw_desc is not None:
            description, err = validate_text_field(
                raw_desc, "description", max_length=10000, required=False
            )
            if err:
                return Response({"error": err}, status=status.HTTP_400_BAD_REQUEST)
            team.description = description or ""

        # role_id="" → clear override; non-empty → set to that role
        if raw_member_role is not None:
            if raw_member_role == "":
                team.member_role = None
            else:
                role, err_response = _resolve_role_or_404(raw_member_role, org)
                if err_response is not None:
                    return err_response
                team.member_role = role

        if raw_sa_role is not None:
            if raw_sa_role == "":
                team.service_account_role = None
            else:
                role, err_response = _resolve_role_or_404(raw_sa_role, org)
                if err_response is not None:
                    return err_response
                team.service_account_role = role

        team.save()

        _audit_team_event(
            request,
            org,
            team,
            event_type="U",
            old_values={
                "name": old_name,
                "description": old_description,
                "member_role": old_member_role,
                "service_account_role": old_sa_role,
            },
            new_values={
                "name": team.name,
                "description": team.description,
                "member_role": team.member_role.name if team.member_role else None,
                "service_account_role": (
                    team.service_account_role.name
                    if team.service_account_role
                    else None
                ),
            },
            description=f"Updated team '{team.name}'",
        )

        return Response(
            _serialize_team(team, include_detail=True),
            status=status.HTTP_200_OK,
        )

    def delete(self, request, team_id, *args, **kwargs):
        org = _get_org(request)
        team = self._get_team(team_id, org)
        if team is None:
            return Response(
                {"error": "Team not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if not _caller_has_global_access(request) and not _is_team_member(
            request, team
        ):
            raise PermissionDenied("You don't have access to this team.")

        if team.is_scim_managed:
            return Response(
                {
                    "error": (
                        "SCIM-managed teams cannot be deleted via the API. "
                        "Delete the corresponding group in the SCIM provider."
                    )
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        team_name = team.name
        actor_type, actor_id, actor_meta = get_actor_info(request)
        ip_address, user_agent = get_resolver_request_meta(request)

        with transaction.atomic():
            # Revoke every key the team granted (orphan EnvironmentKeys
            # are soft-deleted; keys with remaining INDIVIDUAL grants
            # survive). Call sa.delete() so the SA's tokens AND its own
            # EnvironmentKey rows are soft-deleted+wiped via the model
            # override — inlining the soft-delete here previously left
            # the SA's wrapping material live in the DB.
            audit_team_cascade_sas(
                team, actor_type, actor_id, actor_meta, ip_address, user_agent
            )
            revoke_team_environment_keys(team)
            for sa in ServiceAccount.objects.filter(team=team, deleted_at=None):
                sa.delete()
            team.deleted_at = timezone.now()
            team.save()

        _audit_team_event(
            request,
            org,
            team,
            event_type="D",
            old_values={"name": team_name},
            description=f"Deleted team '{team_name}'",
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


# ────────────────────────────────────────────────────────────────────
# Members: add + remove
# ────────────────────────────────────────────────────────────────────


class PublicTeamMembersView(APIView):
    """POST /v1/teams/<team_id>/members/ — add one or more team members.

    Body: {"member_type": "user" | "service_account", "member_ids": [...]}.
    SCIM-managed teams accept SA additions but reject USER additions.
    """

    authentication_classes = [PhaseTokenAuthentication]
    permission_classes = [IsAuthenticated, IsIPAllowed]
    throttle_classes = [PlanBasedRateThrottle]
    renderer_classes = [CamelCaseJSONRenderer]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        action = METHOD_TO_ACTION.get(request.method)
        if not action:
            raise MethodNotAllowed(request.method)
        org = _get_org(request)
        account = _caller_account(request)
        is_sa = request.auth["auth_type"] == "ServiceAccount"
        # Mutating membership counts as updating the team — mirrors the
        # GraphQL mutations which require "update" on Teams.
        if not user_has_permission(account, "update", "Teams", org, False, is_sa):
            raise PermissionDenied(
                "You don't have permission to update teams."
            )

    def post(self, request, team_id, *args, **kwargs):
        org = _get_org(request)
        try:
            team = Team.objects.get(
                id=team_id, organisation=org, deleted_at__isnull=True
            )
        except (ObjectDoesNotExist, ValueError):
            return Response(
                {"error": "Team not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if not _caller_has_global_access(request) and not _is_team_member(
            request, team
        ):
            raise PermissionDenied("You don't have access to this team.")

        member_type = request.data.get("member_type", USER)
        if member_type not in _VALID_MEMBER_TYPES:
            return Response(
                {
                    "error": (
                        f"'member_type' must be one of {sorted(_VALID_MEMBER_TYPES)}."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        if team.is_scim_managed and member_type == USER:
            return Response(
                {
                    "error": (
                        "User membership of SCIM-managed teams is controlled "
                        "by the SCIM provider. Service-account additions are "
                        "permitted."
                    )
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        member_ids = request.data.get("member_ids")
        if not isinstance(member_ids, list) or not member_ids:
            return Response(
                {"error": "'member_ids' must be a non-empty list."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        new_memberships = []
        with transaction.atomic():
            if member_type == USER:
                org_members = list(
                    OrganisationMember.objects.filter(
                        id__in=member_ids,
                        organisation=org,
                        deleted_at=None,
                    )
                )
                found = {str(m.id) for m in org_members}
                missing = [m for m in member_ids if str(m) not in found]
                if missing:
                    return Response(
                        {"error": f"Member(s) not found: {', '.join(missing)}."},
                        status=status.HTTP_404_NOT_FOUND,
                    )
                for om in org_members:
                    membership, created = TeamMembership.objects.get_or_create(
                        team=team, org_member=om
                    )
                    if created:
                        new_memberships.append(membership)
            else:
                service_accounts = list(
                    ServiceAccount.objects.filter(
                        id__in=member_ids,
                        organisation=org,
                        deleted_at=None,
                    )
                )
                found = {str(s.id) for s in service_accounts}
                missing = [m for m in member_ids if str(m) not in found]
                if missing:
                    return Response(
                        {"error": f"Service account(s) not found: {', '.join(missing)}."},
                        status=status.HTTP_404_NOT_FOUND,
                    )
                # Team-owned SAs cannot be added to a different team.
                for sa in service_accounts:
                    if sa.team_id is not None and str(sa.team_id) != str(team.id):
                        return Response(
                            {
                                "error": (
                                    f"Service account '{sa.name}' is owned by another team "
                                    f"and cannot be added to this team."
                                )
                            },
                            status=status.HTTP_409_CONFLICT,
                        )
                for sa in service_accounts:
                    membership, created = TeamMembership.objects.get_or_create(
                        team=team, service_account=sa
                    )
                    if created:
                        new_memberships.append(membership)

            # Provision team env keys for each new membership across every
            # SSE-enabled app the team already has access to.
            for membership in new_memberships:
                _provision_keys_for_team_membership(team, membership)

        _audit_team_event(
            request,
            org,
            team,
            event_type="U",
            new_values={
                "members_added": [_serialize_member_ref(m) for m in new_memberships]
            },
            description=(
                f"Added {len(new_memberships)} {member_type} member(s) to "
                f"team '{team.name}'"
            ),
        )

        return Response(
            _serialize_team(team, include_detail=True),
            status=status.HTTP_200_OK,
        )


class PublicTeamMemberDetailView(APIView):
    """DELETE /v1/teams/<team_id>/members/<member_id>/?member_type=user|service_account
    — remove one team member. SCIM-managed teams reject user removals;
    team-owned SAs cannot leave their owning team.
    """

    authentication_classes = [PhaseTokenAuthentication]
    permission_classes = [IsAuthenticated, IsIPAllowed]
    throttle_classes = [PlanBasedRateThrottle]
    renderer_classes = [CamelCaseJSONRenderer]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        action = METHOD_TO_ACTION.get(request.method)
        if not action:
            raise MethodNotAllowed(request.method)
        org = _get_org(request)
        account = _caller_account(request)
        is_sa = request.auth["auth_type"] == "ServiceAccount"
        if not user_has_permission(account, "update", "Teams", org, False, is_sa):
            raise PermissionDenied(
                "You don't have permission to update teams."
            )

    def delete(self, request, team_id, member_id, *args, **kwargs):
        org = _get_org(request)
        try:
            team = Team.objects.get(
                id=team_id, organisation=org, deleted_at__isnull=True
            )
        except (ObjectDoesNotExist, ValueError):
            return Response(
                {"error": "Team not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if not _caller_has_global_access(request) and not _is_team_member(
            request, team
        ):
            raise PermissionDenied("You don't have access to this team.")

        member_type = request.query_params.get("member_type", USER)
        if member_type not in _VALID_MEMBER_TYPES:
            return Response(
                {
                    "error": (
                        f"'member_type' must be one of {sorted(_VALID_MEMBER_TYPES)}."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        if team.is_scim_managed and member_type == USER:
            return Response(
                {
                    "error": (
                        "User membership of SCIM-managed teams is controlled "
                        "by the SCIM provider."
                    )
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        with transaction.atomic():
            if member_type == USER:
                try:
                    membership = TeamMembership.objects.get(
                        team=team, org_member_id=member_id
                    )
                except (TeamMembership.DoesNotExist, ValueError):
                    return Response(
                        {"error": "Member not found in this team."},
                        status=status.HTTP_404_NOT_FOUND,
                    )
                revoke_team_environment_keys(team, member=membership.org_member)
            else:
                try:
                    sa = ServiceAccount.objects.get(
                        id=member_id, organisation=org, deleted_at=None
                    )
                except (ObjectDoesNotExist, ValueError):
                    return Response(
                        {"error": "Service account not found."},
                        status=status.HTTP_404_NOT_FOUND,
                    )
                # A team-owned SA cannot leave its owning team — would
                # orphan the SA's membership invariant.
                if sa.team_id is not None and str(sa.team_id) == str(team.id):
                    return Response(
                        {
                            "error": (
                                "This service account is owned by the team and "
                                "cannot be removed. Delete the service account or "
                                "transfer ownership to org-level first."
                            )
                        },
                        status=status.HTTP_409_CONFLICT,
                    )
                try:
                    membership = TeamMembership.objects.get(team=team, service_account=sa)
                except TeamMembership.DoesNotExist:
                    return Response(
                        {"error": "Service account is not a member of this team."},
                        status=status.HTTP_404_NOT_FOUND,
                    )
                revoke_team_environment_keys(team, member=sa)
            removed_ref = _serialize_member_ref(membership)
            membership.delete()

        _audit_team_event(
            request,
            org,
            team,
            event_type="U",
            old_values={"members_removed": [removed_ref]},
            description=f"Removed {member_type} member from team '{team.name}'",
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


# ────────────────────────────────────────────────────────────────────
# Access: declarative app + environment scoping
# ────────────────────────────────────────────────────────────────────


class PublicTeamAccessView(APIView):
    """PUT /v1/teams/<team_id>/access/ — declarative set of (app, [envs])
    the team has access to. Mirrors the shape of /members/:id/access/
    and /service-accounts/:id/access/."""

    authentication_classes = [PhaseTokenAuthentication]
    permission_classes = [IsAuthenticated, IsIPAllowed]
    throttle_classes = [PlanBasedRateThrottle]
    renderer_classes = [CamelCaseJSONRenderer]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        action = METHOD_TO_ACTION.get(request.method)
        if not action:
            raise MethodNotAllowed(request.method)
        org = _get_org(request)
        account = _caller_account(request)
        is_sa = request.auth["auth_type"] == "ServiceAccount"
        if not user_has_permission(account, "update", "Teams", org, False, is_sa):
            raise PermissionDenied(
                "You don't have permission to update teams."
            )

    def put(self, request, team_id, *args, **kwargs):
        org = _get_org(request)
        try:
            team = Team.objects.get(
                id=team_id, organisation=org, deleted_at__isnull=True
            )
        except (ObjectDoesNotExist, ValueError):
            return Response(
                {"error": "Team not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if not _caller_has_global_access(request) and not _is_team_member(
            request, team
        ):
            raise PermissionDenied("You don't have access to this team.")

        apps_input = request.data.get("apps")
        if apps_input is None:
            return Response(
                {"error": "Missing required field: apps"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not isinstance(apps_input, list):
            return Response(
                {"error": "'apps' must be a list."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Validate request shape and resolve apps + envs up front.
        desired = {}  # app_id_str → {"app": App, "env_ids": set}
        for entry in apps_input:
            if not isinstance(entry, dict):
                return Response(
                    {"error": "Each entry in 'apps' must be an object."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            app_id = entry.get("id")
            env_ids = entry.get("environments")
            if not app_id:
                return Response(
                    {"error": "Each app entry must have an 'id'."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if not isinstance(env_ids, list) or not env_ids:
                return Response(
                    {
                        "error": (
                            f"App entry for '{app_id}' must include a non-empty "
                            "'environments' list. To revoke all team access for "
                            "an app, omit it from the body."
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
            try:
                app = App.objects.get(
                    id=app_id, organisation=org, is_deleted=False
                )
            except (ObjectDoesNotExist, ValueError):
                return Response(
                    {"error": f"App not found: {app_id}."},
                    status=status.HTTP_404_NOT_FOUND,
                )
            if not app.sse_enabled:
                return Response(
                    {
                        "error": (
                            f"App '{app.name}' does not have SSE enabled. "
                            "Only SSE apps can be granted to teams."
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
            # Caller must individually have access to each app they're
            # granting to the team — same gate as GraphQL AddTeamApps.
            # Applies symmetrically to user and SA callers; without the SA
            # branch a service account could grant a team access to any
            # SSE app in the org regardless of its own visibility.
            if not _caller_has_global_access(request):
                caller_has_app_access = False
                if request.auth["auth_type"] == "User":
                    caller_has_app_access = user_can_access_app(
                        request.auth["org_member"].user.userId, app.id
                    )
                elif request.auth["auth_type"] == "ServiceAccount":
                    from api.utils.access.permissions import (
                        service_account_can_access_app,
                    )
                    caller_has_app_access = service_account_can_access_app(
                        request.auth["service_account"].id, app.id
                    )
                if not caller_has_app_access:
                    return Response(
                        {"error": f"You don't have access to app '{app.name}'."},
                        status=status.HTTP_403_FORBIDDEN,
                    )

            valid_envs = {
                str(e.id): e
                for e in Environment.objects.filter(app=app, id__in=env_ids)
            }
            missing_envs = [str(e) for e in env_ids if str(e) not in valid_envs]
            if missing_envs:
                return Response(
                    {
                        "error": (
                            f"Environment(s) not found in app '{app.name}': "
                            f"{', '.join(missing_envs)}."
                        )
                    },
                    status=status.HTTP_404_NOT_FOUND,
                )
            desired[str(app.id)] = {
                "app": app,
                "env_ids": set(valid_envs.keys()),
            }

        with transaction.atomic():
            current = {
                str(tae.environment_id): tae
                for tae in TeamAppEnvironment.objects.filter(team=team)
            }
            current_app_ids = {str(tae.app_id) for tae in current.values()}
            desired_app_ids = set(desired.keys())

            # Apps to fully revoke (no longer in desired).
            apps_to_revoke = current_app_ids - desired_app_ids
            for app_id_str in apps_to_revoke:
                app = App.objects.filter(id=app_id_str).first()
                if app is not None:
                    revoke_team_environment_keys(team, app=app)
                TeamAppEnvironment.objects.filter(team=team, app_id=app_id_str).delete()

            # Per-app env diff for apps in desired set.
            for app_id_str, info in desired.items():
                app = info["app"]
                desired_env_ids = info["env_ids"]
                current_env_ids = {
                    str(tae.environment_id)
                    for tae in current.values()
                    if str(tae.app_id) == app_id_str
                }

                env_ids_to_remove = current_env_ids - desired_env_ids
                if env_ids_to_remove:
                    envs_to_remove = Environment.objects.filter(
                        id__in=env_ids_to_remove
                    )
                    revoke_team_environment_keys(
                        team, environments=list(envs_to_remove)
                    )
                    TeamAppEnvironment.objects.filter(
                        team=team, environment_id__in=env_ids_to_remove
                    ).delete()

                env_ids_to_add = desired_env_ids - current_env_ids
                for env_id_str in env_ids_to_add:
                    env = Environment.objects.get(id=env_id_str)
                    TeamAppEnvironment.objects.get_or_create(
                        team=team, app=app, environment=env
                    )

                # Always reprovision keys for the desired env set —
                # `provision_team_environment_keys` is idempotent (checks
                # for existing keys + grants per member).
                provision_team_environment_keys(team, app)

        _audit_team_event(
            request,
            org,
            team,
            event_type="U",
            new_values={
                "access_updated": [
                    {
                        "app": info["app"].name,
                        "environments": sorted(info["env_ids"]),
                    }
                    for info in desired.values()
                ]
            },
            description=f"Updated access scope for team '{team.name}'",
        )

        return Response(
            _serialize_team(team, include_detail=True),
            status=status.HTTP_200_OK,
        )
