from api.utils.access.permissions import user_is_org_member
from api.models import (
    App,
    Organisation,
    OrganisationMember,
    OrganisationMemberInvite,
    ServiceAccount,
)
from backend.quotas import PLAN_CONFIG
from django.utils import timezone


def resolve_organisation_plan(self, info, organisation_id):
    if user_is_org_member(info.context.user, organisation_id):

        organisation = Organisation.objects.get(id=organisation_id)

        plan = PLAN_CONFIG[organisation.plan]

        plan["seats_used"] = {
            "users": (
                OrganisationMember.objects.filter(
                    organisation=organisation, deleted_at=None
                ).count()
                + OrganisationMemberInvite.objects.filter(
                    organisation=organisation,
                    valid=True,
                    expires_at__gte=timezone.now(),
                ).count()
            ),
            "service_accounts": ServiceAccount.objects.filter(
                organisation=organisation, deleted_at=None
            ).count(),
        }

        plan["seats_used"]["total"] = (
            plan["seats_used"]["users"] + plan["seats_used"]["service_accounts"]
        )

        plan["app_count"] = App.objects.filter(
            organisation=organisation, deleted_at=None
        ).count()

        return plan
