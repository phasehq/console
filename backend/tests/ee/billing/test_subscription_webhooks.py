"""The Stripe subscription webhooks save only the billing fields, so a webhook
handled while the org is restored or purged can't undo the restore or recreate
the org."""

from unittest.mock import MagicMock, patch

import pytest

from api.models import Organisation
from ee.billing.webhooks import stripe as webhooks

PRICES = {
    "free": ["price_free"],
    "pro_monthly": ["price_pro_m"],
    "pro_yearly": ["price_pro_y"],
    "enterprise_monthly": ["price_ent_m"],
    "enterprise_yearly": ["price_ent_y"],
}


@pytest.mark.parametrize(
    "handler",
    [
        webhooks.handle_subscription_created,
        webhooks.handle_subscription_updated,
        webhooks.handle_subscription_deleted,
    ],
)
def test_saves_only_billing_fields(handler):
    org = MagicMock()
    org.stripe_customer_id = "cus_123"
    event = {
        "data": {
            "object": {
                "id": "sub_pro",
                "customer": "cus_123",
                "items": {"data": [{"price": {"id": "price_pro_m"}}]},
            }
        }
    }

    with patch.object(webhooks.settings, "STRIPE", {"prices": PRICES}), patch.object(
        Organisation, "objects"
    ) as objects, patch.object(
        webhooks.stripe.Subscription, "list", return_value={"data": []}
    ):
        objects.get.return_value = org
        handler(event)

    org.save.assert_called_once_with(
        update_fields=["plan", "stripe_subscription_id", "updated_at"]
    )
