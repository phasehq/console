from api.crypto import decrypt_asymmetric, encrypt_asymmetric, get_server_keypair
from api.models import Environment, EnvironmentSync, ServerEnvironmentKey
from backend.graphene.utils.syncing.cloudflare.pages import list_cloudflare_pages
from backend.graphene.utils.permissions import user_can_access_app
from graphql import GraphQLError


def resolve_server_public_key(root, info):
    pk, sk = get_server_keypair()
    return pk.hex()


def resolve_sync_enabled(root, info, app_id):
    # ServerEnvironmentKey.objects.all().delete()

    if not user_can_access_app(info.context.user.userId, app_id):
        raise GraphQLError("You don't have access to this app")

    app_envs = Environment.objects.filter(app_id=app_id).values_list("id")
    return ServerEnvironmentKey.objects.filter(environment_id__in=app_envs).exists()


def resolve_cloudflare_pages_projects(root, info, account_id, access_token):
    pk, sk = get_server_keypair()
    decrypted_account_id = decrypt_asymmetric(account_id, sk.hex(), pk.hex())
    decrypted_access_token = decrypt_asymmetric(access_token, sk.hex(), pk.hex())

    try:
        projects = list_cloudflare_pages(decrypted_account_id, decrypted_access_token)
        return projects
    except Exception as ex:
        raise GraphQLError(ex)


def resolve_app_syncs(root, info, app_id):
    if not user_can_access_app(info.context.user.userId, app_id):
        raise GraphQLError("You don't have access to this app")

    # EnvironmentSync.objects.all().delete()

    return EnvironmentSync.objects.filter(environment__app__id=app_id)
