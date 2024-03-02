from api.utils.permissions import user_is_org_member
from api.models import Organisation
from ee.quotas import PLAN_CONFIG


def resolve_organisation_plan(self, info, organisation_id):
    if user_is_org_member(info.context.user, organisation_id):

        organisation = Organisation.objects.get(id=organisation_id)

        return PLAN_CONFIG[organisation.plan]
