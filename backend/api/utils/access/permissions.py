from api.models import App, Environment, EnvironmentKey, Organisation, OrganisationMember

admin_roles = [OrganisationMember.OWNER, OrganisationMember.ADMIN]


def user_is_admin(user_id, org_id):
    member = OrganisationMember.objects.get(
        user_id=user_id, organisation_id=org_id, deleted_at=None)
    return member.role in admin_roles


def user_is_org_member(user_id, org_id):
    return OrganisationMember.objects.filter(user_id=user_id, organisation_id=org_id, deleted_at=None).exists()


def user_can_access_app(user_id, app_id):
    app = App.objects.get(id=app_id)
    org_member = OrganisationMember.objects.get(
        user_id=user_id, organisation=app.organisation, deleted_at=None)
    return org_member in app.members.all()


def user_can_access_environment(user_id, env_id):
    env = Environment.objects.get(id=env_id)
    org_member = OrganisationMember.objects.get(
        organisation=env.app.organisation, user_id=user_id, deleted_at=None)
    return EnvironmentKey.objects.filter(user_id=org_member, environment_id=env_id).exists()


def member_can_access_org(member_id, org_id):
    return OrganisationMember.objects.filter(id=member_id, organisation_id=org_id, deleted_at=None).exists()


def user_has_permission(user, action, resource, organisation):
    """Check if the user has the specified permission for a resource in an organization."""
    try:
        # Get the user's membership in the organization
        org_member = OrganisationMember.objects.get(user=user, organisation=organisation)
        role = org_member.role
        if not role:
            return False  # No role assigned, hence no permissions

        permissions = role.permissions.get('permissions', [])

        # Iterate through permissions to check if the required action is allowed
        for permission in permissions:
            if permission['resource'] == resource and action in permission['actions']:
                return True

        return False
    except OrganisationMember.DoesNotExist:
        return False  # User is not a member of the organization
