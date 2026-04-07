import logging
from datetime import timedelta

from django.conf import settings
from django.core.exceptions import ObjectDoesNotExist
from django.db import transaction
from django.utils import timezone

from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.exceptions import MethodNotAllowed, PermissionDenied
from rest_framework.response import Response
from rest_framework import status
from djangorestframework_camel_case.render import CamelCaseJSONRenderer

from api.auth import PhaseTokenAuthentication
from api.models import (
    App,
    Environment,
    EnvironmentKey,
    OrganisationMember,
    OrganisationMemberInvite,
    Role,
    ServerEnvironmentKey,
)
from api.serializers import OrganisationMemberSerializer, OrganisationMemberInviteSerializer
from api.utils.access.permissions import (
    role_has_global_access,
    role_has_permission,
    user_has_permission,
)
from api.utils.audit_logging import log_audit_event, get_actor_info, get_member_display_name
from api.utils.crypto import decrypt_asymmetric, get_server_keypair
from api.utils.environments import _ed25519_pk_to_curve25519, _wrap_env_secrets_for_key
from api.utils.rest import METHOD_TO_ACTION, get_resolver_request_meta, validate_email_address
from api.throttling import PlanBasedRateThrottle
from api.utils.access.middleware import IsIPAllowed
from backend.quotas import can_add_account

logger = logging.getLogger(__name__)

CLOUD_HOSTED = settings.APP_HOST == "cloud"
INVITE_EXPIRY_DAYS = 14


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------



def _get_org(request):
    if request.auth.get("organisation"):
        return request.auth["organisation"]
    if request.auth.get("app"):
        return request.auth["app"].organisation
    raise PermissionDenied("Could not resolve organisation from request.")


def _check_permission(request, action):
    """Check RBAC for the given action on the Members resource."""
    account = None
    is_sa = False
    if request.auth["auth_type"] == "User":
        account = request.auth["org_member"].user
    elif request.auth["auth_type"] == "ServiceAccount":
        account = request.auth["service_account"]
        is_sa = True

    if account is not None:
        org = _get_org(request)
        if not user_has_permission(account, action, "Members", org, False, is_sa):
            raise PermissionDenied(f"You don't have permission to {action} members.")


# ---------------------------------------------------------------------------
# Members: list / invite
# ---------------------------------------------------------------------------


class PublicMembersView(APIView):
    """
    GET  /public/v1/members/  — list active org members
    POST /public/v1/members/  — invite a new member (creates an invite, not a direct member)
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
        _check_permission(request, action)

    def get(self, request, *args, **kwargs):
        org = _get_org(request)
        members = (
            OrganisationMember.objects.select_related("user", "role")
            .filter(organisation=org, deleted_at=None)
            .order_by("created_at")
        )
        return Response(OrganisationMemberSerializer(members, many=True).data, status=status.HTTP_200_OK)

    def post(self, request, *args, **kwargs):
        org = _get_org(request)
        invited_by = request.auth.get("org_member")  # None for SA tokens

        raw_email = request.data.get("email", "")
        role_id = request.data.get("role_id")

        email, err = validate_email_address(raw_email)
        if err:
            return Response({"error": err}, status=status.HTTP_400_BAD_REQUEST)

        if not role_id:
            return Response(
                {"error": "Missing required field: role_id"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            role = Role.objects.get(id=role_id, organisation=org)
        except (Role.DoesNotExist, ValueError):
            return Response({"error": "Role not found."}, status=status.HTTP_404_NOT_FOUND)

        # Restrict invitable roles: no global-access (Owner/Admin) or SA-token-create roles
        if role_has_global_access(role):
            return Response(
                {"error": f"Members cannot be invited with the '{role.name}' role."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if role_has_permission(role, "create", "ServiceAccountTokens"):
            return Response(
                {
                    "error": "Members cannot be invited with a role that allows creating service account tokens."
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Conflict checks
        if OrganisationMember.objects.filter(
            organisation=org, user__email=email, deleted_at=None
        ).exists():
            return Response(
                {"error": f"'{email}' is already a member of this organisation."},
                status=status.HTTP_409_CONFLICT,
            )
        if OrganisationMemberInvite.objects.filter(
            organisation=org, invitee_email=email, valid=True, expires_at__gte=timezone.now()
        ).exists():
            return Response(
                {"error": f"An active invite already exists for '{email}'."},
                status=status.HTTP_409_CONFLICT,
            )

        # Quota check
        if not can_add_account(org, 1):
            return Response(
                {"error": "Member quota exceeded for this organisation's plan."},
                status=status.HTTP_403_FORBIDDEN,
            )

        app_ids = request.data.get("apps", [])
        if not isinstance(app_ids, list):
            return Response(
                {"error": "'apps' must be a list of app IDs."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        app_scope = App.objects.filter(id__in=app_ids, organisation=org, is_deleted=False)

        invited_by_sa = (
            request.auth["service_account"]
            if request.auth["auth_type"] == "ServiceAccount"
            else None
        )

        expiry = timezone.now() + timedelta(days=INVITE_EXPIRY_DAYS)
        invite = OrganisationMemberInvite.objects.create(
            organisation=org,
            role=role,
            invited_by=invited_by,
            invited_by_service_account=invited_by_sa,
            invitee_email=email,
            expires_at=expiry,
        )
        invite.apps.set(app_scope)

        try:
            from api.tasks.emails import send_invite_email_job

            send_invite_email_job(invite)
        except Exception as e:
            logger.warning("Failed to send invite email to %s: %s", email, e)

        actor_type, actor_id, actor_meta = get_actor_info(request)
        ip_address, user_agent = get_resolver_request_meta(request)
        log_audit_event(
            organisation=org,
            event_type="C",
            resource_type="invite",
            resource_id=str(invite.id),
            actor_type=actor_type,
            actor_id=actor_id,
            actor_metadata=actor_meta,
            resource_metadata={"email": email, "role": role.name},
            description=f"Invited '{email}' with role '{role.name}'",
            ip_address=ip_address,
            user_agent=user_agent,
        )

        return Response(OrganisationMemberInviteSerializer(invite).data, status=status.HTTP_201_CREATED)


# ---------------------------------------------------------------------------
# Member detail: get / update role / delete
# ---------------------------------------------------------------------------


class PublicMemberDetailView(APIView):
    """
    GET    /public/v1/members/<id>/  — member detail
    PUT    /public/v1/members/<id>/  — update member role
    DELETE /public/v1/members/<id>/  — remove member (soft-delete)
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
        _check_permission(request, action)

    def _get_member(self, member_id, org):
        try:
            return OrganisationMember.objects.select_related("user", "role").get(
                id=member_id, organisation=org, deleted_at=None
            )
        except (ObjectDoesNotExist, ValueError):
            return None

    def get(self, request, member_id, *args, **kwargs):
        org = _get_org(request)
        member = self._get_member(member_id, org)
        if not member:
            return Response({"error": "Member not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(OrganisationMemberSerializer(member).data, status=status.HTTP_200_OK)

    def put(self, request, member_id, *args, **kwargs):
        org = _get_org(request)
        member = self._get_member(member_id, org)
        if not member:
            return Response({"error": "Member not found."}, status=status.HTTP_404_NOT_FOUND)

        # The Owner role is immutable via the API — use the ownership transfer flow
        if member.role.is_default and member.role.name.lower() == "owner":
            return Response(
                {"error": "The Owner's role cannot be changed via the API. Use the ownership transfer flow."},
                status=status.HTTP_403_FORBIDDEN,
            )

        if request.auth["auth_type"] == "User":
            # Prevent self role-update
            acting_member = request.auth["org_member"]
            if str(acting_member.id) == str(member.id):
                return Response(
                    {"error": "You cannot update your own role."},
                    status=status.HTTP_403_FORBIDDEN,
                )
            # Prevent updating a global-access member unless the caller also has global access
            if role_has_global_access(member.role) and not role_has_global_access(
                acting_member.role
            ):
                return Response(
                    {"error": "You cannot update the role of a member with global access."},
                    status=status.HTTP_403_FORBIDDEN,
                )
        elif request.auth["auth_type"] == "ServiceAccount":
            # SAs cannot modify members with global-access roles (e.g. Admin)
            if role_has_global_access(member.role):
                return Response(
                    {"error": "Service accounts cannot modify members with global access."},
                    status=status.HTTP_403_FORBIDDEN,
                )

        role_id = request.data.get("role_id")
        if not role_id:
            return Response(
                {"error": "Missing required field: role_id"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            new_role = Role.objects.get(id=role_id, organisation=org)
        except (Role.DoesNotExist, ValueError):
            return Response({"error": "Role not found."}, status=status.HTTP_404_NOT_FOUND)

        # Owner role can only be transferred via the dedicated ownership transfer flow
        if new_role.name.lower() == "owner":
            return Response(
                {"error": "You cannot assign the Owner role directly. Use the ownership transfer flow."},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Only global-access callers can assign global-access roles; SAs never can
        if role_has_global_access(new_role):
            can_assign = (
                request.auth["auth_type"] == "User"
                and role_has_global_access(request.auth["org_member"].role)
            )
            if not can_assign:
                return Response(
                    {"error": f"You cannot assign the '{new_role.name}' role."},
                    status=status.HTTP_403_FORBIDDEN,
                )

        old_role_name = member.role.name
        member.role = new_role
        member.save()

        actor_type, actor_id, actor_meta = get_actor_info(request)
        ip_address, user_agent = get_resolver_request_meta(request)
        log_audit_event(
            organisation=org,
            event_type="U",
            resource_type="member",
            resource_id=str(member.id),
            actor_type=actor_type,
            actor_id=actor_id,
            actor_metadata=actor_meta,
            resource_metadata={"email": member.user.email},
            old_values={"role": old_role_name},
            new_values={"role": new_role.name},
            description=f"Updated member '{get_member_display_name(member)}' role from '{old_role_name}' to '{new_role.name}'",
            ip_address=ip_address,
            user_agent=user_agent,
        )

        return Response(OrganisationMemberSerializer(member).data, status=status.HTTP_200_OK)

    def delete(self, request, member_id, *args, **kwargs):
        org = _get_org(request)
        member = self._get_member(member_id, org)
        if not member:
            return Response({"error": "Member not found."}, status=status.HTTP_404_NOT_FOUND)

        # The Owner cannot be removed via the API
        if member.role.is_default and member.role.name.lower() == "owner":
            return Response(
                {"error": "The Owner cannot be removed via the API. Use the ownership transfer flow."},
                status=status.HTTP_403_FORBIDDEN,
            )

        if request.auth["auth_type"] == "User":
            # Prevent self-removal
            if str(request.auth["org_member"].id) == str(member.id):
                return Response(
                    {"error": "You cannot remove yourself from the organisation."},
                    status=status.HTTP_403_FORBIDDEN,
                )
        elif request.auth["auth_type"] == "ServiceAccount":
            # SAs cannot remove members with global-access roles (e.g. Admin)
            if role_has_global_access(member.role):
                return Response(
                    {"error": "Service accounts cannot remove members with global access."},
                    status=status.HTTP_403_FORBIDDEN,
                )

        member_display_name = get_member_display_name(member)
        member_email = member.user.email
        member_role = member.role.name

        member.deleted_at = timezone.now()
        member.save()

        if CLOUD_HOSTED:
            from ee.billing.stripe import update_stripe_subscription_seats

            update_stripe_subscription_seats(org)

        actor_type, actor_id, actor_meta = get_actor_info(request)
        ip_address, user_agent = get_resolver_request_meta(request)
        log_audit_event(
            organisation=org,
            event_type="D",
            resource_type="member",
            resource_id=str(member_id),
            actor_type=actor_type,
            actor_id=actor_id,
            actor_metadata=actor_meta,
            resource_metadata={"email": member_email},
            old_values={"email": member_email, "role": member_role},
            description=f"Removed member '{member_display_name}' from the organisation",
            ip_address=ip_address,
            user_agent=user_agent,
        )

        return Response(status=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Member access management (server-side key wrapping, SSE apps only)
# ---------------------------------------------------------------------------


class PublicMemberAccessView(APIView):
    """
    PUT /public/v1/members/<id>/access/

    Declaratively set a member's app/environment access. The member's ed25519
    identity_key is used to wrap environment secrets server-side (SSE apps only).

    Input:
        {
            "apps": [
                {"id": "<app_id>", "environments": ["<env_id_1>", ...]},
                ...
            ]
        }

    Apps not in the list have their access revoked. Environments within each
    app are synced to exactly the provided list.
    """

    authentication_classes = [PhaseTokenAuthentication]
    permission_classes = [IsAuthenticated, IsIPAllowed]
    throttle_classes = [PlanBasedRateThrottle]
    renderer_classes = [CamelCaseJSONRenderer]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        _check_permission(request, "update")

    def put(self, request, member_id, *args, **kwargs):
        org = _get_org(request)

        try:
            member = OrganisationMember.objects.select_related("user", "role").get(
                id=member_id, organisation=org, deleted_at=None
            )
        except (ObjectDoesNotExist, ValueError):
            return Response({"error": "Member not found."}, status=status.HTTP_404_NOT_FOUND)

        if not member.identity_key:
            return Response(
                {
                    "error": (
                        "Member has not set up their identity key yet. "
                        "They must log in to the console first."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

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

        # --- Validate all apps and environments upfront ---
        desired_app_ids = set()
        desired_env_map = {}  # app_id (str) -> set of env_id (str)

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
                    {
                        "error": f"App '{app.name}' does not have SSE enabled. Only SSE apps are supported."
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            env_ids = app_entry.get("environments")
            if not isinstance(env_ids, list):
                return Response(
                    {"error": "Each app entry must have an 'environments' list of environment IDs."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if len(env_ids) == 0:
                return Response(
                    {
                        "error": (
                            f"'environments' for app '{app_id}' must not be empty. "
                            "To revoke all access, remove the app from the list entirely."
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            valid_envs = set(
                Environment.objects.filter(app=app, id__in=env_ids).values_list("id", flat=True)
            )
            invalid_ids = set(str(e) for e in env_ids) - set(str(e) for e in valid_envs)
            if invalid_ids:
                return Response(
                    {
                        "error": f"Environment(s) not found in app '{app.name}': {', '.join(invalid_ids)}"
                    },
                    status=status.HTTP_404_NOT_FOUND,
                )

            desired_app_ids.add(str(app.id))
            desired_env_map[str(app.id)] = valid_envs

        # --- Derive member's x25519 key from their stored ed25519 identity_key ---
        try:
            member_kx_pub = _ed25519_pk_to_curve25519(member.identity_key)
        except Exception as e:
            logger.error("Failed to derive kx pubkey for member %s: %s", member_id, e)
            return Response(
                {"error": "Failed to process member's identity key."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        server_pk, server_sk = get_server_keypair()

        # --- Apply all changes atomically ---
        apps_to_add = set()
        apps_to_remove = set()

        with transaction.atomic():
            current_app_ids = set(str(a.id) for a in member.apps.filter(is_deleted=False))

            # Revoke access to apps no longer in the desired list
            apps_to_remove = current_app_ids - desired_app_ids
            if apps_to_remove:
                member.apps.remove(*App.objects.filter(id__in=apps_to_remove))
                EnvironmentKey.objects.filter(
                    user=member,
                    environment__app__id__in=apps_to_remove,
                    deleted_at=None,
                ).update(deleted_at=timezone.now())

            # Grant access to new apps
            apps_to_add = desired_app_ids - current_app_ids
            if apps_to_add:
                member.apps.add(*App.objects.filter(id__in=apps_to_add))

            # Sync environment access per app
            for app_id_str, desired_envs in desired_env_map.items():
                desired_env_id_strs = set(str(e) for e in desired_envs)

                current_env_keys = EnvironmentKey.objects.filter(
                    user=member,
                    environment__app_id=app_id_str,
                    deleted_at=None,
                )
                current_env_ids = set(str(ek.environment_id) for ek in current_env_keys)

                # Revoke environments no longer desired
                envs_to_revoke = current_env_ids - desired_env_id_strs
                if envs_to_revoke:
                    EnvironmentKey.objects.filter(
                        user=member,
                        environment_id__in=envs_to_revoke,
                        deleted_at=None,
                    ).update(deleted_at=timezone.now())

                # Grant new environments via server-side key wrapping
                envs_to_grant = desired_env_id_strs - current_env_ids
                if envs_to_grant:
                    new_env_keys = []
                    for env_id in envs_to_grant:
                        try:
                            sek = ServerEnvironmentKey.objects.get(
                                environment_id=env_id,
                                deleted_at=None,
                            )
                        except ObjectDoesNotExist:
                            logger.warning(
                                "No ServerEnvironmentKey for env %s — skipping.", env_id
                            )
                            continue

                        # Decrypt env seed/salt with server keys, re-wrap for member
                        env_seed = decrypt_asymmetric(
                            sek.wrapped_seed, server_sk.hex(), server_pk.hex()
                        )
                        env_salt = decrypt_asymmetric(
                            sek.wrapped_salt, server_sk.hex(), server_pk.hex()
                        )
                        wrapped_seed, wrapped_salt = _wrap_env_secrets_for_key(
                            env_seed, env_salt, member_kx_pub
                        )

                        env = Environment.objects.get(id=env_id)
                        new_env_keys.append(
                            EnvironmentKey(
                                environment=env,
                                user=member,
                                identity_key=sek.identity_key,
                                wrapped_seed=wrapped_seed,
                                wrapped_salt=wrapped_salt,
                            )
                        )

                    if new_env_keys:
                        EnvironmentKey.objects.bulk_create(new_env_keys)

        # Build detailed access change data for audit log
        app_name_map = {
            str(a.id): a.name
            for a in App.objects.filter(id__in=desired_app_ids | apps_to_remove)
        }
        env_name_map = {
            str(e.id): e.name
            for e in Environment.objects.filter(app_id__in=desired_app_ids | apps_to_remove)
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
                    user=member,
                    environment__app_id=app_id_str,
                    deleted_at=None,
                )
            )
            added_envs = desired_envs - current_envs
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

        member_display = get_member_display_name(member)
        actor_type, actor_id, actor_meta = get_actor_info(request)
        ip_address, user_agent = get_resolver_request_meta(request)
        log_audit_event(
            organisation=org,
            event_type="A",
            resource_type="member",
            resource_id=str(member.id),
            actor_type=actor_type,
            actor_id=actor_id,
            actor_metadata=actor_meta,
            resource_metadata={"email": member.user.email},
            old_values=old_values or None,
            new_values=new_values or None,
            description=f"Updated access for member '{member_display}'",
            ip_address=ip_address,
            user_agent=user_agent,
        )

        return Response(OrganisationMemberSerializer(member).data, status=status.HTTP_200_OK)


# ---------------------------------------------------------------------------
# Invites: list / cancel
# ---------------------------------------------------------------------------


class PublicInvitesView(APIView):
    """
    GET /public/v1/invites/ — list pending (valid, non-expired) invites
    """

    authentication_classes = [PhaseTokenAuthentication]
    permission_classes = [IsAuthenticated, IsIPAllowed]
    throttle_classes = [PlanBasedRateThrottle]
    renderer_classes = [CamelCaseJSONRenderer]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        _check_permission(request, "read")

    def get(self, request, *args, **kwargs):
        org = _get_org(request)
        invites = (
            OrganisationMemberInvite.objects.select_related("role", "invited_by__user")
            .filter(organisation=org, valid=True, expires_at__gte=timezone.now())
            .order_by("-created_at")
        )
        return Response(OrganisationMemberInviteSerializer(invites, many=True).data, status=status.HTTP_200_OK)


class PublicInviteDetailView(APIView):
    """
    DELETE /public/v1/invites/<id>/ — cancel a pending invite
    """

    authentication_classes = [PhaseTokenAuthentication]
    permission_classes = [IsAuthenticated, IsIPAllowed]
    throttle_classes = [PlanBasedRateThrottle]
    renderer_classes = [CamelCaseJSONRenderer]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        _check_permission(request, "delete")

    def delete(self, request, invite_id, *args, **kwargs):
        org = _get_org(request)

        try:
            invite = OrganisationMemberInvite.objects.select_related("role").get(
                id=invite_id, organisation=org
            )
        except (ObjectDoesNotExist, ValueError):
            return Response({"error": "Invite not found."}, status=status.HTTP_404_NOT_FOUND)

        invite_email = invite.invitee_email
        invite_role = invite.role.name

        invite.delete()

        actor_type, actor_id, actor_meta = get_actor_info(request)
        ip_address, user_agent = get_resolver_request_meta(request)
        log_audit_event(
            organisation=org,
            event_type="D",
            resource_type="invite",
            resource_id=str(invite_id),
            actor_type=actor_type,
            actor_id=actor_id,
            actor_metadata=actor_meta,
            resource_metadata={"email": invite_email, "role": invite_role},
            description=f"Cancelled invite for '{invite_email}'",
            ip_address=ip_address,
            user_agent=user_agent,
        )

        return Response(status=status.HTTP_204_NO_CONTENT)
