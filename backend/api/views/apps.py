import logging

from api.auth import PhaseTokenAuthentication
from api.models import App, OrganisationMember, Role
from api.serializers import AppSerializer
from api.utils.access.permissions import user_has_permission, user_is_org_member
from api.utils.crypto import (
    encrypt_raw,
    env_keypair,
    get_server_keypair,
    random_hex,
    split_secret_hex,
    wrap_share_hex,
)
from api.utils.audit_logging import log_audit_event, get_actor_info, build_change_values
from api.utils.environments import create_environment
from api.utils.rest import METHOD_TO_ACTION, get_resolver_request_meta
from api.throttling import PlanBasedRateThrottle
from api.utils.access.middleware import IsIPAllowed
from backend.quotas import can_add_app, can_use_custom_envs

from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework import status
from djangorestframework_camel_case.render import CamelCaseJSONRenderer
from django.conf import settings
from django.db import transaction
from django.db.models import Q

logger = logging.getLogger(__name__)

CLOUD_HOSTED = settings.APP_HOST == "cloud"


class PublicAppsView(APIView):
    authentication_classes = [PhaseTokenAuthentication]
    permission_classes = [IsAuthenticated, IsIPAllowed]
    throttle_classes = [PlanBasedRateThrottle]
    renderer_classes = [CamelCaseJSONRenderer]

    def _get_org(self, request):
        """Resolve the organisation from the request auth context."""
        if request.auth.get("organisation"):
            return request.auth["organisation"]
        if request.auth.get("app"):
            return request.auth["app"].organisation
        raise PermissionDenied("Could not resolve organisation from request.")

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)

        action = METHOD_TO_ACTION.get(request.method)
        if not action:
            raise PermissionDenied(f"Unsupported HTTP method: {request.method}")

        account = None
        is_sa = False
        if request.auth["auth_type"] == "User":
            account = request.auth["org_member"].user
            org = self._get_org(request)
            if not user_is_org_member(account.userId, org.id):
                raise PermissionDenied("You are not a member of this organisation.")
        elif request.auth["auth_type"] == "ServiceAccount":
            account = request.auth["service_account"]
            is_sa = True

        if account is not None:
            org = self._get_org(request)
            if not user_has_permission(
                account, action, "Apps", org, False, is_sa
            ):
                raise PermissionDenied(
                    f"You don't have permission to {action} apps."
                )

    def get(self, request, *args, **kwargs):
        org = self._get_org(request)

        org_apps = App.objects.filter(
            organisation=org,
            is_deleted=False,
            sse_enabled=True,
        )

        if request.auth["auth_type"] == "User":
            org_member = request.auth["org_member"]
            accessible_apps = org_apps.filter(members=org_member)
        elif request.auth["auth_type"] == "ServiceAccount":
            sa = request.auth["service_account"]
            accessible_apps = org_apps.filter(service_accounts=sa)
        else:
            accessible_apps = App.objects.none()

        serializer = AppSerializer(
            accessible_apps.order_by("-created_at"), many=True
        )
        return Response(serializer.data, status=status.HTTP_200_OK)

    def post(self, request, *args, **kwargs):
        org = self._get_org(request)

        # --- Validate input ---
        name = request.data.get("name")
        if not name or not str(name).strip():
            return Response(
                {"error": "Missing required field: name"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        name = str(name).strip()
        if len(name) > 64:
            return Response(
                {"error": "App name cannot exceed 64 characters."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        description = request.data.get("description", None)
        if description is not None and len(str(description)) > 10000:
            return Response(
                {"error": "App description cannot exceed 10,000 characters."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # --- Validate optional environments list ---
        custom_envs = request.data.get("environments", None)
        if custom_envs is not None:
            if not isinstance(custom_envs, list):
                return Response(
                    {"error": "'environments' must be a list of environment names."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if len(custom_envs) == 0:
                return Response(
                    {"error": "'environments' must not be empty."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            for env_name in custom_envs:
                if not isinstance(env_name, str) or not env_name.strip():
                    return Response(
                        {"error": "Each environment name must be a non-empty string."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
            # Check for duplicates (case-insensitive)
            seen = set()
            for env_name in custom_envs:
                lower = env_name.strip().lower()
                if lower in seen:
                    return Response(
                        {"error": f"Duplicate environment name: '{env_name.strip()}'."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                seen.add(lower)
            if not can_use_custom_envs(org):
                return Response(
                    {"error": "Custom environments are not available on the Free plan."},
                    status=status.HTTP_403_FORBIDDEN,
                )

        # --- Check quota ---
        if not can_add_app(org):
            return Response(
                {"error": "App quota exceeded for this organisation's plan."},
                status=status.HTTP_403_FORBIDDEN,
            )

        # --- Generate cryptographic material (server-side, SSE) ---
        app_seed = random_hex(32)
        app_token = random_hex(32)
        wrap_key = random_hex(32)

        identity_key_pub, identity_key_priv = env_keypair(app_seed)

        _share0, share1 = split_secret_hex(identity_key_priv)
        wrapped_key_share = wrap_share_hex(share1, wrap_key)

        _server_pk, server_sk = get_server_keypair()
        encrypted_app_seed = bytes(encrypt_raw(app_seed, server_sk)).hex()

        # --- Determine requesting account ---
        requesting_user = None
        requesting_sa = None
        if request.auth["auth_type"] == "User":
            requesting_user = request.auth["org_member"]
        elif request.auth["auth_type"] == "ServiceAccount":
            requesting_sa = request.auth["service_account"]

        # --- Create app + members + default environments ---
        try:
            with transaction.atomic():
                app = App.objects.create(
                    organisation=org,
                    name=name,
                    description=description,
                    identity_key=identity_key_pub,
                    app_version=1,
                    app_token=app_token,
                    app_seed=encrypted_app_seed,
                    wrapped_key_share=wrapped_key_share,
                    sse_enabled=True,
                )

                # Add requesting account to app members
                if requesting_user:
                    requesting_user.apps.add(app)
                if requesting_sa:
                    requesting_sa.apps.add(app)

                # Add all org owners/admins to app members
                admin_roles = Role.objects.filter(
                    Q(organisation=org)
                    & (Q(name__iexact="owner") | Q(name__iexact="admin"))
                )
                org_admins = OrganisationMember.objects.filter(
                    organisation=org,
                    role__in=admin_roles,
                    deleted_at=None,
                )
                for admin in org_admins:
                    admin.apps.add(app)

                # Create environments
                if custom_envs is not None:
                    for env_name in custom_envs:
                        create_environment(
                            app,
                            env_name.strip(),
                            "custom",
                            requesting_user=requesting_user,
                            requesting_sa=requesting_sa,
                        )
                else:
                    for env_name, env_type in [
                        ("Development", "dev"),
                        ("Staging", "staging"),
                        ("Production", "prod"),
                    ]:
                        create_environment(
                            app,
                            env_name,
                            env_type,
                            requesting_user=requesting_user,
                            requesting_sa=requesting_sa,
                        )

        except ValueError as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Audit log
        actor_type, actor_id, actor_meta = get_actor_info(request)
        ip_address, user_agent = get_resolver_request_meta(request)
        log_audit_event(
            organisation=org,
            event_type="C",
            resource_type="app",
            resource_id=app.id,
            actor_type=actor_type,
            actor_id=actor_id,
            actor_metadata=actor_meta,
            resource_metadata={"name": app.name},
            new_values={"name": app.name, "description": app.description or ""},
            description=f"Created app '{app.name}'",
            ip_address=ip_address,
            user_agent=user_agent,
        )

        serializer = AppSerializer(app)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class PublicAppDetailView(APIView):
    authentication_classes = [PhaseTokenAuthentication]
    permission_classes = [IsAuthenticated, IsIPAllowed]
    throttle_classes = [PlanBasedRateThrottle]
    renderer_classes = [CamelCaseJSONRenderer]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)

        app = request.auth.get("app")
        if not app:
            raise PermissionDenied("Could not resolve app from request.")

        if not app.sse_enabled:
            raise PermissionDenied("SSE is not enabled for this App.")

        action = METHOD_TO_ACTION.get(request.method)
        if not action:
            raise PermissionDenied(f"Unsupported HTTP method: {request.method}")

        account = None
        is_sa = False
        if request.auth["auth_type"] == "User":
            account = request.auth["org_member"].user
            org_member = request.auth["org_member"]
            if not app.members.filter(id=org_member.id).exists():
                raise PermissionDenied("You do not have access to this app.")
        elif request.auth["auth_type"] == "ServiceAccount":
            account = request.auth["service_account"]
            is_sa = True
            if not app.service_accounts.filter(id=account.id, deleted_at=None).exists():
                raise PermissionDenied("Service account does not have access to this app.")

        if account is not None:
            organisation = app.organisation
            if not user_has_permission(
                account, action, "Apps", organisation, False, is_sa
            ):
                raise PermissionDenied(
                    f"You don't have permission to {action} apps."
                )

    def get(self, request, app_id, *args, **kwargs):
        app = request.auth["app"]
        serializer = AppSerializer(app)
        return Response(serializer.data, status=status.HTTP_200_OK)

    def put(self, request, app_id, *args, **kwargs):
        app = request.auth["app"]

        name = request.data.get("name")
        description = request.data.get("description")

        if name is None and description is None:
            return Response(
                {"error": "At least one of 'name' or 'description' must be provided."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        old_values, new_values = build_change_values(
            app, ["name", "description"], request.data
        )

        if name is not None:
            if not name or str(name).strip() == "":
                return Response(
                    {"error": "App name cannot be blank."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if len(str(name)) > 64:
                return Response(
                    {"error": "App name cannot exceed 64 characters."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            app.name = str(name).strip()

        if description is not None:
            if len(str(description)) > 10000:
                return Response(
                    {"error": "App description cannot exceed 10,000 characters."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            app.description = description

        app.save()

        # Audit log
        if old_values:
            actor_type, actor_id, actor_meta = get_actor_info(request)
            ip_address, user_agent = get_resolver_request_meta(request)
            log_audit_event(
                organisation=app.organisation,
                event_type="U",
                resource_type="app",
                resource_id=app.id,
                actor_type=actor_type,
                actor_id=actor_id,
                actor_metadata=actor_meta,
                resource_metadata={"name": app.name},
                old_values=old_values,
                new_values=new_values,
                description=f"Updated app '{app.name}'",
                ip_address=ip_address,
                user_agent=user_agent,
            )

        serializer = AppSerializer(app)
        return Response(serializer.data, status=status.HTTP_200_OK)

    def delete(self, request, app_id, *args, **kwargs):
        app = request.auth["app"]
        app_name = app.name
        org = app.organisation

        if CLOUD_HOSTED:
            from backend.api.kv import delete as kv_delete, purge as kv_purge

            deleted = kv_delete(app.app_token)
            purged = kv_purge(
                f"phApp:v{app.app_version}:{app.identity_key}/{app.app_token}"
            )
            if not deleted or not purged:
                return Response(
                    {"error": "Failed to delete app keys from CDN. Please try again."},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                )

        app.wrapped_key_share = ""
        app.save()
        app.delete()

        # Audit log
        actor_type, actor_id, actor_meta = get_actor_info(request)
        ip_address, user_agent = get_resolver_request_meta(request)
        log_audit_event(
            organisation=org,
            event_type="D",
            resource_type="app",
            resource_id=app_id,
            actor_type=actor_type,
            actor_id=actor_id,
            actor_metadata=actor_meta,
            resource_metadata={"name": app_name},
            old_values={"name": app_name},
            description=f"Deleted app '{app_name}'",
            ip_address=ip_address,
            user_agent=user_agent,
        )

        return Response(status=status.HTTP_204_NO_CONTENT)
