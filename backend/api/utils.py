from api.models import EnvironmentToken, ServiceToken, UserToken
from django.utils import timezone


def get_client_ip(request):
    x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
    if x_forwarded_for:
        ip = x_forwarded_for.split(',')[0]
    else:
        ip = request.META.get('REMOTE_ADDR')
    return ip


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


def token_is_expired(auth_token):
    prefix, token_type, token_value = auth_token.split(" ")

    if token_type == 'User':
        token = UserToken.objects.get(token=token_value)
    else:
        token = ServiceToken.objects.get(token=token_value)

    return token.deleted_at is not None or token.expires_at < timezone.now()
