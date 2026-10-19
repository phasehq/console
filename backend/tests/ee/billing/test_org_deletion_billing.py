"""Stripe handling for organisation deletion: cancel paid subscriptions at period
end on request, resume only those on restore, cancel everything on purge."""

from unittest.mock import MagicMock, call, patch

import pytest

from ee.billing import stripe as billing

PRICES = {"free": ["price_free"]}


def _sub(sub_id, price_id, status="active", cancel_at_period_end=False, metadata=None):
    return {
        "id": sub_id,
        "status": status,
        "cancel_at_period_end": cancel_at_period_end,
        "metadata": metadata or {},
        "items": {"data": [{"price": {"id": price_id}}]},
    }


@pytest.fixture
def stripe_api():
    with patch.object(
        billing.settings, "STRIPE", {"secret_key": "sk_test", "prices": PRICES}
    ), patch.object(billing.stripe.Subscription, "list") as list_subs, patch.object(
        billing.stripe.Subscription, "modify"
    ) as modify, patch.object(
        billing.stripe.Subscription, "cancel"
    ) as cancel:
        yield MagicMock(list=list_subs, modify=modify, cancel=cancel)


def _with_subscriptions(stripe_api, subscriptions):
    stripe_api.list.return_value.auto_paging_iter.return_value = subscriptions


def _org(customer_id="cus_123"):
    return MagicMock(stripe_customer_id=customer_id)


class TestCancelAtPeriodEnd:
    def test_cancels_and_tags_only_paid_subscriptions(self, stripe_api):
        _with_subscriptions(
            stripe_api,
            [
                _sub("sub_pro", "price_pro"),
                _sub("sub_free", "price_free"),
                _sub("sub_already_cancelling", "price_pro", cancel_at_period_end=True),
            ],
        )

        billing.cancel_paid_subscriptions_at_period_end(_org())

        stripe_api.list.assert_called_once_with(customer="cus_123", status="all")
        stripe_api.modify.assert_called_once_with(
            "sub_pro",
            cancel_at_period_end=True,
            metadata={billing.ORG_DELETION_METADATA_KEY: "true"},
        )

    def test_org_without_a_customer_is_skipped(self, stripe_api):
        billing.cancel_paid_subscriptions_at_period_end(_org(customer_id=None))

        stripe_api.list.assert_not_called()
        stripe_api.modify.assert_not_called()


class TestResume:
    def test_resumes_only_subscriptions_cancelled_for_deletion(self, stripe_api):
        _with_subscriptions(
            stripe_api,
            [
                _sub(
                    "sub_tagged",
                    "price_pro",
                    cancel_at_period_end=True,
                    metadata={billing.ORG_DELETION_METADATA_KEY: "true"},
                ),
                _sub("sub_customer_cancelled", "price_pro", cancel_at_period_end=True),
            ],
        )

        billing.resume_subscriptions_cancelled_for_deletion(_org())

        stripe_api.modify.assert_called_once_with(
            "sub_tagged",
            cancel_at_period_end=False,
            metadata={billing.ORG_DELETION_METADATA_KEY: ""},
        )


class TestCancelAll:
    def test_cancels_every_open_subscription_now(self, stripe_api):
        _with_subscriptions(
            stripe_api,
            [
                _sub("sub_pro", "price_pro", cancel_at_period_end=True),
                _sub("sub_free", "price_free"),
                _sub("sub_trial", "price_pro", status="trialing"),
                _sub("sub_old", "price_pro", status="canceled"),
            ],
        )

        billing.cancel_all_subscriptions(_org())

        assert stripe_api.cancel.call_args_list == [
            call("sub_pro"),
            call("sub_free"),
            call("sub_trial"),
        ]


class TestUnpaidSubscriptions:
    @pytest.mark.parametrize(
        "subscription, unpaid",
        [
            (_sub("sub_pro", "price_pro", status="past_due"), True),
            (_sub("sub_pro", "price_pro", status="unpaid"), True),
            (_sub("sub_pro", "price_pro", status="active"), False),
            (_sub("sub_pro", "price_pro", status="incomplete"), False),
            (_sub("sub_free", "price_free", status="past_due"), False),
        ],
        ids=["past-due", "unpaid", "active", "incomplete", "free-past-due"],
    )
    def test_only_paid_subscriptions_awaiting_payment_count(
        self, stripe_api, subscription, unpaid
    ):
        _with_subscriptions(stripe_api, [subscription])

        assert billing.has_unpaid_subscriptions(_org()) is unpaid

    def test_one_unpaid_subscription_is_enough(self, stripe_api):
        _with_subscriptions(
            stripe_api,
            [
                _sub("sub_free", "price_free"),
                _sub("sub_ent", "price_ent", status="past_due"),
            ],
        )

        assert billing.has_unpaid_subscriptions(_org()) is True

    def test_org_without_a_stripe_customer(self, stripe_api):
        assert billing.has_unpaid_subscriptions(_org(customer_id=None)) is False
        stripe_api.list.assert_not_called()


class TestHasPendingInvoices:
    def test_self_hosted_never_calls_stripe(self, settings, stripe_api):
        from api.utils.organisation_deletion import has_pending_invoices

        settings.APP_HOST = "self"

        assert has_pending_invoices(_org()) is False
        stripe_api.list.assert_not_called()

    def test_cloud_checks_the_subscriptions(self, settings, stripe_api):
        from api.utils.organisation_deletion import has_pending_invoices

        settings.APP_HOST = "cloud"
        _with_subscriptions(stripe_api, [_sub("sub_pro", "price_pro", status="unpaid")])

        assert has_pending_invoices(_org()) is True


class TestPendingInvoicesQuery:
    QUERIES = "ee.billing.graphene.queries.stripe"

    def _resolve(self, allowed):
        from ee.billing.graphene.queries import stripe as queries

        with patch(f"{self.QUERIES}.Organisation") as org_model, patch(
            f"{self.QUERIES}.user_has_permission", return_value=allowed
        ), patch(f"{self.QUERIES}.has_pending_invoices", return_value=True) as check:
            result = queries.resolve_organisation_has_pending_invoices(
                None, MagicMock(), "org-1"
            )
        return result, check, org_model

    def test_returns_whether_invoices_are_pending(self):
        result, check, org_model = self._resolve(allowed=True)

        assert result is True
        check.assert_called_once_with(org_model.objects.get.return_value)

    def test_needs_billing_access(self):
        from graphql import GraphQLError

        with pytest.raises(GraphQLError, match="permission"):
            self._resolve(allowed=False)
