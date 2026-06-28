"""Unit tests for backend.quotas helpers."""

from unittest.mock import MagicMock, patch

import pytest

from backend.quotas import can_add_environments
from ee.licensing.utils import organisation_has_valid_license

_Q = "backend.quotas"
_L = "ee.licensing.utils"


def _org(plan):
    org = MagicMock()
    org.plan = plan
    return org


@pytest.mark.parametrize(
    "plan,count,expected",
    [
        ("FR", 3, True),   # Free: at the 3-env limit
        ("FR", 4, False),  # Free: over the limit
        ("PR", 10, True),  # Pro: at the 10-env limit
        ("PR", 11, False), # Pro: over the limit
        ("EN", 999, True), # Enterprise: unlimited
    ],
)
def test_can_add_environments_enforces_plan_limits(plan, count, expected):
    # No valid license -> plan limits apply.
    with patch(f"{_Q}.organisation_has_valid_license", return_value=False):
        assert can_add_environments(_org(plan), count) is expected


def test_can_add_environments_valid_license_bypasses_limit():
    # A valid (non-expired) license lifts the per-app env cap regardless of plan.
    with patch(f"{_Q}.organisation_has_valid_license", return_value=True):
        assert can_add_environments(_org("FR"), 100) is True


def test_valid_license_check_filters_on_expiry():
    """organisation_has_valid_license must exclude expired licenses by filtering
    on expires_at, not merely check that a license row exists."""
    model = MagicMock()
    model.objects.filter.return_value.exists.return_value = True

    with patch(f"{_L}.apps.get_model", return_value=model):
        assert organisation_has_valid_license(_org("EN")) is True

    _, kwargs = model.objects.filter.call_args
    assert "expires_at__gte" in kwargs


def test_expired_license_does_not_count_as_valid():
    """A stale (expired) license row must not be treated as valid: the
    expiry-filtered query returns nothing even though a row exists."""

    def _filter(**kwargs):
        qs = MagicMock()
        # The expiry-filtered query (the correct one) finds no *valid* license.
        qs.exists.return_value = "expires_at__gte" not in kwargs
        return qs

    model = MagicMock()
    model.objects.filter.side_effect = _filter

    with patch(f"{_L}.apps.get_model", return_value=model):
        assert organisation_has_valid_license(_org("FR")) is False
