"""resolve_organisation_plan seat-limit reporting.

The frontend computes availableSeats = seatLimit - seatsUsed and uses it to
gate member invites (including bulk email import). When a plan has no seat cap
the backend must report seat_limit = None so the frontend can treat seats as
unlimited; a numeric value here would drive availableSeats negative and block
all invites on a self-hosted free plan.
"""

from unittest.mock import MagicMock, patch


_M = "backend.graphene.queries.quotas"


def _info(user=None):
    info = MagicMock()
    info.context.user = user or MagicMock()
    return info


def _make_org(plan="FR", pricing_version="v1"):
    org = MagicMock()
    org.plan = plan
    org.pricing_version = pricing_version
    return org


def test_self_hosted_free_plan_reports_unlimited_seats():
    """Non-cloud free plan -> seat_limit is None (unlimited)."""
    from backend.graphene.queries.quotas import resolve_organisation_plan

    org = _make_org(plan="FR")

    with patch(f"{_M}.user_is_org_member", return_value=True), patch(
        f"{_M}.CLOUD_HOSTED", False
    ), patch(
        f"{_M}.PLAN_CONFIG", {"FR": {"name": "Free", "max_users": None}}
    ), patch(
        f"{_M}.Organisation"
    ) as MockOrg, patch(
        f"{_M}.OrganisationMember"
    ) as MockMember, patch(
        f"{_M}.OrganisationMemberInvite"
    ) as MockInvite, patch(
        f"{_M}.ServiceAccount"
    ) as MockSA, patch(
        f"{_M}.App"
    ) as MockApp:
        MockOrg.FREE_PLAN = "FR"
        MockOrg.PRICING_V2 = "v2"
        MockOrg.objects.get.return_value = org
        MockMember.objects.filter.return_value.count.return_value = 2
        MockInvite.objects.filter.return_value.count.return_value = 1
        MockSA.objects.filter.return_value.count.return_value = 0
        MockApp.objects.filter.return_value.count.return_value = 0

        plan = resolve_organisation_plan(None, _info(), organisation_id="org-1")

    assert plan["seat_limit"] is None
    assert plan["seats_used"]["total"] == 3


def test_capped_plan_reports_numeric_seat_limit():
    """When the plan is capped, seat_limit comes from get_org_seat_limit."""
    from backend.graphene.queries.quotas import resolve_organisation_plan

    org = _make_org(plan="FR")

    with patch(f"{_M}.user_is_org_member", return_value=True), patch(
        f"{_M}.CLOUD_HOSTED", True
    ), patch(
        f"{_M}.PLAN_CONFIG", {"FR": {"name": "Free", "max_users": 5}}
    ), patch(
        "ee.billing.utils.get_org_seat_limit", return_value=5
    ), patch(
        f"{_M}.Organisation"
    ) as MockOrg, patch(
        f"{_M}.OrganisationMember"
    ) as MockMember, patch(
        f"{_M}.OrganisationMemberInvite"
    ) as MockInvite, patch(
        f"{_M}.ServiceAccount"
    ) as MockSA, patch(
        f"{_M}.App"
    ) as MockApp:
        MockOrg.FREE_PLAN = "FR"
        MockOrg.PRICING_V2 = "v2"
        MockOrg.objects.get.return_value = org
        MockMember.objects.filter.return_value.count.return_value = 2
        MockInvite.objects.filter.return_value.count.return_value = 0
        MockSA.objects.filter.return_value.count.return_value = 0
        MockApp.objects.filter.return_value.count.return_value = 0

        plan = resolve_organisation_plan(None, _info(), organisation_id="org-1")

    assert plan["seat_limit"] == 5
