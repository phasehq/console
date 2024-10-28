from api.utils.rest import (
    get_org_member_from_user_token,
    get_service_account_from_token,
    get_service_token,
    get_token_type,
    token_is_expired_or_deleted,
)
from api.models import Environment
from api.utils.access.permissions import (
    service_account_can_access_environment,
    user_can_access_environment,
)
from rest_framework import authentication, exceptions


class PhaseTokenAuthentication(authentication.BaseAuthentication):
    def authenticate(self, request):

        token_types = ["User", "Service", "ServiceAccount"]

        auth_token = request.headers.get("Authorization")

        if not auth_token:
            return None  # No authentication attempted

        token_type = get_token_type(auth_token)

        if token_type not in token_types:
            raise exceptions.AuthenticationFailed("Invalid token")

        auth = {
            "token": auth_token,
            "org_member": None,
            "service_token": None,
            "service_account": None,
        }

        if token_is_expired_or_deleted(auth_token):
            raise exceptions.AuthenticationFailed("Token expired or deleted")

        env_id = request.headers.get("environment")

        # Try resolving env from header
        if env_id:
            try:
                env = Environment.objects.get(id=env_id)
            except Environment.DoesNotExist:
                raise exceptions.AuthenticationFailed("Environment not found")

        # Try resolving env from query params
        else:
            try:
                app_id = request.GET.get("app_id")
                env_name = request.GET.get("env")
                env = Environment.objects.get(app_id=app_id, name__iexact=env_name)
            except Environment.DoesNotExist:
                raise exceptions.AuthenticationFailed("Environment not found")

        auth["environment"] = env

        if token_type == "User":
            try:
                org_member = get_org_member_from_user_token(auth_token)
                auth["org_member"] = org_member
                user = org_member.user

                if not user_can_access_environment(org_member.user.userId, env.id):
                    raise exceptions.AuthenticationFailed(
                        "User cannot access this environment"
                    )
            except Exception as ex:
                raise exceptions.NotFound("User not found")

        elif token_type == "Service":
            service_token = get_service_token(auth_token)
            auth["service_token"] = service_token
            user = service_token.created_by.user

        if token_type == "ServiceAccount":

            try:
                service_token = get_service_token(auth_token)
                service_account = get_service_account_from_token(auth_token)
                user = service_token.created_by.user
                auth["service_account"] = service_account

                if not service_account_can_access_environment(
                    service_account.id, env.id
                ):
                    raise exceptions.AuthenticationFailed(
                        "Service account cannot access this environment"
                    )
            except Exception as ex:
                raise exceptions.NotFound("Service account not found")

        return (user, auth)
