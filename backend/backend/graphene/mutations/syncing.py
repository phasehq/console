import json
import re

from api.tasks.syncing import trigger_sync_tasks
from api.utils.crypto import decrypt_asymmetric, encrypt_asymmetric, get_server_keypair
from api.utils.secrets import normalize_path_string
from api.utils.syncing.azure.key_vault import validate_vault_uri
from api.utils.syncing.gcp.auth import (
    ISSUER_PATTERN,
    KEY_ID_PATTERN,
    GCPAuthError,
    exchange_token,
    generate_workload_identity_key,
    normalize_workload_identity_provider,
    public_jwks,
    workload_identity_subject,
)
from api.utils.syncing.gcp.secret_manager import (
    validate_kms_key_name,
    validate_location,
    validate_prefix,
    validate_project_id,
    validate_secret_id,
)

from api.utils.syncing.render.main import RenderResourceType
import graphene
from django.db import transaction
from graphql import GraphQLError
from api.utils.access.permissions import (
    user_can_access_app,
    user_can_access_environment,
    user_has_permission,
    user_is_org_member,
)
from api.utils.audit_logging import log_audit_event, get_actor_info_from_graphql
from api.utils.rest import get_resolver_request_meta
from backend.graphene.types import AppType, EnvironmentSyncType, ProviderCredentialsType
from .environment import EnvironmentKeyInput
from api.models import (
    App,
    Environment,
    EnvironmentSync,
    Organisation,
    ProviderCredentials,
    ServerEnvironmentKey,
)
from api.services import Providers, ServiceConfig


class RailwayResourceInput(graphene.InputObjectType):
    id = graphene.ID(required=True)
    name = graphene.String(required=True)


class InitEnvSync(graphene.Mutation):
    class Arguments:
        app_id = graphene.ID()
        env_keys = graphene.List(EnvironmentKeyInput)

    app = graphene.Field(AppType)

    @classmethod
    def mutate(cls, root, info, app_id, env_keys):
        user = info.context.user
        app = App.objects.get(id=app_id)

        if not user_can_access_app(user.userId, app.id):
            raise GraphQLError("You don't have access to this app")

        if not user_has_permission(
            user, "update", "EncryptionMode", app.organisation, True, app=app
        ):
            raise GraphQLError(
                "You don't have permission to change the encryption mode of this App"
            )

        app_environments = {
            str(env.id): env for env in Environment.objects.filter(app=app)
        }
        if not app_environments:
            raise GraphQLError("This App has no environments")

        for env in app_environments.values():
            if not user_can_access_environment(user.userId, env.id):
                raise GraphQLError(
                    "You cannot enable SSE as you don't have access to all environments in this App"
                )

        env_keys = list(env_keys or [])
        requested_env_ids = [str(key.env_id) for key in env_keys]
        if len(requested_env_ids) != len(set(requested_env_ids)):
            raise GraphQLError("Duplicate environment IDs are not allowed")
        if not set(requested_env_ids) <= set(app_environments):
            raise GraphQLError("Some environment IDs do not belong to this app")
        if set(requested_env_ids) != set(app_environments):
            raise GraphQLError(
                "Server keys must be supplied for every environment of this App"
            )

        with transaction.atomic():
            was_enabled = app.sse_enabled
            app.sse_enabled = True
            app.save()

            for key in env_keys:
                environment = app_environments[str(key.env_id)]
                # filter().first() instead of update_or_create: legacy dupes
                # from the old unconditional create() would trip
                # MultipleObjectsReturned.
                server_key = ServerEnvironmentKey.objects.filter(
                    environment=environment
                ).first()
                if server_key is None:
                    server_key = ServerEnvironmentKey(environment=environment)
                server_key.wrapped_seed = key.wrapped_seed
                server_key.wrapped_salt = key.wrapped_salt
                server_key.identity_key = key.identity_key
                server_key.deleted_at = None
                server_key.save()

        # Only audit the actual transition, not idempotent re-enables.
        if not was_enabled:
            actor_type, actor_id, actor_metadata = get_actor_info_from_graphql(
                info, organisation=app.organisation
            )
            ip_address, user_agent = get_resolver_request_meta(info.context)
            log_audit_event(
                organisation=app.organisation,
                event_type="U",
                resource_type="app",
                resource_id=app.id,
                actor_type=actor_type,
                actor_id=actor_id,
                actor_metadata=actor_metadata,
                resource_metadata={"name": app.name},
                old_values={"sse_enabled": False},
                new_values={"sse_enabled": True},
                description=f"Enabled server-side encryption on app '{app.name}'",
                ip_address=ip_address,
                user_agent=user_agent,
            )

        return InitEnvSync(app=app)


def validate_credential_values(provider_id, credentials, organisation_id=None):
    """Server-side validation of provider-specific credential fields.

    The Datadog site composes into intake/API URLs (an SSRF surface) and a
    bad value only surfaces at ship time — enforce the allowlist here, not
    just in the console picker. Values arrive encrypted with the server
    public key, so validation decrypts the field it checks.
    """
    if provider_id == Providers.GCP["id"]:
        validate_gcp_credential_values(credentials, organisation_id)
        return
    if provider_id != "datadog":
        return
    from api.services import DATADOG_SITES, normalize_datadog_site
    from api.utils.crypto import decrypt_asymmetric, get_server_keypair

    encrypted_site = (credentials or {}).get("site")
    if not encrypted_site:
        raise GraphQLError("A Datadog site is required")
    pk, sk = get_server_keypair()
    try:
        site = decrypt_asymmetric(encrypted_site, sk.hex(), pk.hex())
    except Exception:
        raise GraphQLError("Could not read the Datadog site value")
    if normalize_datadog_site(site) not in DATADOG_SITES:
        raise GraphQLError(
            "Unknown Datadog site. Choose one of the supported Datadog regions."
        )


def validate_gcp_credential_values(credentials, organisation_id):
    """Check a Google Cloud credential before it's saved or verified.

    Besides a well-formed provider name, the signing identity must be one
    generateGcpWorkloadIdentityKey minted for this organisation: the subject
    names the org and key ID, and the stored JWKS is the private key's public
    half. An identity can't be moved into another org's credential, and the
    setup script shown later always matches the key Phase signs with.
    Returns the decrypted values.
    """
    credentials = credentials or {}
    fields = Providers.GCP["expected_credentials"]
    missing = [field for field in fields if not credentials.get(field)]
    if missing:
        raise GraphQLError(
            f"Missing Google Cloud credential fields: {', '.join(missing)}"
        )
    pk, sk = get_server_keypair()
    try:
        values = {
            field: decrypt_asymmetric(credentials[field], sk.hex(), pk.hex())
            for field in fields
        }
    except Exception:
        raise GraphQLError(
            "Could not read these Google Cloud credentials. Reload the page and try again."
        )
    try:
        normalize_workload_identity_provider(values["workload_identity_provider"])
    except ValueError as e:
        raise GraphQLError(str(e))
    # These values are rendered into setup scripts and sent to Google, so
    # only the exact shapes Phase mints are accepted.
    if not KEY_ID_PATTERN.match(values["key_id"]) or not ISSUER_PATTERN.match(
        values["issuer"]
    ):
        raise GraphQLError(
            "This Google Cloud identity wasn't created by Phase. Create a new credential."
        )
    if values["subject"] != workload_identity_subject(
        organisation_id, values["key_id"]
    ):
        raise GraphQLError(
            "This Google Cloud identity belongs to a different organisation. "
            "Create a new credential."
        )
    try:
        key_matches = public_jwks(
            values["private_key"], values["key_id"]
        ) == json.loads(values["jwks"])
    except (ValueError, TypeError):
        key_matches = False
    if not key_matches:
        raise GraphQLError(
            "This credential's signing key doesn't match its public key. "
            "Create a new credential."
        )
    return values


class GCPWorkloadIdentityKeyType(graphene.ObjectType):
    issuer = graphene.String()
    subject = graphene.String()
    key_id = graphene.String()
    # The JWKS the customer uploads to their Workload Identity provider.
    jwks = graphene.String()
    # Every credential field except the provider name, each encrypted to the
    # server's public key: the form credential values are saved in.
    sealed_credentials = graphene.JSONString()


class GenerateGCPWorkloadIdentityKey(graphene.Mutation):
    """Mint the signing identity for a new Google Cloud credential.

    Nothing is stored here. The private key is only ever returned sealed to
    the server's public key, so it round-trips through the browser to
    createProviderCredentials without being readable there.
    """

    class Arguments:
        organisation_id = graphene.ID(required=True)

    key = graphene.Field(GCPWorkloadIdentityKeyType)

    @classmethod
    def mutate(cls, root, info, organisation_id):
        org = Organisation.objects.get(id=organisation_id)
        if not user_has_permission(
            info.context.user, "create", "IntegrationCredentials", org
        ):
            raise GraphQLError(
                "You don't have permission to create Integration Credentials"
            )

        try:
            identity = generate_workload_identity_key(org.id)
        except GCPAuthError as e:
            raise GraphQLError(str(e))

        jwks = json.dumps(identity["jwks"], indent=2)
        pk, _ = get_server_keypair()
        sealed = {
            field: encrypt_asymmetric(value, pk.hex())
            for field, value in (
                ("issuer", identity["issuer"]),
                ("subject", identity["subject"]),
                ("key_id", identity["key_id"]),
                ("private_key", identity["private_key"]),
                ("jwks", jwks),
            )
        }
        return GenerateGCPWorkloadIdentityKey(
            key=GCPWorkloadIdentityKeyType(
                issuer=identity["issuer"],
                subject=identity["subject"],
                key_id=identity["key_id"],
                jwks=jwks,
                sealed_credentials=sealed,
            )
        )


class ValidateGCPWorkloadIdentity(graphene.Mutation):
    """Exchange a token with Google using credentials that aren't saved yet.

    Google doesn't check an uploaded JWKS, so this is where a wrong key,
    issuer, subject or provider name first shows up.
    """

    class Arguments:
        organisation_id = graphene.ID(required=True)
        credentials = graphene.JSONString(required=True)

    valid = graphene.Boolean()
    error = graphene.String()

    @classmethod
    def mutate(cls, root, info, organisation_id, credentials):
        org = Organisation.objects.get(id=organisation_id)
        user = info.context.user
        if not (
            user_has_permission(user, "create", "IntegrationCredentials", org)
            or user_has_permission(user, "update", "IntegrationCredentials", org)
        ):
            raise GraphQLError(
                "You don't have permission to validate Integration Credentials"
            )

        try:
            decrypted = validate_gcp_credential_values(credentials, org.id)
        except GraphQLError as e:
            return ValidateGCPWorkloadIdentity(valid=False, error=e.message)

        try:
            exchange_token(decrypted)
        except GCPAuthError as e:
            return ValidateGCPWorkloadIdentity(valid=False, error=str(e))
        return ValidateGCPWorkloadIdentity(valid=True, error=None)


class CreateProviderCredentials(graphene.Mutation):
    class Arguments:
        org_id = graphene.ID()
        provider = graphene.String()
        name = graphene.String()
        credentials = graphene.JSONString()

    credential = graphene.Field(ProviderCredentialsType)

    @classmethod
    def mutate(cls, root, info, org_id, provider, name, credentials):

        org = Organisation.objects.get(id=org_id)

        if not user_has_permission(
            info.context.user, "create", "IntegrationCredentials", org
        ):
            raise GraphQLError(
                "You don't have permission to create Integration Credentials"
            )

        validate_credential_values(provider, credentials, org.id)

        credential = ProviderCredentials.objects.create(
            organisation=org, name=name, provider=provider, credentials=credentials
        )

        return CreateProviderCredentials(credential=credential)


class UpdateProviderCredentials(graphene.Mutation):
    class Arguments:
        credential_id = graphene.ID()
        name = graphene.String()
        credentials = graphene.JSONString()

    credential = graphene.Field(ProviderCredentialsType)

    @classmethod
    def mutate(cls, root, info, credential_id, name, credentials):
        credential = ProviderCredentials.objects.get(id=credential_id)

        if not user_has_permission(
            info.context.user,
            "update",
            "IntegrationCredentials",
            credential.organisation,
        ):
            raise GraphQLError(
                "You don't have permission to update Integration Credentials"
            )

        validate_credential_values(
            credential.provider, credentials, credential.organisation_id
        )

        credential.name = name
        credential.credentials = credentials
        credential.save()

        return UpdateProviderCredentials(credential=credential)


class DeleteProviderCredentials(graphene.Mutation):
    class Arguments:
        credential_id = graphene.ID()

    ok = graphene.Boolean()

    @classmethod
    def mutate(cls, root, info, credential_id):
        credential = ProviderCredentials.objects.get(id=credential_id)

        if not user_has_permission(
            info.context.user,
            "delete",
            "IntegrationCredentials",
            credential.organisation,
        ):
            raise GraphQLError(
                "You don't have permission to delete Integration Credentials"
            )

        credential.delete()

        return DeleteProviderCredentials(ok=True)


class CreateCloudflarePagesSync(graphene.Mutation):
    class Arguments:
        env_id = graphene.ID()
        path = graphene.String()
        credential_id = graphene.ID()
        project_name = graphene.String()
        deployment_id = graphene.ID()
        project_env = graphene.String()

    sync = graphene.Field(EnvironmentSyncType)

    @classmethod
    def mutate(
        cls,
        root,
        info,
        env_id,
        path,
        credential_id,
        project_name,
        deployment_id,
        project_env,
    ):
        service_id = "cloudflare_pages"
        service_config = ServiceConfig.get_service_config(service_id)

        env = Environment.objects.get(id=env_id)

        authentication = ProviderCredentials.objects.get(id=credential_id)
        if authentication.organisation != env.app.organisation:
            raise GraphQLError(
                "The credential provided does not belong to this organization."
            )

        if not env.app.sse_enabled:
            raise GraphQLError("Syncing is not enabled for this environment!")

        if not user_can_access_app(info.context.user.userId, env.app.id):
            raise GraphQLError("You don't have access to this app")

        if not user_can_access_environment(info.context.user.userId, env.id):
            raise GraphQLError("You don't have access to this environment")

        if not user_has_permission(
            info.context.user,
            "create",
            "Integrations",
            env.app.organisation,
            True,
            app=env.app,
        ):
            raise GraphQLError("You don't have permission to create Integrations")

        sync_options = {
            "project_name": project_name,
            "deployment_id": deployment_id,
            "environment": project_env,
        }

        existing_syncs = EnvironmentSync.objects.filter(
            environment__app_id=env.app.id, service=service_id, deleted_at=None
        )

        for es in existing_syncs:
            if es.options == sync_options:
                raise GraphQLError(
                    "A sync already exists for this Cloudflare Pages deployment!"
                )

        sync = EnvironmentSync.objects.create(
            environment=env,
            path=normalize_path_string(path),
            service=service_id,
            options=sync_options,
            authentication_id=credential_id,
        )

        trigger_sync_tasks(sync)

        return CreateCloudflarePagesSync(sync=sync)


class CreateAWSSecretsManagerSync(graphene.Mutation):
    class Arguments:
        env_id = graphene.ID()
        path = graphene.String()
        credential_id = graphene.ID()
        secret_name = graphene.String()
        kms_id = graphene.String(required=False)

    sync = graphene.Field(EnvironmentSyncType)

    @classmethod
    def mutate(cls, root, info, env_id, path, credential_id, secret_name, kms_id=None):
        service_id = "aws_secrets_manager"

        env = Environment.objects.get(id=env_id)

        authentication = ProviderCredentials.objects.get(id=credential_id)
        if authentication.organisation != env.app.organisation:
            raise GraphQLError(
                "The credential provided does not belong to this organization."
            )

        if not env.app.sse_enabled:
            raise GraphQLError("Syncing is not enabled for this environment!")

        if not user_can_access_app(info.context.user.userId, env.app.id):
            raise GraphQLError("You don't have access to this app")

        if not user_can_access_environment(info.context.user.userId, env.id):
            raise GraphQLError("You don't have access to this environment")

        if not user_has_permission(
            info.context.user,
            "create",
            "Integrations",
            env.app.organisation,
            True,
            app=env.app,
        ):
            raise GraphQLError("You don't have permission to create Integrations")

        sync_options = {}

        sync_options["secret_name"] = secret_name

        if kms_id:
            sync_options["kms_id"] = kms_id

        existing_syncs = EnvironmentSync.objects.filter(
            environment__app_id=env.app.id,
            service=service_id,
            authentication_id=credential_id,
            deleted_at=None,
        )

        for es in existing_syncs:
            if es.options == sync_options:
                raise GraphQLError("This app is already synced with this AWS Secret!")

        sync = EnvironmentSync.objects.create(
            environment=env,
            path=normalize_path_string(path),
            service=service_id,
            options=sync_options,
            authentication_id=credential_id,
        )

        trigger_sync_tasks(sync)

        return CreateAWSSecretsManagerSync(sync=sync)


class CreateGitHubActionsSync(graphene.Mutation):
    class Arguments:
        env_id = graphene.ID()
        path = graphene.String()
        credential_id = graphene.ID()
        repo_name = graphene.String(required=False)
        owner = graphene.String()
        environment_name = graphene.String(required=False)
        org_sync = graphene.Boolean(required=False)
        repo_visibility = graphene.String(required=False)

    sync = graphene.Field(EnvironmentSyncType)

    @classmethod
    def mutate(
        cls,
        root,
        info,
        env_id,
        path,
        credential_id,
        repo_name=None,
        owner=None,
        environment_name=None,
        org_sync=False,
        repo_visibility="all",
    ):
        service_id = "github_actions"
        service_config = ServiceConfig.get_service_config(service_id)

        env = Environment.objects.get(id=env_id)

        authentication = ProviderCredentials.objects.get(id=credential_id)
        if authentication.organisation != env.app.organisation:
            raise GraphQLError(
                "The credential provided does not belong to this organization."
            )

        if not env.app.sse_enabled:
            raise GraphQLError("Syncing is not enabled for this environment!")

        if not user_can_access_app(info.context.user.userId, env.app.id):
            raise GraphQLError("You don't have access to this app")

        if not user_can_access_environment(info.context.user.userId, env.id):
            raise GraphQLError("You don't have access to this environment")

        if not user_has_permission(
            info.context.user,
            "create",
            "Integrations",
            env.app.organisation,
            True,
            app=env.app,
        ):
            raise GraphQLError("You don't have permission to create Integrations")

        if org_sync:
            sync_options = {
                "org": owner,
                "org_sync": True,
                "visibility": repo_visibility or "all",
            }
        else:
            if not repo_name:
                raise GraphQLError("Repository name is required for repository syncs")
            sync_options = {"repo_name": repo_name, "owner": owner}
            if environment_name:
                sync_options["environment_name"] = environment_name

        existing_syncs = EnvironmentSync.objects.filter(
            environment__app_id=env.app.id, service=service_id, deleted_at=None
        )

        for es in existing_syncs:
            # Block duplicate org syncs to the same org regardless of visibility
            if (
                org_sync
                and es.options.get("org") == owner
                and es.options.get("org_sync")
            ):
                raise GraphQLError(
                    "A sync already exists for this GitHub organization!"
                )
            # Repo syncs must match all options to be considered duplicate
            if not org_sync and es.options == sync_options:
                raise GraphQLError("A sync already exists for this GitHub repo!")

        sync = EnvironmentSync.objects.create(
            environment=env,
            path=normalize_path_string(path),
            service=service_id,
            options=sync_options,
            authentication_id=credential_id,
        )

        trigger_sync_tasks(sync)

        return CreateGitHubActionsSync(sync=sync)


class CreateGitHubDependabotSync(graphene.Mutation):
    class Arguments:
        env_id = graphene.ID()
        path = graphene.String()
        credential_id = graphene.ID()
        repo_name = graphene.String(required=False)
        owner = graphene.String()
        org_sync = graphene.Boolean(required=False)
        repo_visibility = graphene.String(required=False)

    sync = graphene.Field(EnvironmentSyncType)

    @classmethod
    def mutate(
        cls,
        root,
        info,
        env_id,
        path,
        credential_id,
        repo_name=None,
        owner=None,
        org_sync=False,
        repo_visibility="all",
    ):
        service_id = "github_dependabot"

        env = Environment.objects.get(id=env_id)

        if not owner:
            raise GraphQLError("Owner is required for GitHub Dependabot syncs")

        if not env.app.sse_enabled:
            raise GraphQLError("Syncing is not enabled for this environment!")

        if not user_can_access_app(info.context.user.userId, env.app.id):
            raise GraphQLError("You don't have access to this app")

        if not user_can_access_environment(info.context.user.userId, env.id):
            raise GraphQLError("You don't have access to this environment")

        if not user_has_permission(
            info.context.user,
            "create",
            "Integrations",
            env.app.organisation,
            True,
            app=env.app,
        ):
            raise GraphQLError("You don't have permission to create Integrations")

        if org_sync:
            sync_options = {
                "org": owner,
                "org_sync": True,
                "visibility": repo_visibility or "all",
            }
        else:
            if not repo_name:
                raise GraphQLError("Repository name is required for repository syncs")
            sync_options = {"repo_name": repo_name, "owner": owner}

        authentication = ProviderCredentials.objects.get(id=credential_id)
        if authentication.organisation != env.app.organisation:
            raise GraphQLError(
                "The credential provided does not belong to this organization."
            )

        existing_syncs = EnvironmentSync.objects.filter(
            environment__app_id=env.app.id, service=service_id, deleted_at=None
        )

        for es in existing_syncs:
            if (
                org_sync
                and es.options.get("org") == owner
                and es.options.get("org_sync")
                and es.options.get("visibility", "all")
                == sync_options.get("visibility", "all")
            ):
                raise GraphQLError(
                    "A sync already exists for this GitHub organization!"
                )
            if not org_sync and es.options == sync_options:
                raise GraphQLError("A sync already exists for this GitHub repo!")

        sync = EnvironmentSync.objects.create(
            environment=env,
            path=normalize_path_string(path),
            service=service_id,
            options=sync_options,
            authentication_id=credential_id,
        )

        trigger_sync_tasks(sync)

        return CreateGitHubDependabotSync(sync=sync)


class CreateVaultSync(graphene.Mutation):
    class Arguments:
        env_id = graphene.ID()
        path = graphene.String()
        credential_id = graphene.ID()
        engine = graphene.String()
        vault_path = graphene.String()

    sync = graphene.Field(EnvironmentSyncType)

    @classmethod
    def mutate(cls, root, info, env_id, path, credential_id, engine, vault_path):
        service_id = "hashicorp_vault"
        service_config = ServiceConfig.get_service_config(service_id)

        env = Environment.objects.get(id=env_id)

        authentication = ProviderCredentials.objects.get(id=credential_id)
        if authentication.organisation != env.app.organisation:
            raise GraphQLError(
                "The credential provided does not belong to this organization."
            )

        if not env.app.sse_enabled:
            raise GraphQLError("Syncing is not enabled for this environment!")

        if not user_can_access_app(info.context.user.userId, env.app.id):
            raise GraphQLError("You don't have access to this app")

        if not user_can_access_environment(info.context.user.userId, env.id):
            raise GraphQLError("You don't have access to this environment")

        if not user_has_permission(
            info.context.user,
            "create",
            "Integrations",
            env.app.organisation,
            True,
            app=env.app,
        ):
            raise GraphQLError("You don't have permission to create Integrations")

        sync_options = {"engine": engine, "path": vault_path}

        existing_syncs = EnvironmentSync.objects.filter(
            environment__app_id=env.app.id, service=service_id, deleted_at=None
        )

        for es in existing_syncs:
            if es.options == sync_options:
                raise GraphQLError("A sync already exists for this Vault path!")

        sync = EnvironmentSync.objects.create(
            environment=env,
            path=normalize_path_string(path),
            service=service_id,
            options=sync_options,
            authentication_id=credential_id,
        )

        trigger_sync_tasks(sync)

        return CreateVaultSync(sync=sync)


class CreateNomadSync(graphene.Mutation):
    class Arguments:
        env_id = graphene.ID()
        path = graphene.String()
        credential_id = graphene.ID()
        nomad_path = graphene.String()
        nomad_namespace = graphene.String()

    sync = graphene.Field(EnvironmentSyncType)

    @classmethod
    def mutate(
        cls, root, info, env_id, path, credential_id, nomad_path, nomad_namespace
    ):
        service_id = "hashicorp_nomad"
        service_config = ServiceConfig.get_service_config(service_id)

        env = Environment.objects.get(id=env_id)

        authentication = ProviderCredentials.objects.get(id=credential_id)
        if authentication.organisation != env.app.organisation:
            raise GraphQLError(
                "The credential provided does not belong to this organization."
            )

        if not env.app.sse_enabled:
            raise GraphQLError("Syncing is not enabled for this environment!")

        if not user_can_access_app(info.context.user.userId, env.app.id):
            raise GraphQLError("You don't have access to this app")

        if not user_can_access_environment(info.context.user.userId, env.id):
            raise GraphQLError("You don't have access to this environment")

        if not user_has_permission(
            info.context.user,
            "create",
            "Integrations",
            env.app.organisation,
            True,
            app=env.app,
        ):
            raise GraphQLError("You don't have permission to create Integrations")

        sync_options = {"path": nomad_path, "namespace": nomad_namespace}

        existing_syncs = EnvironmentSync.objects.filter(
            environment__app_id=env.app.id, service=service_id, deleted_at=None
        )

        for es in existing_syncs:
            if es.options == sync_options:
                raise GraphQLError("A sync already exists for this Nomad path!")

        sync = EnvironmentSync.objects.create(
            environment=env,
            path=normalize_path_string(path),
            service=service_id,
            options=sync_options,
            authentication_id=credential_id,
        )

        trigger_sync_tasks(sync)

        return CreateNomadSync(sync=sync)


class CreateGitLabCISync(graphene.Mutation):
    class Arguments:
        env_id = graphene.ID()
        path = graphene.String()
        credential_id = graphene.ID()
        resource_path = graphene.String()
        resource_id = graphene.String()
        is_group = graphene.Boolean()
        masked = graphene.Boolean()
        protected = graphene.Boolean()

    sync = graphene.Field(EnvironmentSyncType)

    @classmethod
    def mutate(
        cls,
        root,
        info,
        env_id,
        path,
        credential_id,
        resource_path,
        resource_id,
        is_group,
        masked,
        protected,
    ):
        service_id = "gitlab_ci"
        service_config = ServiceConfig.get_service_config(service_id)

        env = Environment.objects.get(id=env_id)

        authentication = ProviderCredentials.objects.get(id=credential_id)
        if authentication.organisation != env.app.organisation:
            raise GraphQLError(
                "The credential provided does not belong to this organization."
            )

        if not env.app.sse_enabled:
            raise GraphQLError("Syncing is not enabled for this environment!")

        if not user_can_access_app(info.context.user.userId, env.app.id):
            raise GraphQLError("You don't have access to this app")

        if not user_can_access_environment(info.context.user.userId, env.id):
            raise GraphQLError("You don't have access to this environment")

        if not user_has_permission(
            info.context.user,
            "create",
            "Integrations",
            env.app.organisation,
            True,
            app=env.app,
        ):
            raise GraphQLError("You don't have permission to create Integrations")

        sync_options = {
            "resource_path": resource_path,
            "resource_id": resource_id,
            "is_group": is_group,
            "masked": masked,
            "protected": protected,
        }

        existing_syncs = EnvironmentSync.objects.filter(
            environment__app_id=env.app.id, service=service_id, deleted_at=None
        )

        for es in existing_syncs:
            if es.options == sync_options:
                raise GraphQLError(
                    f"A sync already exists for this GitLab {'group' if is_group else 'project'}!"
                )

        sync = EnvironmentSync.objects.create(
            environment=env,
            path=normalize_path_string(path),
            service=service_id,
            options=sync_options,
            authentication_id=credential_id,
        )

        trigger_sync_tasks(sync)

        return CreateGitLabCISync(sync=sync)


class CreateRailwaySync(graphene.Mutation):
    class Arguments:
        env_id = graphene.ID()
        path = graphene.String()
        credential_id = graphene.ID()
        railway_project = graphene.Argument(RailwayResourceInput)
        railway_environment = graphene.Argument(RailwayResourceInput)
        railway_service = graphene.Argument(RailwayResourceInput, required=False)

    sync = graphene.Field(EnvironmentSyncType)

    @classmethod
    def mutate(
        cls,
        root,
        info,
        env_id,
        path,
        credential_id,
        railway_project,
        railway_environment,
        railway_service=None,
    ):
        service_id = "railway"
        service_config = ServiceConfig.get_service_config(service_id)

        env = Environment.objects.get(id=env_id)

        authentication = ProviderCredentials.objects.get(id=credential_id)
        if authentication.organisation != env.app.organisation:
            raise GraphQLError(
                "The credential provided does not belong to this organization."
            )

        if not env.app.sse_enabled:
            raise GraphQLError("Syncing is not enabled for this environment!")

        if not user_can_access_app(info.context.user.userId, env.app.id):
            raise GraphQLError("You don't have access to this app")

        if not user_can_access_environment(info.context.user.userId, env.id):
            raise GraphQLError("You don't have access to this environment")

        if not user_has_permission(
            info.context.user,
            "create",
            "Integrations",
            env.app.organisation,
            True,
            app=env.app,
        ):
            raise GraphQLError("You don't have permission to create Integrations")

        sync_options = {
            "project": {"id": railway_project.id, "name": railway_project.name},
            "environment": {
                "id": railway_environment.id,
                "name": railway_environment.name,
            },
        }

        if railway_service:
            sync_options["service"] = {
                "id": railway_service.id,
                "name": railway_service.name,
            }

        existing_syncs = EnvironmentSync.objects.filter(
            environment__app_id=env.app.id, service=service_id, deleted_at=None
        )

        for es in existing_syncs:
            if es.options == sync_options:
                raise GraphQLError(
                    f"A sync already exists for this Railway environment!"
                )

        sync = EnvironmentSync.objects.create(
            environment=env,
            path=normalize_path_string(path),
            service=service_id,
            options=sync_options,
            authentication_id=credential_id,
        )

        trigger_sync_tasks(sync)

        return CreateRailwaySync(sync=sync)


class CreateSupabaseSync(graphene.Mutation):
    class Arguments:
        env_id = graphene.ID()
        path = graphene.String()
        credential_id = graphene.ID()
        project_ref = graphene.String()
        project_name = graphene.String()

    sync = graphene.Field(EnvironmentSyncType)

    @classmethod
    def mutate(
        cls,
        root,
        info,
        env_id,
        path,
        credential_id,
        project_ref,
        project_name,
    ):
        service_id = "supabase_edge_functions"
        service_config = ServiceConfig.get_service_config(service_id)

        env = Environment.objects.get(id=env_id)

        authentication = ProviderCredentials.objects.get(id=credential_id)
        if authentication.organisation != env.app.organisation:
            raise GraphQLError(
                "The credential provided does not belong to this organization."
            )

        if not env.app.sse_enabled:
            raise GraphQLError("Syncing is not enabled for this environment!")

        if not user_can_access_app(info.context.user.userId, env.app.id):
            raise GraphQLError("You don't have access to this app")

        if not user_can_access_environment(info.context.user.userId, env.id):
            raise GraphQLError("You don't have access to this environment")

        if not user_has_permission(
            info.context.user,
            "create",
            "Integrations",
            env.app.organisation,
            True,
            app=env.app,
        ):
            raise GraphQLError("You don't have permission to create Integrations")

        sync_options = {
            "project_ref": project_ref,
            "project_name": project_name,
        }

        existing_syncs = EnvironmentSync.objects.filter(
            environment__app_id=env.app.id, service=service_id, deleted_at=None
        )

        # Compare by ref only — project_name is display metadata
        for es in existing_syncs:
            if es.options.get("project_ref") == project_ref:
                raise GraphQLError("A sync already exists for this Supabase project!")

        sync = EnvironmentSync.objects.create(
            environment=env,
            path=normalize_path_string(path),
            service=service_id,
            options=sync_options,
            authentication_id=credential_id,
        )

        trigger_sync_tasks(sync)

        return CreateSupabaseSync(sync=sync)


class CreateVercelSync(graphene.Mutation):
    class Arguments:
        env_id = graphene.ID()
        path = graphene.String()
        credential_id = graphene.ID()
        team_id = graphene.String()
        team_name = graphene.String()
        project_id = graphene.String()
        project_name = graphene.String()
        environment = graphene.String()
        secret_type = graphene.String()

    sync = graphene.Field(EnvironmentSyncType)

    @classmethod
    def mutate(
        cls,
        root,
        info,
        env_id,
        path,
        credential_id,
        team_id,
        team_name,
        project_id,
        project_name,
        environment="production",
        secret_type="encrypted",
    ):
        service_id = "vercel"

        env = Environment.objects.get(id=env_id)

        authentication = ProviderCredentials.objects.get(id=credential_id)
        if authentication.organisation != env.app.organisation:
            raise GraphQLError(
                "The credential provided does not belong to this organization."
            )

        if not env.app.sse_enabled:
            raise GraphQLError("Syncing is not enabled for this environment!")

        if not user_can_access_app(info.context.user.userId, env.app.id):
            raise GraphQLError("You don't have access to this app")

        if not user_can_access_environment(info.context.user.userId, env.id):
            raise GraphQLError("You don't have access to this environment")

        if not user_has_permission(
            info.context.user,
            "create",
            "Integrations",
            env.app.organisation,
            True,
            app=env.app,
        ):
            raise GraphQLError("You don't have permission to create Integrations")

        sync_options = {
            "project": {"id": project_id, "name": project_name},
            "team": {"id": team_id, "name": team_name},
            "environment": environment,
            "secret_type": secret_type,
        }

        existing_syncs = EnvironmentSync.objects.filter(
            environment__app_id=env.app.id, service=service_id, deleted_at=None
        )

        for es in existing_syncs:
            if es.options == sync_options:
                raise GraphQLError("A sync already exists for this Vercel project!")

        sync = EnvironmentSync.objects.create(
            environment=env,
            path=normalize_path_string(path),
            service=service_id,
            options=sync_options,
            authentication_id=credential_id,
        )

        trigger_sync_tasks(sync)

        return CreateVercelSync(sync=sync)


class CreateAzureKeyVaultSync(graphene.Mutation):
    class Arguments:
        env_id = graphene.ID()
        path = graphene.String()
        credential_id = graphene.ID()
        vault_uri = graphene.String()
        sync_mode = graphene.String()
        secret_name = graphene.String(required=False)

    sync = graphene.Field(EnvironmentSyncType)

    @classmethod
    def mutate(
        cls, root, info, env_id, path, credential_id, vault_uri, sync_mode, secret_name=None
    ):
        service_id = "azure_key_vault"

        # Validate sync_mode
        if sync_mode not in ("individual", "blob"):
            raise GraphQLError("Invalid sync mode. Must be 'individual' or 'blob'.")

        # Validate and normalize vault_uri
        try:
            vault_uri = validate_vault_uri(vault_uri)
        except ValueError as e:
            raise GraphQLError(str(e))

        env = Environment.objects.get(id=env_id)

        authentication = ProviderCredentials.objects.get(id=credential_id)
        if authentication.organisation != env.app.organisation:
            raise GraphQLError(
                "The credential provided does not belong to this organization."
            )

        if not env.app.sse_enabled:
            raise GraphQLError("Syncing is not enabled for this environment!")

        if not user_can_access_app(info.context.user.userId, env.app.id):
            raise GraphQLError("You don't have access to this app")

        if not user_can_access_environment(info.context.user.userId, env.id):
            raise GraphQLError("You don't have access to this environment")

        if not user_has_permission(
            info.context.user,
            "create",
            "Integrations",
            env.app.organisation,
            True,
            app=env.app,
        ):
            raise GraphQLError("You don't have permission to create Integrations")

        if sync_mode == "blob" and not secret_name:
            raise GraphQLError("Secret name is required for blob sync mode")

        if secret_name and not re.match(r'^[a-zA-Z0-9-]+$', secret_name):
            raise GraphQLError("Secret name can only contain alphanumeric characters and hyphens")

        sync_options = {
            "vault_uri": vault_uri,
            "sync_mode": sync_mode,
        }

        if sync_mode == "blob":
            sync_options["secret_name"] = secret_name

        existing_syncs = EnvironmentSync.objects.filter(
            environment__app_id=env.app.id,
            service=service_id,
            deleted_at=None,
        )

        for es in existing_syncs:
            if es.options == sync_options:
                raise GraphQLError(
                    "A sync already exists for this Azure Key Vault configuration!"
                )

        sync = EnvironmentSync.objects.create(
            environment=env,
            path=normalize_path_string(path),
            service=service_id,
            options=sync_options,
            authentication_id=credential_id,
        )

        trigger_sync_tasks(sync)

        return CreateAzureKeyVaultSync(sync=sync)


class CreateGCPSecretManagerSync(graphene.Mutation):
    class Arguments:
        env_id = graphene.ID()
        path = graphene.String()
        credential_id = graphene.ID()
        project_id = graphene.String()
        location = graphene.String()
        sync_mode = graphene.String()
        secret_name = graphene.String(required=False)
        prefix = graphene.String(required=False)
        kms_key_name = graphene.String(required=False)

    sync = graphene.Field(EnvironmentSyncType)

    @classmethod
    def mutate(
        cls,
        root,
        info,
        env_id,
        path,
        credential_id,
        project_id,
        location,
        sync_mode,
        secret_name=None,
        prefix=None,
        kms_key_name=None,
    ):
        service_id = ServiceConfig.GCP_SECRET_MANAGER["id"]

        if sync_mode not in ("individual", "blob"):
            raise GraphQLError("Invalid sync mode. Must be 'individual' or 'blob'.")

        try:
            project_id = validate_project_id(project_id)
            location = validate_location(location)
            kms_key_name = validate_kms_key_name(kms_key_name, location)
            if sync_mode == "blob":
                secret_name = validate_secret_id(secret_name)
            else:
                prefix = validate_prefix(prefix)
        except ValueError as e:
            raise GraphQLError(str(e))

        env = Environment.objects.get(id=env_id)

        authentication = ProviderCredentials.objects.get(id=credential_id)
        if authentication.organisation != env.app.organisation:
            raise GraphQLError(
                "The credential provided does not belong to this organization."
            )
        if authentication.provider != Providers.GCP["id"]:
            raise GraphQLError(
                "These credentials can't be used with GCP Secret Manager."
            )

        if not env.app.sse_enabled:
            raise GraphQLError("Syncing is not enabled for this environment!")

        if not user_can_access_app(info.context.user.userId, env.app.id):
            raise GraphQLError("You don't have access to this app")

        if not user_can_access_environment(info.context.user.userId, env.id):
            raise GraphQLError("You don't have access to this environment")

        if not user_has_permission(
            info.context.user,
            "create",
            "Integrations",
            env.app.organisation,
            True,
            app=env.app,
        ):
            raise GraphQLError("You don't have permission to create Integrations")

        sync_options = {
            "project_id": project_id,
            "location": location,
            "sync_mode": sync_mode,
        }
        if sync_mode == "blob":
            sync_options["secret_name"] = secret_name
        else:
            sync_options["prefix"] = prefix
        if kms_key_name:
            sync_options["kms_key_name"] = kms_key_name

        # Checked org-wide, not per app: two syncs writing the same secret
        # names would fail against each other's ownership labels.
        target_key = "secret_name" if sync_mode == "blob" else "prefix"
        existing_syncs = EnvironmentSync.objects.filter(
            environment__app__organisation=env.app.organisation,
            service=service_id,
            deleted_at=None,
        )
        for es in existing_syncs:
            if (
                es.options.get("project_id") == project_id
                and es.options.get("location") == location
                and es.options.get("sync_mode", "individual") == sync_mode
                and es.options.get(target_key, "") == sync_options[target_key]
            ):
                raise GraphQLError(
                    "Another sync already writes to these secrets in this project "
                    "and location."
                )

        sync = EnvironmentSync.objects.create(
            environment=env,
            path=normalize_path_string(path),
            service=service_id,
            options=sync_options,
            authentication_id=credential_id,
        )

        trigger_sync_tasks(sync)

        return CreateGCPSecretManagerSync(sync=sync)


class DeleteSync(graphene.Mutation):
    class Arguments:
        sync_id = graphene.ID()

    ok = graphene.Boolean()

    @classmethod
    def mutate(cls, root, info, sync_id):
        env_sync = EnvironmentSync.objects.get(id=sync_id)

        if not user_can_access_environment(
            info.context.user.userId, env_sync.environment.id
        ):
            raise GraphQLError("You don't have access to this environment")

        if not user_has_permission(
            info.context.user,
            "delete",
            "Integrations",
            env_sync.environment.app.organisation,
            True,
            app=env_sync.environment.app,
        ):
            raise GraphQLError("You don't have permission to delete Integrations")

        env_sync.delete()

        return DeleteSync(ok=True)


class ToggleSyncActive(graphene.Mutation):
    class Arguments:
        sync_id = graphene.ID()

    ok = graphene.Boolean()

    @classmethod
    def mutate(cls, root, info, sync_id):
        env_sync = EnvironmentSync.objects.get(id=sync_id)

        if not user_can_access_environment(
            info.context.user.userId, env_sync.environment.id
        ):
            raise GraphQLError("You don't have access to this environment")

        if not user_has_permission(
            info.context.user,
            "update",
            "Integrations",
            env_sync.environment.app.organisation,
            True,
            app=env_sync.environment.app,
        ):
            raise GraphQLError("You don't have permission to update Integrations")

        env_sync.is_active = not env_sync.is_active
        env_sync.save()

        if env_sync.is_active:
            trigger_sync_tasks(env_sync)

        return ToggleSyncActive(ok=True)


class TriggerSync(graphene.Mutation):
    class Arguments:
        sync_id = graphene.ID()

    sync = graphene.Field(EnvironmentSyncType)

    @classmethod
    def mutate(cls, root, info, sync_id):
        env_sync = EnvironmentSync.objects.get(id=sync_id)

        if not user_can_access_environment(
            info.context.user.userId, env_sync.environment.id
        ):
            raise GraphQLError("You don't have access to this environment")

        # Match the console gate: creating a sync also triggers it, so either
        # permission may run one
        can_trigger = any(
            user_has_permission(
                info.context.user,
                action,
                "Integrations",
                env_sync.environment.app.organisation,
                True,
                app=env_sync.environment.app,
            )
            for action in ("update", "create")
        )
        if not can_trigger:
            raise GraphQLError("You don't have permission to trigger syncs")

        trigger_sync_tasks(env_sync)

        return TriggerSync(sync=env_sync)


class UpdateSyncAuthentication(graphene.Mutation):
    class Arguments:
        sync_id = graphene.ID()
        credential_id = graphene.ID()

    sync = graphene.Field(EnvironmentSyncType)

    @classmethod
    def mutate(cls, root, info, sync_id, credential_id):
        env_sync = EnvironmentSync.objects.get(id=sync_id)

        if not user_can_access_environment(
            info.context.user.userId, env_sync.environment.id
        ):
            raise GraphQLError("You don't have access to this environment")

        if not user_has_permission(
            info.context.user,
            "update",
            "Integrations",
            env_sync.environment.app.organisation,
            True,
            app=env_sync.environment.app,
        ):
            raise GraphQLError("You don't have permission to update Integrations")

        authentication = ProviderCredentials.objects.get(id=credential_id)
        if authentication.organisation != env_sync.environment.app.organisation:
            raise GraphQLError(
                "The credential provided does not belong to this organization."
            )

        env_sync.authentication_id = credential_id
        env_sync.save()

        return UpdateSyncAuthentication(sync=env_sync)


class CreateCloudflareWorkersSync(graphene.Mutation):
    class Arguments:
        env_id = graphene.ID()
        path = graphene.String()
        credential_id = graphene.ID()
        worker_name = graphene.String()

    sync = graphene.Field(EnvironmentSyncType)

    @classmethod
    def mutate(
        cls,
        root,
        info,
        env_id,
        path,
        credential_id,
        worker_name,
    ):
        service_id = "cloudflare_workers"
        service_config = ServiceConfig.get_service_config(service_id)

        env = Environment.objects.get(id=env_id)

        authentication = ProviderCredentials.objects.get(id=credential_id)
        if authentication.organisation != env.app.organisation:
            raise GraphQLError(
                "The credential provided does not belong to this organization."
            )

        if not env.app.sse_enabled:
            raise GraphQLError("Syncing is not enabled for this environment!")

        if not user_can_access_app(info.context.user.userId, env.app.id):
            raise GraphQLError("You don't have access to this app")

        if not user_can_access_environment(info.context.user.userId, env.id):
            raise GraphQLError("You don't have access to this environment")

        if not user_has_permission(
            info.context.user,
            "create",
            "Integrations",
            env.app.organisation,
            True,
            app=env.app,
        ):
            raise GraphQLError("You don't have permission to create Integrations")

        sync_options = {
            "worker_name": worker_name,
        }

        existing_syncs = EnvironmentSync.objects.filter(
            environment__app_id=env.app.id, service=service_id, deleted_at=None
        )

        for es in existing_syncs:
            if es.options == sync_options:
                raise GraphQLError("A sync already exists for this Cloudflare Worker!")

        sync = EnvironmentSync.objects.create(
            environment=env,
            path=normalize_path_string(path),
            service=service_id,
            options=sync_options,
            authentication_id=credential_id,
        )

        trigger_sync_tasks(sync)

        return CreateCloudflareWorkersSync(sync=sync)


class CreateRenderSync(graphene.Mutation):
    class Arguments:
        env_id = graphene.ID()
        path = graphene.String()
        credential_id = graphene.ID()
        resource_id = graphene.String()
        resource_name = graphene.String()
        resource_type = graphene.Argument(RenderResourceType)
        secret_file_name = graphene.String(required=False)

    sync = graphene.Field(EnvironmentSyncType)

    @classmethod
    def mutate(
        cls,
        root,
        info,
        env_id,
        path,
        credential_id,
        resource_id,
        resource_name,
        resource_type,
        secret_file_name,
    ):
        service_type = "render"
        service_config = ServiceConfig.get_service_config(service_type)

        env = Environment.objects.get(id=env_id)

        authentication = ProviderCredentials.objects.get(id=credential_id)
        if authentication.organisation != env.app.organisation:
            raise GraphQLError(
                "The credential provided does not belong to this organization."
            )

        if not env.app.sse_enabled:
            raise GraphQLError("Syncing is not enabled for this environment!")

        if not user_can_access_app(info.context.user.userId, env.app.id):
            raise GraphQLError("You don't have access to this app")

        if not user_can_access_environment(info.context.user.userId, env.id):
            raise GraphQLError("You don't have access to this environment")

        if not user_has_permission(
            info.context.user,
            "create",
            "Integrations",
            env.app.organisation,
            True,
            app=env.app,
        ):
            raise GraphQLError("You don't have permission to create Integrations")

        sync_options = {
            "resource_id": resource_id,
            "resource_name": resource_name,
            "resource_type": resource_type.value,
            "secret_file_name": secret_file_name,
        }

        existing_syncs = EnvironmentSync.objects.filter(
            environment__app_id=env.app.id, service=service_type, deleted_at=None
        )

        for es in existing_syncs:
            if es.options == sync_options:
                raise GraphQLError("A sync already exists for this Render service!")

        sync = EnvironmentSync.objects.create(
            environment=env,
            path=normalize_path_string(path),
            service=service_type,
            options=sync_options,
            authentication_id=credential_id,
        )

        trigger_sync_tasks(sync)

        return CreateRenderSync(sync=sync)
