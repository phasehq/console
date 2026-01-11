from api.models import Organisation
from api.utils.organisations import get_organisation_seats
from api.utils.access.permissions import user_has_permission
from ee.billing.graphene.types import BillingPeriodEnum, PlanTypeEnum
import stripe
from django.conf import settings
from graphene import Mutation, ID, String, Boolean, ObjectType, Mutation, Enum
from graphql import GraphQLError


class UpdateSubscriptionResponse(ObjectType):
    success = Boolean()
    message = String()
    cancelled_at = String()
    status = String()


class CreateSubscriptionCheckoutSession(Mutation):
    class Arguments:
        organisation_id = ID(required=True)
        plan_type = PlanTypeEnum()
        billing_period = BillingPeriodEnum()

    client_secret = String()

    def mutate(self, info, organisation_id, plan_type, billing_period):

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

            if plan_type == PlanTypeEnum.ENTERPRISE:
                price = (
                    settings.STRIPE["prices"]["enterprise_monthly"]
                    if billing_period == BillingPeriodEnum.MONTHLY
                    else settings.STRIPE["prices"]["enterprise_yearly"]
                )

            else:
                price = (
                    settings.STRIPE["prices"]["pro_monthly"]
                    if billing_period == BillingPeriodEnum.MONTHLY
                    else settings.STRIPE["prices"]["pro_yearly"]
                )

            # Create the checkout session
            session = stripe.checkout.Session.create(
                mode="subscription",
                billing_address_collection="required",
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
                    "trial_period_days": 14,
                },
                return_url=f"{settings.OAUTH_REDIRECT_URI}/{organisation.name}/settings?stripe_session_id={{CHECKOUT_SESSION_ID}}",
                saved_payment_method_options={
                    "allow_redisplay_filters": ["always", "limited", "unspecified"],
                },
            )
            return CreateSubscriptionCheckoutSession(
                client_secret=session.client_secret
            )

        except Organisation.DoesNotExist:
            raise GraphQLError("Organisation not found.")
        except Exception as e:
            raise GraphQLError(f"Error creating checkout session: {e}")


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

            payment_method = stripe.PaymentMethod.retrieve(payment_method_id)
            if payment_method.customer != org.stripe_customer_id:
                raise GraphQLError("Payment method does not belong to this organisation")

            stripe.PaymentMethod.detach(payment_method_id)

            return DeletePaymentMethodMutation(ok=True)
        except Exception as e:
            raise GraphQLError("Something went wrong. Please try again.")


class CancelSubscriptionMutation(Mutation):
    class Arguments:
        organisation_id = ID()
        subscription_id = String(required=True)

    Output = UpdateSubscriptionResponse

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

            # Cancel at the end of the current billing cycle
            updated_subscription = stripe.Subscription.modify(
                subscription_id, cancel_at_period_end=True
            )

            return UpdateSubscriptionResponse(
                success=True,
                message="Subscription set to cancel at the end of the current billing cycle.",
                cancelled_at=None,  # The subscription is not yet canceled
                status=updated_subscription["status"],
            )
        except stripe.error.InvalidRequestError as e:
            return UpdateSubscriptionResponse(
                success=False,
                message=f"Error: {str(e)}",
                cancelled_at=None,
                status=None,
            )
        except Exception as e:
            return UpdateSubscriptionResponse(
                success=False,
                message=f"An unexpected error occurred: {str(e)}",
                cancelled_at=None,
                status=None,
            )


class ResumeSubscriptionMutation(Mutation):
    class Arguments:
        organisation_id = ID()
        subscription_id = String(required=True)

    Output = UpdateSubscriptionResponse  # Reuse the response class for consistency

    def mutate(self, info, organisation_id, subscription_id):
        stripe.api_key = settings.STRIPE["secret_key"]

        try:
            org = Organisation.objects.get(id=organisation_id)

            if not user_has_permission(info.context.user, "update", "Billing", org):
                raise GraphQLError(
                    "You don't have the permissions required to update Billing information in this Organisation."
                )

            if org.stripe_subscription_id != subscription_id:
                raise GraphQLError("The subscription ID provided is not valid.")

            # Retrieve the subscription
            subscription = stripe.Subscription.retrieve(subscription_id)

            if not subscription.get("cancel_at_period_end"):
                raise GraphQLError("The subscription is not marked for cancellation.")

            # Resume the subscription by updating cancel_at_period_end to False
            updated_subscription = stripe.Subscription.modify(
                subscription_id, cancel_at_period_end=False
            )

            return UpdateSubscriptionResponse(
                success=True,
                message="Subscription resumed successfully.",
                cancelled_at=None,  # Reset cancelled_at since the subscription is active
                status=updated_subscription["status"],
            )
        except stripe.error.InvalidRequestError as e:
            return UpdateSubscriptionResponse(
                success=False,
                message=f"Error: {str(e)}",
                cancelled_at=None,
                status=None,
            )
        except Exception as e:
            return UpdateSubscriptionResponse(
                success=False,
                message=f"An unexpected error occurred: {str(e)}",
                cancelled_at=None,
                status=None,
            )


class ModifySubscriptionMutation(Mutation):
    class Arguments:
        organisation_id = ID(required=True)
        plan_type = PlanTypeEnum()
        billing_period = BillingPeriodEnum()
        subscription_id = String(required=True)

    Output = UpdateSubscriptionResponse

    def mutate(self, info, organisation_id, plan_type, billing_period, subscription_id):
        try:
            stripe.api_key = settings.STRIPE["secret_key"]

            organisation = Organisation.objects.get(id=organisation_id)

            if not user_has_permission(
                info.context.user, "update", "Billing", organisation
            ):
                raise GraphQLError("You don't have permission to update Billing")

            # Ensure the organisation has a Stripe customer ID
            if not organisation.stripe_customer_id:
                raise GraphQLError("Organisation must have a Stripe customer ID.")

            if organisation.stripe_subscription_id != subscription_id:
                raise GraphQLError("Invalid subscription ID")

            subscription = stripe.Subscription.retrieve(
                organisation.stripe_subscription_id
            )

            subscription_item_id = subscription["items"]["data"][0]["id"]

            if plan_type == PlanTypeEnum.ENTERPRISE:
                price = (
                    settings.STRIPE["prices"]["enterprise_monthly"]
                    if billing_period == BillingPeriodEnum.MONTHLY
                    else settings.STRIPE["prices"]["enterprise_yearly"]
                )

            else:
                price = (
                    settings.STRIPE["prices"]["pro_monthly"]
                    if billing_period == BillingPeriodEnum.MONTHLY
                    else settings.STRIPE["prices"]["pro_yearly"]
                )

            # Retrieve the subscription and update it with a new price
            updated_subscription = stripe.Subscription.modify(
                organisation.stripe_subscription_id,
                items=[
                    {
                        "id": subscription_item_id,  # Assuming there's only one item in the subscription
                        "price": price,
                        "quantity": get_organisation_seats(organisation),
                    },
                ],
            )

            return UpdateSubscriptionResponse(
                success=True,
                cancelled_at=None,
                message="Subscription modified successfully.",
                status=updated_subscription["status"],
            )
        except Organisation.DoesNotExist:
            raise GraphQLError("Organisation not found.")
        except stripe.error.InvalidRequestError as e:
            return UpdateSubscriptionResponse(
                success=False,
                cancelled_at=None,
                message=f"Stripe error: {str(e)}",
                status=None,
            )
        except Exception as e:
            return UpdateSubscriptionResponse(
                success=False,
                cancelled_at=None,
                message=f"An unexpected error occurred: {str(e)}",
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
            usage="off_session",
            automatic_payment_methods={
                "enabled": False,
            },
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

            stripe.PaymentMethod.modify(payment_method_id, allow_redisplay="limited")

            return SetDefaultPaymentMethodMutation(ok=True)
        except stripe.error.StripeError as e:
            # Handle Stripe errors
            raise GraphQLError(f"Stripe error: {str(e)}")
        except Exception as e:
            # Handle other potential exceptions
            raise GraphQLError(f"An error occurred: {str(e)}")
