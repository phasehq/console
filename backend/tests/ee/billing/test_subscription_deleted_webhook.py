"""Tests for the customer.subscription.deleted webhook handler."""

from unittest.mock import MagicMock, patch

import pytest

from api.models import Organisation
from ee.billing.webhooks import stripe as webhooks

PRICES = {
    "free": ["price_free_v1", "price_free_v2"],
    "pro_monthly": ["price_pro_m"],
    "pro_yearly": ["price_pro_y"],
    "enterprise_monthly": ["price_ent_m"],
    "enterprise_yearly": ["price_ent_y"],
}


def _sub(sub_id, price_id):
    return {"id": sub_id, "items": {"data": [{"price": {"id": price_id}}]}}


@pytest.fixture
def org():
    organisation = MagicMock()
    organisation.stripe_customer_id = "cus_123"
    organisation.stripe_subscription_id = "sub_pro"
    organisation.plan = Organisation.PRO_PLAN
    return organisation


def _run(org, active_subscriptions):
    event = {"data": {"object": {"customer": "cus_123"}}}
    with patch.object(webhooks.settings, "STRIPE", {"prices": PRICES}), patch.object(
        Organisation, "objects"
    ) as objects, patch.object(webhooks.stripe.Subscription, "list") as list_subs:
        objects.get.return_value = org
        list_subs.return_value = {"data": active_subscriptions}
        webhooks.handle_subscription_deleted(event)


def test_falls_back_to_active_free_subscription(org):
    _run(org, [_sub("sub_free", "price_free_v2")])

    assert org.stripe_subscription_id == "sub_free"
    assert org.plan == Organisation.FREE_PLAN
    org.save.assert_called_once()


def test_keeps_remaining_paid_subscription(org):
    _run(org, [_sub("sub_free", "price_free_v1"), _sub("sub_ent", "price_ent_y")])

    assert org.stripe_subscription_id == "sub_ent"
    assert org.plan == Organisation.PRO_PLAN


def test_clears_subscription_when_none_active(org):
    _run(org, [])

    assert org.stripe_subscription_id is None
    assert org.plan == Organisation.FREE_PLAN
