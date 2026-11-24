"""Billing issues: paid subscriptions, or their invoices, awaiting payment. Every
member of the organisation reads them through a cache that the Stripe webhook clears."""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from django.core.cache.backends.locmem import LocMemCache
from graphql import GraphQLError

from ee.billing import stripe as billing
from ee.billing.graphene.types import BillingIssueEnum

PRICES = {"free": ["price_free"]}
INVOICE_URL = "https://invoice.stripe.com/i/acct_1/test_1"


def _sub(sub_id, price_id, status):
    return {
        "id": sub_id,
        "status": status,
        "items": {"data": [{"price": {"id": price_id}}]},
    }


def _org(customer_id="cus_123"):
    return MagicMock(id="org-1", stripe_customer_id=customer_id)


@pytest.fixture
def stripe_api():
    with patch.object(
        billing.settings, "STRIPE", {"secret_key": "sk_test", "prices": PRICES}
    ), patch.object(billing.stripe.Subscription, "list") as list_subs, patch.object(
        billing.stripe.Invoice, "list", return_value={"data": [], "has_more": False}
    ) as list_invoices:
        yield SimpleNamespace(subscriptions=list_subs, invoices=list_invoices)


def _with_subscriptions(stripe_api, subscriptions):
    stripe_api.subscriptions.return_value.auto_paging_iter.return_value = subscriptions


def _invoice(url=INVOICE_URL, **fields):
    """An open invoice, charged automatically and not yet attempted unless given."""
    return {
        "hosted_invoice_url": url,
        "collection_method": "charge_automatically",
        "attempted": False,
        **fields,
    }


def _with_invoices(stripe_api, *invoices):
    stripe_api.invoices.return_value = {"data": list(invoices), "has_more": False}


def _with_open_invoices(stripe_api, *urls):
    _with_invoices(stripe_api, *(_invoice(url) for url in urls))


@pytest.fixture
def cache():
    local = LocMemCache("billing-issue-tests", {})
    # Instances with the same name share storage.
    local.clear()
    with patch.object(billing, "cache", local):
        yield local


class TestGetBillingIssue:
    @pytest.mark.parametrize("status", ["past_due", "unpaid", "incomplete", "paused"])
    def test_paid_subscriptions_awaiting_payment(self, stripe_api, status):
        _with_subscriptions(stripe_api, [_sub("sub_pro", "price_pro", status)])

        assert billing.get_billing_issue(_org()) == billing.BillingIssue(status)
        stripe_api.subscriptions.assert_called_once_with(
            customer="cus_123", status="all"
        )

    @pytest.mark.parametrize("status", ["active", "trialing"])
    def test_settled_subscriptions(self, stripe_api, status):
        _with_subscriptions(stripe_api, [_sub("sub_pro", "price_pro", status)])

        assert billing.get_billing_issue(_org()) is None
        stripe_api.invoices.assert_called_once_with(
            customer="cus_123", status="open", limit=100
        )

    @pytest.mark.parametrize("status", ["canceled", "incomplete_expired"])
    def test_ended_subscriptions(self, stripe_api, status):
        _with_subscriptions(stripe_api, [_sub("sub_pro", "price_pro", status)])
        _with_invoices(stripe_api, _invoice(attempted=True))

        assert billing.get_billing_issue(_org()) is None
        stripe_api.invoices.assert_not_called()

    def test_free_subscriptions_are_ignored(self, stripe_api):
        _with_subscriptions(stripe_api, [_sub("sub_free", "price_free", "past_due")])
        _with_invoices(stripe_api, _invoice(attempted=True))

        assert billing.get_billing_issue(_org()) is None
        stripe_api.invoices.assert_not_called()

    def test_most_urgent_issue_wins(self, stripe_api):
        _with_subscriptions(
            stripe_api,
            [
                _sub("sub_trial", "price_pro", "paused"),
                _sub("sub_old", "price_pro", "past_due"),
                _sub("sub_ent", "price_ent", "unpaid"),
                _sub("sub_free", "price_free", "active"),
            ],
        )

        assert billing.get_billing_issue(_org()) == billing.BillingIssue("unpaid")

    def test_links_the_only_open_invoice(self, stripe_api):
        _with_subscriptions(stripe_api, [_sub("sub_pro", "price_pro", "past_due")])
        _with_open_invoices(stripe_api, INVOICE_URL)

        issue = billing.get_billing_issue(_org())

        assert issue == billing.BillingIssue("past_due", INVOICE_URL)
        stripe_api.invoices.assert_called_once_with(
            customer="cus_123", status="open", limit=100
        )

    def test_no_link_when_several_invoices_are_open(self, stripe_api):
        _with_subscriptions(stripe_api, [_sub("sub_pro", "price_pro", "past_due")])
        _with_open_invoices(stripe_api, INVOICE_URL, "https://invoice.stripe.com/i/2")

        assert billing.get_billing_issue(_org()) == billing.BillingIssue("past_due")

    def test_unpaid_invoice_on_an_active_subscription(self, stripe_api):
        # e.g. an older invoice, after the latest one was paid
        _with_subscriptions(stripe_api, [_sub("sub_pro", "price_pro", "active")])
        _with_invoices(stripe_api, _invoice(attempted=True))

        assert billing.get_billing_issue(_org()) == billing.BillingIssue(
            billing.UNPAID_INVOICE, INVOICE_URL
        )

    def test_invoice_not_charged_yet_is_not_overdue(self, stripe_api):
        _with_subscriptions(stripe_api, [_sub("sub_pro", "price_pro", "active")])
        _with_invoices(stripe_api, _invoice(attempted=False))

        assert billing.get_billing_issue(_org()) is None

    @pytest.mark.parametrize(
        "due_in, overdue", [(-86400, True), (86400, False), (None, False)]
    )
    def test_sent_invoice_is_overdue_after_its_due_date(
        self, stripe_api, due_in, overdue
    ):
        now = 1_800_000_000
        due_date = None if due_in is None else now + due_in
        _with_subscriptions(stripe_api, [_sub("sub_ent", "price_ent", "active")])
        _with_invoices(
            stripe_api, _invoice(collection_method="send_invoice", due_date=due_date)
        )

        with patch.object(billing.time, "time", return_value=now):
            issue = billing.get_billing_issue(_org())

        unpaid = billing.BillingIssue(billing.UNPAID_INVOICE, INVOICE_URL)
        assert issue == (unpaid if overdue else None)

    def test_unpaid_invoice_links_only_when_it_is_the_only_open_one(self, stripe_api):
        _with_subscriptions(stripe_api, [_sub("sub_pro", "price_pro", "active")])
        _with_invoices(
            stripe_api,
            _invoice("https://invoice.stripe.com/i/new"),
            _invoice(INVOICE_URL, attempted=True),
        )

        assert billing.get_billing_issue(_org()) == billing.BillingIssue(
            billing.UNPAID_INVOICE
        )

    def test_subscription_issue_wins_over_an_unpaid_invoice(self, stripe_api):
        _with_subscriptions(
            stripe_api,
            [
                _sub("sub_pro", "price_pro", "active"),
                _sub("sub_ent", "price_ent", "past_due"),
            ],
        )
        _with_invoices(stripe_api, _invoice(attempted=True))

        assert billing.get_billing_issue(_org()) == billing.BillingIssue(
            "past_due", INVOICE_URL
        )


class TestCachedBillingIssue:
    def test_stripe_is_checked_once_per_customer(self, stripe_api, cache):
        _with_subscriptions(stripe_api, [_sub("sub_pro", "price_pro", "past_due")])
        _with_open_invoices(stripe_api, INVOICE_URL)
        issue = billing.BillingIssue("past_due", INVOICE_URL)

        assert billing.cached_billing_issue(_org()) == issue
        assert billing.cached_billing_issue(_org()) == issue
        stripe_api.subscriptions.assert_called_once()
        stripe_api.invoices.assert_called_once()

    def test_no_issue_is_cached_too(self, stripe_api, cache):
        _with_subscriptions(stripe_api, [_sub("sub_pro", "price_pro", "active")])

        assert billing.cached_billing_issue(_org()) is None
        assert billing.cached_billing_issue(_org()) is None
        stripe_api.subscriptions.assert_called_once()

    def test_each_customer_is_cached_separately(self, stripe_api, cache):
        _with_subscriptions(stripe_api, [_sub("sub_pro", "price_pro", "past_due")])
        billing.cached_billing_issue(_org())

        _with_subscriptions(stripe_api, [_sub("sub_pro", "price_pro", "active")])

        assert billing.cached_billing_issue(_org(customer_id="cus_other")) is None

    def test_clearing_the_cache_checks_stripe_again(self, stripe_api, cache):
        _with_subscriptions(stripe_api, [_sub("sub_pro", "price_pro", "past_due")])
        billing.cached_billing_issue(_org())

        _with_subscriptions(stripe_api, [_sub("sub_pro", "price_pro", "active")])
        billing.clear_cached_billing_issue("cus_123")

        assert billing.cached_billing_issue(_org()) is None

    def test_stripe_errors_read_as_no_issue_and_retry_sooner(self, stripe_api):
        stripe_api.subscriptions.side_effect = billing.stripe.error.APIConnectionError(
            "Stripe is down"
        )

        with patch.object(billing, "cache") as cache:
            cache.get.return_value = None
            assert billing.cached_billing_issue(_org()) is None

        assert (
            cache.set.call_args.kwargs["timeout"]
            == billing.BILLING_ISSUE_ERROR_CACHE_TTL
        )

    def test_works_without_the_cache(self, stripe_api):
        _with_subscriptions(stripe_api, [_sub("sub_pro", "price_pro", "unpaid")])

        with patch.object(billing, "cache") as cache:
            cache.get.side_effect = ConnectionError
            cache.set.side_effect = ConnectionError
            issue = billing.cached_billing_issue(_org())

        assert issue == billing.BillingIssue("unpaid")

    def test_org_without_a_stripe_customer(self, stripe_api):
        with patch.object(billing, "cache") as cache:
            assert billing.cached_billing_issue(_org(customer_id=None)) is None

        cache.get.assert_not_called()
        stripe_api.subscriptions.assert_not_called()


class TestBillingIssueQuery:
    QUERIES = "ee.billing.graphene.queries.stripe"

    def _resolve(self, member=True, can_pay=True, issue=None):
        from ee.billing.graphene.queries import stripe as queries

        issue = issue or billing.BillingIssue("past_due", INVOICE_URL)
        with patch(f"{self.QUERIES}.Organisation") as org_model, patch(
            f"{self.QUERIES}.user_is_org_member", return_value=member
        ) as is_member, patch(
            f"{self.QUERIES}.user_has_permission", return_value=can_pay
        ) as has_permission, patch(
            f"{self.QUERIES}.cached_billing_issue", return_value=issue
        ) as check:
            info = MagicMock()
            result = queries.resolve_organisation_billing_issue(None, info, "org-1")
        return SimpleNamespace(
            result=result,
            check=check,
            is_member=is_member,
            has_permission=has_permission,
            org=org_model.objects.get.return_value,
            user=info.context.user,
        )

    def test_any_member_reads_the_status(self, settings):
        settings.APP_HOST = "cloud"

        call = self._resolve(can_pay=False)

        assert call.result.status == BillingIssueEnum.get("past_due")
        call.check.assert_called_once_with(call.org)

    @pytest.mark.parametrize(
        "status",
        ["unpaid", "past_due", "incomplete", "paused", billing.UNPAID_INVOICE],
    )
    def test_every_issue_has_a_graphql_status(self, settings, status):
        settings.APP_HOST = "cloud"

        call = self._resolve(issue=billing.BillingIssue(status))

        assert call.result.status.value == status

    def test_billing_updaters_get_the_invoice_link(self, settings):
        settings.APP_HOST = "cloud"

        call = self._resolve(can_pay=True)

        assert call.result.invoice_url == INVOICE_URL
        call.has_permission.assert_called_once_with(
            call.user, "update", "Billing", call.org
        )

    def test_other_members_never_get_the_invoice_link(self, settings):
        settings.APP_HOST = "cloud"

        call = self._resolve(can_pay=False)

        assert call.result.invoice_url is None

    def test_no_issue(self, settings):
        settings.APP_HOST = "cloud"

        with patch(f"{self.QUERIES}.cached_billing_issue", return_value=None), patch(
            f"{self.QUERIES}.user_is_org_member", return_value=True
        ), patch(f"{self.QUERIES}.Organisation"):
            from ee.billing.graphene.queries import stripe as queries

            assert (
                queries.resolve_organisation_billing_issue(None, MagicMock(), "org-1")
                is None
            )

    def test_needs_org_membership(self, settings):
        settings.APP_HOST = "cloud"

        with pytest.raises(GraphQLError, match="access"):
            self._resolve(member=False)

    def test_self_hosted_never_checks(self, settings):
        settings.APP_HOST = "self"

        call = self._resolve()

        assert call.result is None
        call.is_member.assert_not_called()
        call.check.assert_not_called()


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
