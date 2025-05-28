from api.utils.crypto import (
    decrypt_asymmetric,
    get_server_keypair,
)
from api.models import (
    App,
    Environment,
    EnvironmentSync,
    Organisation,
    ProviderCredentials,
    ServerEnvironmentKey,
)
from backend.api.notifier import notify_slack
from api.utils.syncing.cloudflare.pages import list_cloudflare_pages
from api.utils.access.permissions import (
    user_can_access_app,
    user_can_access_environment,
    user_has_permission,
    user_is_org_member,
)
from api.services import Providers, ServiceConfig
from api.utils.syncing.aws.secrets_manager import list_aws_secrets
from api.utils.syncing.github.actions import list_repos
from api.utils.syncing.vault.main import test_vault_creds
from api.utils.syncing.nomad.main import test_nomad_creds
from api.utils.syncing.gitlab.main import list_gitlab_groups, list_gitlab_projects
from api.utils.syncing.railway.main import (
    fetch_railway_projects,
)
from api.utils.syncing.vercel.main import (
    test_vercel_creds,
    list_vercel_projects
)
from api.utils.syncing.cloudflare.workers import list_cloudflare_workers
from backend.graphene.types import ProviderType, ServiceType
from graphql import GraphQLError


def resolve_server_public_key(root, info):
    pk, _ = get_server_keypair()
    return pk.hex()


def resolve_sse_enabled(root, info, app_id):
    if not user_can_access_app(info.context.user.userId, app_id):
        raise GraphQLError("You don't have access to this app")

    return App.objects.get(id=app_id).sse_enabled


def resolve_providers(self, info):
    return [
        ProviderType(**provider)
        for provider in Providers.__dict__.values()
        if isinstance(provider, dict)
    ]


def resolve_services(self, info):
    return [
        ServiceType(**service)
        for service in ServiceConfig.__dict__.values()
        if isinstance(service, dict)
    ]


def resolve_saved_credentials(root, info, org_id):

    org = Organisation.objects.get(id=org_id)

    if not user_has_permission(
        info.context.user, "read", "IntegrationCredentials", org
    ):
        return []

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


def resolve_cloudflare_workers(root, info, credential_id):
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
        workers = list_cloudflare_workers(decrypted_account_id, decrypted_access_token)
        return workers
    except Exception as ex:
        raise GraphQLError(ex)


def resolve_aws_secret_manager_secrets(root, info, credential_id):
    pk, sk = get_server_keypair()
    credential = ProviderCredentials.objects.get(id=credential_id)
    
    try:
        decrypted_creds = {}
        
        for key in ["role_arn", "external_id", "region", "access_key_id", "secret_access_key"]:
            if key in credential.credentials:
                decrypted_creds[key] = decrypt_asymmetric(
                    credential.credentials[key], sk.hex(), pk.hex()
                )
        
        secrets = list_aws_secrets(
            region=decrypted_creds.get("region"),
            AWS_ACCESS_KEY_ID=decrypted_creds.get("access_key_id"),
            AWS_SECRET_ACCESS_KEY=decrypted_creds.get("secret_access_key"),
            role_arn=decrypted_creds.get("role_arn"),
            external_id=decrypted_creds.get("external_id")
        )
        
        return secrets
    except Exception as ex:
        raise GraphQLError(ex)


def resolve_gh_repos(root, info, credential_id):
    try:
        secrets = list_repos(credential_id)
        return secrets
    except Exception as ex:
        raise GraphQLError(ex)


def resolve_test_vault_creds(root, info, credential_id):
    try:
        valid = test_vault_creds(credential_id)
        return valid
    except Exception as ex:
        raise GraphQLError(f"Error testing Vault credentials: {str(ex)}")


def resolve_test_nomad_creds(root, info, credential_id):
    try:
        valid = test_nomad_creds(credential_id)
        return valid
    except Exception as ex:
        raise GraphQLError(f"Error testing Nomad credentials: {str(ex)}")


def resolve_gitlab_projects(root, info, credential_id):
    try:
        projects = list_gitlab_projects(credential_id)
        return projects
    except Exception as ex:
        raise GraphQLError(f"Error listing GitLab projects: {str(ex)}")


def resolve_gitlab_groups(root, info, credential_id):
    try:
        groups = list_gitlab_groups(credential_id)
        return groups
    except Exception as ex:
        raise GraphQLError(f"Error listing GitLab groups: {str(ex)}")


def resolve_railway_projects(root, info, credential_id):
    try:
        projects = fetch_railway_projects(credential_id)
        return projects
    except Exception as ex:
        raise GraphQLError(f"Error listing Railway environments: {str(ex)}")

def resolve_vercel_projects(root, info, credential_id):
    """Resolver for listing Vercel projects."""
    try:
        if not test_vercel_creds(credential_id):
            raise GraphQLError(
                "Could not authenticate with Vercel. Please check that your credentials are valid"
            )
        
        projects = list_vercel_projects(credential_id)
        return projects
    except Exception as ex:
        raise GraphQLError(f"Error listing Vercel projects: {str(ex)}")

def resolve_syncs(root, info, app_id=None, env_id=None, org_id=None):

    # If both app_id and env_id are provided
    if app_id and env_id:
        org = App.objects.get(id=app_id).organisation
        if not user_has_permission(
            info.context.user, "read", "Integrations", org, True
        ):
            return []

        if not user_can_access_app(info.context.user.userId, app_id):
            raise GraphQLError("You don't have access to this app")
        if not user_can_access_environment(info.context.user.userId, env_id):
            raise GraphQLError("You don't have access to this environment")
        return EnvironmentSync.objects.filter(
            environment__app__id=app_id, environment_id=env_id, deleted_at=None
        )

    # If only app_id is provided
    elif app_id:

        org = App.objects.get(id=app_id).organisation
        if not user_has_permission(
            info.context.user, "read", "Integrations", org, True
        ):
            return []

        if not user_can_access_app(info.context.user.userId, app_id):
            raise GraphQLError("You don't have access to this app")
        return EnvironmentSync.objects.filter(
            environment__app__id=app_id, deleted_at=None
        )

    # If only env_id is provided
    elif env_id:

        org = Environment.objects.get(id=env_id).app.organisation
        if not user_has_permission(
            info.context.user, "read", "Integrations", org, True
        ):
            return []

        if not user_can_access_environment(info.context.user.userId, env_id):
            raise GraphQLError("You don't have access to this environment")
        return EnvironmentSync.objects.filter(environment_id=env_id, deleted_at=None)

    # If only org_id is provided
    elif org_id:

        org = Organisation.objects.get(id=org_id)
        if not user_has_permission(
            info.context.user, "read", "Integrations", org, True
        ):
            return []

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
