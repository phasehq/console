from backend.api.kv import delete, purge
from backend.graphene.mutations.environment import EnvironmentKeyInput
from backend.graphene.utils.permissions import user_can_access_app, user_is_org_member
from ee.feature_flags import allow_new_app
import graphene
from django.utils import timezone
from graphql import GraphQLError
from api.models import App, EnvironmentKey, Organisation, OrganisationMember
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
                raise GraphQLError(
                    "Failed to delete app keys. Please try again.")

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
                raise GraphQLError(
                    "Failed to delete app keys. Please try again.")

        app.wrapped_key_share = ""
        app.is_deleted = True
        app.deleted_at = timezone.now()
        app.save()

        return DeleteAppMutation(app=app)


class AddAppMemberMutation(graphene.Mutation):
    class Arguments:
        member_id = graphene.ID()
        app_id = graphene.ID()
        env_keys = graphene.List(EnvironmentKeyInput)

    app = graphene.Field(AppType)

    @classmethod
    def mutate(cls, root, info, member_id, app_id, env_keys):
        user = info.context.user
        app = App.objects.get(id=app_id)

        if not user_can_access_app(user.userId, app.id):
            raise GraphQLError("You don't have access to this app")

        org_member = OrganisationMember.objects.get(
            id=member_id, deleted_at=None)
        if org_member in app.members.all():
            raise GraphQLError("This user already has access to this app")
        else:
            app.members.add(org_member)
            for key in env_keys:
                EnvironmentKey.objects.create(
                    environment_id=key.env_id, user_id=key.user_id, wrapped_seed=key.wrapped_seed, wrapped_salt=key.wrapped_salt)

        return AddAppMemberMutation(app=app)


class RemoveAppMemberMutation(graphene.Mutation):
    class Arguments:
        member_id = graphene.ID()
        app_id = graphene.ID()

    app = graphene.Field(AppType)

    @classmethod
    def mutate(cls, root, info, member_id, app_id):
        user = info.context.user
        app = App.objects.get(id=app_id)

        if not user_can_access_app(user.userId, app.id):
            raise GraphQLError("You don't have access to this app")

        org_member = OrganisationMember.objects.get(
            id=member_id, deleted_at=None)
        if org_member not in app.members.all():
            raise GraphQLError("This user is not a member of this app")
        else:
            app.members.remove(org_member)
            EnvironmentKey.objects.filter(
                environment__app=app, user_id=member_id).delete()

        return RemoveAppMemberMutation(app=app)
