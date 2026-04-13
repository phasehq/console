from api.utils.access.permissions import (
    role_has_global_access,
    user_can_access_app,
    user_has_permission,
    user_is_org_member,
)
from api.models import App, Organisation, OrganisationMember, Role, ServiceAccount, TeamMembership
from .access import resolve_organisation_global_access_users
from django.db.models import Q
from graphql import GraphQLError


def resolve_service_accounts(root, info, org_id, service_account_id=None):
    org = Organisation.objects.get(id=org_id)
    if user_has_permission(info.context.user.userId, "read", "ServiceAccounts", org):

        filter = {"organisation": org, "deleted_at": None}

        if service_account_id is not None:
            filter["id"] = service_account_id

        qs = ServiceAccount.objects.filter(**filter)

        # Team-owned SAs: only visible to team members + global_access users
        org_member = OrganisationMember.objects.get(
            user=info.context.user, organisation=org, deleted_at=None
        )
        if not role_has_global_access(org_member.role):
            user_team_ids = TeamMembership.objects.filter(
                org_member=org_member,
                team__deleted_at__isnull=True,
            ).values_list("team_id", flat=True)
            qs = qs.filter(Q(team__isnull=True) | Q(team_id__in=user_team_ids))

        return qs


def resolve_service_account_handlers(root, info, org_id):
    if not user_is_org_member(info.context.user.userId, org_id):
        raise GraphQLError("You don't have access to this organisation")

    service_account_handler_roles = Role.objects.filter(
        Q(organisation_id=org_id)
        & (
            Q(name__iexact="owner")
            | Q(name__iexact="admin")
            | Q(permissions__global_access=True)  # Check for global access roles
            | Q(permissions__permissions__ServiceAccounts__gt=0)
        ),
    )

    members = OrganisationMember.objects.filter(
        organisation_id=org_id,
        role__in=service_account_handler_roles,
        deleted_at=None,
    )

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
