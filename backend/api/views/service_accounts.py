import json
import logging
from datetime import datetime

from django.core.exceptions import ObjectDoesNotExist
from django.utils import timezone

from api.auth import PhaseTokenAuthentication
from api.models import (
    App,
    Environment,
    EnvironmentKey,
    OrganisationMember,
    Role,
    ServiceAccount,
    ServiceAccountToken,
    Team,
    TeamAppEnvironment,
    TeamMembership,
)
from django.db.models import Q
from api.serializers import ServiceAccountSerializer
from api.utils.access.permissions import (
    role_has_global_access,
    role_has_permission,
    service_account_can_access_app,
    service_account_can_access_environment,
    user_can_access_app,
    user_can_access_environment,
    user_has_permission,
)
from api.utils.crypto import (
    decrypt_asymmetric,
    ed25519_to_kx,
    encrypt_asymmetric,
    get_server_keypair,
    random_hex,
    split_secret_hex,
    wrap_share_hex,
)
from api.utils.environments import _ed25519_pk_to_curve25519, _wrap_env_secrets_for_key
from api.utils.keys import (
    provision_team_environment_keys,
    revoke_individual_environment_keys,
    track_individual_environment_grants,
)
from api.utils.audit_logging import log_audit_event, get_actor_info, build_change_values
from api.utils.rest import METHOD_TO_ACTION, get_resolver_request_meta, validate_text_field
from api.utils.service_accounts import generate_server_managed_sa_keys
from api.throttling import PlanBasedRateThrottle
from api.utils.access.middleware import IsIPAllowed
from backend.quotas import can_use_teams

from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.exceptions import MethodNotAllowed, PermissionDenied
from rest_framework.response import Response
from rest_framework import status
from djangorestframework_camel_case.render import CamelCaseJSONRenderer
from django.conf import settings
from django.db import transaction

logger = logging.getLogger(__name__)

CLOUD_HOSTED = settings.APP_HOST == "cloud"


def _serialize_sa(sa):
    """Serialize a ServiceAccount with token count and timestamps."""
    data = ServiceAccountSerializer(sa).data
    data["created_at"] = sa.created_at
    data["updated_at"] = sa.updated_at
    return data


def _caller_team_ids(request):
    """Team IDs the calling principal is a member of (for team-owned SA
    visibility scoping). Returns an empty queryset if the principal has
    no team memberships or is an SA without team affiliation."""
    if request.auth["auth_type"] == "User":
        return TeamMembership.objects.filter(
            org_member=request.auth["org_member"],
            team__deleted_at__isnull=True,
        ).values_list("team_id", flat=True)
    if request.auth["auth_type"] == "ServiceAccount":
        return TeamMembership.objects.filter(
            service_account=request.auth["service_account"],
            team__deleted_at__isnull=True,
        ).values_list("team_id", flat=True)
    return TeamMembership.objects.none().values_list("team_id", flat=True)


def _mint_sa_token(sa, name, expires_at, created_by, created_by_sa):
    """Generate an SA token end-to-end via SSK. Returns (ServiceAccountToken,
    full_token_string, bearer_token_string). Caller is responsible for
    verifying SA visibility, permission, and SSK availability."""
    pk, sk = get_server_keypair()
    keyring_json = decrypt_asymmetric(
        sa.server_wrapped_keyring, sk.hex(), pk.hex()
    )
    keyring = json.loads(keyring_json)
    kx_pub, kx_priv = ed25519_to_kx(keyring["publicKey"], keyring["privateKey"])

    wrap_key = random_hex(32)
    token_value = random_hex(32)
    share_a, share_b = split_secret_hex(kx_priv)
    wrapped_share_b = wrap_share_hex(share_b, wrap_key)

    token = ServiceAccountToken.objects.create(
        service_account=sa,
        name=name,
        identity_key=kx_pub,
        token=token_value,
        wrapped_key_share=wrapped_share_b,
        created_by=created_by,
        created_by_service_account=created_by_sa,
        expires_at=expires_at,
    )

    full_token = f"pss_service:v2:{token_value}:{kx_pub}:{share_a}:{wrap_key}"
    bearer_token = f"ServiceAccount {token_value}"
    return token, full_token, bearer_token


def _caller_has_global_access(request):
    """True if the calling principal holds a role with global access. Used
    to short-circuit team-owned SA visibility filters."""
    if request.auth["auth_type"] == "User":
        return role_has_global_access(request.auth["org_member"].role)
    if request.auth["auth_type"] == "ServiceAccount":
        return role_has_global_access(request.auth["service_account"].role)
    return False


def _caller_can_access_app(request, app_id):
    if request.auth["auth_type"] == "User":
        return user_can_access_app(
            request.auth["org_member"].user.userId, app_id
        )
    if request.auth["auth_type"] == "ServiceAccount":
        return service_account_can_access_app(
            request.auth["service_account"].id, app_id
        )
    return False


def _caller_can_access_environment(request, env_id):
    if request.auth["auth_type"] == "User":
        return user_can_access_environment(
            request.auth["org_member"].user.userId, env_id
        )
    if request.auth["auth_type"] == "ServiceAccount":
        return service_account_can_access_environment(
            request.auth["service_account"].id, env_id
        )
    return False


def _visible_service_accounts_queryset(request, org):
    """Returns the ServiceAccount queryset scoped to what the calling
    principal is allowed to see — org-level SAs are universally visible
    to anyone with ServiceAccounts.read; team-owned SAs are only visible
    to global-access principals or members of the owning team. SAs that
    are themselves members of a shared team (without being owned by it)
    are also included for shared-team callers."""
    qs = ServiceAccount.objects.filter(
        organisation=org, deleted_at=None
    ).select_related("role")

    if _caller_has_global_access(request):
        return qs

    team_ids = list(_caller_team_ids(request))
    return qs.filter(
        Q(team__isnull=True)
        | Q(team_id__in=team_ids)
        | Q(team_memberships__team_id__in=team_ids)
    ).distinct()


def _resolve_team_for_sa_create(request, org, team_id, sa_role):
    """Validates that a team-owned SA can be created in the supplied team:
    org plan allows teams; the team exists; the calling principal is either
    a team owner / member or holds global access; and the caller's effective
    role (team override → caller role) grants ServiceAccounts.create.

    Returns (team, error_response_or_None). On error, the second tuple
    element is a fully-formed REST Response the caller should return.
    """
    if not can_use_teams(org):
        return None, Response(
            {"error": "Teams are not available on your organisation's plan."},
            status=status.HTTP_403_FORBIDDEN,
        )

    try:
        team = Team.objects.get(id=team_id, organisation=org, deleted_at__isnull=True)
    except (ObjectDoesNotExist, ValueError):
        return None, Response(
            {"error": "Team not found."},
            status=status.HTTP_404_NOT_FOUND,
        )

    has_global = _caller_has_global_access(request)
    auth_type = request.auth["auth_type"]

    if auth_type == "User":
        caller_member = request.auth["org_member"]
        is_team_owner = team.owner_id is not None and team.owner_id == caller_member.id
        is_team_member = TeamMembership.objects.filter(
            team=team, org_member=caller_member, team__deleted_at__isnull=True
        ).exists()
        if not (has_global or is_team_owner or is_team_member):
            return None, Response(
                {"error": "You are not a member of this team."},
                status=status.HTTP_403_FORBIDDEN,
            )
        effective_role = team.member_role or caller_member.role
    elif auth_type == "ServiceAccount":
        caller_sa = request.auth["service_account"]
        is_team_member = TeamMembership.objects.filter(
            team=team, service_account=caller_sa, team__deleted_at__isnull=True
        ).exists()
        if not (has_global or is_team_member):
            return None, Response(
                {"error": "Service account is not a member of this team."},
                status=status.HTTP_403_FORBIDDEN,
            )
        effective_role = team.service_account_role or caller_sa.role
    else:
        return None, Response(
            {"error": "Unsupported auth type for team-owned service account creation."},
            status=status.HTTP_403_FORBIDDEN,
        )

    # Permission check against the effective role — global-access roles
    # short-circuit. Mirrors _check_sa_permission for create.
    if not has_global and not role_has_permission(
        effective_role, "create", "ServiceAccounts"
    ):
        return None, Response(
            {
                "error": (
                    "Your effective role on this team does not grant permission "
                    "to create service accounts."
                )
            },
            status=status.HTTP_403_FORBIDDEN,
        )

    # The SA being created cannot itself hold a global-access role — same
    # rule as org-level SA creation, applied to the team-owned variant.
    if role_has_global_access(sa_role):
        return None, Response(
            {
                "error": (
                    f"Service accounts cannot be assigned the '{sa_role.name}' role."
                )
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    return team, None


def _can_access_service_account(request, sa):
    """Authorization gate for accessing a specific service account record.
    Org-level SAs are accessible to any caller with the required org
    ServiceAccounts permission (checked separately in initial()).
    Team-owned SAs require global access OR membership in the owning
    team — same rule as _check_sa_permission in permissions.py."""
    if sa.team is None:
        return True

    if _caller_has_global_access(request):
        return True

    if request.auth["auth_type"] == "User":
        org_member = request.auth["org_member"]
        if sa.team.owner_id is not None and sa.team.owner_id == org_member.id:
            return True
        return TeamMembership.objects.filter(
            team=sa.team, org_member=org_member, team__deleted_at__isnull=True
        ).exists()

    if request.auth["auth_type"] == "ServiceAccount":
        return TeamMembership.objects.filter(
            team=sa.team,
            service_account=request.auth["service_account"],
            team__deleted_at__isnull=True,
        ).exists()

    return False


def _serialize_sa_detail(sa):
    """Serialize a ServiceAccount with full detail including tokens and app access."""
    data = _serialize_sa(sa)

    # Include non-deleted tokens (name, id, created_at only — no secret material)
    tokens = sa.serviceaccounttoken_set.filter(deleted_at=None).order_by("-created_at")
    data["tokens"] = [
        {
            "id": t.id,
            "name": t.name,
            "created_at": t.created_at,
            "expires_at": t.expires_at,
        }
        for t in tokens
    ]

    # Include app memberships with environment access
    apps_data = []
    for app in sa.apps.filter(is_deleted=False).order_by("-created_at"):
        env_keys = EnvironmentKey.objects.filter(
            service_account=sa,
            environment__app=app,
            deleted_at=None,
        ).select_related("environment")
        apps_data.append(
            {
                "id": str(app.id),
                "name": app.name,
                "environments": [
                    {
                        "id": str(ek.environment.id),
                        "name": ek.environment.name,
                        "env_type": ek.environment.env_type,
                    }
                    for ek in env_keys
                ],
            }
        )
    data["apps"] = apps_data

    return data


class PublicServiceAccountsView(APIView):
    authentication_classes = [PhaseTokenAuthentication]
    permission_classes = [IsAuthenticated, IsIPAllowed]
    throttle_classes = [PlanBasedRateThrottle]
    renderer_classes = [CamelCaseJSONRenderer]

    def _get_org(self, request):
        if request.auth.get("organisation"):
            return request.auth["organisation"]
        if request.auth.get("app"):
            return request.auth["app"].organisation
        raise PermissionDenied("Could not resolve organisation from request.")

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)

        action = METHOD_TO_ACTION.get(request.method)
        if not action:
            raise MethodNotAllowed(request.method)

        account = None
        is_sa = False
        if request.auth["auth_type"] == "User":
            account = request.auth["org_member"].user
        elif request.auth["auth_type"] == "ServiceAccount":
            account = request.auth["service_account"]
            is_sa = True

        if account is not None:
            org = self._get_org(request)
            if not user_has_permission(
                account, action, "ServiceAccounts", org, False, is_sa
            ):
                raise PermissionDenied(
                    f"You don't have permission to {action} service accounts."
                )

    def get(self, request, *args, **kwargs):
        org = self._get_org(request)

        service_accounts = _visible_service_accounts_queryset(request, org).order_by(
            "-created_at"
        )

        data = [_serialize_sa(sa) for sa in service_accounts]
        return Response(data, status=status.HTTP_200_OK)

    def post(self, request, *args, **kwargs):
        org = self._get_org(request)

        # --- Validate input ---
        name, err = validate_text_field(request.data.get("name"), "name", max_length=64)
        if err:
            return Response({"error": err}, status=status.HTTP_400_BAD_REQUEST)

        # Validate token_name up-front so an invalid value doesn't leave
        # behind an orphan SA + phantom Stripe seat after the atomic block
        # below has already committed.
        raw_token_name = request.data.get("token_name", "Default")
        token_name, err = validate_text_field(
            raw_token_name, "token_name", max_length=64
        )
        if err:
            return Response({"error": err}, status=status.HTTP_400_BAD_REQUEST)
        token_name = token_name or "Default"

        # --- Validate role ---
        role_id = request.data.get("role_id")
        if not role_id:
            return Response(
                {"error": "Missing required field: role_id"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            role = Role.objects.get(id=role_id, organisation=org)
        except (ObjectDoesNotExist, ValueError):
            return Response(
                {"error": "Role not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Team-owned SA path: validate team, caller membership, effective
        # role permission, and the global-access guard on the SA's role.
        # The team-aware path also handles the global-access role guard,
        # so we only run the org-level check when team_id is absent.
        team_id = request.data.get("team_id")
        team = None
        if team_id is not None:
            team, err_response = _resolve_team_for_sa_create(request, org, team_id, role)
            if err_response is not None:
                return err_response
        else:
            if role_has_global_access(role):
                return Response(
                    {"error": f"Service accounts cannot be assigned the '{role.name}' role."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        # --- Generate cryptographic material ---
        identity_key, server_wrapped_keyring, server_wrapped_recovery = (
            generate_server_managed_sa_keys()
        )

        # --- Create service account ---
        try:
            with transaction.atomic():
                sa = ServiceAccount.objects.create(
                    name=name,
                    organisation=org,
                    role=role,
                    team=team,
                    identity_key=identity_key,
                    server_wrapped_keyring=server_wrapped_keyring,
                    server_wrapped_recovery=server_wrapped_recovery,
                )
                if team is not None:
                    # Auto-add as a team member and provision env keys for
                    # every SSE-enabled app the team has access to. Mirrors
                    # the GraphQL CreateServiceAccountMutation team flow.
                    TeamMembership.objects.create(team=team, service_account=sa)
                    team_app_ids = (
                        TeamAppEnvironment.objects.filter(team=team)
                        .values_list("app_id", flat=True)
                        .distinct()
                    )
                    for team_app in App.objects.filter(
                        id__in=team_app_ids, sse_enabled=True, is_deleted=False
                    ):
                        provision_team_environment_keys(team, team_app)
        except ValueError as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_403_FORBIDDEN,
            )

        if CLOUD_HOSTED:
            from ee.billing.stripe import update_stripe_subscription_seats

            update_stripe_subscription_seats(org)

        # --- Mint an initial token (token_name already validated above) ---
        created_by = None
        created_by_sa = None
        if request.auth["auth_type"] == "User":
            created_by = request.auth["org_member"]
        elif request.auth["auth_type"] == "ServiceAccount":
            created_by_sa = request.auth["service_account"]

        _token, full_token, bearer_token = _mint_sa_token(
            sa,
            name=str(token_name).strip()[:64],
            expires_at=None,
            created_by=created_by,
            created_by_sa=created_by_sa,
        )

        # Audit log — SA creation
        actor_type, actor_id, actor_meta = get_actor_info(request)
        ip_address, user_agent = get_resolver_request_meta(request)
        log_audit_event(
            organisation=org,
            event_type="C",
            resource_type="sa",
            resource_id=sa.id,
            actor_type=actor_type,
            actor_id=actor_id,
            actor_metadata=actor_meta,
            resource_metadata={
                "name": sa.name,
                **({"team_id": str(team.id), "team_name": team.name} if team else {}),
            },
            new_values={
                "name": sa.name,
                "role": role.name,
                **({"team": team.name} if team else {}),
            },
            description=(
                f"Created service account '{sa.name}' with role '{role.name}'"
                f"{f' in team {team.name}' if team else ''}"
            ),
            ip_address=ip_address,
            user_agent=user_agent,
        )

        response_data = _serialize_sa(sa)
        response_data["token"] = full_token
        response_data["bearer_token"] = bearer_token
        return Response(response_data, status=status.HTTP_201_CREATED)


class PublicServiceAccountDetailView(APIView):
    authentication_classes = [PhaseTokenAuthentication]
    permission_classes = [IsAuthenticated, IsIPAllowed]
    throttle_classes = [PlanBasedRateThrottle]
    renderer_classes = [CamelCaseJSONRenderer]

    def _get_org(self, request):
        if request.auth.get("organisation"):
            return request.auth["organisation"]
        if request.auth.get("app"):
            return request.auth["app"].organisation
        raise PermissionDenied("Could not resolve organisation from request.")

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)

        action = METHOD_TO_ACTION.get(request.method)
        if not action:
            raise MethodNotAllowed(request.method)

        account = None
        is_sa = False
        if request.auth["auth_type"] == "User":
            account = request.auth["org_member"].user
        elif request.auth["auth_type"] == "ServiceAccount":
            account = request.auth["service_account"]
            is_sa = True

        if account is not None:
            org = self._get_org(request)
            if not user_has_permission(
                account, action, "ServiceAccounts", org, False, is_sa
            ):
                raise PermissionDenied(
                    f"You don't have permission to {action} service accounts."
                )

    def _get_service_account(self, request, sa_id):
        org = self._get_org(request)
        try:
            sa = ServiceAccount.objects.select_related("role").get(
                id=sa_id,
                organisation=org,
                deleted_at=None,
            )
        except (ObjectDoesNotExist, ValueError):
            return None

        # Team-owned SAs are invisible to non-team-members (mirrors the
        # GraphQL resolver). Return None → 404 from the caller so we don't
        # leak the SA's existence to non-team-members.
        if not _can_access_service_account(request, sa):
            return None

        return sa

    def get(self, request, sa_id, *args, **kwargs):
        sa = self._get_service_account(request, sa_id)
        if sa is None:
            return Response(
                {"error": "Service account not found."},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(_serialize_sa_detail(sa), status=status.HTTP_200_OK)

    def put(self, request, sa_id, *args, **kwargs):
        sa = self._get_service_account(request, sa_id)
        if sa is None:
            return Response(
                {"error": "Service account not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        old_name = sa.name
        old_role_name = sa.role.name if sa.role else None

        raw_name = request.data.get("name")
        role_id = request.data.get("role_id")

        if raw_name is None and role_id is None:
            return Response(
                {"error": "At least one of 'name' or 'role_id' must be provided."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if raw_name is not None:
            name, err = validate_text_field(raw_name, "name", max_length=64)
            if err:
                return Response({"error": err}, status=status.HTTP_400_BAD_REQUEST)
            sa.name = name

        if role_id is not None:
            try:
                role = Role.objects.get(id=role_id, organisation=sa.organisation)
            except (ObjectDoesNotExist, ValueError):
                return Response(
                    {"error": "Role not found."},
                    status=status.HTTP_404_NOT_FOUND,
                )
            if role_has_global_access(role):
                return Response(
                    {"error": f"Service accounts cannot be assigned the '{role.name}' role."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            sa.role = role

        sa.save()

        # Audit log
        old_vals = {}
        new_vals = {}
        if raw_name is not None and old_name != sa.name:
            old_vals["name"] = old_name
            new_vals["name"] = sa.name
        if role_id is not None and old_role_name != (sa.role.name if sa.role else None):
            old_vals["role"] = old_role_name
            new_vals["role"] = sa.role.name if sa.role else None
        if old_vals:
            actor_type, actor_id, actor_meta = get_actor_info(request)
            ip_address, user_agent = get_resolver_request_meta(request)
            log_audit_event(
                organisation=sa.organisation,
                event_type="U",
                resource_type="sa",
                resource_id=sa.id,
                actor_type=actor_type,
                actor_id=actor_id,
                actor_metadata=actor_meta,
                resource_metadata={"name": sa.name},
                old_values=old_vals,
                new_values=new_vals,
                description=f"Updated service account '{sa.name}'",
                ip_address=ip_address,
                user_agent=user_agent,
            )

        return Response(_serialize_sa_detail(sa), status=status.HTTP_200_OK)

    def delete(self, request, sa_id, *args, **kwargs):
        sa = self._get_service_account(request, sa_id)
        if sa is None:
            return Response(
                {"error": "Service account not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        sa_name = sa.name
        sa_role_name = sa.role.name if sa.role else None
        org = sa.organisation
        sa.delete()

        if CLOUD_HOSTED:
            from ee.billing.stripe import update_stripe_subscription_seats

            update_stripe_subscription_seats(org)

        # Audit log
        actor_type, actor_id, actor_meta = get_actor_info(request)
        ip_address, user_agent = get_resolver_request_meta(request)
        log_audit_event(
            organisation=org,
            event_type="D",
            resource_type="sa",
            resource_id=sa_id,
            actor_type=actor_type,
            actor_id=actor_id,
            actor_metadata=actor_meta,
            resource_metadata={"name": sa_name},
            old_values={"name": sa_name, "role": sa_role_name},
            description=f"Deleted service account '{sa_name}'",
            ip_address=ip_address,
            user_agent=user_agent,
        )

        return Response(status=status.HTTP_204_NO_CONTENT)


class PublicServiceAccountAccessView(APIView):
    """
    Manage app and environment access for a service account.

    PUT /service-accounts/<sa_id>/access/

    Request body:
        {
            "apps": [
                {
                    "id": "<app_id>",
                    "environments": ["<env_id_1>", "<env_id_2>"]
                },
                ...
            ]
        }

    This replaces the service account's entire access configuration.
    - Apps not in the list are removed.
    - Environment access is granted by creating EnvironmentKey records
      with server-wrapped keys for the SA's identity key.
    - Environments not in the list for a given app are revoked.
    """

    authentication_classes = [PhaseTokenAuthentication]
    permission_classes = [IsAuthenticated, IsIPAllowed]
    throttle_classes = [PlanBasedRateThrottle]
    renderer_classes = [CamelCaseJSONRenderer]

    def _get_org(self, request):
        if request.auth.get("organisation"):
            return request.auth["organisation"]
        if request.auth.get("app"):
            return request.auth["app"].organisation
        raise PermissionDenied("Could not resolve organisation from request.")

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)

        # Access management requires "update" on ServiceAccounts
        account = None
        is_sa = False
        if request.auth["auth_type"] == "User":
            account = request.auth["org_member"].user
        elif request.auth["auth_type"] == "ServiceAccount":
            account = request.auth["service_account"]
            is_sa = True

        if account is not None:
            org = self._get_org(request)
            if not user_has_permission(
                account, "update", "ServiceAccounts", org, False, is_sa
            ):
                raise PermissionDenied(
                    "You don't have permission to update service accounts."
                )

    def put(self, request, sa_id, *args, **kwargs):
        org = self._get_org(request)

        try:
            sa = ServiceAccount.objects.select_related("role").get(
                id=sa_id,
                organisation=org,
                deleted_at=None,
            )
        except (ObjectDoesNotExist, ValueError):
            return Response(
                {"error": "Service account not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Team-owned SAs: only team members (or global-access) can manage
        # access. Return 404 rather than 403 so we don't reveal the SA's
        # existence to non-team-members.
        if not _can_access_service_account(request, sa):
            return Response(
                {"error": "Service account not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if not isinstance(sa.identity_key, str) or not sa.identity_key.strip():
            return Response(
                {
                    "error": (
                        "Service account does not have an identity key set. "
                        "Cannot grant environment access."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # --- Validate input ---
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

        # --- Resolve all apps and environments upfront ---
        desired_app_ids = set()
        desired_env_map = {}  # app_id -> set of env_ids

        for app_entry in apps_input:
            if not isinstance(app_entry, dict):
                return Response(
                    {"error": "Each entry in 'apps' must be an object with 'id' and 'environments'."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            app_id = app_entry.get("id")
            if not app_id:
                return Response(
                    {"error": "Each app entry must have an 'id' field."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            try:
                app = App.objects.get(id=app_id, organisation=org, is_deleted=False)
            except (ObjectDoesNotExist, ValueError):
                return Response(
                    {"error": f"App not found: {app_id}"},
                    status=status.HTTP_404_NOT_FOUND,
                )

            if not app.sse_enabled:
                return Response(
                    {"error": f"App '{app.name}' does not have SSE enabled. Only SSE apps are supported."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            # Server-side key wrapping means the caller can grant access
            # without ever holding it — so the caller must individually
            # own each app/env they're granting to the SA. Global-access
            # roles (Owner/Admin) short-circuit.
            caller_global = _caller_has_global_access(request)
            if not caller_global and not _caller_can_access_app(request, app.id):
                return Response(
                    {"error": f"You don't have access to app '{app.name}'."},
                    status=status.HTTP_403_FORBIDDEN,
                )

            env_ids = app_entry.get("environments")
            if env_ids is None or not isinstance(env_ids, list):
                return Response(
                    {"error": f"Each app entry must have an 'environments' list of environment IDs."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if len(env_ids) == 0:
                return Response(
                    {"error": f"'environments' for app '{app_id}' must not be empty. To revoke all access, remove the app from the list."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            # Validate all env IDs belong to this app
            valid_envs = set(
                Environment.objects.filter(
                    app=app,
                    id__in=env_ids,
                ).values_list("id", flat=True)
            )
            invalid_ids = set(str(e) for e in env_ids) - set(str(e) for e in valid_envs)
            if invalid_ids:
                return Response(
                    {"error": f"Environment(s) not found in app '{app.name}': {', '.join(invalid_ids)}"},
                    status=status.HTTP_404_NOT_FOUND,
                )

            if not caller_global:
                for env_id in valid_envs:
                    if not _caller_can_access_environment(request, env_id):
                        return Response(
                            {
                                "error": (
                                    f"You don't have access to one or more "
                                    f"environments in app '{app.name}'."
                                )
                            },
                            status=status.HTTP_403_FORBIDDEN,
                        )

            desired_app_ids.add(str(app.id))
            desired_env_map[str(app.id)] = valid_envs

        # --- Check SA has server-wrapped keyring for key wrapping ---
        if not sa.server_wrapped_keyring:
            return Response(
                {"error": "Service account does not have server-side key management enabled."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Decrypt SA keyring to get its public key for env key wrapping
        server_pk, server_sk = get_server_keypair()
        keyring_json = decrypt_asymmetric(
            sa.server_wrapped_keyring, server_sk.hex(), server_pk.hex()
        )
        keyring = json.loads(keyring_json)
        sa_kx_pub = _ed25519_pk_to_curve25519(keyring["publicKey"])

        # --- Apply changes atomically ---
        with transaction.atomic():
            # 1. Remove app memberships not in the desired list
            current_app_ids = set(
                str(a.id) for a in sa.apps.filter(is_deleted=False)
            )
            apps_to_remove = current_app_ids - desired_app_ids
            if apps_to_remove:
                apps_to_remove_qs = list(App.objects.filter(id__in=apps_to_remove))
                sa.apps.remove(*apps_to_remove_qs)
                for a in apps_to_remove_qs:
                    revoke_individual_environment_keys(sa, app=a)

            # 2. Add new app memberships
            apps_to_add = desired_app_ids - current_app_ids
            if apps_to_add:
                sa.apps.add(*App.objects.filter(id__in=apps_to_add))

            # 3. Sync environment access per app
            for app_id_str, desired_envs in desired_env_map.items():
                desired_env_id_strs = set(str(e) for e in desired_envs)

                # Get current env keys for this SA + app
                current_env_keys = EnvironmentKey.objects.filter(
                    service_account=sa,
                    environment__app_id=app_id_str,
                    deleted_at=None,
                )
                current_env_ids = set(
                    str(ek.environment_id) for ek in current_env_keys
                )

                # Revoke access to environments not in the desired list
                envs_to_revoke = current_env_ids - desired_env_id_strs
                if envs_to_revoke:
                    revoke_individual_environment_keys(
                        sa,
                        environments=Environment.objects.filter(id__in=envs_to_revoke),
                    )

                # Grant access to new environments
                envs_to_grant = desired_env_id_strs - current_env_ids
                if envs_to_grant:
                    from api.models import ServerEnvironmentKey

                    new_env_keys = []
                    for env_id in envs_to_grant:
                        # Get the ServerEnvironmentKey to obtain the env seed/salt
                        try:
                            sek = ServerEnvironmentKey.objects.get(
                                environment_id=env_id,
                                deleted_at=None,
                            )
                        except ObjectDoesNotExist:
                            logger.warning(
                                "No ServerEnvironmentKey for env %s — skipping.",
                                env_id,
                            )
                            continue

                        # Decrypt env seed/salt from server key
                        env_seed = decrypt_asymmetric(
                            sek.wrapped_seed, server_sk.hex(), server_pk.hex()
                        )
                        env_salt = decrypt_asymmetric(
                            sek.wrapped_salt, server_sk.hex(), server_pk.hex()
                        )

                        # Re-wrap for the SA's identity key
                        wrapped_seed, wrapped_salt = _wrap_env_secrets_for_key(
                            env_seed, env_salt, sa_kx_pub
                        )

                        env = Environment.objects.get(id=env_id)
                        new_env_keys.append(
                            EnvironmentKey(
                                environment=env,
                                service_account=sa,
                                identity_key=sek.identity_key,
                                wrapped_seed=wrapped_seed,
                                wrapped_salt=wrapped_salt,
                            )
                        )

                    if new_env_keys:
                        created = EnvironmentKey.objects.bulk_create(new_env_keys)
                        track_individual_environment_grants(created)

        # Audit log — build detailed access change data
        app_name_map = {
            str(a.id): a.name
            for a in App.objects.filter(
                id__in=desired_app_ids | apps_to_remove
            )
        }
        env_name_map = {
            str(e.id): e.name
            for e in Environment.objects.filter(
                app_id__in=desired_app_ids | apps_to_remove
            )
        }

        access_detail = []
        for app_id_str in apps_to_add:
            env_ids = desired_env_map.get(app_id_str, [])
            access_detail.append({
                "id": app_id_str,
                "name": app_name_map.get(app_id_str, app_id_str),
                "env_scope": sorted(env_name_map.get(str(e), str(e)) for e in env_ids),
            })

        revoked_detail = []
        for app_id_str in apps_to_remove:
            revoked_detail.append({
                "id": app_id_str,
                "name": app_name_map.get(app_id_str, app_id_str),
            })

        new_values = {}
        old_values = {}
        if access_detail:
            new_values["apps_granted"] = access_detail
        if revoked_detail:
            old_values["apps_revoked"] = revoked_detail

        # Include env scope changes for apps that weren't added/removed
        existing_apps = desired_app_ids - apps_to_add
        for app_id_str in existing_apps:
            desired_envs = set(str(e) for e in desired_env_map.get(app_id_str, []))
            current_envs = set(
                str(ek.environment_id)
                for ek in EnvironmentKey.objects.filter(
                    service_account=sa,
                    environment__app_id=app_id_str,
                    deleted_at=None,
                )
            )
            added_envs = desired_envs - current_envs  # already applied above in atomic block
            removed_envs = current_envs - desired_envs
            if added_envs or removed_envs:
                app_name = app_name_map.get(app_id_str, app_id_str)
                if added_envs:
                    new_values.setdefault("envs_added", []).append({
                        "app": app_name,
                        "environments": sorted(env_name_map.get(e, e) for e in added_envs),
                    })
                if removed_envs:
                    old_values.setdefault("envs_removed", []).append({
                        "app": app_name,
                        "environments": sorted(env_name_map.get(e, e) for e in removed_envs),
                    })

        if new_values or old_values:
            actor_type, actor_id, actor_meta = get_actor_info(request)
            ip_address, user_agent = get_resolver_request_meta(request)
            log_audit_event(
                organisation=org,
                event_type="A",
                resource_type="sa",
                resource_id=sa.id,
                actor_type=actor_type,
                actor_id=actor_id,
                actor_metadata=actor_meta,
                resource_metadata={"name": sa.name},
                old_values=old_values or None,
                new_values=new_values or None,
                description=f"Updated access for service account '{sa.name}'",
                ip_address=ip_address,
                user_agent=user_agent,
            )

        return Response(_serialize_sa_detail(sa), status=status.HTTP_200_OK)


# ---------------------------------------------------------------------------
# Service-account tokens (SSK-minted, end-to-end on the server)
# ---------------------------------------------------------------------------


class PublicServiceAccountTokensView(APIView):
    """
    POST /public/v1/service-accounts/<sa_id>/tokens/

    Mint an additional bearer token for an existing service account using
    the server-side keyring. Requires the SA to have SSK enabled (SAs
    created via this API always do).
    """

    authentication_classes = [PhaseTokenAuthentication]
    permission_classes = [IsAuthenticated, IsIPAllowed]
    throttle_classes = [PlanBasedRateThrottle]
    renderer_classes = [CamelCaseJSONRenderer]

    def _get_org(self, request):
        if request.auth.get("organisation"):
            return request.auth["organisation"]
        if request.auth.get("app"):
            return request.auth["app"].organisation
        raise PermissionDenied("Could not resolve organisation from request.")

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        account = None
        is_sa = False
        if request.auth["auth_type"] == "User":
            account = request.auth["org_member"].user
        elif request.auth["auth_type"] == "ServiceAccount":
            account = request.auth["service_account"]
            is_sa = True

        if account is not None:
            org = self._get_org(request)
            if not user_has_permission(
                account, "create", "ServiceAccountTokens", org, False, is_sa
            ):
                raise PermissionDenied(
                    "You don't have permission to create service account tokens."
                )

    def post(self, request, sa_id, *args, **kwargs):
        org = self._get_org(request)

        try:
            sa = ServiceAccount.objects.get(
                id=sa_id, organisation=org, deleted_at=None
            )
        except (ObjectDoesNotExist, ValueError):
            return Response(
                {"error": "Service account not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Team-owned SAs require team membership; mirror /access/ 404 so
        # callers can't probe for the existence of team-owned SAs.
        if not _can_access_service_account(request, sa):
            return Response(
                {"error": "Service account not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if not sa.server_wrapped_keyring:
            return Response(
                {
                    "error": (
                        "Service account does not have server-side key "
                        "management enabled. Tokens cannot be minted via "
                        "the API."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        name, err = validate_text_field(request.data.get("name"), "name", max_length=64)
        if err:
            return Response({"error": err}, status=status.HTTP_400_BAD_REQUEST)

        expiry = request.data.get("expiry")
        expires_at = None
        if expiry is not None:
            try:
                expires_at = datetime.fromtimestamp(int(expiry) / 1000)
            except (TypeError, ValueError):
                return Response(
                    {"error": "'expiry' must be a unix-ms timestamp."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        created_by = None
        created_by_sa = None
        if request.auth["auth_type"] == "User":
            created_by = request.auth["org_member"]
        elif request.auth["auth_type"] == "ServiceAccount":
            created_by_sa = request.auth["service_account"]

        token, full_token, bearer_token = _mint_sa_token(
            sa,
            name=name.strip()[:64],
            expires_at=expires_at,
            created_by=created_by,
            created_by_sa=created_by_sa,
        )

        actor_type, actor_id, actor_meta = get_actor_info(request)
        ip_address, user_agent = get_resolver_request_meta(request)
        log_audit_event(
            organisation=org,
            event_type="C",
            resource_type="sa_token",
            resource_id=token.id,
            actor_type=actor_type,
            actor_id=actor_id,
            actor_metadata=actor_meta,
            resource_metadata={
                "name": token.name,
                "service_account": sa.name,
                "service_account_id": str(sa.id),
            },
            description=f"Created service account token '{token.name}' for '{sa.name}'",
            ip_address=ip_address,
            user_agent=user_agent,
        )

        return Response(
            {
                "id": str(token.id),
                "name": token.name,
                "created_at": token.created_at,
                "expires_at": token.expires_at,
                "token": full_token,
                "bearer_token": bearer_token,
            },
            status=status.HTTP_201_CREATED,
        )


class PublicServiceAccountTokenDetailView(APIView):
    """
    DELETE /public/v1/service-accounts/<sa_id>/tokens/<token_id>/

    Soft-delete a service-account token. Mismatches between path sa_id
    and the token's parent SA return 404 to avoid revealing token
    existence across SAs.
    """

    authentication_classes = [PhaseTokenAuthentication]
    permission_classes = [IsAuthenticated, IsIPAllowed]
    throttle_classes = [PlanBasedRateThrottle]
    renderer_classes = [CamelCaseJSONRenderer]

    def _get_org(self, request):
        if request.auth.get("organisation"):
            return request.auth["organisation"]
        if request.auth.get("app"):
            return request.auth["app"].organisation
        raise PermissionDenied("Could not resolve organisation from request.")

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        account = None
        is_sa = False
        if request.auth["auth_type"] == "User":
            account = request.auth["org_member"].user
        elif request.auth["auth_type"] == "ServiceAccount":
            account = request.auth["service_account"]
            is_sa = True

        if account is not None:
            org = self._get_org(request)
            if not user_has_permission(
                account, "delete", "ServiceAccountTokens", org, False, is_sa
            ):
                raise PermissionDenied(
                    "You don't have permission to delete service account tokens."
                )

    def delete(self, request, sa_id, token_id, *args, **kwargs):
        org = self._get_org(request)

        try:
            sa = ServiceAccount.objects.get(
                id=sa_id, organisation=org, deleted_at=None
            )
        except (ObjectDoesNotExist, ValueError):
            return Response(
                {"error": "Service account not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if not _can_access_service_account(request, sa):
            return Response(
                {"error": "Service account not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        try:
            token = ServiceAccountToken.objects.get(
                id=token_id, service_account=sa, deleted_at=None
            )
        except (ObjectDoesNotExist, ValueError):
            return Response(
                {"error": "Token not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        token_name = token.name
        token_id_str = str(token.id)
        token.deleted_at = timezone.now()
        token.save()

        actor_type, actor_id, actor_meta = get_actor_info(request)
        ip_address, user_agent = get_resolver_request_meta(request)
        log_audit_event(
            organisation=org,
            event_type="D",
            resource_type="sa_token",
            resource_id=token_id_str,
            actor_type=actor_type,
            actor_id=actor_id,
            actor_metadata=actor_meta,
            resource_metadata={
                "name": token_name,
                "service_account": sa.name,
                "service_account_id": str(sa.id),
            },
            description=f"Deleted service account token '{token_name}' from '{sa.name}'",
            ip_address=ip_address,
            user_agent=user_agent,
        )

        return Response(status=status.HTTP_204_NO_CONTENT)
