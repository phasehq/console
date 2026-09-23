from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from graphql import GraphQLError

from ee.billing.graphene.queries import stripe as queries


def test_checkout_details_requires_org_context():
    from backend.schema import schema

    args = schema.graphql_schema.query_type.fields["stripeCheckoutDetails"].args
    assert str(args["organisationId"].type) == "ID!"


@pytest.fixture
def checkout(monkeypatch):
    org = SimpleNamespace(id="org-1", stripe_customer_id="cus_org")
    model = MagicMock()
    model.DoesNotExist = type("DoesNotExist", (Exception,), {})
    model.objects.get.return_value = org
    model.objects.filter.return_value.count.return_value = 1
    monkeypatch.setattr(queries, "Organisation", model)

    permission = MagicMock(return_value=True)
    monkeypatch.setattr(queries, "user_has_permission", permission)
    monkeypatch.setattr(queries.settings, "STRIPE", {"secret_key": "sk_test"})
    monkeypatch.setattr(queries.stripe, "api_key", "sk_test")

    session = MagicMock()
    session.get.side_effect = {"customer": "cus_org", "subscription": "sub_1"}.get
    session.payment_status = "paid"
    session.customer_details.email = "payer@example.com"
    retrieve_session = MagicMock(return_value=session)
    monkeypatch.setattr(queries.stripe.checkout.Session, "retrieve", retrieve_session)

    subscription = {
        "items": {"data": [{"plan": {"nickname": "Pro"}}]},
        "current_period_start": 1,
        "current_period_end": 2,
    }
    retrieve_subscription = MagicMock(return_value=subscription)
    monkeypatch.setattr(queries.stripe.Subscription, "retrieve", retrieve_subscription)

    user = object()
    info = SimpleNamespace(context=SimpleNamespace(user=user))
    return SimpleNamespace(
        org=org,
        model=model,
        permission=permission,
        session=session,
        retrieve_session=retrieve_session,
        retrieve_subscription=retrieve_subscription,
        info=info,
    )


def test_checkout_details_for_authorised_org(checkout):
    details = queries.resolve_stripe_checkout_details(
        None, checkout.info, "cs_org", organisation_id="org-1"
    )

    assert details.customer_email == "payer@example.com"
    assert details.plan_name == "Pro"
    checkout.permission.assert_called_once_with(
        checkout.info.context.user, "read", "Billing", checkout.org
    )
    checkout.retrieve_session.assert_called_once_with("cs_org")
    checkout.retrieve_subscription.assert_called_once_with("sub_1")


def test_checkout_details_requires_billing_read_before_stripe_lookup(checkout):
    checkout.permission.return_value = False

    with pytest.raises(GraphQLError, match="permission to view billing information"):
        queries.resolve_stripe_checkout_details(
            None, checkout.info, "cs_other", organisation_id="org-1"
        )

    checkout.retrieve_session.assert_not_called()


@pytest.mark.parametrize("customer_id", ["cus_other", None])
def test_checkout_details_rejects_session_from_other_customer(checkout, customer_id):
    checkout.session.get.side_effect = {
        "customer": customer_id,
        "subscription": "sub_other",
    }.get

    assert (
        queries.resolve_stripe_checkout_details(
            None, checkout.info, "cs_other", organisation_id="org-1"
        )
        is None
    )
    checkout.retrieve_subscription.assert_not_called()


@pytest.mark.parametrize("stripe_customer_id, matches", [(None, 1), ("cus_org", 2)])
def test_checkout_details_rejects_missing_or_ambiguous_org_customer(
    checkout, stripe_customer_id, matches
):
    checkout.org.stripe_customer_id = stripe_customer_id
    checkout.model.objects.filter.return_value.count.return_value = matches

    assert (
        queries.resolve_stripe_checkout_details(
            None, checkout.info, "cs_org", organisation_id="org-1"
        )
        is None
    )
    checkout.retrieve_session.assert_not_called()
