import re
from django.utils import timezone
from django.db.models import Max
from api.utils.rest import get_resolver_request_meta
from api.utils.access.permissions import (
    member_can_access_org,
    user_can_access_app,
    user_can_access_environment,
    user_has_permission,
    user_is_org_member,
)
from api.utils.audit_logging import log_secret_event
from api.utils.secrets import create_environment_folder_structure, normalize_path_string
from backend.quotas import can_add_environment, can_use_custom_envs
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
    ServiceAccount,
    UserToken,
    ServiceToken,
)
from backend.graphene.types import (
    AppType,
    EnvironmentKeyType,
    EnvironmentTokenType,
    EnvironmentType,
    MemberType,
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
    id = graphene.ID(required=False)
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
        wrapped_seed = graphene.String(required=False)
        wrapped_salt = graphene.String(required=False)

    environment = graphene.Field(EnvironmentType)

    @classmethod
    def mutate(
        cls,
        root,
        info,
        environment_data,
        admin_keys,
        wrapped_seed=None,
        wrapped_salt=None,
    ):
        user_id = info.context.user.userId

        if not user_can_access_app(user_id, environment_data.app_id):
            raise GraphQLError("You don't have access to this app")

        app = App.objects.get(id=environment_data.app_id)

        if not user_has_permission(
            info.context.user, "create", "Environments", app.organisation, True
        ):
            raise GraphQLError(
                "You don't have permission to create environments in this organisation"
            )

        if not re.match(r"^[a-zA-Z0-9\-_]{1,32}$", environment_data.name):
            raise GraphQLError(
                "Environment name is invalid! Environment names can only includes letters, numbers, hyphens and underscores, and must be 32 characters or less."
            )

        if Environment.objects.filter(
            app=app, name__iexact=environment_data.name
        ).exists():
            raise GraphQLError(
                "An Environment with this name already exists in this App!"
            )
        if not can_add_environment(app):
            raise GraphQLError("You cannot add any more Environments to this App!")

        if environment_data.env_type.lower() == "dev":
            index = 0
        elif environment_data.env_type.lower() == "staging":
            index = 1
        elif environment_data.env_type.lower() == "prod":
            index = 2
        else:
            max_index = Environment.objects.filter(app=app).aggregate(Max("index"))[
                "index__max"
            ]
            if max_index:
                index = max_index + 1
            else:
                index = 0

        environment = Environment.objects.create(
            app=app,
            name=environment_data.name,
            env_type=environment_data.env_type,
            index=index,
            identity_key=environment_data.identity_key,
            wrapped_seed=environment_data.wrapped_seed,
            wrapped_salt=environment_data.wrapped_salt,
        )

        org_owner = OrganisationMember.objects.get(
            organisation=environment.app.organisation,
            role__name="Owner",
            deleted_at=None,
        )

        # Add the org owner to the environment
        EnvironmentKey.objects.create(
            environment=environment,
            user=org_owner,
            identity_key=environment_data.identity_key,
            wrapped_seed=environment_data.wrapped_seed,
            wrapped_salt=environment_data.wrapped_salt,
        )

        # Add admins to the environment
        for key in admin_keys:
            EnvironmentKey.objects.create(
                environment=environment,
                user_id=key.user_id,
                wrapped_seed=key.wrapped_seed,
                wrapped_salt=key.wrapped_salt,
                identity_key=key.identity_key,
            )

        # Add Server keys if provided
        if wrapped_seed and wrapped_salt:
            ServerEnvironmentKey.objects.create(
                environment=environment,
                identity_key=environment_data.identity_key,
                wrapped_seed=wrapped_seed,
                wrapped_salt=wrapped_salt,
            )

        return CreateEnvironmentMutation(environment=environment)


class RenameEnvironmentMutation(graphene.Mutation):
    class Arguments:
        environment_id = graphene.ID(required=True)
        name = graphene.String(required=True)

    environment = graphene.Field(EnvironmentType)

    @classmethod
    def mutate(cls, root, info, environment_id, name):
        user = info.context.user
        environment = Environment.objects.get(id=environment_id)
        org = environment.app.organisation

        if not user_has_permission(
            info.context.user, "update", "Environments", org, True
        ):
            raise GraphQLError("You do not have permission to rename environments")

        if not can_use_custom_envs(org):
            raise GraphQLError(
                "Your Organisation doesn't have access to Custom Environments"
            )

        if not re.match(r"^[a-zA-Z0-9\-_]{1,32}$", name):
            raise GraphQLError(
                "Environment name is invalid! Environment names can only includes letters, numbers, hyphens and underscores, and must be 32 characters or less."
            )

        if (
            Environment.objects.filter(app=environment.app, name__iexact=name)
            .exclude(id=environment_id)
            .exists()
        ):
            raise GraphQLError(
                "An Environment with this name already exists in this App!"
            )
        environment.name = name
        environment.updated_at = timezone.now()
        environment.save()

        return RenameEnvironmentMutation(environment=environment)


class DeleteEnvironmentMutation(graphene.Mutation):
    class Arguments:
        environment_id = graphene.ID(required=True)

    ok = graphene.Boolean()

    @classmethod
    def mutate(cls, root, info, environment_id):
        user = info.context.user
        environment = Environment.objects.get(id=environment_id)
        org = environment.app.organisation

        if not user_has_permission(
            info.context.user, "delete", "Environments", org, True
        ):
            raise GraphQLError("You do not have permission to delete environments")

        if not can_use_custom_envs(org):
            raise GraphQLError(
                "Your Organisation doesn't have access to Custom Environments"
            )

        environment.delete()

        return DeleteEnvironmentMutation(ok=True)


class SwapEnvironmentOrderMutation(graphene.Mutation):
    class Arguments:
        environment1_id = graphene.ID(required=True)
        environment2_id = graphene.ID(required=True)

    ok = graphene.Boolean()

    @classmethod
    def mutate(cls, root, info, environment1_id, environment2_id):
        user = info.context.user
        environment1 = Environment.objects.get(id=environment1_id)
        environment2 = Environment.objects.get(id=environment2_id)
        org = environment1.app.organisation

        if not user_has_permission(
            info.context.user, "update", "Environments", org, True
        ):
            raise GraphQLError("You do not have permission to update environments")

        if not can_use_custom_envs(org):
            raise GraphQLError(
                "Your Organisation doesn't have access to Custom Environments"
            )

        # Temporarily store the index of environment1
        temp_index = environment1.index

        # Swap the indices
        environment1.index = environment2.index
        environment2.index = temp_index

        environment1.save()
        environment2.save()

        return SwapEnvironmentOrderMutation(ok=True)


class UpdateEnvironmentOrderMutation(graphene.Mutation):
    class Arguments:
        app_id = graphene.ID(required=True)
        environment_order = graphene.List(graphene.ID, required=True)

    ok = graphene.Boolean()

    @classmethod
    def mutate(cls, root, info, app_id, environment_order):
        user = info.context.user
        app = App.objects.get(id=app_id)
        org = app.organisation

        if not user_has_permission(user, "update", "Environments", org, True):
            raise GraphQLError("You do not have permission to update environments")

        if not can_use_custom_envs(org):
            raise GraphQLError(
                "Your Organisation doesn't have access to Custom Environments"
            )

        # Verify all IDs belong to this app
        environments = Environment.objects.filter(app=app)
        env_ids = set(str(e.id) for e in environments)
        order_ids = set(str(id) for id in environment_order)

        if env_ids != order_ids:
            raise GraphQLError(
                "The provided environment list doesn't match the app's environments"
            )

        # Bulk update indices
        for index, env_id in enumerate(environment_order):
            Environment.objects.filter(id=env_id, app=app).update(index=index)

        return UpdateEnvironmentOrderMutation(ok=True)


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
        if user_id is not None and not member_can_access_org(
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
        member_type = MemberType(required=False)
        app_id = graphene.ID()
        env_keys = graphene.List(EnvironmentKeyInput)

    app = graphene.Field(AppType)

    @classmethod
    def mutate(
        cls, root, info, member_id, app_id, env_keys, member_type=MemberType.USER
    ):
        user = info.context.user
        app = App.objects.get(id=app_id)

        if member_type == MemberType.USER:
            permission_key = "Members"
        else:
            permission_key = "ServiceAccounts"

        if not user_has_permission(
            info.context.user, "update", permission_key, app.organisation, True
        ):
            raise GraphQLError("You don't have permission to update App member access")

        if not user_can_access_app(user.userId, app.id):
            raise GraphQLError("You don't have access to this app")

        key_to_delete_filter = {
            "environment__app": app,
        }

        if member_type == MemberType.USER:
            app_member = OrganisationMember.objects.get(id=member_id, deleted_at=None)
            key_to_delete_filter["user_id"] = member_id
            if app_member not in app.members.all():
                raise GraphQLError("This user does not have access to this app")

        elif member_type == MemberType.SERVICE:
            app_member = ServiceAccount.objects.get(id=member_id)
            key_to_delete_filter["service_account_id"] = member_id
            if app_member not in app.service_accounts.all():
                raise GraphQLError(
                    "This service account does not have access to this app"
                )

        # delete all existing keys for this member
        EnvironmentKey.objects.filter(**key_to_delete_filter).delete()

        # set new keys
        for key in env_keys:

            EnvironmentKey.objects.create(
                environment_id=key.env_id,
                user_id=key.user_id if member_type == MemberType.USER else None,
                service_account_id=(
                    key.user_id if member_type == MemberType.SERVICE else None
                ),
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

        if not user_has_permission(
            info.context.user, "create", "Tokens", app.organisation, True
        ):
            raise GraphQLError("You don't have permission to create Tokens in this App")

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

        if not user_has_permission(info.context.user, "delete", "Tokens", org, True):
            raise GraphQLError("You don't have permission to delete Tokens in this App")

        token.deleted_at = timezone.now()
        token.save()

        return DeleteServiceTokenMutation(ok=True)


class CreateSecretFolderMutation(graphene.Mutation):
    class Arguments:
        env_id = graphene.ID()
        path = graphene.String()
        name = graphene.String()

    folder = graphene.Field(SecretFolderType)

    @classmethod
    def mutate(cls, root, info, env_id, name, path):
        user = info.context.user

        org = Environment.objects.get(id=env_id).app.organisation

        if not user_has_permission(info.context.user, "create", "Secrets", org, True):
            raise GraphQLError(
                "You don't have permission to create folders in this organisation"
            )

        if not user_can_access_environment(user.userId, env_id):
            raise GraphQLError("You don't have access to this environment")

        normalized_path = normalize_path_string(path)

        if SecretFolder.objects.filter(
            environment_id=env_id, path=normalized_path, name=name
        ).exists():
            raise GraphQLError("A folder with that name already exists at this path!")

        subfolder = None

        if path != "/":
            subfolder = create_environment_folder_structure(path, env_id)

        folder = SecretFolder.objects.create(
            environment_id=env_id, folder=subfolder, path=normalized_path, name=name
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

        if not user_has_permission(
            info.context.user,
            "delete",
            "Secrets",
            folder.environment.app.organisation,
            True,
        ):
            raise GraphQLError(
                "You don't have permission to delete folders in this organisation"
            )

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

        if not user_has_permission(info.context.user, "create", "Secrets", org, True):
            raise GraphQLError(
                "You don't have permission to create secrets in this organisation"
            )

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
            secret, SecretEvent.CREATE, org_member, None, None, ip_address, user_agent
        )

        return CreateSecretMutation(secret=secret)


class BulkCreateSecretMutation(graphene.Mutation):
    class Arguments:
        secrets_data = graphene.List(SecretInput, required=True)

    secrets = graphene.List(SecretType)

    @classmethod
    def mutate(cls, root, info, secrets_data):
        created_secrets = []

        for secret_data in secrets_data:
            env = Environment.objects.get(id=secret_data.env_id)
            org = env.app.organisation

            if not user_has_permission(
                info.context.user, "create", "Secrets", org, True
            ):
                raise GraphQLError(
                    "You don't have permission to create secrets in this organisation"
                )

            if not user_can_access_environment(info.context.user.userId, env.id):
                raise GraphQLError("You don't have access to this environment")

            tags = SecretTag.objects.filter(id__in=secret_data.tags)

            path = (
                normalize_path_string(secret_data.path)
                if secret_data.path is not None
                else "/"
            )

            folder = None
            if path != "/":
                folder = create_environment_folder_structure(path, secret_data.env_id)

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
            created_secrets.append(secret)

            ip_address, user_agent = get_resolver_request_meta(info.context)
            org_member = OrganisationMember.objects.get(
                user=info.context.user, organisation=org, deleted_at=None
            )
            log_secret_event(
                secret,
                SecretEvent.CREATE,
                org_member,
                None,
                None,
                ip_address,
                user_agent,
            )

        return BulkCreateSecretMutation(secrets=created_secrets)


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

        if not user_has_permission(info.context.user, "update", "Secrets", org, True):
            raise GraphQLError(
                "You don't have permission to update secrets in this organisation"
            )

        if not user_can_access_environment(info.context.user.userId, env.id):
            raise GraphQLError("You don't have access to this environment")

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
            secret, SecretEvent.UPDATE, org_member, None, None, ip_address, user_agent
        )

        return EditSecretMutation(secret=secret)


class BulkEditSecretMutation(graphene.Mutation):
    class Arguments:
        secrets_data = graphene.List(SecretInput, required=True)

    secrets = graphene.List(SecretType)

    @classmethod
    def mutate(cls, root, info, secrets_data):
        updated_secrets = []

        for secret_data in secrets_data:
            secret = Secret.objects.get(id=secret_data.id)
            env = secret.environment
            org = env.app.organisation

            if not user_has_permission(
                info.context.user, "create", "Secrets", org, True
            ):
                raise GraphQLError(
                    "You don't have permission to update secrets in this organisation"
                )

            if not user_can_access_environment(info.context.user.userId, env.id):
                raise GraphQLError("You don't have access to this environment")

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
            updated_secrets.append(secret)

            ip_address, user_agent = get_resolver_request_meta(info.context)
            org_member = OrganisationMember.objects.get(
                user=info.context.user, organisation=org, deleted_at=None
            )
            log_secret_event(
                secret,
                SecretEvent.UPDATE,
                org_member,
                None,
                None,
                ip_address,
                user_agent,
            )

        return BulkEditSecretMutation(secrets=updated_secrets)


class DeleteSecretMutation(graphene.Mutation):
    class Arguments:
        id = graphene.ID(required=True)

    secret = graphene.Field(SecretType)

    @classmethod
    def mutate(cls, root, info, id):
        secret = Secret.objects.get(id=id)
        env = secret.environment
        org = env.app.organisation

        if not user_has_permission(info.context.user, "delete", "Secrets", org, True):
            raise GraphQLError(
                "You don't have permission to delete secrets in this organisation"
            )

        secret.updated_at = timezone.now()
        secret.deleted_at = timezone.now()
        secret.save()

        ip_address, user_agent = get_resolver_request_meta(info.context)

        org_member = OrganisationMember.objects.get(
            user=info.context.user, organisation=org, deleted_at=None
        )

        log_secret_event(
            secret, SecretEvent.DELETE, org_member, None, None, ip_address, user_agent
        )

        return DeleteSecretMutation(secret=secret)


class BulkDeleteSecretMutation(graphene.Mutation):
    class Arguments:
        ids = graphene.List(graphene.ID, required=True)

    secrets = graphene.List(SecretType)

    @classmethod
    def mutate(cls, root, info, ids):
        deleted_secrets = []

        for id in ids:
            secret = Secret.objects.get(id=id)
            env = secret.environment
            org = env.app.organisation

            if not user_has_permission(
                info.context.user, "delete", "Secrets", org, True
            ):
                raise GraphQLError(
                    "You don't have permission to delete secrets in this organisation"
                )

            if not user_can_access_environment(info.context.user.userId, env.id):
                raise GraphQLError("You don't have access to this environment")

            secret.updated_at = timezone.now()
            secret.deleted_at = timezone.now()
            secret.save()
            deleted_secrets.append(secret)

            ip_address, user_agent = get_resolver_request_meta(info.context)
            org_member = OrganisationMember.objects.get(
                user=info.context.user, organisation=org, deleted_at=None
            )
            log_secret_event(
                secret,
                SecretEvent.DELETE,
                org_member,
                None,
                None,
                ip_address,
                user_agent,
            )

        return BulkDeleteSecretMutation(secrets=deleted_secrets)


class ReadSecretMutation(graphene.Mutation):
    class Arguments:
        ids = graphene.List(graphene.ID)

    ok = graphene.Boolean()

    @classmethod
    def mutate(cls, root, info, ids):
        for id in ids:
            secret = Secret.objects.get(id=id)
            if not user_can_access_environment(
                info.context.user.userId, secret.environment.id
            ):
                raise GraphQLError("You don't have permission to perform this action")

            env = secret.environment
            org = env.app.organisation

            ip_address, user_agent = get_resolver_request_meta(info.context)

            org_member = OrganisationMember.objects.get(
                user=info.context.user, organisation=org, deleted_at=None
            )

            log_secret_event(
                secret,
                SecretEvent.READ,
                org_member,
                None,
                None,
                ip_address,
                user_agent,
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
            organisation=org, user=info.context.user, deleted_at=None
        )

        if not user_can_access_environment(info.context.user.userId, secret.environment.id):
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
            organisation=org, user=info.context.user, deleted_at=None
        )

        if not user_can_access_environment(info.context.user.userId, secret.environment.id):
            raise GraphQLError("You don't have access to this secret")

        PersonalSecret.objects.filter(secret_id=secret_id, user=org_member).delete()

        return DeletePersonalSecretMutation(ok=True)
