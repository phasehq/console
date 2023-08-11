from api.models import EnvironmentSecret

def get_client_ip(request):
    x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
    if x_forwarded_for:
        ip = x_forwarded_for.split(',')[0]
    else:
        ip = request.META.get('REMOTE_ADDR')
    return ip

def get_env_from_token(auth_token):
    env_token = auth_token.split("Bearer ")[1]

    if not env_token:
        return False
    
    try:
      env_secret = EnvironmentSecret.objects.get(token=env_token)
      return env_secret.environment, env_secret.user
    except Exception as ex:
        return False

    