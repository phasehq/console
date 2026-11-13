"""Billing issues: paid subscriptions awaiting payment. Every member of the
organisation reads them through a cache that the Stripe webhook clears."""

from unittest.mock import MagicMock, patch

import pytest
from django.core.cache.backends.locmem import LocMemCache
from graphql import GraphQLError

from ee.billing import stripe as billing
from ee.billing.graphene.types import BillingIssueEnum

PRICES = {"free": ["price_free"]}


def _sub(sub_id, price_id, status):
    return {
        "id": sub_id,
        "status": status,
        "items": {"data": [{"price": {"id": price_id}}]},
    }


def _org(customer_id="cus_123"):
    return MagicMock(id="org-1", stripe_customer_id=customer_id)


@pytest.fixture
def list_subscriptions():
    with patch.object(
        billing.settings, "STRIPE", {"secret_key": "sk_test", "prices": PRICES}
    ), patch.object(billing.stripe.Subscription, "list") as list_subs:
        yield list_subs


def _with_subscriptions(list_subscriptions, subscriptions):
    list_subscriptions.return_value.auto_paging_iter.return_value = subscriptions


@pytest.fixture
def cache():
    local = LocMemCache("billing-issue-tests", {})
    # Instances with the same name share storage.
    local.clear()
    with patch.object(billing, "cache", local):
        yield local


class TestGetBillingIssue:
    @pytest.mark.parametrize(
        "status, issue",
        [
            ("past_due", "past_due"),
            ("unpaid", "unpaid"),
            ("incomplete", "incomplete"),
            ("paused", "paused"),
            ("active", None),
            ("trialing", None),
            ("canceled", None),
            ("incomplete_expired", None),
        ],
    )
    def test_paid_subscription_status(self, list_subscriptions, status, issue):
        _with_subscriptions(list_subscriptions, [_sub("sub_pro", "price_pro", status)])

        assert billing.get_billing_issue(_org()) == issue
        list_subscriptions.assert_called_once_with(customer="cus_123", status="all")

    def test_free_subscriptions_are_ignored(self, list_subscriptions):
        _with_subscriptions(
            list_subscriptions, [_sub("sub_free", "price_free", "past_due")]
        )

        assert billing.get_billing_issue(_org()) is None

    def test_most_urgent_issue_wins(self, list_subscriptions):
        _with_subscriptions(
            list_subscriptions,
            [
                _sub("sub_trial", "price_pro", "paused"),
                _sub("sub_old", "price_pro", "past_due"),
                _sub("sub_ent", "price_ent", "unpaid"),
                _sub("sub_free", "price_free", "active"),
            ],
        )

        assert billing.get_billing_issue(_org()) == "unpaid"


class TestCachedBillingIssue:
    def test_stripe_is_checked_once_per_customer(self, list_subscriptions, cache):
        _with_subscriptions(
            list_subscriptions, [_sub("sub_pro", "price_pro", "past_due")]
        )

        assert billing.cached_billing_issue(_org()) == "past_due"
        assert billing.cached_billing_issue(_org()) == "past_due"
        list_subscriptions.assert_called_once()

    def test_no_issue_is_cached_too(self, list_subscriptions, cache):
        _with_subscriptions(
            list_subscriptions, [_sub("sub_pro", "price_pro", "active")]
        )

        assert billing.cached_billing_issue(_org()) is None
        assert billing.cached_billing_issue(_org()) is None
        list_subscriptions.assert_called_once()

    def test_each_customer_is_cached_separately(self, list_subscriptions, cache):
        _with_subscriptions(
            list_subscriptions, [_sub("sub_pro", "price_pro", "past_due")]
        )
        billing.cached_billing_issue(_org())

        _with_subscriptions(
            list_subscriptions, [_sub("sub_pro", "price_pro", "active")]
        )

        assert billing.cached_billing_issue(_org(customer_id="cus_other")) is None

    def test_clearing_the_cache_checks_stripe_again(self, list_subscriptions, cache):
        _with_subscriptions(
            list_subscriptions, [_sub("sub_pro", "price_pro", "past_due")]
        )
        billing.cached_billing_issue(_org())

        _with_subscriptions(
            list_subscriptions, [_sub("sub_pro", "price_pro", "active")]
        )
        billing.clear_cached_billing_issue("cus_123")

        assert billing.cached_billing_issue(_org()) is None

    def test_stripe_errors_read_as_no_issue_and_retry_sooner(self, list_subscriptions):
        list_subscriptions.side_effect = billing.stripe.error.APIConnectionError(
            "Stripe is down"
        )

        with patch.object(billing, "cache") as cache:
            cache.get.return_value = None
            assert billing.cached_billing_issue(_org()) is None

        assert (
            cache.set.call_args.kwargs["timeout"]
            == billing.BILLING_ISSUE_ERROR_CACHE_TTL
        )

    def test_works_without_the_cache(self, list_subscriptions):
        _with_subscriptions(
            list_subscriptions, [_sub("sub_pro", "price_pro", "unpaid")]
        )

        with patch.object(billing, "cache") as cache:
            cache.get.side_effect = ConnectionError
            cache.set.side_effect = ConnectionError
            assert billing.cached_billing_issue(_org()) == "unpaid"

    def test_org_without_a_stripe_customer(self, list_subscriptions):
        with patch.object(billing, "cache") as cache:
            assert billing.cached_billing_issue(_org(customer_id=None)) is None

        cache.get.assert_not_called()
        list_subscriptions.assert_not_called()


class TestBillingIssueQuery:
    QUERIES = "ee.billing.graphene.queries.stripe"

    def _resolve(self, member=True, issue="past_due"):
        from ee.billing.graphene.queries import stripe as queries

        with patch(f"{self.QUERIES}.Organisation") as org_model, patch(
            f"{self.QUERIES}.user_is_org_member", return_value=member
        ) as is_member, patch(
            f"{self.QUERIES}.cached_billing_issue", return_value=issue
        ) as check:
            result = queries.resolve_organisation_billing_issue(
                None, MagicMock(), "org-1"
            )
        return result, check, is_member, org_model

    def test_any_member_reads_the_issue(self, settings):
        settings.APP_HOST = "cloud"

        result, check, _, org_model = self._resolve()

        assert result == BillingIssueEnum.get("past_due")
        check.assert_called_once_with(org_model.objects.get.return_value)

    def test_no_issue(self, settings):
        settings.APP_HOST = "cloud"

        result, *_ = self._resolve(issue=None)

        assert result is None

    def test_needs_org_membership(self, settings):
        settings.APP_HOST = "cloud"

        with pytest.raises(GraphQLError, match="access"):
            self._resolve(member=False)

    def test_self_hosted_never_checks(self, settings):
        settings.APP_HOST = "self"

        result, check, is_member, _ = self._resolve()

        assert result is None
        is_member.assert_not_called()
        check.assert_not_called()


class TestWebhookClearsTheCache:
    def _receive(self, event, handler_error=None):
        from ee.billing.webhooks import stripe as webhooks

        request = MagicMock(body=b"{}", META={"HTTP_STRIPE_SIGNATURE": "t=1,v1=sig"})
        stripe_settings = {"secret_key": "sk_test", "webhook_secret": "whsec"}
        with patch.object(webhooks.settings, "STRIPE", stripe_settings), patch.object(
            webhooks.stripe.Webhook, "construct_event", return_value=event
        ), patch.object(
            webhooks, "handle_subscription_updated", side_effect=handler_error
        ), patch.object(
            webhooks, "clear_cached_billing_issue"
        ) as clear:
            response = webhooks.stripe_webhook(request)
        return response, clear

    def test_invoice_events_clear_the_customers_entry(self):
        event = {
            "id": "evt_1",
            "type": "invoice.payment_failed",
            "data": {"object": {"id": "in_1", "customer": "cus_123"}},
        }

        response, clear = self._receive(event)

        assert response.status_code == 200
        clear.assert_called_once_with("cus_123")

    def test_cleared_even_when_the_handler_fails(self):
        event = {
            "id": "evt_2",
            "type": "customer.subscription.updated",
            "data": {"object": {"id": "sub_pro", "customer": "cus_123"}},
        }

        response, clear = self._receive(event, handler_error=ValueError("boom"))

        assert response.status_code == 200
        clear.assert_called_once_with("cus_123")

    def test_events_without_a_customer_clear_nothing(self):
        event = {
            "id": "evt_3",
            "type": "product.updated",
            "data": {"object": {"id": "prod_1"}},
        }

        _, clear = self._receive(event)

        clear.assert_not_called()
