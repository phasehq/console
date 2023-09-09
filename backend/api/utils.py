from api.models import EnvironmentToken, ServiceToken, UserToken


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
    token_type = get_token_type(auth_token)
    if token_type == 'User':
        user_token = UserToken.objects.get(token=auth_token.split(" ")[2])
        return user_token.deleted_at != None
    else:
        service_token = ServiceToken.objects.get(
            token=auth_token.split(" ")[2])
        return service_token.deleted_at != None
