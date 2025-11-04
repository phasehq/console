from api.models import EnvironmentToken, ServiceAccountToken, ServiceToken, UserToken
from django.utils import timezone
import base64

# Map HTTP methods to permission actions
METHOD_TO_ACTION = {
    "GET": "read",
    "POST": "create",
    "PUT": "update",
    "DELETE": "delete",
}


def get_client_ip(request):
    x_forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR")
    if x_forwarded_for:
        ip = x_forwarded_for.split(",")[0]
    else:
        ip = request.META.get("REMOTE_ADDR")
    return ip


def get_resolver_request_meta(request):
    user_agent = request.META.get("HTTP_USER_AGENT", "Unknown")
    ip_address = get_client_ip(request)

    return ip_address, user_agent


def get_token_type(auth_token):
    return auth_token.split(" ")[1]


def get_env_from_service_token(auth_token):
    token = auth_token.split(" ")[2]

    if not token:
        return False

    try:
        env_token = EnvironmentToken.objects.get(token=token)
        return env_token.environment, env_token.user
    except Exception as ex:
        return False


def get_org_member_from_user_token(auth_token):
    token = auth_token.split(" ")[2]

    if not token:
        return False

    try:
        user_token = UserToken.objects.get(token=token)
        return user_token.user
    except Exception as ex:
        return False


def get_service_account_from_token(auth_token):
    token = auth_token.split(" ")[2]

    if not token:
        return False

    try:
        sa_token = ServiceAccountToken.objects.get(token=token)
        return sa_token.service_account
    except Exception as ex:
        return False


def get_service_token(auth_token):
    prefix, token_type, token_value = auth_token.split(" ")

    if token_type == "User":
        return None

    elif token_type == "Service":
        return ServiceToken.objects.get(token=token_value)

    elif token_type == "ServiceAccount":
        return ServiceAccountToken.objects.get(token=token_value)


def token_is_expired_or_deleted(auth_token):
    prefix, token_type, token_value = auth_token.split(" ")

    if token_type == "User":
        try:
            token = UserToken.objects.get(token=token_value)
        except UserToken.DoesNotExist:
            return True

    elif token_type == "Service":
        try:
            token = ServiceToken.objects.get(token=token_value)
        except ServiceToken.DoesNotExist:
            return True

    elif token_type == "ServiceAccount":
        try:
            token = ServiceAccountToken.objects.get(token=token_value)
        except ServiceAccountToken.DoesNotExist:
            return True

    return token.deleted_at is not None or (
        token.expires_at is not None and token.expires_at < timezone.now()
    )


def encode_string_to_base64(s):
    # Convert string to bytes
    byte_representation = s.encode("utf-8")

    # Base64 encode the bytes
    base64_bytes = base64.b64encode(byte_representation)

    # Convert the encoded bytes back to a string
    base64_string = base64_bytes.decode("utf-8")

    return base64_string
