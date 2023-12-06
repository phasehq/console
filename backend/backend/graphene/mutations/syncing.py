from api.utils.crypto import get_server_keypair
from api.tasks import sync_cloudflare_pages, trigger_sync_tasks
from api.utils.syncing.cloudflare.pages import (
    CloudFlarePagesType,
    get_authentication_credentials,
)
import graphene
from graphql import GraphQLError
from api.utils.permissions import user_can_access_app, user_can_access_environment
from backend.graphene.types import AppType, EnvironmentSyncType
from .environment import EnvironmentKeyInput
from api.models import App, Environment, EnvironmentSync, ServerEnvironmentKey
from api.services import ServiceConfig
from django.utils import timezone


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

        else:
            # set new server env keys
            for key in env_keys:
                ServerEnvironmentKey.objects.create(
                    environment_id=key.env_id,
                    wrapped_seed=key.wrapped_seed,
                    wrapped_salt=key.wrapped_salt,
                    identity_key=key.identity_key,
                )

        return InitEnvSync(app=app)


class CreateCloudflarePagesSync(graphene.Mutation):
    class Arguments:
        env_id = graphene.ID()
        project_name = graphene.String()
        deployment_id = graphene.ID()
        project_env = graphene.String()
        access_token = graphene.String()
        account_id = graphene.String()

    sync = graphene.Field(EnvironmentSyncType)

    @classmethod
    def mutate(
        cls,
        root,
        info,
        env_id,
        project_name,
        deployment_id,
        project_env,
        access_token,
        account_id,
    ):
        service_id = "cloudflare_pages"
        service_config = ServiceConfig.get_service_config(service_id)

        env = Environment.objects.get(id=env_id)

        if not ServerEnvironmentKey.objects.filter(environment=env).exists():
            raise GraphQLError("Syncing is not enabled for this environment!")

        if not user_can_access_app(info.context.user.userId, env.app.id):
            raise GraphQLError("You don't have access to this app")

        sync_options = {
            "project_name": project_name,
            "deployment_id": deployment_id,
            "environment": project_env,
        }

        existing_syncs = EnvironmentSync.objects.filter(
            environment=env, service=service_id, deleted_at=None
        )

        for es in existing_syncs:
            if es.options == sync_options:
                raise GraphQLError(
                    "This environment is already synced with this Cloudflare Pages deployment!"
                )

        authentication_credentials = {
            "access_token": access_token,
            "account_id": account_id,
        }

        sync = EnvironmentSync.objects.create(
            environment=env,
            service=service_id,
            options=sync_options,
            authentication=authentication_credentials,
        )

        trigger_sync_tasks(sync)

        return CreateCloudflarePagesSync(sync=sync)


class UpdateCloudflarePagesSyncCredentials(graphene.Mutation):
    class Arguments:
        sync_id = graphene.ID()
        access_token = graphene.String()
        account_id = graphene.String()

    sync = graphene.Field(EnvironmentSyncType)

    @classmethod
    def mutate(cls, root, info, sync_id, access_token, account_id):
        sync = EnvironmentSync.objects.get(id=sync_id)

        if not user_can_access_environment(
            info.context.user.userId, sync.environment.id
        ):
            raise GraphQLError("You don't have access to this environment")

        authentication_credentials = {
            "access_token": access_token,
            "account_id": account_id,
        }

        sync.authentication = authentication_credentials
        sync.updated_at = timezone.now()
        sync.save()

        return UpdateCloudflarePagesSyncCredentials(sync=sync)


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

        env_sync.delete()

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
