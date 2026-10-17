"""Unit tests for backend.quotas helpers."""

from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from django.utils import timezone

from backend.quotas import (
    FEATURE_MIN_PLAN,
    can_add_environment,
    can_add_environments,
    can_use_log_streams,
    can_use_scim,
    get_plan_features,
    org_has_feature,
    plans_with_feature,
)
from ee.licensing.utils import instance_has_enterprise_license

_Q = "backend.quotas"
_L = "ee.licensing.utils"

# Paid features by tier. The same on Cloud and self-hosted.
PRO_FEATURES = {
    "custom_environments",
    "custom_roles",
    "teams",
    "network_access_policies",
    "rotating_secrets",
}
ENTERPRISE_FEATURES = {
    "global_network_access_policies",
    "sso",
    "scim",
    "log_streams",
    "dynamic_secrets",
}


def _org(plan):
    org = MagicMock()
    org.plan = plan
    return org


def test_feature_map_matches_plan_tiers():
    assert set(FEATURE_MIN_PLAN) == PRO_FEATURES | ENTERPRISE_FEATURES
    assert {f for f, p in FEATURE_MIN_PLAN.items() if p == "PR"} == PRO_FEATURES
    assert {f for f, p in FEATURE_MIN_PLAN.items() if p == "EN"} == ENTERPRISE_FEATURES


@pytest.mark.parametrize("feature", sorted(FEATURE_MIN_PLAN))
def test_org_has_feature_follows_plan_rank(feature):
    assert org_has_feature(_org("FR"), feature) is False
    assert org_has_feature(_org("PR"), feature) is (feature in PRO_FEATURES)
    assert org_has_feature(_org("EN"), feature) is True


def test_pro_plan_does_not_unlock_enterprise_features():
    """Plan is the single source of truth: license activation stamps the
    licensed tier onto organisation.plan, so a Pro-tier license (plan PR)
    must NOT unlock Enterprise features via a license short-circuit."""
    org = _org("PR")

    assert can_use_scim(org) is False
    assert can_use_log_streams(org) is False
    assert org_has_feature(org, "sso") is False
    assert can_add_environments(org, 11) is False


@pytest.mark.parametrize(
    "feature,plans",
    [
        ("custom_roles", ["PR", "EN"]),
        ("scim", ["EN"]),
    ],
)
def test_plans_with_feature(feature, plans):
    assert plans_with_feature(feature) == plans


def test_get_plan_features_reports_required_plan_and_access():
    features = get_plan_features(_org("PR"))

    assert set(features) == set(FEATURE_MIN_PLAN)
    assert features["custom_roles"] == {"enabled": True, "required_plan": "PR"}
    assert features["scim"] == {"enabled": False, "required_plan": "EN"}


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
    assert can_add_environments(_org(plan), count) is expected


@pytest.mark.parametrize(
    "plan,env_count,expected",
    [
        ("FR", 2, True),
        ("FR", 3, False),
        ("PR", 9, True),
        ("PR", 10, False),
        ("EN", 500, True),
    ],
)
def test_can_add_environment_enforces_plan_limits(plan, env_count, expected):
    app = MagicMock()
    app.organisation.plan = plan
    environment_model = MagicMock()
    environment_model.objects.filter.return_value.count.return_value = env_count

    with patch(f"{_Q}.apps.get_model", return_value=environment_model):
        assert can_add_environment(app) is expected


@pytest.mark.parametrize(
    "plan,expected",
    [
        ("FR", False),
        ("PR", False),
        ("EN", True),
    ],
)
def test_can_use_log_streams_is_enterprise_only(plan, expected):
    assert can_use_log_streams(_org(plan)) is expected


def _license_models(enterprise_license_exists):
    license_model = MagicMock()
    license_model.objects.filter.return_value.exists.return_value = (
        enterprise_license_exists
    )
    models = {
        "ActivatedPhaseLicense": license_model,
        "Organisation": MagicMock(ENTERPRISE_PLAN="EN"),
    }
    return license_model, lambda app_label, model_name: models[model_name]


def test_instance_license_counts_active_enterprise_licenses_only():
    license_model, get_model = _license_models(True)

    with patch(f"{_L}.apps.get_model", side_effect=get_model), patch(
        f"{_L}.settings", PHASE_LICENSE=None
    ):
        assert instance_has_enterprise_license() is True

    _, kwargs = license_model.objects.filter.call_args
    assert kwargs["plan"] == "EN"
    assert "expires_at__gte" in kwargs


@pytest.mark.parametrize(
    "offline_plan,days_left,expected",
    [
        (None, None, False),        # no offline license
        ("ENTERPRISE", 30, True),
        ("PRO", 30, False),         # Pro does not include instance SSO
        ("ENTERPRISE", -1, False),  # expired
    ],
)
def test_instance_license_falls_back_to_offline_license(
    offline_plan, days_left, expected
):
    """Without an activated Enterprise license, only a current Enterprise
    offline license counts."""
    _, get_model = _license_models(False)
    offline_license = None
    if offline_plan:
        offline_license = SimpleNamespace(
            plan=offline_plan,
            expires_at=timezone.now().date() + timedelta(days=days_left),
        )

    with patch(f"{_L}.apps.get_model", side_effect=get_model), patch(
        f"{_L}.settings", PHASE_LICENSE=offline_license
    ):
        assert instance_has_enterprise_license() is expected
