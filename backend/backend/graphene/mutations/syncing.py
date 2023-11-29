from api.crypto import get_server_keypair
from backend.graphene.utils.syncing.cloudflare.pages import CloudFlarePagesType
import graphene
from graphql import GraphQLError
from backend.graphene.utils.permissions import user_can_access_app
from backend.graphene.types import AppType, EnvironmentSyncType
from .environment import EnvironmentKeyInput
from api.models import App, Environment, EnvironmentSync, ServerEnvironmentKey
from api.services import ServiceConfig


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
            environment=env, service=service_id
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

        return CreateCloudflarePagesSync(sync=sync)
