from api.utils.access.permissions import user_has_permission, user_is_org_member
from api.models import Organisation, OrganisationMember, Role
from graphql import GraphQLError
from django.db import transaction
from api.utils.access.roles import default_roles
from itertools import chain
from django.db.models import Q


@transaction.atomic
def migrate_role_permissions():
    """Replaces the permissions JSON for all Role objects with the new structure based on the role name."""
    roles = Role.objects.all()

    for role in roles:
        # Check if the role name matches one of the default roles
        role_name = role.name.capitalize()
        if role_name in default_roles:
            # Replace the entire permissions JSON with the new structure
            role.permissions = default_roles[role_name]
            role.save()

    print("Permissions migration completed successfully.")


def resolve_roles(root, info, org_id):
    org = Organisation.objects.get(id=org_id)

    # migrate_role_permissions()

    if user_has_permission(info.context.user.userId, "read", "Roles", org):
        return Role.objects.filter(organisation=org).order_by("-is_default")
    else:
        raise GraphQLError("You don't have permission to perform this action")


def resolve_organisation_global_access_users(root, info, organisation_id):
    if not user_is_org_member(info.context.user.userId, organisation_id):
        raise GraphQLError("You don't have access to this organisation")

    global_access_roles = Role.objects.filter(
        Q(organisation_id=organisation_id)
        & (Q(name__iexact="owner") | Q(name__iexact="admin"))
        | Q(permissions__global_access=True)
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
