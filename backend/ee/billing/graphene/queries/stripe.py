from api.models import Organisation
from api.utils.access.permissions import user_has_permission
import graphene
from graphene import ObjectType, String, Boolean, List, Int, Float
import stripe
from django.conf import settings
from graphql import GraphQLError


class StripeCheckoutDetails(graphene.ObjectType):
    payment_status = graphene.String()
    customer_email = graphene.String()
    billing_start_date = graphene.String()
    billing_end_date = graphene.String()
    subscription_id = graphene.String()
    plan_name = graphene.String()


class PaymentMethodDetails(graphene.ObjectType):
    id = graphene.String()
    brand = graphene.String()
    last4 = graphene.String()
    exp_month = graphene.Int()
    exp_year = graphene.Int()
    is_default = graphene.Boolean()


class StripeSubscriptionDetails(ObjectType):
    subscription_id = String()
    plan_name = String()
    status = String()
    next_payment_amount = Float()
    current_period_start = Int()
    current_period_end = Int()
    renewal_date = Int()
    cancel_at = Int()
    cancel_at_period_end = Boolean()
    payment_methods = List(PaymentMethodDetails)


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


def resolve_stripe_subscription_details(self, info, organisation_id):
    stripe.api_key = settings.STRIPE["secret_key"]

    try:
        org = Organisation.objects.get(id=organisation_id)
        if not user_has_permission(info.context.user, "read", "Billing", org):
            raise GraphQLError("You don't have permission to view Tokens in this App")

        # Retrieve subscription details
        subscription = stripe.Subscription.retrieve(org.stripe_subscription_id)

        plan_name = subscription["items"]["data"][0]["plan"]["nickname"]
        current_period_start = subscription["current_period_start"]
        current_period_end = subscription["current_period_end"]
        renewal_date = subscription["current_period_end"]
        status = subscription["status"]

        # Retrieve cancellation details
        cancel_at = subscription.get("cancel_at")  # Timestamp of cancellation, if set
        cancel_at_period_end = subscription.get("cancel_at_period_end")  # Boolean

        customer = stripe.Customer.retrieve(org.stripe_customer_id)

        default_payment_method_id = customer.get("invoice_settings", {}).get(
            "default_payment_method"
        )

        # Retrieve payment methods for the customer
        payment_methods = stripe.PaymentMethod.list(
            customer=org.stripe_customer_id, type="card"
        )

        payment_methods_list = [
            PaymentMethodDetails(
                id=pm["id"],
                brand=pm["card"]["brand"],
                last4=pm["card"]["last4"],
                is_default=(pm["id"] == default_payment_method_id),  # Check if default
                exp_month=pm["card"]["exp_month"],
                exp_year=pm["card"]["exp_year"],
            )
            for pm in payment_methods["data"]
        ]

        # Retrieve upcoming invoice to get the amount of the next payment
        upcoming_invoice = stripe.Invoice.upcoming(
            customer=org.stripe_customer_id, subscription=org.stripe_subscription_id
        )
        next_payment_amount = upcoming_invoice[
            "total"
        ]  # Amount in the smallest currency unit

        return StripeSubscriptionDetails(
            subscription_id=org.stripe_subscription_id,
            plan_name=plan_name,
            status=status,
            current_period_start=str(current_period_start),
            current_period_end=str(current_period_end),
            renewal_date=str(renewal_date),
            cancel_at=str(cancel_at) if cancel_at else None,
            cancel_at_period_end=cancel_at_period_end,
            payment_methods=payment_methods_list,
            next_payment_amount=next_payment_amount,  # Add this field
        )
    except stripe.error.StripeError as e:
        return None
