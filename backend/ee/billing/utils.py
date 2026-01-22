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


def calculate_graduated_price(seats, plan_type, billing_period):
    """
    Calculate the price for legacy v1 pricing model using graduated tiers.
    """
    from ee.billing.graphene.types import PlanTypeEnum, BillingPeriodEnum

    base_price = 2 if plan_type == PlanTypeEnum.PRO else 5

    # Adjust for yearly billing
    if billing_period == BillingPeriodEnum.YEARLY:
        base_price *= 12

    tiers = [
        {"min": 0, "max": 49, "discount": 0},
        {"min": 50, "max": 99, "discount": 0.25},
        {"min": 100, "max": 249, "discount": 0.35},
        {"min": 250, "max": 999, "discount": 0.45},
        {"min": 1000, "max": 2500, "discount": 0.6},
    ]

    total_price = 0
    remaining_seats = seats

    for tier in tiers:
        if remaining_seats <= 0:
            break

        # Calculate seats in this tier
        tier_span = tier["max"] - tier["min"] + 1
        seats_in_tier = min(remaining_seats, tier_span)

        # Calculate price for these seats
        tier_price = base_price * (1 - tier["discount"])
        total_price += seats_in_tier * tier_price

        remaining_seats -= seats_in_tier

    # Handle any remaining seats using the last tier's discount
    if remaining_seats > 0:
        tier_price = base_price * (1 - tiers[-1]["discount"])
        total_price += remaining_seats * tier_price

    return total_price
