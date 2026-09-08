from api.utils.access.permissions import user_has_permission, user_is_org_member
from api.models import (
    NetworkAccessPolicy,
    Organisation,
    OrganisationMember,
    Role,
    Identity,
)
from api.utils.access.ip import get_client_ip
from graphql import GraphQLError
from django.db import transaction
from api.utils.access.roles import (
    ADMIN_ROLE_KEY,
    DEVELOPER_ROLE_KEY,
    MANAGER_ROLE_KEY,
    OWNER_ROLE_KEY,
    SERVICE_ROLE_KEY,
    get_default_role_template,
)
from itertools import chain
from django.db.models import Case, When, Value, IntegerField


@transaction.atomic
def migrate_role_permissions():
    """Refresh stored permissions for roles with a valid managed-role key."""
    roles = Role.objects.all()

    for role in roles:
        template = get_default_role_template(role)
        if template is not None:
            role.permissions = template
            role.save()

    print("Permissions migration completed successfully.")


def resolve_roles(root, info, org_id):
    org = Organisation.objects.get(id=org_id)

    custom_order = Case(
        When(managed_key=OWNER_ROLE_KEY, then=Value(1)),
        When(managed_key=ADMIN_ROLE_KEY, then=Value(2)),
        When(managed_key=MANAGER_ROLE_KEY, then=Value(3)),
        When(managed_key=DEVELOPER_ROLE_KEY, then=Value(4)),
        When(managed_key=SERVICE_ROLE_KEY, then=Value(5)),
        default=Value(6),  # For custom roles
        output_field=IntegerField(),
    )

    if user_has_permission(info.context.user.userId, "read", "Roles", org):
        return Role.objects.filter(organisation=org).order_by(
            "-is_default", custom_order
        )
    else:
        raise GraphQLError("You don't have permission to perform this action")


def resolve_organisation_global_access_users(root, info, organisation_id):
    if not user_is_org_member(info.context.user.userId, organisation_id):
        raise GraphQLError("You don't have access to this organisation")

    global_access_roles = Role.objects.filter(
        organisation_id=organisation_id,
        is_default=True,
        managed_key__in=(OWNER_ROLE_KEY, ADMIN_ROLE_KEY),
    )

    members = OrganisationMember.objects.filter(
        organisation_id=organisation_id,
        role__in=global_access_roles,
        deleted_at=None,
    )

    if not info.context.user.userId in [member.user_id for member in members]:
        self_member = OrganisationMember.objects.filter(
            organisation_id=organisation_id,
            user_id=info.context.user.userId,
            deleted_at=None,
        )
        members = list(chain(members, self_member))

    return members


def resolve_network_access_policies(root, info, organisation_id):
    if not user_is_org_member(info.context.user.userId, organisation_id):
        raise GraphQLError("You don't have access to this organisation")

    if user_has_permission(
        info.context.user.userId,
        "read",
        "NetworkAccessPolicies",
        Organisation.objects.get(id=organisation_id),
    ):
        return NetworkAccessPolicy.objects.filter(organisation_id=organisation_id)
    else:
        raise GraphQLError(
            "You don't have permission to read Network Access Policies in this organisation"
        )


def resolve_client_ip(root, info):
    request = info.context
    ip = get_client_ip(request)
    return ip


def resolve_identities(root, info, organisation_id):
    if not user_is_org_member(info.context.user.userId, organisation_id):
        raise GraphQLError("You don't have access to this organisation")

    if user_has_permission(
        info.context.user.userId,
        "read",
        "ExternalIdentities",
        Organisation.objects.get(id=organisation_id),
    ):
        return Identity.objects.filter(organisation_id=organisation_id, deleted_at=None)
    else:
        raise GraphQLError(
            "You don't have permission to read identities in this organisation"
        )
