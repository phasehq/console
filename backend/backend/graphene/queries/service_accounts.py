from api.utils.access.permissions import (
    user_can_access_app,
    user_has_permission,
    user_is_org_member,
)
from api.models import App, Organisation, OrganisationMember, Role, ServiceAccount
from .access import resolve_organisation_global_access_users
from django.db.models import Q
from graphql import GraphQLError


def resolve_service_accounts(root, info, org_id, service_account_id=None):
    org = Organisation.objects.get(id=org_id)
    if user_has_permission(info.context.user.userId, "read", "ServiceAccounts", org):

        filter = {"organisation": org}

        if service_account_id is not None:
            filter["id"] = service_account_id

        return ServiceAccount.objects.filter(**filter)


def resolve_service_account_handlers(root, info, org_id):
    if not user_is_org_member(info.context.user.userId, org_id):
        raise GraphQLError("You don't have access to this organisation")

    service_account_handler_roles = Role.objects.filter(
        Q(organisation_id=org_id)
        & (
            Q(name__iexact="owner") | Q(name__iexact="admin")
        )  # Check for "owner" or "admin" roles
        | Q(permissions__global_access=True),  # Check for global access roles
        Q(
            permissions__permissions__ServiceAccounts__gt=0
        ),  # Add condition for non-empty 'ServiceAccounts' list
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
        raise GraphQLError(
            "You don't have permission to read service accounts in this App"
        )

    if not user_can_access_app(info.context.user.userId, app_id):
        raise GraphQLError("You don't have access to this app")

    return app.service_accounts.filter(deleted_at=None)
