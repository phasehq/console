from api.utils.crypto import (
    decrypt_asymmetric,
    get_server_keypair,
)
from api.models import (
    Environment,
    EnvironmentSync,
    ProviderCredentials,
    ServerEnvironmentKey,
)
from backend.api.notifier import notify_slack
from api.utils.syncing.cloudflare.pages import list_cloudflare_pages
from api.utils.permissions import (
    user_can_access_app,
    user_can_access_environment,
    user_is_org_member,
)
from api.services import Providers, ServiceConfig
from api.utils.syncing.aws.secrets_manager import list_aws_secrets
from backend.graphene.types import ProviderType
from graphql import GraphQLError


def resolve_server_public_key(root, info):
    pk, _ = get_server_keypair()
    return pk.hex()


def resolve_sync_enabled(root, info, app_id):
    if not user_can_access_app(info.context.user.userId, app_id):
        raise GraphQLError("You don't have access to this app")

    app_envs = Environment.objects.filter(app_id=app_id).values_list("id")
    return ServerEnvironmentKey.objects.filter(environment_id__in=app_envs).exists()


def resolve_providers(self, info):
    return [
        ProviderType(**provider)
        for provider in Providers.__dict__.values()
        if isinstance(provider, dict)
    ]


def resolve_saved_credentials(root, info, org_id):
    if not user_is_org_member(info.context.user.userId, org_id):
        raise GraphQLError("You don't have permission to perform this action")

    return ProviderCredentials.objects.filter(organisation_id=org_id, deleted_at=None)


def resolve_cloudflare_pages_projects(root, info, credential_id):
    pk, sk = get_server_keypair()

    credential = ProviderCredentials.objects.get(id=credential_id)

    if credential.provider != "cloudflare":
        raise GraphQLError("These credentials can't be used to sync with Cloudflare!")

    decrypted_account_id = decrypt_asymmetric(
        credential.credentials["account_id"], sk.hex(), pk.hex()
    )
    decrypted_access_token = decrypt_asymmetric(
        credential.credentials["access_token"], sk.hex(), pk.hex()
    )

    try:
        projects = list_cloudflare_pages(decrypted_account_id, decrypted_access_token)
        return projects
    except Exception as ex:
        raise GraphQLError(ex)


def resolve_aws_secret_manager_secrets(root, info, credential_id):
    pk, sk = get_server_keypair()

    credential = ProviderCredentials.objects.get(id=credential_id)

    access_key_id = decrypt_asymmetric(
        credential.credentials["access_key_id"], sk.hex(), pk.hex()
    )

    secret_access_key = decrypt_asymmetric(
        credential.credentials["secret_access_key"], sk.hex(), pk.hex()
    )

    region = decrypt_asymmetric(credential.credentials["region"], sk.hex(), pk.hex())

    try:
        secrets = list_aws_secrets(access_key_id, secret_access_key, region)
        return secrets
    except Exception as ex:
        raise GraphQLError(ex)


def resolve_syncs(root, info, app_id=None, env_id=None, org_id=None):
    # If both app_id and env_id are provided
    if app_id and env_id:
        if not user_can_access_app(info.context.user.userId, app_id):
            raise GraphQLError("You don't have access to this app")
        if not user_can_access_environment(info.context.user.userId, env_id):
            raise GraphQLError("You don't have access to this environment")
        return EnvironmentSync.objects.filter(
            environment__app__id=app_id, environment_id=env_id, deleted_at=None
        )

    # If only app_id is provided
    elif app_id:
        if not user_can_access_app(info.context.user.userId, app_id):
            raise GraphQLError("You don't have access to this app")
        return EnvironmentSync.objects.filter(
            environment__app__id=app_id, deleted_at=None
        )

    # If only env_id is provided
    elif env_id:
        if not user_can_access_environment(info.context.user.userId, env_id):
            raise GraphQLError("You don't have access to this environment")
        return EnvironmentSync.objects.filter(environment_id=env_id, deleted_at=None)

    # If only org_id is provided
    elif org_id:
        if not user_is_org_member(info.context.user.userId, org_id):
            raise GraphQLError("You don't have access to this organisation")
        return [
            sync
            for sync in EnvironmentSync.objects.filter(
                environment__app__organisation_id=org_id, deleted_at=None
            )
            if user_can_access_app(info.context.user.userId, sync.environment.app.id)
        ]

    # If neither app_id, env_id, nor org_id is provided
    else:
        raise GraphQLError(
            "You must provide an app ID, an environment ID, or an organisation ID"
        )


def resolve_env_syncs(root, info, env_id):
    if not user_can_access_environment(info.context.user.userId, env_id):
        raise GraphQLError("You don't have access to this environment")

    return EnvironmentSync.objects.filter(environment_id=env_id, deleted_at=None)
