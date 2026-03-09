from backend.api.kv import delete, purge
from backend.graphene.mutations.environment import EnvironmentKeyInput
from api.utils.access.permissions import (
    user_can_access_app,
    user_has_permission,
    user_is_org_member,
)
import graphene
from graphql import GraphQLError
from api.models import (
    App,
    EnvironmentKey,
    Organisation,
    OrganisationMember,
    Role,
    ServiceAccount,
)
from backend.graphene.types import AppType, MemberType
from django.conf import settings
from django.db.models import Q

CLOUD_HOSTED = settings.APP_HOST == "cloud"


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
    def mutate(
        cls,
        root,
        info,
        id,
        organisation_id,
        name,
        identity_key,
        app_token,
        app_seed,
        wrapped_key_share,
        app_version,
    ):
        user = info.context.user
        org = Organisation.objects.get(id=organisation_id)
        if not user_is_org_member(user.userId, organisation_id):
            raise GraphQLError("You don't have access to this organisation")

        if not user_has_permission(info.context.user, "create", "Apps", org):
            raise GraphQLError("You don't have permission to create Apps")

        if App.objects.filter(identity_key=identity_key).exists():
            raise GraphQLError("This app already exists")

        app = App.objects.create(
            id=id,
            organisation=org,
            name=name,
            identity_key=identity_key,
            app_token=app_token,
            app_seed=app_seed,
            wrapped_key_share=wrapped_key_share,
            app_version=app_version,
        )

        org_member = OrganisationMember.objects.get(
            organisation=org, user=info.context.user, deleted_at=None
        )
        org_member.apps.add(app)

        admin_roles = Role.objects.filter(
            Q(organisation_id=organisation_id)
            & (Q(name__iexact="owner") | Q(name__iexact="admin"))
        )

        org_admins = org.users.filter(role__in=admin_roles)
        for admin in org_admins:
            admin.apps.add(app)

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
                f"phApp:v{app.app_version}:{app.identity_key}/{app.app_token}"
            )

            if not deleted or not purged:
                raise GraphQLError("Failed to delete app keys. Please try again.")

        app.app_token = app_token
        app.wrapped_key_share = wrapped_key_share
        app.save()

        return RotateAppKeysMutation(app=app)


class UpdateAppInfoMutation(graphene.Mutation):
    class Arguments:
        id = graphene.ID(required=True)
        name = graphene.String(required=False)
        description = graphene.String(required=False)

    app = graphene.Field(AppType)

    @classmethod
    def mutate(cls, root, info, id, name=None, description=None):
        user = info.context.user
        app = App.objects.get(id=id)

        if not user_can_access_app(user.userId, app.id):
            raise GraphQLError("You don't have access to this app")

        if not user_has_permission(
            info.context.user, "update", "Apps", app.organisation
        ):
            raise GraphQLError("You don't have permission to update Apps")

        if name is not None:
            # Validate name is not blank
            if not name or name.strip() == "":
                raise GraphQLError("App name cannot be blank")

            # Validate name length
            if len(name) > 64:
                raise GraphQLError("App name cannot exceed 64 characters")

            app.name = name

        if description is not None:
            if len(description) > 10000:
                raise GraphQLError("App description cannot exceed 10,000 characters")

            app.description = description

        app.save()

        return UpdateAppInfoMutation(app=app)


class DeleteAppMutation(graphene.Mutation):
    class Arguments:
        id = graphene.ID(required=True)

    ok = graphene.Boolean()

    @classmethod
    def mutate(cls, root, info, id):
        user = info.context.user
        app = App.objects.get(id=id)

        if not user_can_access_app(user.userId, app.id):
            raise GraphQLError("You don't have access to this app")

        if not user_has_permission(
            info.context.user, "delete", "Apps", app.organisation
        ):
            raise GraphQLError("You don't have permission to delete Apps")

        if CLOUD_HOSTED:
            # delete current keys from cloudflare KV
            deleted = delete(app.app_token)

            # purge keys from cloudflare cache
            purged = purge(
                f"phApp:v{app.app_version}:{app.identity_key}/{app.app_token}"
            )

            if not deleted or not purged:
                raise GraphQLError("Failed to delete app keys. Please try again.")

        app.wrapped_key_share = ""
        app.save()
        app.delete()

        return DeleteAppMutation(ok=True)


class AppMemberInputType(graphene.InputObjectType):
    member_id = graphene.ID(required=True)
    member_type = MemberType(required=False, default_value=MemberType.USER)
    env_keys = graphene.List(EnvironmentKeyInput, required=True)


class BulkAddAppMembersMutation(graphene.Mutation):
    class Arguments:
        app_id = graphene.ID(required=True)
        members = graphene.List(AppMemberInputType, required=True)

    app = graphene.Field(AppType)

    @classmethod
    def mutate(cls, root, info, app_id, members):
        user = info.context.user
        app = App.objects.get(id=app_id)

        if not user_can_access_app(user.userId, app.id):
            raise GraphQLError("You don't have access to this app")

        for member_input in members:
            member_id = member_input.member_id
            member_type = member_input.member_type
            env_keys = member_input.env_keys

            if member_type == MemberType.USER:
                permission_key = "Members"
                member = OrganisationMember.objects.get(id=member_id, deleted_at=None)
            else:
                permission_key = "ServiceAccounts"
                member = ServiceAccount.objects.get(id=member_id, deleted_at=None)

            if not user_has_permission(
                user, "create", permission_key, app.organisation, True
            ):
                raise GraphQLError(
                    f"You don't have permission to add {member_type.lower()}s to this App"
                )

            if member_type == MemberType.USER:
                app.members.add(member)
            else:
                app.service_accounts.add(member)

            for key in env_keys:
                defaults = {
                    "wrapped_seed": key.wrapped_seed,
                    "wrapped_salt": key.wrapped_salt,
                    "identity_key": key.identity_key,
                }

                condition = {
                    "environment_id": key.env_id,
                    "user_id": key.user_id if member_type == MemberType.USER else None,
                    "service_account_id": (
                        key.user_id if member_type == MemberType.SERVICE else None
                    ),
                }

                EnvironmentKey.objects.update_or_create(**condition, defaults=defaults)

        return BulkAddAppMembersMutation(app=app)


class AddAppMemberMutation(graphene.Mutation):
    class Arguments:
        member_id = graphene.ID()
        app_id = graphene.ID()
        env_keys = graphene.List(EnvironmentKeyInput)
        member_type = MemberType(required=False)

    app = graphene.Field(AppType)

    @classmethod
    def mutate(
        cls, root, info, member_id, app_id, env_keys, member_type=MemberType.USER
    ):
        user = info.context.user
        app = App.objects.get(id=app_id)

        if member_type == MemberType.USER:
            permission_key = "Members"
            member = OrganisationMember.objects.get(id=member_id, deleted_at=None)
        else:
            permission_key = "ServiceAccounts"
            member = ServiceAccount.objects.get(id=member_id, deleted_at=None)

        if not user_has_permission(
            info.context.user, "create", permission_key, app.organisation, True
        ):
            raise GraphQLError("You don't have permission to add members to this App")

        if not user_can_access_app(user.userId, app.id):
            raise GraphQLError("You don't have access to this app")

        if member_type == MemberType.USER:
            app.members.add(member)
        else:
            app.service_accounts.add(member)

        # Create new env keys
        for key in env_keys:
            defaults = {
                "wrapped_seed": key.wrapped_seed,
                "wrapped_salt": key.wrapped_salt,
                "identity_key": key.identity_key,
            }

            condition = {
                "environment_id": key.env_id,
                "user_id": key.user_id if member_type == MemberType.USER else None,
                "service_account_id": (
                    key.user_id if member_type == MemberType.SERVICE else None
                ),
            }

            EnvironmentKey.objects.update_or_create(**condition, defaults=defaults)

        return AddAppMemberMutation(app=app)


class RemoveAppMemberMutation(graphene.Mutation):
    class Arguments:
        member_id = graphene.ID()
        app_id = graphene.ID()
        member_type = MemberType(required=False)  # Add member_type argument

    app = graphene.Field(AppType)

    @classmethod
    def mutate(cls, root, info, member_id, app_id, member_type=MemberType.USER):
        user = info.context.user
        app = App.objects.get(id=app_id)

        if member_type == MemberType.USER:
            permission_key = "Members"
        else:
            permission_key = "ServiceAccounts"

        if not user_has_permission(
            info.context.user, "delete", permission_key, app.organisation, True
        ):
            raise GraphQLError(
                f"You don't have permission to remove {permission_key} from this App"
            )

        if not user_can_access_app(user.userId, app.id):
            raise GraphQLError("You don't have access to this app")

        member = None
        if member_type == MemberType.USER:
            member = OrganisationMember.objects.get(id=member_id)
        elif member_type == MemberType.SERVICE:
            member = ServiceAccount.objects.get(id=member_id)

        if not member:
            raise GraphQLError("Invalid member type or ID")

        if member_type == MemberType.USER:
            if member not in app.members.all():
                raise GraphQLError("This user is not a member of this app")

            app.members.remove(member)
            EnvironmentKey.objects.filter(
                environment__app=app, user_id=member_id
            ).delete()

        elif member_type == MemberType.SERVICE:
            if member not in app.service_accounts.all():
                raise GraphQLError("This service account is not a member of this app")

            app.service_accounts.remove(member)
            EnvironmentKey.objects.filter(
                environment__app=app, service_account_id=member_id
            ).delete()

        return RemoveAppMemberMutation(app=app)
