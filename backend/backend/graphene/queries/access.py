from api.utils.access.permissions import user_has_permission, user_is_org_member
from api.models import Organisation, Role
from graphql import GraphQLError
from django.db import transaction
from api.utils.access.roles import default_roles


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
        return Role.objects.filter(organisation=org)
    else:
        raise GraphQLError("You don't have permission to perform this action")
