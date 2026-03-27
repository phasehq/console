import re

from api.auth import PhaseTokenAuthentication
from api.models import Environment, EnvironmentKey
from api.serializers import EnvironmentSerializer
from api.utils.access.permissions import (
    user_has_permission,
    user_can_access_environment,
    service_account_can_access_environment,
)
from api.utils.audit_logging import log_audit_event, get_actor_info, build_change_values
from api.utils.environments import create_environment
from api.utils.rest import METHOD_TO_ACTION, get_resolver_request_meta
from api.throttling import PlanBasedRateThrottle
from api.utils.access.middleware import IsIPAllowed
from backend.quotas import can_add_environment, can_use_custom_envs

from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework import status
from djangorestframework_camel_case.render import CamelCaseJSONRenderer

ENV_NAME_RE = re.compile(r"^[a-zA-Z0-9\-_]{1,64}$")


class PublicEnvironmentsView(APIView):
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

            # Verify the service account is a member of this app
            if not app.service_accounts.filter(
                id=account.id, deleted_at=None
            ).exists():
                raise PermissionDenied(
                    "Service account does not have access to this app."
                )

        if account is not None:
            organisation = app.organisation
            if not user_has_permission(
                account, action, "Environments", organisation, True, is_sa
            ):
                raise PermissionDenied(
                    f"You don't have permission to {action} environments."
                )

    def get(self, request, *args, **kwargs):
        app = request.auth["app"]

        # Filter to environments the account actually has access to
        if request.auth["auth_type"] == "User":
            accessible_env_ids = EnvironmentKey.objects.filter(
                environment__app=app,
                user=request.auth["org_member"],
                deleted_at=None,
            ).values_list("environment_id", flat=True)
        elif request.auth["auth_type"] == "ServiceAccount":
            accessible_env_ids = EnvironmentKey.objects.filter(
                environment__app=app,
                service_account=request.auth["service_account"],
                deleted_at=None,
            ).values_list("environment_id", flat=True)
        else:
            accessible_env_ids = []

        environments = Environment.objects.filter(
            app=app, id__in=accessible_env_ids
        ).order_by("index")
        serializer = EnvironmentSerializer(environments, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    def post(self, request, *args, **kwargs):
        app = request.auth["app"]
        org = app.organisation

        name = request.data.get("name")

        if not name:
            return Response(
                {"error": "Missing required field: name"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not can_add_environment(app):
            return Response(
                {"error": "Environment quota exceeded for this app's plan."},
                status=status.HTTP_403_FORBIDDEN,
            )

        if not can_use_custom_envs(org):
            return Response(
                {"error": "Custom environments are not available on the Free plan."},
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            environment = create_environment(
                app,
                name,
                "custom",
                requesting_user=request.auth.get("org_member"),
                requesting_sa=request.auth.get("service_account"),
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
            organisation=app.organisation,
            event_type="C",
            resource_type="env",
            resource_id=environment.id,
            actor_type=actor_type,
            actor_id=actor_id,
            actor_metadata=actor_meta,
            resource_metadata={"name": environment.name, "app_id": str(app.id), "app_name": app.name},
            new_values={"name": environment.name, "env_type": environment.env_type},
            description=f"Created environment '{environment.name}' in app '{app.name}'",
            ip_address=ip_address,
            user_agent=user_agent,
        )

        serializer = EnvironmentSerializer(environment)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class PublicEnvironmentDetailView(APIView):
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

            # Verify the service account is a member of this app
            if not app.service_accounts.filter(
                id=account.id, deleted_at=None
            ).exists():
                raise PermissionDenied(
                    "Service account does not have access to this app."
                )

        if account is not None:
            organisation = app.organisation
            if not user_has_permission(
                account, action, "Environments", organisation, True, is_sa
            ):
                raise PermissionDenied(
                    f"You don't have permission to {action} environments."
                )

    def _get_environment(self, env_id, app):
        """Resolve env by ID and verify it belongs to the authenticated app."""
        try:
            env = Environment.objects.select_related("app").get(id=env_id)
        except Environment.DoesNotExist:
            return None

        if env.app_id != app.id:
            return None

        return env

    def _check_env_access(self, request, env):
        """Verify the requesting account has an EnvironmentKey for the env."""
        if request.auth["auth_type"] == "User":
            user = request.auth["org_member"].user
            if not user_can_access_environment(user.userId, env.id):
                raise PermissionDenied(
                    "You don't have access to this environment."
                )
        elif request.auth["auth_type"] == "ServiceAccount":
            sa = request.auth["service_account"]
            if not service_account_can_access_environment(sa.id, env.id):
                raise PermissionDenied(
                    "Service account doesn't have access to this environment."
                )

    def get(self, request, env_id, *args, **kwargs):
        app = request.auth["app"]
        env = self._get_environment(env_id, app)
        if not env:
            return Response(
                {"error": "Environment not found"},
                status=status.HTTP_404_NOT_FOUND,
            )
        self._check_env_access(request, env)
        serializer = EnvironmentSerializer(env)
        return Response(serializer.data, status=status.HTTP_200_OK)

    def put(self, request, env_id, *args, **kwargs):
        app = request.auth["app"]
        org = app.organisation
        env = self._get_environment(env_id, app)
        if not env:
            return Response(
                {"error": "Environment not found"},
                status=status.HTTP_404_NOT_FOUND,
            )
        self._check_env_access(request, env)

        name = request.data.get("name")
        if not name:
            return Response(
                {"error": "Missing required field: name"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not ENV_NAME_RE.match(name):
            return Response(
                {
                    "error": "Environment name is invalid. Only letters, numbers, "
                    "hyphens and underscores are allowed (max 64 characters)."
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        if env.env_type not in ("dev", "staging", "prod") and not can_use_custom_envs(org):
            return Response(
                {"error": "Custom environments are not available on the Free plan."},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Check for duplicate name (case-insensitive, excluding self)
        if (
            Environment.objects.filter(app=app, name__iexact=name)
            .exclude(id=env.id)
            .exists()
        ):
            return Response(
                {"error": f"An environment named '{name}' already exists in this app."},
                status=status.HTTP_409_CONFLICT,
            )

        old_name = env.name
        env.name = name
        env.save()

        # Audit log
        if old_name != name:
            actor_type, actor_id, actor_meta = get_actor_info(request)
            ip_address, user_agent = get_resolver_request_meta(request)
            log_audit_event(
                organisation=app.organisation,
                event_type="U",
                resource_type="env",
                resource_id=env.id,
                actor_type=actor_type,
                actor_id=actor_id,
                actor_metadata=actor_meta,
                resource_metadata={"name": name, "app_id": str(app.id), "app_name": app.name},
                old_values={"name": old_name},
                new_values={"name": name},
                description=f"Renamed environment '{old_name}' to '{name}' in app '{app.name}'",
                ip_address=ip_address,
                user_agent=user_agent,
            )

        serializer = EnvironmentSerializer(env)
        return Response(serializer.data, status=status.HTTP_200_OK)

    def delete(self, request, env_id, *args, **kwargs):
        app = request.auth["app"]
        org = app.organisation
        env = self._get_environment(env_id, app)
        if not env:
            return Response(
                {"error": "Environment not found"},
                status=status.HTTP_404_NOT_FOUND,
            )
        self._check_env_access(request, env)

        if env.env_type not in ("dev", "staging", "prod") and not can_use_custom_envs(org):
            return Response(
                {"error": "Custom environments are not available on the Free plan."},
                status=status.HTTP_403_FORBIDDEN,
            )

        env_name = env.name
        env.delete()

        # Audit log
        actor_type, actor_id, actor_meta = get_actor_info(request)
        ip_address, user_agent = get_resolver_request_meta(request)
        log_audit_event(
            organisation=org,
            event_type="D",
            resource_type="env",
            resource_id=env_id,
            actor_type=actor_type,
            actor_id=actor_id,
            actor_metadata=actor_meta,
            resource_metadata={"name": env_name, "app_id": str(app.id), "app_name": app.name},
            old_values={"name": env_name},
            description=f"Deleted environment '{env_name}' from app '{app.name}'",
            ip_address=ip_address,
            user_agent=user_agent,
        )

        return Response(status=status.HTTP_204_NO_CONTENT)
