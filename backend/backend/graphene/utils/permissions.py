from api.models import App, Environment, EnvironmentKey, Organisation, OrganisationMember
from graphql import GraphQLError

def user_is_admin(user_id, org_id):
    admin_roles = [OrganisationMember.OWNER, OrganisationMember.ADMIN]
    member = OrganisationMember.objects.get(user__id=user_id, organisation__id=org_id)
    return member.role in admin_roles

def user_is_org_member(user_id, org_id):
    return OrganisationMember.objects.filter(user__id=user_id, organisation__id=org_id).exists()

def user_can_access_app(user_id, app_id):
    org_memberships = OrganisationMember.objects.filter(user_id=user_id)
    app = App.objects.get(id=app_id)
    return app.organisation.id in [membership.organisation.id for membership in org_memberships]

def user_can_access_environment(user_id, env_id):
    return EnvironmentKey.objects.filter(user_id=user_id, environment_id=env_id).exists()
