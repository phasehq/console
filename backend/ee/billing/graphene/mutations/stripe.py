from api.models import Organisation
from api.utils.organisations import get_organisation_seats
from api.utils.access.permissions import user_has_permission
import stripe
from django.conf import settings
from graphene import Mutation, ID, String, Boolean, ObjectType, Mutation
from graphql import GraphQLError


class CancelSubscriptionResponse(ObjectType):
    success = Boolean()
    message = String()
    canceled_at = String()
    status = String()


class CreateProUpgradeCheckoutSession(Mutation):
    class Arguments:
        organisation_id = ID(required=True)
        billing_period = String()

    client_secret = String()

    def mutate(self, info, organisation_id, billing_period):

        try:
            stripe.api_key = settings.STRIPE["secret_key"]

            organisation = Organisation.objects.get(id=organisation_id)

            if not user_has_permission(
                info.context.user, "update", "Billing", organisation
            ):
                raise GraphQLError("You don't have permission to update Billing")

            seats = get_organisation_seats(organisation)

            # Ensure the organisation has a Stripe customer ID
            if not organisation.stripe_customer_id:
                raise GraphQLError("Organisation must have a Stripe customer ID.")

            price = (
                settings.STRIPE["prices"]["pro_monthly"]
                if billing_period == "monthly"
                else settings.STRIPE["prices"]["pro_yearly"]
            )

            # Create the checkout session
            session = stripe.checkout.Session.create(
                mode="subscription",
                ui_mode="embedded",
                line_items=[
                    {
                        "price": price,
                        "quantity": seats,
                    },
                ],
                customer=organisation.stripe_customer_id,
                payment_method_types=["card"],
                subscription_data={
                    "trial_period_days": 30,
                },
                return_url=f"{settings.OAUTH_REDIRECT_URI}/{organisation.name}/settings?stripe_session_id={{CHECKOUT_SESSION_ID}}",
            )
            return CreateProUpgradeCheckoutSession(client_secret=session.client_secret)

        except Organisation.DoesNotExist:
            raise GraphQLError("Organisation not found.")
        except Exception as e:
            raise GraphQLError(
                f"Something went wrong during checkout. Please try again."
            )


class DeletePaymentMethodMutation(Mutation):
    class Arguments:
        organisation_id = ID()
        payment_method_id = String()

    ok = Boolean()

    def mutate(self, info, organisation_id, payment_method_id):
        org = Organisation.objects.get(id=organisation_id)

        if not user_has_permission(info.context.user, "update", "Billing", org):
            raise GraphQLError(
                "You don't have the permissions required to update Billing information in this Organisation."
            )

        try:
            stripe.api_key = settings.STRIPE["secret_key"]
            stripe.PaymentMethod.detach(payment_method_id)

            return DeletePaymentMethodMutation(ok=True)
        except Exception as e:
            raise GraphQLError("Something went wrong. Please try again.")


class CancelSubscriptionMutation(Mutation):
    class Arguments:
        organisation_id = ID()
        subscription_id = String(required=True)

    Output = CancelSubscriptionResponse

    def mutate(self, info, organisation_id, subscription_id):
        stripe.api_key = settings.STRIPE["secret_key"]

        org = Organisation.objects.get(id=organisation_id)

        if not user_has_permission(info.context.user, "update", "Billing", org):
            raise GraphQLError(
                "You don't have the permissions required to update Billing information in this Organisation."
            )

        if org.stripe_subscription_id != subscription_id:
            raise GraphQLError("The subscription ID provided is not valid.")

        try:
            # Retrieve the subscription
            subscription = stripe.Subscription.retrieve(subscription_id)

            # Cancel the subscription
            canceled_subscription = stripe.Subscription.delete(subscription_id)

            return CancelSubscriptionResponse(
                success=True,
                message="Subscription canceled successfully.",
                canceled_at=str(canceled_subscription["canceled_at"]),
                status=canceled_subscription["status"],
            )
        except stripe.error.InvalidRequestError as e:
            return CancelSubscriptionResponse(
                success=False,
                message=f"Error: {str(e)}",
                canceled_at=None,
                status=None,
            )
        except Exception as e:
            return CancelSubscriptionResponse(
                success=False,
                message=f"An unexpected error occurred: {str(e)}",
                canceled_at=None,
                status=None,
            )


class CreateSetupIntentMutation(Mutation):
    class Arguments:
        organisation_id = ID()

    client_secret = String()

    def mutate(self, info, organisation_id):
        stripe.api_key = settings.STRIPE["secret_key"]

        org = Organisation.objects.get(id=organisation_id)

        if not user_has_permission(info.context.user, "update", "Billing", org):
            raise GraphQLError(
                "You don't have the permissions required to update Billing information in this Organisation."
            )

        # Create a SetupIntent for the customer
        setup_intent = stripe.SetupIntent.create(
            customer=org.stripe_customer_id,
            payment_method_types=["card"],
        )

        return CreateSetupIntentMutation(client_secret=setup_intent.client_secret)


class SetDefaultPaymentMethodMutation(Mutation):
    class Arguments:
        # Arguments passed to the mutation
        organisation_id = ID()
        payment_method_id = String(
            required=True, description="Payment Method ID to set as default"
        )

    # Define the return type
    ok = Boolean()

    def mutate(root, info, organisation_id, payment_method_id):

        org = Organisation.objects.get(id=organisation_id)

        if not user_has_permission(info.context.user, "update", "Billing", org):
            raise GraphQLError(
                "You don't have the permissions required to update Billing information in this Organisation."
            )

        try:
            # Retrieve the customer from Stripe
            stripe.Customer.modify(
                org.stripe_customer_id,
                invoice_settings={"default_payment_method": payment_method_id},
            )

            return SetDefaultPaymentMethodMutation(ok=True)
        except stripe.error.StripeError as e:
            # Handle Stripe errors
            raise GraphQLError(f"Stripe error: {str(e)}")
        except Exception as e:
            # Handle other potential exceptions
            raise GraphQLError(f"An error occurred: {str(e)}")
