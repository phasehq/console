from api.crypto import encrypt_asymmetric, get_server_keypair
from api.services import get_service_config
from api.models import Environment, EnvironmentSync, ServerEnvironmentKey
from backend.graphene.utils.permissions import user_can_access_app
from graphql import GraphQLError


def resolve_server_public_key(root, info):
    pk, sk = get_server_keypair()
    return pk.hex()


def resolve_sync_enabled(root, info, app_id):

    # ServerEnvironmentKey.objects.all().delete()

    if not user_can_access_app(info.context.user.userId, app_id):
        raise GraphQLError("You don't have access to this app")

    app_envs = Environment.objects.filter(app_id=app_id).values_list('id')
    return ServerEnvironmentKey.objects.filter(environment_id__in=app_envs).exists()


def create_cloudflare_sync(root, info, env_id, project, project_env, access_token, account_id):
    service_config = get_service_config('cloudflare')

    env = Environment.objects.get(id=env_id)

    if not ServerEnvironmentKey.objects.filter(environment=env).exists():
        raise GraphQLError("Syncing is not enabled for this environment!")

    if not user_can_access_app(info.context.user.userId, env.app.id):
        raise GraphQLError("You don't have access to this app")

    pk, sk = get_server_keypair()

    wrapped_account_id = encrypt_asymmetric(account_id, pk.hex())
    wrapped_access_token = encrypt_asymmetric(access_token, pk.hex())

    sync_options = {
        "project": project,
        "environment": project_env
    }

    authentication_credentials = {
        "access_token": wrapped_access_token,
        "account_id": wrapped_account_id
    }

    EnvironmentSync.objects.create(environment=env, service='cloudflare',
                                   options=sync_options, authentication=authentication_credentials)
