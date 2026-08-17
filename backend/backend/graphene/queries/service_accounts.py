from api.utils.access.permissions import (
    role_has_global_access,
    user_can_access_app,
    user_has_permission,
    user_is_org_member,
)
from api.utils.access.roles import default_roles
from api.models import App, Organisation, OrganisationMember, Role, ServiceAccount, TeamMembership
from .access import resolve_organisation_global_access_users
from django.db.models import Q
from graphql import GraphQLError


def resolve_service_accounts(root, info, org_id, service_account_id=None):
    org = Organisation.objects.get(id=org_id)

    has_org_permission = user_has_permission(info.context.user.userId, "read", "ServiceAccounts", org)

    # Team-based access: if requesting a specific SA, allow access if user shares a team with it
    has_team_access = False
    if not has_org_permission and service_account_id is not None:
        try:
            org_member = OrganisationMember.objects.get(
                user=info.context.user, organisation=org, deleted_at=None
            )
            user_team_ids = TeamMembership.objects.filter(
                org_member=org_member,
                team__deleted_at__isnull=True,
            ).values_list("team_id", flat=True)
            has_team_access = ServiceAccount.objects.filter(
                id=service_account_id,
                deleted_at=None,
                team_id__in=user_team_ids,
            ).exists() or TeamMembership.objects.filter(
                service_account_id=service_account_id,
                team_id__in=user_team_ids,
            ).exists()
        except OrganisationMember.DoesNotExist:
            pass

    if not (has_org_permission or has_team_access):
        # No org-level perm and no team-based access — empty queryset
        # (not None) so the GraphQL field returns [] rather than null.
        return ServiceAccount.objects.none()

    filter = {"organisation": org, "deleted_at": None}

    if service_account_id is not None:
        filter["id"] = service_account_id

    qs = ServiceAccount.objects.filter(**filter)

    # Non-global-access users: scope to org-level SAs + SAs in their teams
    org_member = OrganisationMember.objects.get(
        user=info.context.user, organisation=org, deleted_at=None
    )
    if not role_has_global_access(org_member.role):
        user_team_ids = TeamMembership.objects.filter(
            org_member=org_member,
            team__deleted_at__isnull=True,
        ).values_list("team_id", flat=True)
        if has_org_permission:
            # Org permission: see org-level + team-scoped SAs in user's teams
            qs = qs.filter(Q(team__isnull=True) | Q(team_id__in=user_team_ids))
        else:
            # Team access only: only see SAs that are in shared teams
            qs = qs.filter(
                Q(team_id__in=user_team_ids) |
                Q(team_memberships__team_id__in=user_team_ids)
            ).distinct()

    return qs


def resolve_service_account_handlers(root, info, org_id):
    if not user_is_org_member(info.context.user.userId, org_id):
        raise GraphQLError("You don't have access to this organisation")

    # Default roles store an empty permissions JSON in the DB — resolve from the template
    def role_permissions(role):
        if role.is_default:
            return default_roles.get(role.name.capitalize(), {})
        return role.permissions or {}

    def role_is_handler_eligible(role):
        if role_has_global_access(role):
            return True
        # The default Service role is for machine accounts, not key custody
        if role.is_default and role.name.lower() == "service":
            return False
        return bool(
            role_permissions(role).get("permissions", {}).get("ServiceAccounts", [])
        )

    handler_role_ids = [
        role.id
        for role in Role.objects.filter(organisation_id=org_id)
        if role_is_handler_eligible(role)
    ]

    # Exclude members pending their key ceremony — no public key to wrap to
    members = OrganisationMember.objects.filter(
        organisation_id=org_id,
        role_id__in=handler_role_ids,
        deleted_at=None,
    ).exclude(Q(identity_key__isnull=True) | Q(identity_key=""))

    return members


def resolve_app_service_accounts(root, info, app_id):
    app = App.objects.get(id=app_id)

    if not user_has_permission(
        info.context.user, "read", "ServiceAccounts", app.organisation, True
    ):
        return []

    if not user_can_access_app(info.context.user.userId, app_id):
        raise GraphQLError("You don't have access to this app")

    return app.service_accounts.filter(deleted_at=None)
