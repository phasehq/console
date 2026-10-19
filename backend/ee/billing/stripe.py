from api.models import Organisation
from backend.api.notifier import notify_slack
import stripe
from django.conf import settings
from ee.billing.utils import get_org_billable_seats


def create_stripe_customer(organisation, email):
    stripe.api_key = settings.STRIPE["secret_key"]

    seats = get_org_billable_seats(organisation)

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
        new_seat_count = get_org_billable_seats(organisation)

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

    raise ValueError(f"Unknown Stripe price ID: {stripe_plan_id}")


# Tags deletion-driven cancellations so a restore leaves the customer's own alone.
ORG_DELETION_METADATA_KEY = "phase_org_deletion"

_OPEN_SUBSCRIPTION_STATUSES = {
    "active",
    "trialing",
    "past_due",
    "unpaid",
    "paused",
    "incomplete",
}


def _open_subscriptions(organisation):
    if not organisation.stripe_customer_id:
        return []
    subscriptions = stripe.Subscription.list(
        customer=organisation.stripe_customer_id, status="all"
    )
    return [
        subscription
        for subscription in subscriptions.auto_paging_iter()
        if subscription["status"] in _OPEN_SUBSCRIPTION_STATUSES
    ]


def _is_paid(subscription):
    free_price_ids = set(settings.STRIPE["prices"]["free"])
    return any(
        item["price"]["id"] not in free_price_ids
        for item in subscription["items"]["data"]
    )


def cancel_paid_subscriptions_at_period_end(organisation):
    """Deletion requested: stop renewals but keep paid features until the period
    ends. The subscription-deleted webhook then moves the org to Free."""
    stripe.api_key = settings.STRIPE["secret_key"]

    for subscription in _open_subscriptions(organisation):
        if not _is_paid(subscription) or subscription.get("cancel_at_period_end"):
            continue
        stripe.Subscription.modify(
            subscription["id"],
            cancel_at_period_end=True,
            metadata={ORG_DELETION_METADATA_KEY: "true"},
        )


def resume_subscriptions_cancelled_for_deletion(organisation):
    """Deletion cancelled: undo only the cancellations the request made."""
    stripe.api_key = settings.STRIPE["secret_key"]

    for subscription in _open_subscriptions(organisation):
        metadata = subscription.get("metadata") or {}
        if metadata.get(ORG_DELETION_METADATA_KEY) != "true":
            continue
        stripe.Subscription.modify(
            subscription["id"],
            cancel_at_period_end=False,
            # An empty value deletes the metadata key.
            metadata={ORG_DELETION_METADATA_KEY: ""},
        )


# past_due: Stripe is still retrying the latest invoice. unpaid: the retries
# ran out and the invoice is still open.
_UNPAID_SUBSCRIPTION_STATUSES = {"past_due", "unpaid"}


def has_unpaid_subscriptions(organisation):
    """Whether a paid subscription has an invoice that hasn't been paid."""
    stripe.api_key = settings.STRIPE["secret_key"]

    return any(
        _is_paid(subscription)
        and subscription["status"] in _UNPAID_SUBSCRIPTION_STATUSES
        for subscription in _open_subscriptions(organisation)
    )


def cancel_all_subscriptions(organisation):
    """Organisation purge: end every open subscription now, without proration.
    The Stripe customer record is kept."""
    stripe.api_key = settings.STRIPE["secret_key"]

    for subscription in _open_subscriptions(organisation):
        stripe.Subscription.cancel(subscription["id"])


def update_stripe_customer_email(organisation, new_email):
    """
    Update the Stripe customer email when organisation ownership is transferred.
    """
    stripe.api_key = settings.STRIPE["secret_key"]

    if not organisation.stripe_customer_id:
        return  # No Stripe customer to update

    try:
        stripe.Customer.modify(
            organisation.stripe_customer_id,
            email=new_email,
        )
    except Exception as ex:
        print(f"Failed to update Stripe customer email: {ex}")
        try:
            notify_slack(
                f"Failed to update Stripe customer email for organisation {organisation.id}: {ex}"
            )
        except Exception as slack_ex:
            print(f"Failed to send Slack notification for Stripe email update error: {slack_ex}")


def migrate_organisation_to_v2_pricing(organisation):
    """
    Helper to migrate an organisation to the V2 pricing model.
    """
    if organisation.pricing_version == Organisation.PRICING_V2:
        return

    stripe.api_key = settings.STRIPE["secret_key"]

    # Update local state first to calculate correct V2 seat count
    organisation.pricing_version = Organisation.PRICING_V2
    organisation.save()

    if organisation.plan in [Organisation.PRO_PLAN, Organisation.ENTERPRISE_PLAN]:
        if organisation.stripe_subscription_id:
            try:
                subscription = stripe.Subscription.retrieve(
                    organisation.stripe_subscription_id
                )
                if subscription["items"]["data"]:

                    item = subscription["items"]["data"][0]
                    current_price = item["price"]
                    item_id = item["id"]

                    # Determine billing period based on current price interval
                    is_yearly = (
                        current_price.get("recurring", {}).get("interval") == "year"
                    )

                    # Get new price ID (first in the list is the new active price)
                    if organisation.plan == Organisation.PRO_PLAN:
                        prices = (
                            settings.STRIPE["prices"]["pro_yearly"]
                            if is_yearly
                            else settings.STRIPE["prices"]["pro_monthly"]
                        )
                    else:  # Enterprise
                        prices = (
                            settings.STRIPE["prices"]["enterprise_yearly"]
                            if is_yearly
                            else settings.STRIPE["prices"]["enterprise_monthly"]
                        )

                    if not prices:
                        raise ValueError(
                            "No active price configuration found for plan migration"
                        )

                    new_price_id = prices[0]
                    new_seat_count = get_org_billable_seats(organisation)

                    # Modify subscription to use new price and quantity
                    stripe.Subscription.modify(
                        organisation.stripe_subscription_id,
                        items=[
                            {
                                "id": item_id,
                                "price": new_price_id,
                                "quantity": new_seat_count,
                            }
                        ],
                        proration_behavior="always_invoice",
                        billing_cycle_anchor="unchanged",
                    )

            except Exception as e:
                # Revert local state if stripe update fails
                organisation.pricing_version = Organisation.PRICING_V1
                organisation.save()

                notify_slack(
                    f"Failed to migrate Stripe subscription for organisation {organisation.id}: {e}"
                )
                # Re-raise so the mutation is aware of the failure
                raise e
