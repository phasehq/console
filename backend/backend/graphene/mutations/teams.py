import graphene
from graphql import GraphQLError
from django.utils import timezone
from api.models import (
    App,
    Environment,
    Organisation,
    OrganisationMember,
    Role,
    ServiceAccount,
    ServiceAccountToken,
    Team,
    TeamAppEnvironment,
    TeamMembership,
)
from api.utils.access.permissions import (
    user_can_access_app,
    user_has_permission,
    user_is_org_member,
    user_is_team_member,
)
from api.utils.keys import (
    provision_team_environment_keys,
    revoke_team_environment_keys,
)
from backend.quotas import can_use_teams
from backend.graphene.types import TeamType, MemberType


def _get_org_member(user, org):
    """Get the requesting user's OrganisationMember."""
    return OrganisationMember.objects.get(
        user=user, organisation=org, deleted_at=None
    )


def _check_team_membership(user, team):
    """Verify the user is a member of the team or has global access (Owner/Admin)."""
    if not user_is_team_member(user.userId, team.id):
        raise GraphQLError("You don't have access to this team")


class CreateTeamMutation(graphene.Mutation):
    class Arguments:
        organisation_id = graphene.ID(required=True)
        name = graphene.String(required=True)
        description = graphene.String(required=False)
        member_role_id = graphene.ID(required=False)
        service_account_role_id = graphene.ID(required=False)

    team = graphene.Field(TeamType)

    @classmethod
    def mutate(
        cls,
        root,
        info,
        organisation_id,
        name,
        description=None,
        member_role_id=None,
        service_account_role_id=None,
    ):
        user = info.context.user
        org = Organisation.objects.get(id=organisation_id)

        if not user_is_org_member(user.userId, organisation_id):
            raise GraphQLError("You don't have access to this organisation")

        if not user_has_permission(user, "create", "Teams", org):
            raise GraphQLError("You don't have permission to create Teams")

        if not can_use_teams(org):
            raise GraphQLError(
                "Teams require a Pro or Enterprise plan. Please upgrade to use this feature."
            )

        if not name or not name.strip():
            raise GraphQLError("Team name cannot be blank")
        if len(name) > 64:
            raise GraphQLError("Team name cannot exceed 64 characters")

        member_role = None
        if member_role_id:
            member_role = Role.objects.get(id=member_role_id, organisation=org)

        sa_role = None
        if service_account_role_id:
            sa_role = Role.objects.get(id=service_account_role_id, organisation=org)

        org_member = _get_org_member(user, org)

        team = Team.objects.create(
            name=name.strip(),
            description=description,
            organisation=org,
            member_role=member_role,
            service_account_role=sa_role,
            created_by=org_member,
        )

        # Auto-add the creator as a team member
        TeamMembership.objects.create(team=team, org_member=org_member)

        return CreateTeamMutation(team=team)


class UpdateTeamMutation(graphene.Mutation):
    class Arguments:
        team_id = graphene.ID(required=True)
        name = graphene.String(required=False)
        description = graphene.String(required=False)
        member_role_id = graphene.ID(required=False)
        service_account_role_id = graphene.ID(required=False)

    team = graphene.Field(TeamType)

    @classmethod
    def mutate(
        cls,
        root,
        info,
        team_id,
        name=None,
        description=None,
        member_role_id=None,
        service_account_role_id=None,
    ):
        user = info.context.user
        team = Team.objects.get(id=team_id, deleted_at__isnull=True)
        org = team.organisation

        if not user_is_org_member(user.userId, org.id):
            raise GraphQLError("You don't have access to this organisation")

        if not user_has_permission(user, "update", "Teams", org):
            raise GraphQLError("You don't have permission to update Teams")

        _check_team_membership(user, team)

        if team.is_scim_managed:
            raise GraphQLError(
                "This team is managed by SCIM and cannot be manually updated"
            )

        if name is not None:
            if not name or not name.strip():
                raise GraphQLError("Team name cannot be blank")
            if len(name) > 64:
                raise GraphQLError("Team name cannot exceed 64 characters")
            team.name = name.strip()

        if description is not None:
            team.description = description

        if member_role_id is not None:
            if member_role_id == "":
                team.member_role = None
            else:
                team.member_role = Role.objects.get(
                    id=member_role_id, organisation=org
                )

        if service_account_role_id is not None:
            if service_account_role_id == "":
                team.service_account_role = None
            else:
                team.service_account_role = Role.objects.get(
                    id=service_account_role_id, organisation=org
                )

        team.save()
        return UpdateTeamMutation(team=team)


class DeleteTeamMutation(graphene.Mutation):
    class Arguments:
        team_id = graphene.ID(required=True)

    ok = graphene.Boolean()

    @classmethod
    def mutate(cls, root, info, team_id):
        user = info.context.user
        team = Team.objects.get(id=team_id, deleted_at__isnull=True)
        org = team.organisation

        if not user_is_org_member(user.userId, org.id):
            raise GraphQLError("You don't have access to this organisation")

        if not user_has_permission(user, "delete", "Teams", org):
            raise GraphQLError("You don't have permission to delete Teams")

        _check_team_membership(user, team)

        # Revoke all team environment key grants
        revoke_team_environment_keys(team)

        # Soft-delete team-owned service accounts and their tokens
        now = timezone.now()
        for sa in ServiceAccount.objects.filter(team=team, deleted_at__isnull=True):
            sa.deleted_at = now
            sa.save()
            ServiceAccountToken.objects.filter(
                service_account=sa, deleted_at__isnull=True
            ).update(deleted_at=now)

        team.deleted_at = timezone.now()
        team.save()

        return DeleteTeamMutation(ok=True)


class AddTeamMembersMutation(graphene.Mutation):
    class Arguments:
        team_id = graphene.ID(required=True)
        member_ids = graphene.List(graphene.NonNull(graphene.ID), required=True)
        member_type = MemberType(required=False, default_value=MemberType.USER)

    team = graphene.Field(TeamType)

    @classmethod
    def mutate(cls, root, info, team_id, member_ids, member_type=MemberType.USER):
        user = info.context.user
        team = Team.objects.get(id=team_id, deleted_at__isnull=True)
        org = team.organisation

        if not user_is_org_member(user.userId, org.id):
            raise GraphQLError("You don't have access to this organisation")

        if not user_has_permission(user, "update", "Teams", org):
            raise GraphQLError("You don't have permission to manage Teams")

        _check_team_membership(user, team)

        if team.is_scim_managed:
            raise GraphQLError(
                "This team is managed by SCIM. Members cannot be manually added."
            )

        new_memberships = []
        for mid in member_ids:
            if member_type == MemberType.USER:
                member = OrganisationMember.objects.get(
                    id=mid, organisation=org, deleted_at=None
                )
                if TeamMembership.objects.filter(
                    team=team, org_member=member
                ).exists():
                    continue
                tm = TeamMembership.objects.create(team=team, org_member=member)
            else:
                sa = ServiceAccount.objects.get(
                    id=mid, organisation=org, deleted_at=None
                )
                if TeamMembership.objects.filter(
                    team=team, service_account=sa
                ).exists():
                    continue
                tm = TeamMembership.objects.create(team=team, service_account=sa)
            new_memberships.append(tm)

        # Provision environment keys for new members on all team apps
        if new_memberships:
            app_ids = (
                TeamAppEnvironment.objects.filter(team=team)
                .values_list("app_id", flat=True)
                .distinct()
            )
            for app_id in app_ids:
                app = App.objects.get(id=app_id)
                if app.sse_enabled:
                    provision_team_environment_keys(
                        team, app, members=new_memberships
                    )

        return AddTeamMembersMutation(team=team)


class RemoveTeamMemberMutation(graphene.Mutation):
    class Arguments:
        team_id = graphene.ID(required=True)
        member_id = graphene.ID(required=True)
        member_type = MemberType(required=False, default_value=MemberType.USER)

    team = graphene.Field(TeamType)

    @classmethod
    def mutate(cls, root, info, team_id, member_id, member_type=MemberType.USER):
        user = info.context.user
        team = Team.objects.get(id=team_id, deleted_at__isnull=True)
        org = team.organisation

        if not user_is_org_member(user.userId, org.id):
            raise GraphQLError("You don't have access to this organisation")

        if not user_has_permission(user, "update", "Teams", org):
            raise GraphQLError("You don't have permission to manage Teams")

        _check_team_membership(user, team)

        if team.is_scim_managed:
            raise GraphQLError(
                "This team is managed by SCIM. Members cannot be manually removed."
            )

        if member_type == MemberType.USER:
            member = OrganisationMember.objects.get(id=member_id, deleted_at=None)
            membership = TeamMembership.objects.get(team=team, org_member=member)
            revoke_team_environment_keys(team, member=member)
        else:
            member = ServiceAccount.objects.get(id=member_id, deleted_at=None)
            # Block removing a team-owned SA from its owning team
            if member.team_id == team.id:
                raise GraphQLError(
                    "This service account is owned by this team and cannot be removed. "
                    "Delete the service account instead, or transfer ownership first."
                )
            membership = TeamMembership.objects.get(team=team, service_account=member)
            revoke_team_environment_keys(team, member=member)

        membership.delete()

        return RemoveTeamMemberMutation(team=team)


class AppEnvironmentInput(graphene.InputObjectType):
    app_id = graphene.ID(required=True)
    env_ids = graphene.List(graphene.NonNull(graphene.ID), required=True)


class AddTeamAppsMutation(graphene.Mutation):
    class Arguments:
        team_id = graphene.ID(required=True)
        app_envs = graphene.List(
            graphene.NonNull(AppEnvironmentInput), required=True
        )

    team = graphene.Field(TeamType)

    @classmethod
    def mutate(cls, root, info, team_id, app_envs):
        user = info.context.user
        team = Team.objects.get(id=team_id, deleted_at__isnull=True)
        org = team.organisation

        if not user_is_org_member(user.userId, org.id):
            raise GraphQLError("You don't have access to this organisation")

        if not user_has_permission(user, "update", "Teams", org):
            raise GraphQLError("You don't have permission to manage Teams")

        _check_team_membership(user, team)

        for app_env in app_envs:
            app = App.objects.get(id=app_env.app_id, organisation=org)

            # Actor must have access to the app
            if not user_can_access_app(user.userId, app.id):
                raise GraphQLError(
                    f"You don't have access to app '{app.name}'"
                )

            # Team access requires SSE
            if not app.sse_enabled:
                raise GraphQLError(
                    f"App '{app.name}' does not have server-side encryption enabled. "
                    "Team-based access requires SSE."
                )

            for env_id in app_env.env_ids:
                env = Environment.objects.get(id=env_id, app=app)
                TeamAppEnvironment.objects.get_or_create(
                    team=team, app=app, environment=env
                )

            # Provision keys for all team members
            provision_team_environment_keys(team, app)

        return AddTeamAppsMutation(team=team)


class RemoveTeamAppMutation(graphene.Mutation):
    class Arguments:
        team_id = graphene.ID(required=True)
        app_id = graphene.ID(required=True)

    team = graphene.Field(TeamType)

    @classmethod
    def mutate(cls, root, info, team_id, app_id):
        user = info.context.user
        team = Team.objects.get(id=team_id, deleted_at__isnull=True)
        org = team.organisation

        if not user_is_org_member(user.userId, org.id):
            raise GraphQLError("You don't have access to this organisation")

        if not user_has_permission(user, "update", "Teams", org):
            raise GraphQLError("You don't have permission to manage Teams")

        _check_team_membership(user, team)

        app = App.objects.get(id=app_id, organisation=org)

        # Revoke grants before removing the app-env links
        revoke_team_environment_keys(team, app=app)

        TeamAppEnvironment.objects.filter(team=team, app=app).delete()

        return RemoveTeamAppMutation(team=team)


class UpdateTeamAppEnvironmentsMutation(graphene.Mutation):
    class Arguments:
        team_id = graphene.ID(required=True)
        app_id = graphene.ID(required=True)
        env_ids = graphene.List(graphene.NonNull(graphene.ID), required=True)

    team = graphene.Field(TeamType)

    @classmethod
    def mutate(cls, root, info, team_id, app_id, env_ids):
        user = info.context.user
        team = Team.objects.get(id=team_id, deleted_at__isnull=True)
        org = team.organisation

        if not user_is_org_member(user.userId, org.id):
            raise GraphQLError("You don't have access to this organisation")

        if not user_has_permission(user, "update", "Teams", org):
            raise GraphQLError("You don't have permission to manage Teams")

        _check_team_membership(user, team)

        app = App.objects.get(id=app_id, organisation=org)

        if not user_can_access_app(user.userId, app.id):
            raise GraphQLError("You don't have access to this app")

        if not app.sse_enabled:
            raise GraphQLError(
                "Team-based access requires server-side encryption."
            )

        # Determine which environments to add/remove
        current_env_ids = set(
            TeamAppEnvironment.objects.filter(team=team, app=app).values_list(
                "environment_id", flat=True
            )
        )
        new_env_ids = set(env_ids)

        # Validate all new env_ids belong to this app
        valid_env_ids = set(
            Environment.objects.filter(
                id__in=new_env_ids, app=app
            ).values_list("id", flat=True)
        )
        invalid = new_env_ids - valid_env_ids
        if invalid:
            raise GraphQLError(
                "Some environment IDs do not belong to this app"
            )

        to_remove = current_env_ids - new_env_ids
        to_add = new_env_ids - current_env_ids

        # Remove environments no longer in scope
        if to_remove:
            envs_to_remove = Environment.objects.filter(id__in=to_remove)
            revoke_team_environment_keys(team, app=app, environments=envs_to_remove)
            TeamAppEnvironment.objects.filter(
                team=team, app=app, environment_id__in=to_remove
            ).delete()

        # Add new environments
        for env_id in to_add:
            env = Environment.objects.get(id=env_id, app=app)
            TeamAppEnvironment.objects.get_or_create(
                team=team, app=app, environment=env
            )

        # Provision keys for newly added environments
        if to_add:
            provision_team_environment_keys(team, app)

        return UpdateTeamAppEnvironmentsMutation(team=team)
