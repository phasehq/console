import logging

from api.utils.crypto import (
    decrypt_asymmetric,
    get_server_keypair,
)

from api.models import (
    App,
    Environment,
    EnvironmentSync,
    Organisation,
    OrganisationMember,
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
from api.utils.syncing.github.actions import list_repos, list_environments, list_orgs
from api.utils.syncing.vault.main import test_vault_creds
from api.utils.syncing.nomad.main import test_nomad_creds
from api.utils.syncing.gitlab.main import list_gitlab_groups, list_gitlab_projects
from api.utils.syncing.railway.main import (
    fetch_railway_projects,
)
from api.utils.syncing.vercel.main import test_vercel_creds, list_vercel_projects
from api.utils.syncing.cloudflare.workers import list_cloudflare_workers
from api.utils.syncing.render.main import (
    list_render_services,
    list_render_environment_groups,
)
from api.utils.syncing.supabase.main import list_supabase_projects
from api.utils.syncing.gcp.auth import GCPAuthError, get_gcp_credentials
from api.utils.syncing.gcp.secret_manager import SecretManagerError, list_gcp_secrets
from backend.graphene.types import ProviderType, ServiceType
from graphql import GraphQLError

logger = logging.getLogger(__name__)


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


def get_readable_credential(info, credential_id, providers, service_name):
    """Fetch a credential the caller may read; call before decrypting or using it."""
    credential = (
        ProviderCredentials.objects.filter(id=credential_id, deleted_at=None)
        .select_related("organisation")
        .first()
    )

    # Same error for missing and forbidden so credential ids can't be probed.
    if credential is None or not user_has_permission(
        info.context.user, "read", "IntegrationCredentials", credential.organisation
    ):
        raise GraphQLError("You don't have permission to access these credentials")

    if credential.provider not in providers:
        raise GraphQLError(f"These credentials can't be used with {service_name}")

    return credential


def resolve_cloudflare_pages_projects(root, info, credential_id):
    credential = get_readable_credential(
        info, credential_id, ("cloudflare",), "Cloudflare"
    )

    pk, sk = get_server_keypair()

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
    credential = get_readable_credential(
        info, credential_id, ("cloudflare",), "Cloudflare"
    )

    pk, sk = get_server_keypair()

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
    credential = get_readable_credential(
        info, credential_id, ("aws", "aws_assume_role"), "AWS Secrets Manager"
    )

    pk, sk = get_server_keypair()

    try:
        decrypted_creds = {}

        for key in [
            "role_arn",
            "external_id",
            "region",
            "access_key_id",
            "secret_access_key",
        ]:
            if key in credential.credentials:
                decrypted_creds[key] = decrypt_asymmetric(
                    credential.credentials[key], sk.hex(), pk.hex()
                )

        secrets = list_aws_secrets(
            region=decrypted_creds.get("region"),
            AWS_ACCESS_KEY_ID=decrypted_creds.get("access_key_id"),
            AWS_SECRET_ACCESS_KEY=decrypted_creds.get("secret_access_key"),
            role_arn=decrypted_creds.get("role_arn"),
            external_id=decrypted_creds.get("external_id"),
        )

        return secrets
    except Exception as ex:
        raise GraphQLError(ex)


def resolve_validate_aws_assume_role_auth(root, info):
    """
    Validate if AWS assume role authentication is available for the Phase instance.
    """
    from api.utils.syncing.aws.auth import validate_aws_assume_role_auth

    try:
        validation_result = validate_aws_assume_role_auth()
        return validation_result
    except Exception as ex:
        raise GraphQLError(str(ex))


def resolve_validate_aws_assume_role_credentials(
    root, info, role_arn, region=None, external_id=None
):
    """
    Validate if specific AWS assume role credentials can be successfully used.
    """
    from api.utils.syncing.aws.auth import validate_aws_assume_role_credentials

    try:
        validation_result = validate_aws_assume_role_credentials(
            role_arn, region, external_id
        )
        return validation_result
    except Exception as ex:
        raise GraphQLError(str(ex))


def resolve_gh_repos(root, info, credential_id):
    get_readable_credential(info, credential_id, ("github",), "GitHub")

    try:
        secrets = list_repos(credential_id)
        return secrets
    except Exception as ex:
        raise GraphQLError(ex)


def resolve_github_environments(root, info, credential_id, owner, repo_name):
    get_readable_credential(info, credential_id, ("github",), "GitHub")

    try:
        envs = list_environments(credential_id, owner, repo_name)
        return envs
    except Exception as ex:
        raise GraphQLError(ex)


def resolve_gh_orgs(root, info, credential_id):
    get_readable_credential(info, credential_id, ("github",), "GitHub")

    try:
        orgs = list_orgs(credential_id)
        return orgs
    except Exception as ex:
        raise GraphQLError(ex)


def resolve_test_vault_creds(root, info, credential_id):
    get_readable_credential(
        info, credential_id, ("hashicorp_vault",), "HashiCorp Vault"
    )

    try:
        valid = test_vault_creds(credential_id)
        return valid
    except Exception as ex:
        raise GraphQLError(f"Error testing Vault credentials: {str(ex)}")


def resolve_test_nomad_creds(root, info, credential_id):
    get_readable_credential(
        info, credential_id, ("hashicorp_nomad",), "HashiCorp Nomad"
    )

    try:
        valid = test_nomad_creds(credential_id)
        return valid
    except Exception as ex:
        raise GraphQLError(f"Error testing Nomad credentials: {str(ex)}")


def resolve_gitlab_projects(root, info, credential_id):
    get_readable_credential(info, credential_id, ("gitlab",), "GitLab")

    try:
        projects = list_gitlab_projects(credential_id)
        return projects
    except Exception as ex:
        raise GraphQLError(f"Error listing GitLab projects: {str(ex)}")


def resolve_gitlab_groups(root, info, credential_id):
    get_readable_credential(info, credential_id, ("gitlab",), "GitLab")

    try:
        groups = list_gitlab_groups(credential_id)
        return groups
    except Exception as ex:
        raise GraphQLError(f"Error listing GitLab groups: {str(ex)}")


def resolve_railway_projects(root, info, credential_id):
    get_readable_credential(info, credential_id, ("railway",), "Railway")

    try:
        projects = fetch_railway_projects(credential_id)
        return projects
    except Exception as ex:
        raise GraphQLError(f"Error listing Railway environments: {str(ex)}")


def resolve_supabase_projects(root, info, credential_id):
    get_readable_credential(info, credential_id, ("supabase",), "Supabase")

    try:
        projects = list_supabase_projects(credential_id)
        return projects
    except Exception as ex:
        raise GraphQLError(f"Error listing Supabase projects: {str(ex)}")


def resolve_render_services(root, info, credential_id):
    """Resolver for listing Render services."""
    get_readable_credential(info, credential_id, ("render",), "Render")

    try:
        services = list_render_services(credential_id)
        return services
    except Exception as ex:
        raise GraphQLError(f"Error listing Render services: {str(ex)}")


def resolve_render_envgroups(root, info, credential_id):
    """Resolver for listing Render Environment Groups."""
    get_readable_credential(info, credential_id, ("render",), "Render")

    try:
        envgroups = list_render_environment_groups(credential_id)
        return envgroups
    except Exception as ex:
        raise GraphQLError(f"Error listing Render Environment Groups: {str(ex)}")


def resolve_vercel_projects(root, info, credential_id):
    """Resolver for listing Vercel projects."""
    get_readable_credential(info, credential_id, ("vercel",), "Vercel")

    try:
        if not test_vercel_creds(credential_id):
            raise GraphQLError(
                "Could not authenticate with Vercel. Please check that your credentials are valid"
            )

        projects = list_vercel_projects(credential_id)
        return projects
    except Exception as ex:
        raise GraphQLError(f"Error listing Vercel projects: {str(ex)}")


def resolve_azure_kv_secrets(root, info, credential_id, vault_uri):
    credential = get_readable_credential(
        info, credential_id, ("azure",), "Azure Key Vault"
    )

    pk, sk = get_server_keypair()

    try:
        from api.utils.syncing.azure.auth import (
            get_azure_client_credential,
            get_kv_client,
        )
        from api.utils.syncing.azure.key_vault import list_kv_secrets, validate_vault_uri

        vault_uri = validate_vault_uri(vault_uri)

        tenant_id = decrypt_asymmetric(
            credential.credentials["tenant_id"], sk.hex(), pk.hex()
        )
        client_id = decrypt_asymmetric(
            credential.credentials["client_id"], sk.hex(), pk.hex()
        )
        client_secret = decrypt_asymmetric(
            credential.credentials["client_secret"], sk.hex(), pk.hex()
        )

        azure_cred = get_azure_client_credential(tenant_id, client_id, client_secret)
        client = get_kv_client(azure_cred, vault_uri)
        secrets = list_kv_secrets(client)
        return secrets
    except Exception as ex:
        logger.error(f"Error listing Azure Key Vault secrets: {str(ex)}")
        raise GraphQLError("Failed to list secrets from Azure Key Vault. Please check your credentials and Vault URI.")


def resolve_gcp_secret_manager_secrets(root, info, credential_id, project_id, location):
    credential = ProviderCredentials.objects.get(id=credential_id)

    if not user_has_permission(
        info.context.user, "read", "IntegrationCredentials", credential.organisation
    ):
        raise GraphQLError("You don't have permission to access these credentials")

    if credential.provider != Providers.GCP["id"]:
        raise GraphQLError("These credentials can't be used with GCP Secret Manager!")

    try:
        return list_gcp_secrets(get_gcp_credentials(credential), project_id, location)
    except (ValueError, GCPAuthError) as e:
        raise GraphQLError(str(e))
    except SecretManagerError as e:
        raise GraphQLError(e.user_message())


def resolve_syncs(root, info, app_id=None, env_id=None, org_id=None):

    # If both app_id and env_id are provided
    if app_id and env_id:
        app = App.objects.get(id=app_id)
        org = app.organisation
        if not user_has_permission(
            info.context.user, "read", "Integrations", org, True, app=app
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

        app = App.objects.get(id=app_id)
        org = app.organisation
        if not user_has_permission(
            info.context.user, "read", "Integrations", org, True, app=app
        ):
            return []

        if not user_can_access_app(info.context.user.userId, app_id):
            raise GraphQLError("You don't have access to this app")
        return EnvironmentSync.objects.filter(
            environment__app__id=app_id, deleted_at=None
        )

    # If only env_id is provided
    elif env_id:

        env = Environment.objects.get(id=env_id)
        org = env.app.organisation
        if not user_has_permission(
            info.context.user, "read", "Integrations", org, True, app=env.app
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

        org_member = OrganisationMember.objects.get(
            user_id=info.context.user.userId, organisation_id=org_id, deleted_at=None
        )
        accessible_app_ids = set(org_member.apps.values_list("id", flat=True))

        return list(
            EnvironmentSync.objects.filter(
                environment__app__organisation_id=org_id,
                environment__app_id__in=accessible_app_ids,
                deleted_at=None,
            )
        )

    # If neither app_id, env_id, nor org_id is provided
    else:
        raise GraphQLError(
            "You must provide an app ID, an environment ID, or an organisation ID"
        )


def resolve_env_syncs(root, info, env_id):
    if not user_can_access_environment(info.context.user.userId, env_id):
        raise GraphQLError("You don't have access to this environment")

    env = Environment.objects.get(id=env_id)
    org = env.app.organisation
    # Empty rather than an error: envSyncs is fetched alongside secrets.
    if not user_has_permission(
        info.context.user, "read", "Integrations", org, True, app=env.app
    ):
        return []

    return EnvironmentSync.objects.filter(environment_id=env_id, deleted_at=None)
