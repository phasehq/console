from api.tasks import trigger_sync_tasks
from api.utils.secrets import normalize_path_string

import graphene
from graphql import GraphQLError
from api.utils.access.permissions import (
    user_can_access_app,
    user_can_access_environment,
    user_has_permission,
    user_is_org_member,
)
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
from api.services import ServiceConfig


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

        for env in Environment.objects.filter(app=app):
            if not user_can_access_environment(info.context.user.userId, env.id):
                raise GraphQLError(
                    "You cannot enable SSE as you don't have access to all environments in this App"
                )

        else:
            app.sse_enabled = True
            app.save()
            # set new server env keys
            for key in env_keys:
                ServerEnvironmentKey.objects.create(
                    environment_id=key.env_id,
                    wrapped_seed=key.wrapped_seed,
                    wrapped_salt=key.wrapped_salt,
                    identity_key=key.identity_key,
                )

        return InitEnvSync(app=app)


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
                "You dont have permission to create Integration Credentials"
            )

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
                "You dont have permission to update Integration Credentials"
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
                "You dont have permission to delete Integration Credentials"
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

        if not env.app.sse_enabled:
            raise GraphQLError("Syncing is not enabled for this environment!")

        if not user_can_access_app(info.context.user.userId, env.app.id):
            raise GraphQLError("You don't have access to this app")

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

        if not env.app.sse_enabled:
            raise GraphQLError("Syncing is not enabled for this environment!")

        if not user_can_access_app(info.context.user.userId, env.app.id):
            raise GraphQLError("You don't have access to this app")

        sync_options = {}

        sync_options["secret_name"] = secret_name

        if kms_id:
            sync_options["kms_id"] = kms_id

        existing_syncs = EnvironmentSync.objects.filter(
            environment__app_id=env.app.id, service=service_id, deleted_at=None
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
        repo_name = graphene.String()
        owner = graphene.String()

    sync = graphene.Field(EnvironmentSyncType)

    @classmethod
    def mutate(cls, root, info, env_id, path, credential_id, repo_name, owner):
        service_id = "github_actions"
        service_config = ServiceConfig.get_service_config(service_id)

        env = Environment.objects.get(id=env_id)

        if not env.app.sse_enabled:
            raise GraphQLError("Syncing is not enabled for this environment!")

        if not user_can_access_app(info.context.user.userId, env.app.id):
            raise GraphQLError("You don't have access to this app")

        sync_options = {"repo_name": repo_name, "owner": owner}

        existing_syncs = EnvironmentSync.objects.filter(
            environment__app_id=env.app.id, service=service_id, deleted_at=None
        )

        for es in existing_syncs:
            if es.options == sync_options:
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

        if not env.app.sse_enabled:
            raise GraphQLError("Syncing is not enabled for this environment!")

        if not user_can_access_app(info.context.user.userId, env.app.id):
            raise GraphQLError("You don't have access to this app")

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

        if not env.app.sse_enabled:
            raise GraphQLError("Syncing is not enabled for this environment!")

        if not user_can_access_app(info.context.user.userId, env.app.id):
            raise GraphQLError("You don't have access to this app")

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

        if not env.app.sse_enabled:
            raise GraphQLError("Syncing is not enabled for this environment!")

        if not user_can_access_app(info.context.user.userId, env.app.id):
            raise GraphQLError("You don't have access to this app")

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

        if not env.app.sse_enabled:
            raise GraphQLError("Syncing is not enabled for this environment!")

        if not user_can_access_app(info.context.user.userId, env.app.id):
            raise GraphQLError("You don't have access to this app")

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

        env_sync.authentication_id = credential_id
        env_sync.save()

        return UpdateSyncAuthentication(sync=env_sync)
