from django.utils import timezone
from backend.graphene.utils.permissions import member_can_access_org, user_can_access_app, user_can_access_environment, user_is_org_member
import graphene
from graphql import GraphQLError
from api.models import App, Environment, EnvironmentKey, EnvironmentToken, Organisation, OrganisationMember, Secret, SecretEvent, SecretFolder, SecretTag, UserToken
from backend.graphene.types import EnvironmentKeyType, EnvironmentTokenType, EnvironmentType, SecretFolderType, SecretTagType, SecretType, UserTokenType


class EnvironmentInput(graphene.InputObjectType):
    id = graphene.ID(required=True)
    app_id = graphene.ID(required=True)
    name = graphene.String(required=True)
    env_type = graphene.String(required=True)
    wrapped_seed = graphene.String(required=True)
    wrapped_salt = graphene.String(required=True)
    identity_key = graphene.String(required=True)


class CreateEnvironmentMutation(graphene.Mutation):
    class Arguments:
        environment_data = EnvironmentInput(required=True)

    environment = graphene.Field(EnvironmentType)

    @classmethod
    def mutate(cls, root, info, environment_data):
        user_id = info.context.user.userId

        if not user_can_access_app(user_id, environment_data.app_id):
            raise GraphQLError("You don't have access to this app")

        app = App.objects.get(id=environment_data.app_id)

        environment = Environment.objects.create(
            id=environment_data.id, app=app, name=environment_data.name, env_type=environment_data.env_type, identity_key=environment_data.identity_key, wrapped_seed=environment_data.wrapped_seed, wrapped_salt=environment_data.wrapped_salt)

        org_owner = OrganisationMember.objects.get(
            organisation=environment.app.organisation, role=OrganisationMember.OWNER)

        EnvironmentKey.objects.create(id=id, environment=environment, user=org_owner,
                                      identity_key=environment_data.identity_key, wrapped_seed=environment_data.wrapped_seed, wrapped_salt=environment_data.wrapped_salt)

        return CreateEnvironmentMutation(environment=environment)


class CreateEnvironmentKeyMutation(graphene.Mutation):
    class Arguments:
        # id = graphene.ID(required=True)
        env_id = graphene.ID(required=True)
        user_id = graphene.ID(required=True)
        identity_key = graphene.String(required=True)
        wrapped_seed = graphene.String(required=True)
        wrapped_salt = graphene.String(required=True)

    environment_key = graphene.Field(EnvironmentKeyType)

    @classmethod
    def mutate(cls, root, info, env_id, user_id, identity_key, wrapped_seed, wrapped_salt):

        env = Environment.objects.get(id=env_id)

        # check that the user attempting the mutation has access
        if not user_can_access_app(info.context.user.userId, env.app.id):
            raise GraphQLError("You don't have access to this app")

        # check that the user for whom we are add a key has access
        if not member_can_access_org(user_id, env.app.organisation.id):
            raise GraphQLError("This user doesn't have access to this app")

        org_member = OrganisationMember.objects.get(id=user_id)

        if EnvironmentKey.objects.filter(environment=env, user_id=org_member).exists():
            raise GraphQLError(
                "This user already has access to this environment")

        environment_key = EnvironmentKey.objects.create(
            environment=env, user_id=user_id, identity_key=identity_key, wrapped_seed=wrapped_seed, wrapped_salt=wrapped_salt)

        return CreateEnvironmentKeyMutation(environment_key=environment_key)


class CreateEnvironmentTokenMutation(graphene.Mutation):
    class Arguments:
        env_id = graphene.ID(required=True)
        name = graphene.String(required=True)
        identity_key = graphene.String(required=True)
        token = graphene.String(required=True)
        wrapped_key_share = graphene.String(required=True)

    environment_token = graphene.Field(EnvironmentTokenType)

    @classmethod
    def mutate(cls, root, info, env_id, name, identity_key, token, wrapped_key_share):
        user = info.context.user
        if user_can_access_environment(user.userId, env_id):

            env = Environment.objects.get(id=env_id)
            org_member = OrganisationMember.objects.get(
                organisation=env.app.organisation, user_id=user.userId)

            environment_token = EnvironmentToken.objects.create(
                environment_id=env_id, user=org_member, name=name, identity_key=identity_key, token=token, wrapped_key_share=wrapped_key_share)

            return CreateEnvironmentTokenMutation(environment_token=environment_token)


class CreateUserTokenMutation(graphene.Mutation):
    class Arguments:
        org_id = graphene.ID(required=True)
        name = graphene.String(required=True)
        identity_key = graphene.String(required=True)
        token = graphene.String(required=True)
        wrapped_key_share = graphene.String(required=True)

    user_token = graphene.Field(UserTokenType)

    @classmethod
    def mutate(cls, root, info, org_id, name, identity_key, token, wrapped_key_share):
        user = info.context.user
        if user_is_org_member(user.userId, org_id):

            org_member = OrganisationMember.objects.get(
                organisation_id=org_id, user_id=user.userId)

            user_token = UserToken.objects.create(
                user=org_member, name=name, identity_key=identity_key, token=token, wrapped_key_share=wrapped_key_share)

            return CreateUserTokenMutation(user_token=user_token)


class CreateSecretFolderMutation(graphene.Mutation):
    class Arguments:
        id = graphene.ID(required=True)
        env_id = graphene.ID(required=True)
        parent_folder_id = graphene.ID(required=False)
        name = graphene.String(required=True)

    folder = graphene.Field(SecretFolderType)

    @classmethod
    def mutate(cls, root, info, id, env_id, name, parent_folder_id=None):
        user = info.context.user
        if user_can_access_environment(user.id, env_id):
            folder = SecretFolder.objects.create(
                id=id, environment_id=env_id, parent_id=parent_folder_id, name=name)

            return CreateSecretFolderMutation(folder=folder)


class CreateSecretTagMutation(graphene.Mutation):
    class Arguments:
        id = graphene.ID(required=True)
        org_id = graphene.ID(required=True)
        name = graphene.String(required=True)

    tag = graphene.Field(SecretTagType)

    @classmethod
    def mutate(cls, root, info, id, org_id, name):

        if not user_is_org_member(info.context.user.userId, org_id):
            raise GraphQLError(
                "You don't have permission to perform this action")

        org = Organisation.objects.get(id=org_id)

        if SecretTag.objects.filter(organisation=org, name=name).exists():
            raise GraphQLError('This tag already exists!')

        tag = SecretTag.objects.create(id=id, organisation=org, name=name)

        return CreateSecretTagMutation(tag=tag)


class CreateSecretMutation(graphene.Mutation):
    class Arguments:
        env_id = graphene.ID(required=True)
        folder_id = graphene.ID(required=False)
        key = graphene.String(required=True)
        key_digest = graphene.String(required=True)
        value = graphene.String(required=True)
        tags = graphene.List(graphene.String)
        comment = graphene.String()

    secret = graphene.Field(SecretType)

    @classmethod
    def mutate(cls, root, info, env_id, key, key_digest, value, folder_id=None, tags=[], comment=''):
        env = Environment.objects.get(id=env_id)
        org = env.app.organisation
        if not user_is_org_member(info.context.user.userId, org.id):
            raise GraphQLError(
                "You don't have permission to perform this action")

        tag_names = SecretTag.objects.filter(
            id__in=tags).values_list('name', flat=True)

        secret_data = {
            'environment_id': env.id,
            'folder_id': folder_id,
            'key': key,
            'key_digest': key_digest,
            'value': value,
            'version': 1,
            'tags': [],
            'comment': comment
        }

        secret = Secret.objects.create(**secret_data)

        org_member = OrganisationMember.objects.get(
            user=info.context.user, organisation=org)

        SecretEvent.objects.create(
            **{**secret_data, **{'user': org_member, 'secret': secret, 'event_type': SecretEvent.CREATE}})

        return CreateSecretMutation(secret=secret)


class EditSecretMutation(graphene.Mutation):
    class Arguments:
        id = graphene.ID(required=True)
        folder_id = graphene.ID(required=False)
        key = graphene.String(required=True)
        key_digest = graphene.String(required=True)
        value = graphene.String(required=True)
        tags = graphene.List(graphene.String)
        comment = graphene.String()

    secret = graphene.Field(SecretType)

    @classmethod
    def mutate(cls, root, info, id, folder_id, key, key_digest, value, tags, comment):
        secret = Secret.objects.get(id=id)
        env = secret.environment
        org = env.app.organisation
        if not user_is_org_member(info.context.user.userId, org.id):
            raise GraphQLError(
                "You don't have permission to perform this action")

        tag_names = SecretTag.objects.filter(
            id__in=tags).values_list('name', flat=True)

        secret_data = {
            'environment_id': env.id,
            'folder_id': folder_id,
            'key': key,
            'key_digest': key_digest,
            'value': value,
            'version': secret.version + 1,
            'tags': [],
            'comment': comment
        }

        for key, value in secret_data.items():
            setattr(secret, key, value)

        secret.updated_at = timezone.now()
        secret.save()

        org_member = OrganisationMember.objects.get(
            user=info.context.user, organisation=org)

        SecretEvent.objects.create(
            **{**secret_data, **{'user': org_member, 'secret': secret, 'event_type': SecretEvent.UPDATE}})

        return EditSecretMutation(secret=secret)


class DeleteSecretMutation(graphene.Mutation):
    class Arguments:
        id = graphene.ID(required=True)

    secret = graphene.Field(SecretType)

    @classmethod
    def mutate(cls, root, info, id):
        secret = Secret.objects.get(id=id)
        env = secret.environment
        org = env.app.organisation
        if not user_is_org_member(info.context.user.userId, org.id):
            raise GraphQLError(
                "You don't have permission to perform this action")

        secret.updated_at = timezone.now()
        secret.deleted_at = timezone.now()
        secret.save()

        most_recent_event = SecretEvent.objects.filter(
            secret=secret).order_by('version').last()

        # setting the pk to None and then saving it creates a copy of the instance with updated fields
        most_recent_event.id = None
        most_recent_event.event_type = SecretEvent.DELETE
        most_recent_event.save()

        return DeleteSecretMutation(secret=secret)
