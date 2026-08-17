import re
from django.utils import timezone
from django.db import transaction
from django.db.models import Max
from api.utils.rest import get_resolver_request_meta
from api.utils.access.permissions import (
    member_can_access_org,
    role_has_global_access,
    user_can_access_app,
    user_can_access_environment,
    user_has_permission,
    user_is_org_member,
)
from api.utils.audit_logging import log_secret_event, log_secret_events_bulk, log_audit_event, get_actor_info_from_graphql, get_member_display_name
from api.utils.secrets import create_environment_folder_structure, normalize_path_string
from backend.quotas import can_add_environment, can_use_custom_envs
import graphene
from graphql import GraphQLError
from api.models import (
    App,
    Environment,
    EnvironmentKey,
    EnvironmentKeyGrant,
    EnvironmentSync,
    EnvironmentToken,
    Organisation,
    OrganisationMember,
    PersonalSecret,
    RotatingSecret,
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
    type = graphene.String(required=False)


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
            info.context.user, "create", "Environments", app.organisation, True, app=app
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

        # Custom environments require a paid plan. The default dev/staging/prod
        # environments provisioned during app setup are exempt.
        is_custom_env = environment_data.env_type.lower() not in (
            "dev",
            "staging",
            "prod",
        )
        if is_custom_env and not can_use_custom_envs(app.organisation):
            raise GraphQLError(
                "Custom environments are not available on the Free plan. Upgrade to Pro to create custom environments."
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

        with transaction.atomic():
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
            owner_key = EnvironmentKey.objects.create(
                environment=environment,
                user=org_owner,
                identity_key=environment_data.identity_key,
                wrapped_seed=environment_data.wrapped_seed,
                wrapped_salt=environment_data.wrapped_salt,
            )
            EnvironmentKeyGrant.objects.create(
                environment_key=owner_key,
                grant_type="individual",
            )

            # Add admins to the environment
            for key in admin_keys:
                admin_key = EnvironmentKey.objects.create(
                    environment=environment,
                    user_id=key.user_id,
                    wrapped_seed=key.wrapped_seed,
                    wrapped_salt=key.wrapped_salt,
                    identity_key=key.identity_key,
                )
                EnvironmentKeyGrant.objects.create(
                    environment_key=admin_key,
                    grant_type="individual",
                )

            # Add Server keys if provided
            if wrapped_seed and wrapped_salt:
                ServerEnvironmentKey.objects.create(
                    environment=environment,
                    identity_key=environment_data.identity_key,
                    wrapped_seed=wrapped_seed,
                    wrapped_salt=wrapped_salt,
                )

        actor_type, actor_id, actor_metadata = get_actor_info_from_graphql(info, organisation=app.organisation)
        ip_address, user_agent = get_resolver_request_meta(info.context)
        log_audit_event(
            organisation=app.organisation,
            event_type="C",
            resource_type="env",
            resource_id=environment.id,
            actor_type=actor_type,
            actor_id=actor_id,
            actor_metadata=actor_metadata,
            resource_metadata={"name": environment_data.name, "app": app.name},
            description=f"Created environment '{environment_data.name}' in app '{app.name}'",
            ip_address=ip_address,
            user_agent=user_agent,
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
            info.context.user, "update", "Environments", org, True, app=environment.app
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
        old_name = environment.name
        environment.name = name
        environment.updated_at = timezone.now()
        environment.save()

        actor_type, actor_id, actor_metadata = get_actor_info_from_graphql(info, organisation=org)
        ip_address, user_agent = get_resolver_request_meta(info.context)
        log_audit_event(
            organisation=org,
            event_type="U",
            resource_type="env",
            resource_id=environment.id,
            actor_type=actor_type,
            actor_id=actor_id,
            actor_metadata=actor_metadata,
            resource_metadata={"name": name},
            old_values={"name": old_name},
            new_values={"name": name},
            description=f"Renamed environment '{old_name}' to '{name}'",
            ip_address=ip_address,
            user_agent=user_agent,
        )

        return RenameEnvironmentMutation(environment=environment)


def _descendant_folder_ids(folder):
    """All folder ids under `folder` (inclusive), reached via the self-FK tree."""
    seen = {folder.id}
    frontier = [folder.id]
    while frontier:
        children = list(
            SecretFolder.objects.filter(folder_id__in=frontier).values_list("id", flat=True)
        )
        new = [c for c in children if c not in seen]
        if not new:
            break
        seen.update(new)
        frontier = new
    return seen


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
            info.context.user, "delete", "Environments", org, True, app=environment.app
        ):
            raise GraphQLError("You do not have permission to delete environments")

        # An env that contains live rotating secrets can't be deleted without
        # RotatingSecrets:delete — otherwise a caller with only Environments:delete
        # could destroy a rotation config (and its provider creds via cascade).
        if RotatingSecret.objects.filter(
            environment=environment, deleted_at__isnull=True
        ).exists():
            if not user_has_permission(
                user, "delete", "RotatingSecrets", org, True, app=environment.app
            ):
                raise GraphQLError(
                    "This environment contains rotating secrets. You need "
                    "permission to delete rotating secrets to remove it."
                )

        if not can_use_custom_envs(org):
            raise GraphQLError(
                "Your Organisation doesn't have access to Custom Environments"
            )

        env_name = environment.name
        env_id = environment.id

        environment.delete()

        actor_type, actor_id, actor_metadata = get_actor_info_from_graphql(info, organisation=org)
        ip_address, user_agent = get_resolver_request_meta(info.context)
        log_audit_event(
            organisation=org,
            event_type="D",
            resource_type="env",
            resource_id=env_id,
            actor_type=actor_type,
            actor_id=actor_id,
            actor_metadata=actor_metadata,
            resource_metadata={"name": env_name},
            description=f"Deleted environment '{env_name}'",
            ip_address=ip_address,
            user_agent=user_agent,
        )

        return DeleteEnvironmentMutation(ok=True)


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

        if not user_has_permission(user, "update", "Environments", org, True, app=app):
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
        EnvironmentKeyGrant.objects.create(
            environment_key=environment_key,
            grant_type="individual",
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
            info.context.user, "update", permission_key, app.organisation, True, app=app
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

            if role_has_global_access(app_member.role):
                raise GraphQLError(
                    "Access cannot be changed for members with a global access role."
                )

        elif member_type == MemberType.SERVICE:
            app_member = ServiceAccount.objects.get(id=member_id)
            key_to_delete_filter["service_account_id"] = member_id
            if app_member not in app.service_accounts.all():
                raise GraphQLError(
                    "This service account does not have access to this app"
                )

        # Capture old env scope for audit logging
        old_env_key_filter = dict(key_to_delete_filter)
        old_env_ids = set(
            EnvironmentKey.objects.filter(**old_env_key_filter)
            .values_list("environment_id", flat=True)
        )
        new_env_ids = set(key.env_id for key in env_keys)

        with transaction.atomic():
            # Drop only individual grants; team grants on the same key
            # must survive this edit. Soft-delete keys with no grants
            # left, and re-attach individual grants to keys preserved
            # for their team grant (avoids the (env, user|sa) unique
            # conflict that would arise from creating a duplicate row).
            old_keys = list(
                EnvironmentKey.objects.filter(
                    deleted_at__isnull=True, **key_to_delete_filter
                )
            )
            old_key_ids = [k.id for k in old_keys]
            EnvironmentKeyGrant.objects.filter(
                environment_key_id__in=old_key_ids, grant_type="individual"
            ).delete()

            keys_with_remaining_grants = set(
                EnvironmentKeyGrant.objects.filter(
                    environment_key_id__in=old_key_ids
                ).values_list("environment_key_id", flat=True)
            )
            EnvironmentKey.objects.filter(
                id__in=[
                    kid for kid in old_key_ids
                    if kid not in keys_with_remaining_grants
                ]
            ).update(deleted_at=timezone.now())

            preserved_by_env = {
                k.environment_id: k
                for k in old_keys
                if k.id in keys_with_remaining_grants
            }

            for key in env_keys:
                preserved = preserved_by_env.get(key.env_id)
                if preserved is not None:
                    EnvironmentKeyGrant.objects.get_or_create(
                        environment_key=preserved,
                        grant_type="individual",
                        team=None,
                    )
                    continue

                new_key = EnvironmentKey.objects.create(
                    environment_id=key.env_id,
                    user_id=key.user_id if member_type == MemberType.USER else None,
                    service_account_id=(
                        key.user_id if member_type == MemberType.SERVICE else None
                    ),
                    wrapped_seed=key.wrapped_seed,
                    wrapped_salt=key.wrapped_salt,
                    identity_key=key.identity_key,
                )
                EnvironmentKeyGrant.objects.create(
                    environment_key=new_key,
                    grant_type="individual",
                    team=None,
                )

        # Audit log the env scope change
        if old_env_ids != new_env_ids:
            actor_type, actor_id, actor_metadata = get_actor_info_from_graphql(
                info, organisation=app.organisation
            )
            ip_address, user_agent = get_resolver_request_meta(info.context)

            # Compute the actual diff — only envs that were added or removed
            added_env_ids = new_env_ids - old_env_ids
            removed_env_ids = old_env_ids - new_env_ids

            # Resolve env names for readability
            env_name_map = dict(
                Environment.objects.filter(
                    id__in=added_env_ids | removed_env_ids
                ).values_list("id", "name")
            )
            added_env_names = sorted(env_name_map.get(eid, str(eid)) for eid in added_env_ids)
            removed_env_names = sorted(env_name_map.get(eid, str(eid)) for eid in removed_env_ids)

            if member_type == MemberType.USER:
                member_name = get_member_display_name(app_member)
                resource_type = "member"
            else:
                member_name = app_member.name
                resource_type = "sa"

            old_values = {}
            new_values = {}
            if removed_env_names:
                old_values["envs_removed"] = removed_env_names
            if added_env_names:
                new_values["envs_added"] = added_env_names

            log_audit_event(
                organisation=app.organisation,
                event_type="A",
                resource_type=resource_type,
                resource_id=str(member_id),
                actor_type=actor_type,
                actor_id=actor_id,
                actor_metadata=actor_metadata,
                resource_metadata={"name": member_name, "app_name": app.name, "app_id": str(app.id)},
                old_values=old_values,
                new_values=new_values,
                description=f"Updated environment scope for {member_name} in app '{app.name}'",
                ip_address=ip_address,
                user_agent=user_agent,
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

            actor_type, actor_id, actor_metadata = get_actor_info_from_graphql(info, organisation=org_member.organisation)
            ip_address, user_agent = get_resolver_request_meta(info.context)
            log_audit_event(
                organisation=org_member.organisation,
                event_type="C",
                resource_type="pat",
                resource_id=user_token.id,
                actor_type=actor_type,
                actor_id=actor_id,
                actor_metadata=actor_metadata,
                resource_metadata={"name": name},
                description=f"Created personal access token '{name}'",
                ip_address=ip_address,
                user_agent=user_agent,
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
            token_name = token.name
            token_id = token.id

            token.deleted_at = timezone.now()
            token.save()

            actor_type, actor_id, actor_metadata = get_actor_info_from_graphql(info, organisation=org)
            ip_address, user_agent = get_resolver_request_meta(info.context)
            log_audit_event(
                organisation=org,
                event_type="D",
                resource_type="pat",
                resource_id=token_id,
                actor_type=actor_type,
                actor_id=actor_id,
                actor_metadata=actor_metadata,
                resource_metadata={"name": token_name},
                description=f"Deleted personal access token '{token_name}'",
                ip_address=ip_address,
                user_agent=user_agent,
            )

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
            info.context.user, "create", "Tokens", app.organisation, True, app=app
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

        actor_type, actor_id, actor_metadata = get_actor_info_from_graphql(info, organisation=app.organisation)
        ip_address, user_agent = get_resolver_request_meta(info.context)
        log_audit_event(
            organisation=app.organisation,
            event_type="C",
            resource_type="svc_token",
            resource_id=service_token.id,
            actor_type=actor_type,
            actor_id=actor_id,
            actor_metadata=actor_metadata,
            resource_metadata={"name": name, "app_name": app.name, "app_id": str(app.id)},
            description=f"Created service token '{name}' for app '{app.name}'",
            ip_address=ip_address,
            user_agent=user_agent,
        )

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

        if not user_has_permission(info.context.user, "delete", "Tokens", org, True, app=token.app):
            raise GraphQLError("You don't have permission to delete Tokens in this App")

        token_name = token.name
        token_id = token.id
        app_name = token.app.name
        app_id = str(token.app.id)

        token.deleted_at = timezone.now()
        token.save()

        actor_type, actor_id, actor_metadata = get_actor_info_from_graphql(info, organisation=org)
        ip_address, user_agent = get_resolver_request_meta(info.context)
        log_audit_event(
            organisation=org,
            event_type="D",
            resource_type="svc_token",
            resource_id=token_id,
            actor_type=actor_type,
            actor_id=actor_id,
            actor_metadata=actor_metadata,
            resource_metadata={"name": token_name, "app_name": app_name, "app_id": app_id},
            description=f"Deleted service token '{token_name}'",
            ip_address=ip_address,
            user_agent=user_agent,
        )

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

        env_obj = Environment.objects.get(id=env_id)
        app = env_obj.app
        org = app.organisation

        if not user_has_permission(info.context.user, "create", "Secrets", org, True, app=app):
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
            app=folder.environment.app,
        ):
            raise GraphQLError(
                "You don't have permission to delete folders in this organisation"
            )

        if not user_can_access_environment(user.userId, folder.environment.id):
            raise GraphQLError("You don't have access to this environment")

        # Same RotatingSecrets:delete gate as DeleteEnvironment.
        affected_folder_ids = _descendant_folder_ids(folder)
        if RotatingSecret.objects.filter(
            folder_id__in=affected_folder_ids, deleted_at__isnull=True
        ).exists():
            if not user_has_permission(
                user,
                "delete",
                "RotatingSecrets",
                folder.environment.app.organisation,
                True,
                app=folder.environment.app,
            ):
                raise GraphQLError(
                    "This folder contains rotating secrets. You need "
                    "permission to delete rotating secrets to remove it."
                )

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

        if not user_has_permission(info.context.user, "create", "Secrets", org, True, app=env.app):
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
            "type": secret_data.type or "secret",
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
        affected_envs = {}

        # Defer per-secret sync triggering (trigger_sync=False) and trigger once
        # per affected environment afterwards, so a bulk write fires each env's
        # sync jobs + reference scan a single time instead of once per secret.
        try:
            for secret_data in secrets_data:
                env = Environment.objects.get(id=secret_data.env_id)
                org = env.app.organisation

                if not user_has_permission(
                    info.context.user, "create", "Secrets", org, True, app=env.app
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
                    folder = create_environment_folder_structure(
                        path, secret_data.env_id
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
                    "type": secret_data.type or "secret",
                }

                secret = Secret(**secret_obj_data)
                secret.save(force_insert=True, trigger_sync=False)
                secret.tags.set(tags)
                created_secrets.append(secret)
                affected_envs[env.id] = env
        finally:
            for env in affected_envs.values():
                env.save()

        if created_secrets:
            ip_address, user_agent = get_resolver_request_meta(info.context)
            org_member = OrganisationMember.objects.get(
                user=info.context.user,
                organisation=created_secrets[0].environment.app.organisation,
                deleted_at=None,
            )
            log_secret_events_bulk(
                created_secrets,
                SecretEvent.CREATE,
                org_member,
                None,
                None,
                ip_address,
                user_agent,
            )

        return BulkCreateSecretMutation(secrets=created_secrets)


def _sync_rotating_key_map(secret, new_encrypted_key, new_key_digest):
    """Mirror a rotating row's renamed key into its parent RotatingSecret.key_map."""
    if not secret.rotating_output_id or not new_encrypted_key:
        return
    if new_encrypted_key == secret.key and new_key_digest == secret.key_digest:
        return

    rotating_secret = secret.rotating_secret
    key_map = list(rotating_secret.key_map or [])

    for other in key_map:
        if other.get("id") == secret.rotating_output_id:
            continue
        other_digest = other.get("key_digest") or other.get("keyDigest")
        if other_digest and other_digest == new_key_digest:
            raise GraphQLError(
                "Another output in this rotating secret already uses that key."
            )

    updated = False
    for entry in key_map:
        if entry.get("id") == secret.rotating_output_id:
            entry["key_name"] = new_encrypted_key
            entry["key_digest"] = new_key_digest
            if "keyDigest" in entry:
                entry["keyDigest"] = new_key_digest
            updated = True
            break

    if updated:
        rotating_secret.key_map = key_map
        rotating_secret.save(update_fields=["key_map", "updated_at"])


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

        if not user_has_permission(info.context.user, "update", "Secrets", org, True, app=env.app):
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

        # Enforce seal permanence
        if secret.type == "sealed" and secret_data.type is not None and secret_data.type != "sealed":
            raise GraphQLError("Sealed secrets cannot be unsealed. Delete and recreate the secret instead.")

        secret_obj_data = {
            "path": path,
            "key": secret_data.key,
            "key_digest": secret_data.key_digest,
            "value": secret_data.value,
            "version": secret.version + 1,
            "comment": secret_data.comment,
        }

        # For sealed secrets, preserve existing encrypted value (UI sends "" since it never received it)
        if secret.type == "sealed":
            secret_obj_data["value"] = secret.value

        # Rotating-owned rows: engine owns value/path; key can be renamed
        # (we sync key_map below). value/path stay frozen.
        if secret.rotating_secret_id is not None:
            secret_obj_data["path"] = secret.path
            secret_obj_data["value"] = secret.value
            _sync_rotating_key_map(secret, secret_obj_data["key"], secret_obj_data["key_digest"])

        # Set type if provided (and not already sealed)
        if secret_data.type is not None:
            secret_obj_data["type"] = secret_data.type

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
        affected_envs = {}

        # Defer per-secret sync triggering; trigger once per env afterwards.
        try:
            for secret_data in secrets_data:
                secret = Secret.objects.get(id=secret_data.id)
                env = secret.environment
                org = env.app.organisation

                if not user_has_permission(
                    info.context.user, "create", "Secrets", org, True, app=env.app
                ):
                    raise GraphQLError(
                        "You don't have permission to update secrets in this organisation"
                    )

                if not user_can_access_environment(info.context.user.userId, env.id):
                    raise GraphQLError("You don't have access to this environment")

                # Enforce seal permanence
                if secret.type == "sealed" and secret_data.type is not None and secret_data.type != "sealed":
                    raise GraphQLError("Sealed secrets cannot be unsealed. Delete and recreate the secret instead.")

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

                # For sealed secrets, preserve existing encrypted value
                if secret.type == "sealed":
                    secret_obj_data["value"] = secret.value

                # Rotating-owned rows: engine owns value/path; key can be renamed
                # (we sync key_map below). value/path stay frozen.
                if secret.rotating_secret_id is not None:
                    secret_obj_data["path"] = secret.path
                    secret_obj_data["value"] = secret.value
                    _sync_rotating_key_map(secret, secret_obj_data["key"], secret_obj_data["key_digest"])

                # Set type if provided (and not already sealed)
                if secret_data.type is not None:
                    secret_obj_data["type"] = secret_data.type

                for key, value in secret_obj_data.items():
                    setattr(secret, key, value)

                secret.updated_at = timezone.now()
                secret.tags.set(tags)
                secret.save(trigger_sync=False)
                updated_secrets.append(secret)
                affected_envs[env.id] = env
        finally:
            for env in affected_envs.values():
                env.save()

        if updated_secrets:
            ip_address, user_agent = get_resolver_request_meta(info.context)
            org_member = OrganisationMember.objects.get(
                user=info.context.user,
                organisation=updated_secrets[0].environment.app.organisation,
                deleted_at=None,
            )
            log_secret_events_bulk(
                updated_secrets,
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

        if not user_has_permission(info.context.user, "delete", "Secrets", org, True, app=env.app):
            raise GraphQLError(
                "You don't have permission to delete secrets in this organisation"
            )

        if not user_can_access_environment(info.context.user.userId, env.id):
            raise GraphQLError("You don't have access to this environment")

        if secret.rotating_secret_id is not None:
            raise GraphQLError(
                "Rotating secrets must be deleted from the manage dialog."
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
        affected_envs = {}

        # Defer per-secret sync triggering; trigger once per env afterwards.
        try:
            for id in ids:
                secret = Secret.objects.get(id=id)
                env = secret.environment
                org = env.app.organisation

                if not user_has_permission(
                    info.context.user, "delete", "Secrets", org, True, app=env.app
                ):
                    raise GraphQLError(
                        "You don't have permission to delete secrets in this organisation"
                    )

                if not user_can_access_environment(info.context.user.userId, env.id):
                    raise GraphQLError("You don't have access to this environment")

                if secret.rotating_secret_id is not None:
                    raise GraphQLError(
                        "Rotating secrets must be deleted from the manage dialog."
                    )

                secret.updated_at = timezone.now()
                secret.deleted_at = timezone.now()
                secret.save(trigger_sync=False)
                deleted_secrets.append(secret)
                affected_envs[env.id] = env
        finally:
            for env in affected_envs.values():
                env.save()

        if deleted_secrets:
            ip_address, user_agent = get_resolver_request_meta(info.context)
            org_member = OrganisationMember.objects.get(
                user=info.context.user,
                organisation=deleted_secrets[0].environment.app.organisation,
                deleted_at=None,
            )
            log_secret_events_bulk(
                deleted_secrets,
                SecretEvent.DELETE,
                org_member,
                None,
                None,
                ip_address,
                user_agent,
            )

        return BulkDeleteSecretMutation(secrets=deleted_secrets)


class ReadSecretMutation(graphene.Mutation):
    # SSO middleware reads this to resolve org from the bare `ids`
    # kwarg (output is `ok`, no model implicit in return type).
    org_resource_model = "Secret"

    class Arguments:
        ids = graphene.List(graphene.ID)

    ok = graphene.Boolean()

    @classmethod
    def mutate(cls, root, info, ids):
        secrets = []
        for id in ids:
            try:
                secret = Secret.objects.get(id=id)
            except Secret.DoesNotExist:
                continue
            if not user_can_access_environment(
                info.context.user.userId, secret.environment.id
            ):
                raise GraphQLError("You don't have permission to perform this action")
            secrets.append(secret)

        if secrets:
            ip_address, user_agent = get_resolver_request_meta(info.context)
            org_member = OrganisationMember.objects.get(
                user=info.context.user,
                organisation=secrets[0].environment.app.organisation,
                deleted_at=None,
            )
            log_secret_events_bulk(
                secrets,
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
