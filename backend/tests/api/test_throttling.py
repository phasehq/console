import logging

import pytest
from unittest.mock import Mock, patch
from rest_framework.test import APIRequestFactory
from api.throttling import PlanBasedRateThrottle


def make_org(org_id="org-1", plan="FR"):
    return Mock(id=org_id, plan=plan)


def _base_auth(**overrides):
    # Keys PhaseTokenAuthentication always sets on request.auth
    auth = {
        "token": "test-token",
        "auth_type": "User",
        "org_member": None,
        "service_token": None,
        "service_account": None,
        "service_account_token": None,
        "environment": None,
    }
    auth.update(overrides)
    return auth


# Builders mirroring the auth dict shapes authenticate() actually emits
def user_env_auth(org):
    env = Mock(app=Mock(organisation=org))
    return _base_auth(environment=env, app=env.app, org_member=Mock(organisation=org))


def user_app_auth(org):
    return _base_auth(app=Mock(organisation=org), org_member=Mock(organisation=org))


def user_org_auth(org):
    return _base_auth(
        org_only=True, organisation=org, org_member=Mock(organisation=org)
    )


def service_token_env_auth(org):
    env = Mock(app=Mock(organisation=org))
    return _base_auth(
        auth_type="Service", environment=env, app=env.app, service_token=Mock(app=env.app)
    )


def service_token_bootstrap_auth(org):
    app = Mock(organisation=org)
    return _base_auth(
        auth_type="Service", app=app, organisation=org, service_token=Mock(app=app)
    )


def service_account_org_auth(org):
    return _base_auth(
        auth_type="ServiceAccount",
        org_only=True,
        organisation=org,
        service_account=Mock(organisation=org),
    )


AUTH_SHAPES = [
    user_env_auth,
    user_app_auth,
    user_org_auth,
    service_token_env_auth,
    service_token_bootstrap_auth,
    service_account_org_auth,
]


class TestPlanBasedRateThrottle:

    @pytest.fixture(autouse=True)
    def setup_test_env(self, settings):
        """
        Configures the test environment, overrides settings, and initializes objects.
        Replaces setup_method to ensure correct ordering with settings overrides.
        """
        # 1. Override cache backend to use LocMemCache
        settings.CACHES = {
            "default": {
                "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            }
        }
        settings.DATABASES = {
            "default": {
                "ENGINE": "django.db.backends.sqlite3",
                "NAME": ":memory:",
            }
        }

        # 2. Force Django to reload the cache backend
        from django.core.cache import caches

        try:
            if "default" in caches:
                del caches["default"]
        except (AttributeError, KeyError):
            # Handle cases where asgiref/thread-local storage is inconsistent
            pass

        # 3. Initialize test objects (formerly in setup_method)
        self.factory = APIRequestFactory()
        self.throttle = PlanBasedRateThrottle()

        # Pin the clock so fixed-window tests can never straddle a boundary
        self.throttle.timer = lambda: 1_000_000.0

        # 4. Assign the fresh LocMemCache to the throttle and clear it
        from django.core.cache import cache

        self.throttle.cache = cache
        cache.clear()

    def build_request(self, auth=None, authenticated=True):
        request = self.factory.get("/")
        request.user = Mock(is_authenticated=authenticated)
        request.auth = auth
        return request

    @pytest.mark.parametrize("build_auth", AUTH_SHAPES, ids=lambda f: f.__name__)
    def test_cache_key_is_org_scoped_for_all_auth_shapes(self, build_auth):
        """Every auth shape authenticate() emits keys the org bucket exactly"""
        request = self.build_request(build_auth(make_org(org_id="org-123")))

        key = self.throttle.get_cache_key(request, None)
        assert key == "throttle_plan_based_org_org-123"

    def test_cache_key_shared_across_org_principals(self):
        """All principals of one org draw from a single shared bucket"""
        org = make_org(org_id="abc-123")

        keys = {
            self.throttle.get_cache_key(self.build_request(build_auth(org)), None)
            for build_auth in AUTH_SHAPES
        }
        assert keys == {"throttle_plan_based_org_abc-123"}

    def test_get_cache_key_anonymous(self):
        """Test cache key generation for anonymous user"""
        request = self.build_request(auth=None, authenticated=False)

        key = self.throttle.get_cache_key(request, None)
        assert key.startswith("throttle_plan_based_anon_")

    def test_get_organisation_falls_back_to_principals(self):
        """Defensive fallbacks for auth shapes authenticate() does not currently emit"""
        org = make_org()
        for auth in (
            _base_auth(org_member=Mock(organisation=org)),
            _base_auth(service_account=Mock(organisation=org)),
            _base_auth(
                auth_type="Service", service_token=Mock(app=Mock(organisation=org))
            ),
        ):
            request = self.build_request(auth)
            assert PlanBasedRateThrottle.get_organisation(request) is org

    @patch("api.throttling.CLOUD_HOSTED", True)
    def test_rate_selection_cloud_hosted_free_plan(self, settings):
        """Test that Free plan rate is applied in cloud mode"""
        settings.PLAN_RATE_LIMITS = {
            "FR": "10/min",
            "PR": "100/min",
            "DEFAULT": "5/min",
        }

        request = self.build_request(user_env_auth(make_org(plan="FR")))

        with patch.object(PlanBasedRateThrottle, "get_rate", return_value="5/min"):
            self.throttle.allow_request(request, None)

        assert self.throttle.rate == "10/min"
        assert self.throttle.num_requests == 10
        assert self.throttle.duration == 60

    @patch("api.throttling.CLOUD_HOSTED", True)
    def test_rate_selection_cloud_hosted_pro_plan(self, settings):
        """Test that Pro plan rate is applied in cloud mode"""
        settings.PLAN_RATE_LIMITS = {
            "FR": "10/min",
            "PR": "100/min",
            "DEFAULT": "5/min",
        }

        request = self.build_request(user_org_auth(make_org(plan="PR")))

        with patch.object(PlanBasedRateThrottle, "get_rate", return_value="5/min"):
            self.throttle.allow_request(request, None)

        assert self.throttle.rate == "100/min"

    @patch("api.throttling.CLOUD_HOSTED", True)
    def test_missing_plan_rate_falls_back_to_default(self, settings):
        """An unset per-plan rate falls back to DEFAULT instead of disabling throttling"""
        settings.PLAN_RATE_LIMITS = {
            "FR": None,
            "PR": "100/min",
            "DEFAULT": "7/min",
        }

        request = self.build_request(user_env_auth(make_org(plan="FR")))

        with patch.object(PlanBasedRateThrottle, "get_rate", return_value="5/min"):
            self.throttle.allow_request(request, None)

        assert self.throttle.rate == "7/min"

    @patch("api.throttling.CLOUD_HOSTED", False)
    def test_rate_selection_self_hosted_uses_default(self, settings):
        """Test that self-hosted mode ignores plan and uses default"""
        settings.PLAN_RATE_LIMITS = {"FR": "10/min", "DEFAULT": "5/min"}

        request = self.build_request(user_env_auth(make_org(plan="FR")))

        with patch.object(PlanBasedRateThrottle, "get_rate", return_value="5/min"):
            self.throttle.allow_request(request, None)

        assert self.throttle.rate == "5/min"

    @patch("api.throttling.CLOUD_HOSTED", True)
    def test_rate_selection_anonymous_uses_default(self, settings):
        """Test that anonymous requests use the default rate"""
        settings.PLAN_RATE_LIMITS = {"DEFAULT": "5/min"}

        request = self.build_request(auth=None, authenticated=False)

        with patch.object(PlanBasedRateThrottle, "get_rate", return_value="5/min"):
            self.throttle.allow_request(request, None)

        assert self.throttle.rate == "5/min"

    @patch("api.throttling.CLOUD_HOSTED", True)
    def test_unresolvable_auth_falls_back_to_ip_bucket_with_warning(
        self, settings, caplog
    ):
        """Authenticated requests with no resolvable org log a warning and use the IP bucket"""
        settings.PLAN_RATE_LIMITS = {"DEFAULT": "5/min"}

        request = self.build_request(_base_auth())

        with patch.object(PlanBasedRateThrottle, "get_rate", return_value="5/min"):
            with caplog.at_level(logging.WARNING, logger="api.throttling"):
                allowed = self.throttle.allow_request(request, None)

        assert allowed is True
        assert "Could not resolve an organisation" in caplog.text
        assert "anon_" in self.throttle.key

    @patch("api.throttling.CLOUD_HOSTED", True)
    def test_org_bucket_shared_enforcement(self, settings):
        """Different principals in one org consume the same rate limit"""
        settings.PLAN_RATE_LIMITS = {"FR": "2/min", "DEFAULT": "5/min"}

        org = make_org(org_id="org-1", plan="FR")

        def allow(auth):
            return self.throttle.allow_request(self.build_request(auth), None)

        assert allow(user_env_auth(org)) is True
        assert allow(service_token_env_auth(org)) is True
        # Org bucket exhausted — a third principal is throttled
        assert allow(user_org_auth(org)) is False
        # A different org is unaffected
        assert allow(user_env_auth(make_org(org_id="org-2", plan="FR"))) is True

    @patch("api.throttling.CLOUD_HOSTED", True)
    def test_throttled_wait_returns_window_remainder(self, settings):
        """wait() reports the seconds until the fixed window resets"""
        settings.PLAN_RATE_LIMITS = {"FR": "1/min", "DEFAULT": "5/min"}

        org = make_org(plan="FR")

        assert self.throttle.allow_request(self.build_request(user_env_auth(org)), None) is True
        assert self.throttle.allow_request(self.build_request(user_env_auth(org)), None) is False
        # Clock is pinned at 1,000,000s; the current 60s window resets at 1,000,020s
        assert self.throttle.wait() == 20.0

    @patch("api.throttling.CLOUD_HOSTED", True)
    def test_window_reset_allows_requests_again(self, settings):
        """A new fixed window starts a fresh count"""
        settings.PLAN_RATE_LIMITS = {"FR": "1/min", "DEFAULT": "5/min"}

        org = make_org(plan="FR")

        def allow():
            return self.throttle.allow_request(self.build_request(user_env_auth(org)), None)

        assert allow() is True
        assert allow() is False

        self.throttle.timer = lambda: 1_000_020.0
        assert allow() is True

    def test_no_rate_disables_throttling(self):
        """A None rate (e.g. self-hosted with RATE_LIMIT_DEFAULT unset) disables throttling"""
        request = self.build_request(auth={})

        with patch.object(PlanBasedRateThrottle, "get_rate", return_value=None):
            allowed = self.throttle.allow_request(request, None)

        assert allowed is True
        assert self.throttle.rate is None
