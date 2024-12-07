from django.views.decorators.csrf import csrf_exempt
from django.http import JsonResponse
from ee.billing.stripe import map_stripe_plan_to_tier
import stripe
import logging
from api.models import Organisation

from django.conf import settings


def handle_subscription_created(event):
    """
    Handles the creation of a subscription. Updates the organisation's
    stripe_subscription_id and plan tier based on the price_id.
    """
    subscription = event["data"]["object"]

    try:
        organisation = Organisation.objects.get(
            stripe_customer_id=subscription["customer"]
        )

        # Set the subscription ID and update the plan
        organisation.stripe_subscription_id = subscription["id"]
        organisation.plan = map_stripe_plan_to_tier(
            subscription["items"]["data"][0]["price"]["id"]
        )
        organisation.save()

    except Organisation.DoesNotExist:
        return JsonResponse({"error": "Organisation not found"}, status=404)


def handle_subscription_updated(event):
    subscription = event["data"]["object"]

    try:
        organisation = Organisation.objects.get(
            stripe_customer_id=subscription["customer"]
        )

        # Update the plan and subscription ID
        organisation.plan = map_stripe_plan_to_tier(
            subscription["items"]["data"][0]["price"]["id"]
        )
        organisation.stripe_subscription_id = subscription["id"]
        organisation.save()

    except Organisation.DoesNotExist:
        return JsonResponse({"error": "Organisation not found"}, status=404)


def handle_subscription_deleted(event):
    subscription = event["data"]["object"]

    try:
        organisation = Organisation.objects.get(
            stripe_customer_id=subscription["customer"]
        )

        pro_price_ids = [
            settings.STRIPE["prices"]["pro_monthly"],
            settings.STRIPE["prices"]["pro_yearly"],
        ]
        free_price_id = settings.STRIPE["prices"]["free"]

        # Fetch all active subscriptions for the customer
        active_subscriptions = stripe.Subscription.list(
            customer=organisation.stripe_customer_id, status="active"
        )

        # Check for active Pro subscriptions
        active_pro_subscriptions = [
            sub
            for sub in active_subscriptions["data"]
            if any(
                item["price"]["id"] in pro_price_ids for item in sub["items"]["data"]
            )
        ]

        if active_pro_subscriptions:
            # Update the organisation's subscription ID to the first active Pro subscription
            organisation.stripe_subscription_id = active_pro_subscriptions[0]["id"]
        else:
            # Check for the Free subscription
            free_subscriptions = [
                sub
                for sub in active_subscriptions["data"]
                if any(
                    item["price"]["id"] == free_price_id
                    for item in sub["items"]["data"]
                )
            ]

            if free_subscriptions:
                # Update the organisation's subscription ID to the first Free subscription
                organisation.stripe_subscription_id = free_subscriptions[0]["id"]
                organisation.plan = Organisation.FREE_PLAN
            else:
                # If no active subscription exists, set the plan to Free and clear the subscription ID
                organisation.plan = Organisation.FREE_PLAN
                organisation.stripe_subscription_id = None

        organisation.save()

    except Organisation.DoesNotExist:
        return JsonResponse({"error": "Organisation not found"}, status=404)
    except Exception as e:
        logging.error("An error occurred: %s", str(e))
        return JsonResponse({"error": "An internal error has occurred"}, status=500)


@csrf_exempt
def stripe_webhook(request):
    payload = request.body
    sig_header = request.META["HTTP_STRIPE_SIGNATURE"]
    event = None

    try:
        stripe.api_key = settings.STRIPE["secret_key"]
        event = stripe.Webhook.construct_event(
            payload, sig_header, settings.STRIPE["webhook_secret"]
        )
    except ValueError:
        return JsonResponse({"error": "Invalid payload"}, status=400)
    except stripe.error.SignatureVerificationError:
        return JsonResponse({"error": "Invalid signature"}, status=400)

    # Route events to the appropriate handler
    if event["type"] == "customer.subscription.created":
        handle_subscription_created(event)
    elif event["type"] == "customer.subscription.updated":
        handle_subscription_updated(event)
    elif event["type"] == "customer.subscription.deleted":
        handle_subscription_deleted(event)

    return JsonResponse({"status": "success"}, status=200)
