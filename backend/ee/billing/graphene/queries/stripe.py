import graphene
from graphene import ObjectType, String, Field
import stripe
from django.conf import settings


class StripeCheckoutDetails(graphene.ObjectType):
    payment_status = graphene.String()
    customer_email = graphene.String()
    billing_start_date = graphene.String()
    billing_end_date = graphene.String()
    subscription_id = graphene.String()
    plan_name = graphene.String()


def resolve_stripe_checkout_details(self, info, stripe_session_id):
    stripe.api_key = settings.STRIPE["secret_key"]

    try:
        session = stripe.checkout.Session.retrieve(stripe_session_id)

        subscription_id = session.get("subscription")
        if subscription_id:
            subscription = stripe.Subscription.retrieve(subscription_id)
            plan_name = subscription["items"]["data"][0]["plan"]["nickname"]
            billing_start_date = subscription["current_period_start"]
            billing_end_date = subscription["current_period_end"]
        else:
            plan_name = None
            billing_start_date = None
            billing_end_date = None

        return StripeCheckoutDetails(
            payment_status=session.payment_status,
            customer_email=session.customer_details.email,
            billing_start_date=str(billing_start_date),
            billing_end_date=str(billing_end_date),
            subscription_id=subscription_id,
            plan_name=plan_name,
        )
    except stripe.error.StripeError as e:
        return None
