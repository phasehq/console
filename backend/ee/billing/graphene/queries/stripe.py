from api.models import Organisation
from api.utils.access.permissions import user_has_permission
import graphene
from graphene import ObjectType, String, Field
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


class StripeSubscriptionDetails(graphene.ObjectType):
    subscription_id = graphene.String()
    plan_name = graphene.String()
    status = graphene.String()
    current_period_start = graphene.Int()
    current_period_end = graphene.Int()
    renewal_date = graphene.Int()
    payment_methods = graphene.List(PaymentMethodDetails)


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

        customer = stripe.Customer.retrieve(org.stripe_customer_id)

        default_payment_method_id = customer.get("invoice_settings", {}).get(
            "default_payment_method"
        )

        # Retrieve payment methods for the customer
        payment_methods = stripe.PaymentMethod.list(
            customer=org.stripe_customer_id, type="card"
        )

        print(customer.get("invoice_settings"))
        print(
            "===================================== DEFAULT PAYMENT",
            default_payment_method_id,
        )
        print(payment_methods)

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

        return StripeSubscriptionDetails(
            subscription_id=org.stripe_subscription_id,
            plan_name=plan_name,
            status=status,
            current_period_start=str(current_period_start),
            current_period_end=str(current_period_end),
            renewal_date=str(renewal_date),
            payment_methods=payment_methods_list,
        )
    except stripe.error.StripeError as e:
        return None
