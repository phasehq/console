import logging
from api.utils.rest import (
    get_org_member_from_user_token,
    get_service_account_from_token,
    get_service_token,
    get_token_type,
    token_is_expired_or_deleted,
)
from api.models import DynamicSecret, Environment, Secret
from api.utils.access.permissions import (
    service_account_can_access_environment,
    user_can_access_environment,
)
from rest_framework import authentication, exceptions
from django.apps import apps

logger = logging.getLogger(__name__)


class ServiceAccountUser:
    """Mock ServiceAccount user"""
    
    def __init__(self, service_account):
        self.userId = service_account.id
        self.id = service_account.id
        self.is_authenticated = True
        self.is_active = True
        self.username = service_account.name
        self.service_account = service_account


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
            "auth_type": token_type,
            "org_member": None,
            "service_token": None,
            "service_account": None,
            "service_account_token": None,
        }

        if token_is_expired_or_deleted(auth_token):
            raise exceptions.AuthenticationFailed("Token expired or deleted")

        env = None

        # Try resolving secret_id from header OR query params (supports Secret or DynamicSecret)
        secret_id = request.headers.get("secret_id") or request.GET.get("secret_id")
        if secret_id:
            found = False
            try:
                secret = Secret.objects.get(id=secret_id)
                env = secret.environment
                found = True
            except Secret.DoesNotExist:
                pass
            if not found:
                try:
                    dyn_secret = DynamicSecret.objects.get(id=secret_id)
                    env = dyn_secret.environment
                    found = True
                except DynamicSecret.DoesNotExist:
                    pass
            if not found:
                raise exceptions.NotFound("Secret not found")

        # If env is still None, try resolving from header or query params
        if env is None:
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
                    if not app_id:
                        raise exceptions.AuthenticationFailed(
                            "Missing app_id parameter"
                        )
                    if not env_name:
                        raise exceptions.AuthenticationFailed("Missing env parameter")
                    env = Environment.objects.get(app_id=app_id, name__iexact=env_name)
                except Environment.DoesNotExist:
                    # Check if the app exists to give a more specific error
                    App = apps.get_model("api", "App")
                    if not App.objects.filter(id=app_id).exists():
                        raise exceptions.NotFound(f"App with ID {app_id} not found")
                    else:
                        raise exceptions.NotFound(
                            f"Environment '{env_name}' not found in App {app_id}"
                        )

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
                
                creator = getattr(service_token, "created_by", None)
                if creator:
                    user = creator.user
                else:
                    user = ServiceAccountUser(service_account)
                    
                auth["service_account"] = service_account
                auth["service_account_token"] = service_token

                if not service_account_can_access_environment(
                    service_account.id, env.id
                ):
                    raise exceptions.AuthenticationFailed(
                        "Service account cannot access this environment"
                    )
            except Exception as ex:
                # Distinguish between ServiceAccount not found and other potential errors
                ServiceAccount = apps.get_model("api", "ServiceAccount")
                try:
                    # Attempt to get the service account again to confirm if it exists
                    get_service_account_from_token(auth_token)
                    # If it exists, the error was likely the environment access check
                    raise exceptions.AuthenticationFailed(
                        "Service account cannot access this environment"
                    )
                except ServiceAccount.DoesNotExist:
                    raise exceptions.NotFound("Service account not found")
                except (
                    Exception
                ) as ex:  # Catch any other unexpected error during the re-check
                    logger.debug(f"Authentication error: {ex}")
                    raise exceptions.AuthenticationFailed(
                        f"Authentication error. Please check your authentication token or App / Environment access."
                    )

        return (user, auth)
