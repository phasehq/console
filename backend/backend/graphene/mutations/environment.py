from django.utils import timezone
from api.utils.rest import get_resolver_request_meta
from api.utils.permissions import (
    member_can_access_org,
    user_can_access_app,
    user_can_access_environment,
    user_is_org_member,
)
from api.utils.audit_logging import log_secret_event
from api.utils.secrets import normalize_path_string
import graphene
from graphql import GraphQLError
from api.models import (
    App,
    Environment,
    EnvironmentKey,
    EnvironmentSync,
    EnvironmentToken,
    Organisation,
    OrganisationMember,
    PersonalSecret,
    Secret,
    SecretEvent,
    SecretFolder,
    SecretTag,
    ServerEnvironmentKey,
    UserToken,
    ServiceToken,
)
from backend.graphene.types import (
    AppType,
    EnvironmentKeyType,
    EnvironmentTokenType,
    EnvironmentType,
    PersonalSecretType,
    SecretFolderType,
    SecretTagType,
    SecretType,
    ServiceTokenType,
    UserTokenType,
)
from datetime import datetime


class EnvironmentInput(graphene.InputObjectType):
    app_id = graphene.ID(required=True)
    name = graphene.String(required=True)
    env_type = graphene.String(required=True)
    wrapped_seed = graphene.String(required=True)
    wrapped_salt = graphene.String(required=True)
    identity_key = graphene.String(required=True)


class EnvironmentKeyInput(graphene.InputObjectType):
    env_id = graphene.ID(required=True)
    user_id = graphene.ID(required=False)
    identity_key = graphene.String(required=True)
    wrapped_seed = graphene.String(required=True)
    wrapped_salt = graphene.String(required=True)


class SecretInput(graphene.InputObjectType):
    env_id = graphene.ID(required=False)
    path = graphene.String(required=False)
    key = graphene.String(required=True)
    key_digest = graphene.String(required=True)
    value = graphene.String(required=True)
    tags = graphene.List(graphene.String)
    comment = graphene.String()


class PersonalSecretInput(graphene.InputObjectType):
    secret_id = graphene.ID()
    value = graphene.String()
    is_active = graphene.Boolean()


class CreateEnvironmentMutation(graphene.Mutation):
    class Arguments:
        environment_data = EnvironmentInput(required=True)
        admin_keys = graphene.List(EnvironmentKeyInput)

    environment = graphene.Field(EnvironmentType)

    @classmethod
    def mutate(cls, root, info, environment_data, admin_keys):
        user_id = info.context.user.userId

        if not user_can_access_app(user_id, environment_data.app_id):
            raise GraphQLError("You don't have access to this app")

        app = App.objects.get(id=environment_data.app_id)

        environment = Environment.objects.create(
            app=app,
            name=environment_data.name,
            env_type=environment_data.env_type,
            identity_key=environment_data.identity_key,
            wrapped_seed=environment_data.wrapped_seed,
            wrapped_salt=environment_data.wrapped_salt,
        )

        org_owner = OrganisationMember.objects.get(
            organisation=environment.app.organisation,
            role=OrganisationMember.OWNER,
            deleted_at=None,
        )

        EnvironmentKey.objects.create(
            environment=environment,
            user=org_owner,
            identity_key=environment_data.identity_key,
            wrapped_seed=environment_data.wrapped_seed,
            wrapped_salt=environment_data.wrapped_salt,
        )
        for key in admin_keys:
            EnvironmentKey.objects.create(
                environment=environment,
                user_id=key.user_id,
                wrapped_seed=key.wrapped_seed,
                wrapped_salt=key.wrapped_salt,
                identity_key=key.identity_key,
            )

        return CreateEnvironmentMutation(environment=environment)


class CreateEnvironmentKeyMutation(graphene.Mutation):
    class Arguments:
        # id = graphene.ID(required=True)
        env_id = graphene.ID(required=True)
        user_id = graphene.ID(required=False)
        identity_key = graphene.String(required=True)
        wrapped_seed = graphene.String(required=True)
        wrapped_salt = graphene.String(required=True)

    environment_key = graphene.Field(EnvironmentKeyType)

    @classmethod
    def mutate(
        cls,
        root,
        info,
        env_id,
        identity_key,
        wrapped_seed,
        wrapped_salt,
        user_id=None,
    ):
        env = Environment.objects.get(id=env_id)

        # check that the user attempting the mutation has access
        if not user_can_access_app(info.context.user.userId, env.app.id):
            raise GraphQLError("You don't have access to this app")

        # check that the user for whom we are adding a key has access
        if not user_id is not None and member_can_access_org(
            user_id, env.app.organisation.id
        ):
            raise GraphQLError("This user doesn't have access to this app")

        if user_id is not None:
            org_member = OrganisationMember.objects.get(id=user_id)

            if EnvironmentKey.objects.filter(
                environment=env, user_id=org_member
            ).exists():
                raise GraphQLError("This user already has access to this environment")

        environment_key = EnvironmentKey.objects.create(
            environment=env,
            user_id=user_id,
            identity_key=identity_key,
            wrapped_seed=wrapped_seed,
            wrapped_salt=wrapped_salt,
        )

        return CreateEnvironmentKeyMutation(environment_key=environment_key)


class UpdateMemberEnvScopeMutation(graphene.Mutation):
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

        org_member = OrganisationMember.objects.get(id=member_id, deleted_at=None)
        if org_member not in app.members.all():
            raise GraphQLError("This user does not have access to this app")
        else:
            # delete all existing keys
            EnvironmentKey.objects.filter(
                environment__app=app, user_id=member_id
            ).delete()

            # set new keys
            for key in env_keys:
                EnvironmentKey.objects.create(
                    environment_id=key.env_id,
                    user_id=key.user_id,
                    wrapped_seed=key.wrapped_seed,
                    wrapped_salt=key.wrapped_salt,
                    identity_key=key.identity_key,
                )

        return UpdateMemberEnvScopeMutation(app=app)


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
                organisation=env.app.organisation, user_id=user.userId, deleted_at=None
            )

            environment_token = EnvironmentToken.objects.create(
                environment_id=env_id,
                user=org_member,
                name=name,
                identity_key=identity_key,
                token=token,
                wrapped_key_share=wrapped_key_share,
            )

            return CreateEnvironmentTokenMutation(environment_token=environment_token)


class CreateUserTokenMutation(graphene.Mutation):
    class Arguments:
        org_id = graphene.ID(required=True)
        name = graphene.String(required=True)
        identity_key = graphene.String(required=True)
        token = graphene.String(required=True)
        wrapped_key_share = graphene.String(required=True)
        expiry = graphene.BigInt(required=False)

    ok = graphene.Boolean()
    user_token = graphene.Field(UserTokenType)

    @classmethod
    def mutate(
        cls, root, info, org_id, name, identity_key, token, wrapped_key_share, expiry
    ):
        user = info.context.user
        if user_is_org_member(user.userId, org_id):
            org_member = OrganisationMember.objects.get(
                organisation_id=org_id, user_id=user.userId, deleted_at=None
            )

            if expiry is not None:
                expires_at = datetime.fromtimestamp(expiry / 1000)
            else:
                expires_at = None

            user_token = UserToken.objects.create(
                user=org_member,
                name=name,
                identity_key=identity_key,
                token=token,
                wrapped_key_share=wrapped_key_share,
                expires_at=expires_at,
            )

            return CreateUserTokenMutation(user_token=user_token, ok=True)

        else:
            raise GraphQLError("You don't have permission to perform this action")


class DeleteUserTokenMutation(graphene.Mutation):
    class Arguments:
        token_id = graphene.ID(required=True)

    ok = graphene.Boolean()

    @classmethod
    def mutate(cls, root, info, token_id):
        user = info.context.user
        token = UserToken.objects.get(id=token_id)
        org = token.user.organisation

        if user_is_org_member(user.userId, org.id):
            token.deleted_at = timezone.now()
            token.save()

            return DeleteUserTokenMutation(ok=True)
        else:
            raise GraphQLError("You don't have permission to perform this action")


class CreateServiceTokenMutation(graphene.Mutation):
    class Arguments:
        app_id = graphene.ID(required=True)
        environment_keys = graphene.List(EnvironmentKeyInput)
        identity_key = graphene.String(required=True)
        token = graphene.String(required=True)
        wrapped_key_share = graphene.String(required=True)
        name = graphene.String(required=True)
        expiry = graphene.BigInt(required=False)

    service_token = graphene.Field(ServiceTokenType)

    @classmethod
    def mutate(
        cls,
        root,
        info,
        app_id,
        environment_keys,
        identity_key,
        token,
        wrapped_key_share,
        name,
        expiry,
    ):
        user = info.context.user
        app = App.objects.get(id=app_id)

        if user_is_org_member(user.userId, app.organisation.id):
            org_member = OrganisationMember.objects.get(
                organisation_id=app.organisation.id,
                user_id=user.userId,
                deleted_at=None,
            )

            env_keys = EnvironmentKey.objects.bulk_create(
                [
                    EnvironmentKey(
                        environment_id=key.env_id,
                        identity_key=key.identity_key,
                        wrapped_seed=key.wrapped_seed,
                        wrapped_salt=key.wrapped_salt,
                    )
                    for key in environment_keys
                ]
            )

            if expiry is not None:
                expires_at = datetime.fromtimestamp(expiry / 1000)
            else:
                expires_at = None

            service_token = ServiceToken.objects.create(
                app=app,
                identity_key=identity_key,
                token=token,
                wrapped_key_share=wrapped_key_share,
                name=name,
                created_by=org_member,
                expires_at=expires_at,
            )

            service_token.keys.set(env_keys)

            return CreateServiceTokenMutation(service_token=service_token)


class DeleteServiceTokenMutation(graphene.Mutation):
    class Arguments:
        token_id = graphene.ID(required=True)

    ok = graphene.Boolean()

    @classmethod
    def mutate(cls, root, info, token_id):
        user = info.context.user
        token = ServiceToken.objects.get(id=token_id)
        org = token.app.organisation

        if user_is_org_member(user.userId, org.id):
            token.deleted_at = timezone.now()
            token.save()

            return DeleteServiceTokenMutation(ok=True)
        else:
            raise GraphQLError("You don't have permission to perform this action")


class CreateSecretFolderMutation(graphene.Mutation):
    class Arguments:
        env_id = graphene.ID()
        path = graphene.String()
        name = graphene.String()

    folder = graphene.Field(SecretFolderType)

    @classmethod
    def mutate(cls, root, info, env_id, name, path):
        user = info.context.user

        if not user_can_access_environment(user.userId, env_id):
            raise GraphQLError("You don't have access to this environment")

        normalized_path = normalize_path_string(path)

        if SecretFolder.objects.filter(
            environment_id=env_id, path=normalized_path, name=name
        ).exists():
            raise GraphQLError("A folder with that name already exists at this path!")

        folder = None

        if normalized_path != "/":

            folder_name = normalized_path.split("/")[-1]

            folder_path, _, _ = normalized_path.rpartition("/" + folder_name)
            folder_path = folder_path if folder_path else "/"

            folder = SecretFolder.objects.get(
                environment_id=env_id, path=folder_path, name=folder_name
            )

        folder = SecretFolder.objects.create(
            environment_id=env_id, folder=folder, path=normalized_path, name=name
        )

        return CreateSecretFolderMutation(folder=folder)


class DeleteSecretFolderMutation(graphene.Mutation):
    class Arguments:
        folder_id = graphene.ID()

    ok = graphene.Boolean()

    @classmethod
    def mutate(cls, root, info, folder_id):
        user = info.context.user

        folder = SecretFolder.objects.get(id=folder_id)

        if not user_can_access_environment(user.userId, folder.environment.id):
            raise GraphQLError("You don't have access to this environment")

        folder.delete()

        return DeleteSecretFolderMutation(ok=True)


class CreateSecretTagMutation(graphene.Mutation):
    class Arguments:
        org_id = graphene.ID(required=True)
        name = graphene.String(required=True)
        color = graphene.String(required=True)

    tag = graphene.Field(SecretTagType)

    @classmethod
    def mutate(cls, root, info, org_id, name, color):
        if not user_is_org_member(info.context.user.userId, org_id):
            raise GraphQLError("You don't have permission to perform this action")

        org = Organisation.objects.get(id=org_id)

        if SecretTag.objects.filter(organisation=org, name=name).exists():
            raise GraphQLError("This tag already exists!")

        tag = SecretTag.objects.create(organisation=org, name=name, color=color)

        return CreateSecretTagMutation(tag=tag)


class CreateSecretMutation(graphene.Mutation):
    class Arguments:
        secret_data = SecretInput(SecretInput)

    secret = graphene.Field(SecretType)

    @classmethod
    def mutate(cls, root, info, secret_data):
        env = Environment.objects.get(id=secret_data.env_id)
        org = env.app.organisation
        if not user_is_org_member(info.context.user.userId, org.id):
            raise GraphQLError("You don't have permission to perform this action")

        tags = SecretTag.objects.filter(id__in=secret_data.tags)

        path = (
            normalize_path_string(secret_data.path)
            if secret_data.path is not None
            else "/"
        )

        folder = None

        if path != "/":

            folder_name = path.split("/")[-1]

            folder_path, _, _ = path.rpartition("/" + folder_name)
            folder_path = folder_path if folder_path else "/"

            folder = SecretFolder.objects.get(
                environment_id=env.id, path=folder_path, name=folder_name
            )

        secret_obj_data = {
            "environment_id": env.id,
            "path": path,
            "folder_id": folder.id if folder is not None else None,
            "key": secret_data.key,
            "key_digest": secret_data.key_digest,
            "value": secret_data.value,
            "version": 1,
            "comment": secret_data.comment,
        }

        secret = Secret.objects.create(**secret_obj_data)
        secret.tags.set(tags)

        ip_address, user_agent = get_resolver_request_meta(info.context)

        org_member = OrganisationMember.objects.get(
            user=info.context.user, organisation=org, deleted_at=None
        )

        log_secret_event(
            secret, SecretEvent.CREATE, org_member, None, ip_address, user_agent
        )

        return CreateSecretMutation(secret=secret)


class EditSecretMutation(graphene.Mutation):
    class Arguments:
        id = graphene.ID(required=True)
        secret_data = SecretInput(SecretInput)

    secret = graphene.Field(SecretType)

    @classmethod
    def mutate(cls, root, info, id, secret_data):
        secret = Secret.objects.get(id=id)
        env = secret.environment
        org = env.app.organisation
        if not user_is_org_member(info.context.user.userId, org.id):
            raise GraphQLError("You don't have permission to perform this action")

        tags = SecretTag.objects.filter(id__in=secret_data.tags)

        path = (
            normalize_path_string(secret_data.path)
            if secret_data.path is not None
            else "/"
        )

        secret_obj_data = {
            "path": path,
            "key": secret_data.key,
            "key_digest": secret_data.key_digest,
            "value": secret_data.value,
            "version": secret.version + 1,
            "comment": secret_data.comment,
        }

        for key, value in secret_obj_data.items():
            setattr(secret, key, value)

        secret.updated_at = timezone.now()
        secret.tags.set(tags)
        secret.save()

        ip_address, user_agent = get_resolver_request_meta(info.context)

        org_member = OrganisationMember.objects.get(
            user=info.context.user, organisation=org, deleted_at=None
        )

        log_secret_event(
            secret, SecretEvent.UPDATE, org_member, None, ip_address, user_agent
        )

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
            raise GraphQLError("You don't have permission to perform this action")

        secret.updated_at = timezone.now()
        secret.deleted_at = timezone.now()
        secret.save()

        ip_address, user_agent = get_resolver_request_meta(info.context)

        org_member = OrganisationMember.objects.get(
            user=info.context.user, organisation=org, deleted_at=None
        )

        log_secret_event(
            secret, SecretEvent.DELETE, org_member, None, ip_address, user_agent
        )

        return DeleteSecretMutation(secret=secret)


class ReadSecretMutation(graphene.Mutation):
    class Arguments:
        ids = graphene.List(graphene.ID)

    ok = graphene.Boolean()

    @classmethod
    def mutate(cls, root, info, ids):
        for id in ids:
            secret = Secret.objects.get(id=id)
            env = secret.environment
            org = env.app.organisation
            if not user_is_org_member(info.context.user.userId, org.id):
                raise GraphQLError("You don't have permission to perform this action")
            else:
                ip_address, user_agent = get_resolver_request_meta(info.context)

                org_member = OrganisationMember.objects.get(
                    user=info.context.user, organisation=org, deleted_at=None
                )

                log_secret_event(
                    secret, SecretEvent.READ, org_member, None, ip_address, user_agent
                )
        return ReadSecretMutation(ok=True)


class CreatePersonalSecretMutation(graphene.Mutation):
    class Arguments:
        override_data = PersonalSecretInput(PersonalSecretInput)

    override = graphene.Field(PersonalSecretType)

    @classmethod
    def mutate(cls, root, info, override_data):
        secret = Secret.objects.get(id=override_data.secret_id)
        org = secret.environment.app.organisation
        org_member = OrganisationMember.objects.get(
            organisation=org, user=info.context.user
        )

        if not user_can_access_environment(info.context.user, secret.environment.id):
            raise GraphQLError("You don't have access to this secret")

        override, _ = PersonalSecret.objects.get_or_create(
            secret_id=override_data.secret_id, user=org_member
        )
        override.value = override_data.value
        override.is_active = override_data.is_active
        override.save()

        return CreatePersonalSecretMutation(override=override)


class DeletePersonalSecretMutation(graphene.Mutation):
    class Arguments:
        secret_id = graphene.ID()

    ok = graphene.Boolean()

    @classmethod
    def mutate(cls, root, info, secret_id):
        secret = Secret.objects.get(id=secret_id)
        org = secret.environment.app.organisation
        org_member = OrganisationMember.objects.get(
            organisation=org, user=info.context.user
        )

        if not user_can_access_environment(info.context.user, secret.environment.id):
            raise GraphQLError("You don't have access to this secret")

        PersonalSecret.objects.filter(secret_id=secret_id, user=org_member).delete()

        return DeletePersonalSecretMutation(ok=True)
