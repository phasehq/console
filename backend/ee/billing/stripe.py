from api.models import Organisation
from backend.api.notifier import notify_slack
import stripe
from django.conf import settings


def create_stripe_customer(organisation, email):
    stripe.api_key = settings.STRIPE["secret_key"]

    seats = organisation.get_seats()

    stripe_customer = stripe.Customer.create(
        name=organisation.name,
        email=email,
    )
    organisation.stripe_customer_id = stripe_customer.id

    # Use the latest free price (index 0)
    free_prices = settings.STRIPE["prices"]["free"]
    price_id = free_prices[0] if free_prices else None

    subscription = stripe.Subscription.create(
        customer=stripe_customer.id,
        items=[
            {
                "price": price_id,
                "quantity": seats,
            }
        ],
    )
    organisation.stripe_subscription_id = subscription.id
    organisation.save()


def update_stripe_subscription_seats(organisation):
    stripe.api_key = settings.STRIPE["secret_key"]

    if not organisation.stripe_subscription_id:
        raise ValueError("Organisation must have a Stripe subscription ID.")

    try:
        new_seat_count = organisation.get_seats()

        # Retrieve the subscription
        subscription = stripe.Subscription.retrieve(organisation.stripe_subscription_id)

        if not subscription["items"]["data"]:
            raise ValueError("No items found in the subscription.")

        # Assume we're updating the first item in the subscription
        item_id = subscription["items"]["data"][0]["id"]

        # Modify the subscription with the new seat count
        updated_subscription = stripe.Subscription.modify(
            organisation.stripe_subscription_id,
            items=[
                {
                    "id": item_id,
                    "quantity": new_seat_count,
                }
            ],
            proration_behavior="always_invoice",
        )
        return updated_subscription

    except Exception as ex:
        print("Failed to update Stripe seat count:", ex)
        try:
            notify_slack(
                f"Failed to update Stripe seat count for organisation {organisation.id}: {ex}"
            )
        except:
            pass
        pass


def map_stripe_plan_to_tier(stripe_plan_id):
    if (
        stripe_plan_id in settings.STRIPE["prices"]["pro_monthly"]
        or stripe_plan_id in settings.STRIPE["prices"]["pro_yearly"]
    ):
        return Organisation.PRO_PLAN
    if (
        stripe_plan_id in settings.STRIPE["prices"]["enterprise_monthly"]
        or stripe_plan_id in settings.STRIPE["prices"]["enterprise_yearly"]
    ):
        return Organisation.ENTERPRISE_PLAN
    elif stripe_plan_id in settings.STRIPE["prices"]["free"]:
        return Organisation.FREE_PLAN


def migrate_organisation_to_v2_pricing(organisation):
    """
    Helper to migrate an organisation to the new pricing model.
    Should be called when an organisation changes plans.
    """
    if organisation.pricing_version == Organisation.PRICING_V1:
        organisation.pricing_version = Organisation.PRICING_V2
        organisation.save()
