"""Unit tests for backend.quotas helpers."""

import importlib
from unittest.mock import MagicMock, patch

import pytest
from django.test import override_settings

from backend.quotas import can_add_environments
from ee.licensing.utils import organisation_has_valid_license

_Q = "backend.quotas"
_L = "ee.licensing.utils"


def _org(plan):
    org = MagicMock()
    org.plan = plan
    return org


@pytest.fixture
def hosted(request):
    """backend.quotas as loaded on Cloud ("cloud") or self-hosted ("self"): the
    plan limits are worked out once, when the module is imported."""
    import backend.quotas as quotas

    try:
        with override_settings(APP_HOST=request.param):
            yield importlib.reload(quotas)
    finally:
        importlib.reload(quotas)


@pytest.mark.parametrize("hosted", ["cloud"], indirect=True)
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
def test_can_add_environments_enforces_plan_limits(hosted, plan, count, expected):
    # No valid license -> plan limits apply.
    with patch(f"{_Q}.organisation_has_valid_license", return_value=False):
        assert hosted.can_add_environments(_org(plan), count) is expected


@pytest.mark.parametrize(
    "hosted,limit,many_allowed",
    [("cloud", 3, False), ("self", None, True)],
    indirect=["hosted"],
)
def test_the_free_plan_environment_limit_is_for_cloud_only(hosted, limit, many_allowed):
    assert hosted.PLAN_CONFIG["FR"]["max_envs_per_app"] == limit
    with patch(f"{_Q}.organisation_has_valid_license", return_value=False):
        assert hosted.can_add_environments(_org("FR"), 50) is many_allowed


@pytest.mark.parametrize("hosted", ["cloud", "self"], indirect=True)
def test_the_paid_plan_environment_limits_do_not_depend_on_hosting(hosted):
    assert hosted.PLAN_CONFIG["PR"]["max_envs_per_app"] == 10
    assert hosted.PLAN_CONFIG["EN"]["max_envs_per_app"] is None


def test_can_add_environments_valid_license_bypasses_limit():
    # A valid (non-expired) license lifts the per-app env cap regardless of plan.
    with patch(f"{_Q}.organisation_has_valid_license", return_value=True):
        assert can_add_environments(_org("FR"), 100) is True


@pytest.mark.parametrize(
    "plan,expected",
    [
        ("FR", False),
        ("PR", False),
        ("EN", True),
    ],
)
def test_can_use_log_streams_is_enterprise_only(plan, expected):
    from backend.quotas import can_use_log_streams

    assert can_use_log_streams(_org(plan)) is expected


def test_can_use_log_streams_ignores_license_validity():
    """Plan is the single source of truth: license activation stamps the
    licensed tier onto organisation.plan, so a Pro-tier license (plan PR)
    must NOT unlock this Enterprise feature via a license short-circuit."""
    from backend.quotas import can_use_log_streams

    with patch(f"{_Q}.organisation_has_valid_license", return_value=True):
        assert can_use_log_streams(_org("PR")) is False
        assert can_use_log_streams(_org("EN")) is True


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
