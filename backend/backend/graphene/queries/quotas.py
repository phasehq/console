from api.utils.permissions import user_is_org_member
from api.models import App, Organisation, OrganisationMember, OrganisationMemberInvite
from ee.quotas import PLAN_CONFIG
from django.utils import timezone


def resolve_organisation_plan(self, info, organisation_id):
    if user_is_org_member(info.context.user, organisation_id):

        organisation = Organisation.objects.get(id=organisation_id)

        plan = PLAN_CONFIG[organisation.plan]

        plan["user_count"] = (
            OrganisationMember.objects.filter(
                organisation=organisation, deleted_at=None
            ).count()
            + OrganisationMemberInvite.objects.filter(
                organisation=organisation, valid=True, expires_at__gte=timezone.now()
            ).count()
        )

        plan["app_count"] = App.objects.filter(
            organisation=organisation, deleted_at=None
        ).count()

        return plan
