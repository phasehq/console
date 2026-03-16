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
    Environment,
    EnvironmentKey,
    Organisation,
    OrganisationMember,
    Role,
    ServiceAccount,
)
from backend.graphene.types import AppType, MemberType
from api.utils.audit_logging import log_audit_event, get_actor_info_from_graphql
from api.utils.rest import get_resolver_request_meta
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

        actor_type, actor_id, actor_metadata = get_actor_info_from_graphql(info)
        ip_address, user_agent = get_resolver_request_meta(info.context)
        log_audit_event(
            organisation=org,
            event_type="C",
            resource_type="app",
            resource_id=app.id,
            actor_type=actor_type,
            actor_id=actor_id,
            actor_metadata=actor_metadata,
            resource_metadata={"name": name},
            description=f"Created app '{name}'",
            ip_address=ip_address,
            user_agent=user_agent,
        )

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

        old_name = app.name
        old_description = app.description

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

        old_values = {}
        new_values = {}
        if name is not None and name != old_name:
            old_values["name"] = old_name
            new_values["name"] = name
        if description is not None and description != old_description:
            old_values["description"] = old_description
            new_values["description"] = description

        actor_type, actor_id, actor_metadata = get_actor_info_from_graphql(info)
        ip_address, user_agent = get_resolver_request_meta(info.context)
        log_audit_event(
            organisation=app.organisation,
            event_type="U",
            resource_type="app",
            resource_id=app.id,
            actor_type=actor_type,
            actor_id=actor_id,
            actor_metadata=actor_metadata,
            resource_metadata={"name": app.name},
            old_values=old_values or None,
            new_values=new_values or None,
            description=f"Updated app '{app.name}'",
            ip_address=ip_address,
            user_agent=user_agent,
        )

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

        app_name = app.name
        app_id = app.id
        app_org = app.organisation

        app.wrapped_key_share = ""
        app.save()
        app.delete()

        actor_type, actor_id, actor_metadata = get_actor_info_from_graphql(info)
        ip_address, user_agent = get_resolver_request_meta(info.context)
        log_audit_event(
            organisation=app_org,
            event_type="D",
            resource_type="app",
            resource_id=app_id,
            actor_type=actor_type,
            actor_id=actor_id,
            actor_metadata=actor_metadata,
            resource_metadata={"name": app_name},
            description=f"Deleted app '{app_name}'",
            ip_address=ip_address,
            user_agent=user_agent,
        )

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

        actor_type, actor_id, actor_metadata = get_actor_info_from_graphql(info)
        ip_address, user_agent = get_resolver_request_meta(info.context)

        # Build per-member details with names and env scopes
        members_detail = []
        for member_input in members:
            mid = member_input.member_id
            mtype = member_input.member_type
            env_ids = [k.env_id for k in member_input.env_keys]
            env_names = sorted(
                Environment.objects.filter(id__in=env_ids).values_list("name", flat=True)
            )
            if mtype == MemberType.USER:
                m = OrganisationMember.objects.filter(id=mid, deleted_at=None).first()
                mname = (m.user.username or m.user.email or str(mid)) if m else str(mid)
            else:
                m = ServiceAccount.objects.filter(id=mid, deleted_at=None).first()
                mname = m.name if m else str(mid)
            members_detail.append({
                "id": str(mid),
                "name": mname,
                "type": mtype.value if hasattr(mtype, 'value') else str(mtype),
                "env_scope": env_names,
            })

        log_audit_event(
            organisation=app.organisation,
            event_type="A",
            resource_type="app",
            resource_id=app.id,
            actor_type=actor_type,
            actor_id=actor_id,
            actor_metadata=actor_metadata,
            resource_metadata={"name": app.name},
            new_values={"members_added": members_detail},
            description=f"Added {len(members)} member(s) to app '{app.name}'",
            ip_address=ip_address,
            user_agent=user_agent,
        )

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

        # Resolve member name and initial env scope for audit log
        if member_type == MemberType.USER:
            member_name = member.user.username or member.user.email or str(member_id)
        else:
            member_name = member.name

        env_ids = [key.env_id for key in env_keys]
        env_names = sorted(
            Environment.objects.filter(id__in=env_ids).values_list("name", flat=True)
        )

        actor_type, actor_id, actor_metadata = get_actor_info_from_graphql(info)
        ip_address, user_agent = get_resolver_request_meta(info.context)
        log_audit_event(
            organisation=app.organisation,
            event_type="A",
            resource_type="app",
            resource_id=app.id,
            actor_type=actor_type,
            actor_id=actor_id,
            actor_metadata=actor_metadata,
            resource_metadata={"name": app.name},
            new_values={
                "member_id": str(member_id),
                "member_name": member_name,
                "member_type": member_type.value if hasattr(member_type, 'value') else str(member_type),
                "env_scope": env_names,
            },
            description=f"Added {member_name} to app '{app.name}'",
            ip_address=ip_address,
            user_agent=user_agent,
        )

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

        # Capture member name and env scope before removal
        if member_type == MemberType.USER:
            member_name = member.user.username or member.user.email or str(member_id)
            env_scope_qs = EnvironmentKey.objects.filter(environment__app=app, user_id=member_id)
        else:
            member_name = member.name
            env_scope_qs = EnvironmentKey.objects.filter(environment__app=app, service_account_id=member_id)

        env_names = sorted(
            Environment.objects.filter(
                id__in=env_scope_qs.values_list("environment_id", flat=True)
            ).values_list("name", flat=True)
        )

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

        actor_type, actor_id, actor_metadata = get_actor_info_from_graphql(info)
        ip_address, user_agent = get_resolver_request_meta(info.context)
        log_audit_event(
            organisation=app.organisation,
            event_type="A",
            resource_type="app",
            resource_id=app.id,
            actor_type=actor_type,
            actor_id=actor_id,
            actor_metadata=actor_metadata,
            resource_metadata={"name": app.name},
            old_values={
                "members_removed": [{
                    "id": str(member_id),
                    "name": member_name,
                    "type": member_type.value if hasattr(member_type, 'value') else str(member_type),
                    "env_scope": env_names,
                }],
            },
            description=f"Removed {member_name} from app '{app.name}'",
            ip_address=ip_address,
            user_agent=user_agent,
        )

        return RemoveAppMemberMutation(app=app)
