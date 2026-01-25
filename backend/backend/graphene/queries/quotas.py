from api.utils.access.permissions import user_is_org_member
from api.models import (
    ActivatedPhaseLicense,
    App,
    Organisation,
    OrganisationMember,
    OrganisationMemberInvite,
    ServiceAccount,
)
from django.conf import settings
from backend.quotas import PLAN_CONFIG
from django.utils import timezone

CLOUD_HOSTED = settings.APP_HOST == "cloud"


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

        if (
            organisation.pricing_version == Organisation.PRICING_V2
            and organisation.plan != Organisation.FREE_PLAN
        ):
            plan["seats_used"]["total"] = plan["seats_used"]["users"]
        else:
            plan["seats_used"]["total"] = (
                plan["seats_used"]["users"] + plan["seats_used"]["service_accounts"]
            )

        if not CLOUD_HOSTED and organisation.plan == Organisation.FREE_PLAN:
            seat_limit = None

        else:
            from ee.billing.utils import get_org_seat_limit

            seat_limit = get_org_seat_limit(organisation)

        plan["seat_limit"] = seat_limit

        plan["app_count"] = App.objects.filter(
            organisation=organisation, deleted_at=None
        ).count()

        return plan
