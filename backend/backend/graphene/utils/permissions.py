from api.models import App, Environment, EnvironmentKey, Organisation, OrganisationMember

admin_roles = [OrganisationMember.OWNER, OrganisationMember.ADMIN]


def user_is_admin(user_id, org_id):
    member = OrganisationMember.objects.get(
        user_id=user_id, organisation_id=org_id)
    return member.role in admin_roles


def user_is_org_member(user_id, org_id):
    return OrganisationMember.objects.filter(user_id=user_id, organisation_id=org_id).exists()


def user_can_access_app(user_id, app_id):
    org_memberships = OrganisationMember.objects.filter(user_id=user_id)
    app = App.objects.get(id=app_id)
    return app.organisation.id in [membership.organisation.id for membership in org_memberships]


def user_can_access_environment(user_id, env_id):
    env = Environment.objects.get(id=env_id)
    org_member = OrganisationMember.objects.get(
        organisation=env.app.organisation, user_id=user_id)
    return EnvironmentKey.objects.filter(user_id=org_member, environment_id=env_id).exists()


def member_can_access_org(member_id, org_id):
    return OrganisationMember.objects.filter(id=member_id, organisation_id=org_id).exists()
