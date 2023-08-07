from backend.api.kv import delete, purge
from backend.graphene.utils.permissions import user_can_access_app, user_is_org_member
from ee.feature_flags import allow_new_app
import graphene
from django.utils import timezone
from graphql import GraphQLError
from api.models import App, Organisation, OrganisationMember
from backend.graphene.types import AppType
from django.conf import settings

CLOUD_HOSTED = settings.APP_HOST == 'cloud'

class CreateAppMutation(graphene.Mutation):
    class Arguments:
        id = graphene.ID(required=True)
        organisation_id = graphene.ID(required=True)
        name = graphene.String(required=True)
        identity_key = graphene.String(required=True)
        app_token = graphene.String(required=True)
        app_seed = graphene.String(required=True)
        wrapped_key_share = graphene.String(required=True)
        app_version = graphene.Int(required=True)

    app = graphene.Field(AppType)

    @classmethod
    def mutate(cls, root, info, id, organisation_id, name, identity_key, app_token, app_seed, wrapped_key_share, app_version):
        user = info.context.user
        org = Organisation.objects.get(id=organisation_id)
        if not user_is_org_member(user.userId, organisation_id):
            raise GraphQLError("You don't have access to this organisation")

        if allow_new_app(org) == False:
            raise GraphQLError(
                'You have reached the App limit for your current plan. Please upgrade your account to add more.')

        if App.objects.filter(identity_key=identity_key).exists():
            raise GraphQLError("This app already exists")

        app = App.objects.create(id=id, organisation=org, name=name, identity_key=identity_key,
                                 app_token=app_token, app_seed=app_seed, wrapped_key_share=wrapped_key_share, app_version=app_version)

        return CreateAppMutation(app=app)


class RotateAppKeysMutation(graphene.Mutation):
    class Arguments:
        id = graphene.ID(required=True)
        app_token = graphene.String(required=True)
        wrapped_key_share = graphene.String(required=True)

    app = graphene.Field(AppType)

    @classmethod
    def mutate(cls, root, info, id, app_token, wrapped_key_share):
        user = info.context.user
        app = App.objects.get(id=id)

        if not user_can_access_app(user.userId, app.id):
            raise GraphQLError("You don't have access to this app")

        if CLOUD_HOSTED:
            # delete current keys from cloudflare KV
            deleted = delete(app.app_token)

            # purge keys from cloudflare cache
            purged = purge(
                f"phApp:v{app.app_version}:{app.identity_key}/{app.app_token}")

            if not deleted or not purged:
                raise GraphQLError("Failed to delete app keys. Please try again.")

        app.app_token = app_token
        app.wrapped_key_share = wrapped_key_share
        app.save()

        return RotateAppKeysMutation(app=app)


class DeleteAppMutation(graphene.Mutation):
    class Arguments:
        id = graphene.ID(required=True)

    app = graphene.Field(AppType)

    @classmethod
    def mutate(cls, root, info, id):
        user = info.context.user
        app = App.objects.get(id=id)

        if not user_can_access_app(user.userId, app.id):
            raise GraphQLError("You don't have access to this app")

        if CLOUD_HOSTED:
            # delete current keys from cloudflare KV
            deleted = delete(app.app_token)

            # purge keys from cloudflare cache
            purged = purge(
                f"phApp:v{app.app_version}:{app.identity_key}/{app.app_token}")

            if not deleted or not purged:
                raise GraphQLError("Failed to delete app keys. Please try again.")

        app.wrapped_key_share = ""
        app.is_deleted = True
        app.deleted_at = timezone.now()
        app.save()

        return DeleteAppMutation(app=app)
