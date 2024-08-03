from api.models import Organisation
from api.utils.organisations import get_organisation_seats
import stripe
from django.conf import settings
from graphene import Mutation, ID, String
from graphql import GraphQLError


class CreateProUpgradeCheckoutSession(Mutation):
    class Arguments:
        organisation_id = ID(required=True)
        billing_period = String()

    client_secret = String()

    def mutate(self, info, organisation_id, billing_period):

        try:
            stripe.api_key = settings.STRIPE["secret_key"]

            organisation = Organisation.objects.get(id=organisation_id)
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
                return_url=f"{settings.OAUTH_REDIRECT_URI}/{organisation.name}/settings?stripe_session_id={{CHECKOUT_SESSION_ID}}",
            )
            return CreateProUpgradeCheckoutSession(client_secret=session.client_secret)

        except Organisation.DoesNotExist:
            raise GraphQLError("Organisation not found.")
        except Exception as e:
            raise GraphQLError(
                f"Something went wrong during checkout. Please try again."
            )
