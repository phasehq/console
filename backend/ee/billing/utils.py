from api.models import ActivatedPhaseLicense
from backend.quotas import PLAN_CONFIG


def get_org_seat_limit(organisation):
    """Get the total number of seats available for an organisation."""

    plan = PLAN_CONFIG[organisation.plan]

    license_exists = ActivatedPhaseLicense.objects.filter(
        organisation=organisation
    ).exists()

    if license_exists:
        license = (
            ActivatedPhaseLicense.objects.filter(organisation=organisation)
            .order_by("-activated_at")
            .first()
        )
        seats = license.seats
    else:
        seats = plan["max_users"]

    return seats
