from django.views.decorators.csrf import csrf_exempt
from django.http import JsonResponse
from ee.billing.stripe import map_stripe_plan_to_tier
import stripe
from api.models import Organisation

from django.conf import settings


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
        if subscription["items"]["data"][0]["price"]["id"] in pro_price_ids:
            active_subscriptions = stripe.Subscription.list(
                customer=organisation.stripe_customer_id, status="active"
            )

            has_active_pro_subscription = any(
                item["price"]["id"] in pro_price_ids
                for sub in active_subscriptions["data"]
                for item in sub["items"]["data"]
            )

            if not has_active_pro_subscription:
                organisation.plan = Organisation.FREE_PLAN
                organisation.save()

    except Organisation.DoesNotExist:
        return JsonResponse({"error": "Organisation not found"}, status=404)


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
    if event["type"] == "customer.subscription.updated":
        handle_subscription_updated(event)
    elif event["type"] == "customer.subscription.deleted":
        handle_subscription_deleted(event)

    return JsonResponse({"status": "success"}, status=200)
