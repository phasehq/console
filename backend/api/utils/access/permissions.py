from api.utils.access.roles import default_roles
from django.apps import apps


admin_roles = ["Owner", "Admin"]


def user_is_admin(user_id, org_id):
    OrganisationMember = apps.get_model("api", "OrganisationMember")
    member = OrganisationMember.objects.get(
        user_id=user_id, organisation_id=org_id, deleted_at=None
    )
    return member.role.name in admin_roles


def user_is_org_member(user_id, org_id):
    OrganisationMember = apps.get_model("api", "OrganisationMember")
    return OrganisationMember.objects.filter(
        user_id=user_id, organisation_id=org_id, deleted_at=None
    ).exists()


def user_can_access_app(user_id, app_id):
    OrganisationMember = apps.get_model("api", "OrganisationMember")
    App = apps.get_model("api", "App")
    TeamMembership = apps.get_model("api", "TeamMembership")

    app = App.objects.get(id=app_id)
    org_member = OrganisationMember.objects.get(
        user_id=user_id, organisation=app.organisation, deleted_at=None
    )

    # Individual access
    if org_member in app.members.all():
        return True

    # Team access
    return TeamMembership.objects.filter(
        org_member=org_member,
        team__app_environments__app=app,
        team__deleted_at__isnull=True,
    ).exists()


def user_can_access_environment(user_id, env_id):
    OrganisationMember = apps.get_model("api", "OrganisationMember")
    Environment = apps.get_model("api", "Environment")
    EnvironmentKey = apps.get_model("api", "EnvironmentKey")

    env = Environment.objects.get(id=env_id)
    org_member = OrganisationMember.objects.get(
        organisation=env.app.organisation, user_id=user_id, deleted_at=None
    )
    return EnvironmentKey.objects.filter(
        user_id=org_member, environment_id=env_id
    ).exists()


def service_account_can_access_environment(account_id, env_id):
    Environment = apps.get_model("api", "Environment")
    EnvironmentKey = apps.get_model("api", "EnvironmentKey")
    ServiceAccount = apps.get_model("api", "ServiceAccount")

    env = Environment.objects.get(id=env_id)
    service_account = ServiceAccount.objects.get(
        organisation=env.app.organisation, id=account_id, deleted_at=None
    )
    return EnvironmentKey.objects.filter(
        service_account=service_account, environment_id=env_id
    ).exists()


def member_can_access_org(member_id, org_id):
    OrganisationMember = apps.get_model("api", "OrganisationMember")
    return OrganisationMember.objects.filter(
        id=member_id, organisation_id=org_id, deleted_at=None
    ).exists()


def role_has_permission(role, action, resource, is_app_resource=False):
    """Check if a role has the specified permission for a resource."""
    if not role:
        return False  # No role assigned, hence no permissions

    # Check if the role is a default role
    if role.is_default:
        # Get permissions from the default_roles dictionary
        role_name = role.name.capitalize()
        permissions = default_roles.get(role_name, {})
    else:
        # Use the permissions stored in the role object
        permissions = role.permissions

    # Determine the correct key to check
    permission_key = "app_permissions" if is_app_resource else "permissions"

    # Check if the resource exists and if the action is permitted
    resource_permissions = permissions.get(permission_key, {}).get(resource, [])
    return action in resource_permissions


def _check_app_permission(account, action, resource, app, is_service_account=False):
    """
    Check app-level permission considering both individual and team access.

    - Individual access: uses org role's app_permissions
    - Team access: uses team role's app_permissions (override model)
    - Multiple teams: union — if ANY team role grants the permission, allow it
    - Team role is null: uses org role (team is purely an access group)
    """
    Team = apps.get_model("api", "Team")

    if is_service_account:
        has_individual = app.service_accounts.filter(id=account.id).exists()
        org_role = account.role
        role_field = "service_account_role"
        membership_filter = {"memberships__service_account": account}
    else:
        has_individual = account in app.members.all()
        org_role = account.role
        role_field = "member_role"
        membership_filter = {"memberships__org_member": account}

    # Individual access → org role, no team override
    if has_individual:
        return role_has_permission(org_role, action, resource, is_app_resource=True)

    # Team access — find all teams granting access to this app
    teams = Team.objects.filter(
        app_environments__app=app,
        deleted_at__isnull=True,
        **membership_filter,
    ).distinct()

    if not teams.exists():
        return False  # No access

    # Union: if ANY team role grants this permission, allow it
    for team in teams:
        team_role = getattr(team, role_field)
        if team_role is None:
            # No team role → use org role (most permissive possible)
            if role_has_permission(org_role, action, resource, is_app_resource=True):
                return True
        else:
            if role_has_permission(team_role, action, resource, is_app_resource=True):
                return True

    return False


def user_has_permission(
    account,
    action,
    resource,
    organisation,
    is_app_resource=False,
    is_service_account=False,
    app=None,
):
    OrganisationMember = apps.get_model("api", "OrganisationMember")

    """Check if the user has the specified permission for a resource in an organization."""
    try:
        # Get the user's membership in the organization
        if is_service_account:
            org_member = account
        else:
            org_member = OrganisationMember.objects.get(
                user=account, organisation=organisation, deleted_at=None
            )

        # Org-level permissions — always use org role
        if not is_app_resource or app is None:
            return role_has_permission(
                org_member.role, action, resource, is_app_resource
            )

        # App-level permissions — resolve effective role via team access
        return _check_app_permission(
            org_member, action, resource, app, is_service_account
        )

    except OrganisationMember.DoesNotExist:
        return False  # User is not a member of the organization


def role_has_global_access(role):
    Role = apps.get_model("api", "Role")

    """Check if a given role has global access."""
    try:
        # Check if the role is a default role
        if role.is_default:
            # Get permissions from the default_roles dictionary
            role_name = role.name.capitalize()
            permissions = default_roles.get(role_name, {})
        else:
            # Use the permissions stored in the role object
            permissions = role.permissions

        permission_key = "global_access"

        return permissions.get(permission_key, False)

    except Role.DoesNotExist:
        return False  # Role is not valid
