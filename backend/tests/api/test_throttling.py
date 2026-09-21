import logging
import threading
import time

import pytest
from unittest.mock import Mock, patch
from django.contrib.auth.models import AnonymousUser
from rest_framework.test import APIRequestFactory
from api.throttling import (
    AnonIPRateThrottle,
    FixedWindowRateThrottle,
    PlanBasedRateThrottle,
    throttle_ident,
)


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


def ip_request(factory, xff=None, real_ip=None, remote_addr="10.0.0.5"):
    """An unauthenticated request as it reaches Django behind a proxy."""
    extra = {"REMOTE_ADDR": remote_addr}
    if xff is not None:
        extra["HTTP_X_FORWARDED_FOR"] = xff
    if real_ip is not None:
        extra["HTTP_X_REAL_IP"] = real_ip
    request = factory.post("/", **extra)
    request.user = AnonymousUser()
    request.auth = None
    return request


class TestThrottleIdent:
    def setup_method(self):
        self.factory = APIRequestFactory()

    def ident(self, **kwargs):
        return throttle_ident(ip_request(self.factory, **kwargs))

    def test_rotating_proxy_hop_maps_to_one_client(self):
        """A proxy hop that changes per request (e.g. a CDN edge) must not split the client"""
        assert (
            self.ident(xff="203.0.113.9, 198.51.100.10")
            == self.ident(xff="203.0.113.9, 198.51.100.11")
            == "203.0.113.9"
        )

    def test_x_real_ip_preferred(self):
        """Self-hosted nginx sets X-Real-IP to $remote_addr; a forged XFF entry can't override it"""
        assert self.ident(xff="198.51.100.1, 203.0.113.9", real_ip="203.0.113.9") == "203.0.113.9"

    def test_falls_back_to_remote_addr(self):
        assert self.ident(remote_addr="203.0.113.20") == "203.0.113.20"

    def test_invalid_headers_fall_through(self):
        assert self.ident(xff="not-an-ip", real_ip="garbage", remote_addr="203.0.113.30") == "203.0.113.30"

    def test_ipv6_grouped_per_64(self):
        a = self.ident(xff="2001:db8:aaaa:bbbb::1")
        b = self.ident(xff="2001:db8:aaaa:bbbb:ffff:ffff:ffff:ffff")
        c = self.ident(xff="2001:db8:aaaa:cccc::1")
        assert a == b == "2001:db8:aaaa:bbbb::/64"
        assert c != a

    def test_ipv4_mapped_ipv6_normalised(self):
        assert self.ident(xff="::ffff:203.0.113.9") == "203.0.113.9"


class _TightThrottle(AnonIPRateThrottle):
    scope = "test_tight"
    rate = "3/min"


class _OtherThrottle(AnonIPRateThrottle):
    scope = "test_other"
    rate = "3/min"


class _BurstThrottle(AnonIPRateThrottle):
    scope = "test_burst"
    rate = "20/min"


class _SlowReadCache:
    """Widens the gap between reading a counter and writing it back, so a
    non-atomic (read-modify-write) counter over-admits under concurrency the
    way it does against Redis. Atomic add/incr never call get()."""

    def __init__(self, inner):
        self._inner = inner

    def get(self, *args, **kwargs):
        value = self._inner.get(*args, **kwargs)
        time.sleep(0.002)
        return value

    def __getattr__(self, name):
        return getattr(self._inner, name)


class TestAnonIPRateThrottle:
    @pytest.fixture(autouse=True)
    def setup(self):
        from django.core.cache import cache

        cache.clear()
        self.factory = APIRequestFactory()

    def make(self, cls):
        throttle = cls()
        # Pin the clock so fixed-window tests can never straddle a boundary
        throttle.timer = lambda: 1_000_000.0
        return throttle

    def allow(self, cls, **kwargs):
        return self.make(cls).allow_request(ip_request(self.factory, **kwargs), None)

    def test_limit_enforced_per_client(self):
        assert [self.allow(_TightThrottle, xff="203.0.113.9") for _ in range(4)] == [
            True, True, True, False,
        ]
        # A different client is unaffected
        assert self.allow(_TightThrottle, xff="203.0.113.10") is True

    def test_rotating_proxy_hop_cannot_bypass(self):
        """Regression: each distinct proxy hop used to get its own fresh bucket"""
        hops = ["198.51.100.10", "198.51.100.11", "198.51.100.12", "198.51.100.13"]
        results = [self.allow(_TightThrottle, xff=f"203.0.113.9, {hop}") for hop in hops]
        assert results == [True, True, True, False]

    def test_scopes_do_not_share_a_budget(self):
        """Exhausting one endpoint's budget must not throttle another endpoint"""
        for _ in range(3):
            assert self.allow(_TightThrottle, xff="203.0.113.9") is True
        assert self.allow(_TightThrottle, xff="203.0.113.9") is False
        assert self.allow(_OtherThrottle, xff="203.0.113.9") is True

    def test_authenticated_requests_are_not_throttled(self):
        request = ip_request(self.factory, xff="203.0.113.9")
        request.user = Mock(is_authenticated=True)
        throttle = self.make(_TightThrottle)
        assert throttle.get_cache_key(request, None) is None
        assert all(throttle.allow_request(request, None) for _ in range(10))

    def test_concurrent_requests_cannot_exceed_the_limit(self):
        """40 simultaneous requests against 20/min admit exactly 20"""
        results, lock = [], threading.Lock()
        barrier = threading.Barrier(40)

        from django.core.cache import cache

        def worker():
            throttle = self.make(_BurstThrottle)
            throttle.cache = _SlowReadCache(cache)
            request = ip_request(self.factory, xff="203.0.113.9")
            barrier.wait()
            allowed = throttle.allow_request(request, None)
            with lock:
                results.append(allowed)

        threads = [threading.Thread(target=worker) for _ in range(40)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        assert results.count(True) == 20

    def test_wait_is_never_zero(self):
        """DRF drops the Retry-After header when wait() is falsy"""
        throttle = self.make(_TightThrottle)
        for _ in range(4):
            throttle.allow_request(ip_request(self.factory, xff="203.0.113.9"), None)
        throttle.timer = lambda: 1_000_020.5  # just past the window reset
        assert throttle.wait() == 1

    def test_first_rejection_per_window_is_logged_once(self, caplog):
        with caplog.at_level(logging.WARNING, logger="api.throttling"):
            for _ in range(6):
                self.allow(_TightThrottle, xff="203.0.113.9")
        lines = [r.getMessage() for r in caplog.records if "Rate limit exceeded" in r.getMessage()]
        assert lines == ["Rate limit exceeded: throttle_test_tight_203.0.113.9_16666 (limit 3/min)"]

    def test_counter_ttl_outlives_its_window(self):
        from django.core.cache import cache

        throttle = self.make(_TightThrottle)
        throttle.cache = Mock(wraps=cache)
        throttle.allow_request(ip_request(self.factory, xff="203.0.113.9"), None)
        assert throttle.cache.add.call_args.args[2] == 120


def _attached_throttle_classes():
    """Every throttle class attached to a routed DRF view."""
    from django.urls import get_resolver
    from django.urls.resolvers import URLResolver

    found, stack = set(), [get_resolver()]
    while stack:
        for entry in stack.pop().url_patterns:
            if isinstance(entry, URLResolver):
                stack.append(entry)
                continue
            # DRF's as_view() (and @api_view) exposes the view class as .cls
            view_cls = getattr(entry.callback, "cls", None)
            found.update(getattr(view_cls, "throttle_classes", ()))
    return found


def test_every_throttle_uses_the_shared_identity_and_atomic_counter():
    """A throttle on DRF's own base would key on the raw XFF chain and race on a timestamp list"""
    classes = _attached_throttle_classes()
    assert classes
    offenders = sorted(
        f"{c.__module__}.{c.__qualname__}"
        for c in classes
        if not issubclass(c, FixedWindowRateThrottle)
    )
    assert not offenders, f"throttles not built on FixedWindowRateThrottle: {offenders}"


def test_anonymous_throttles_have_unique_scopes():
    anon = [
        c for c in _attached_throttle_classes()
        if issubclass(c, AnonIPRateThrottle)
    ]
    assert anon
    for c in anon:
        assert "scope" in vars(c), f"{c.__qualname__} must set its own scope"
    scopes = [c.scope for c in anon]
    shared = sorted({s for s in scopes if scopes.count(s) > 1})
    assert not shared, f"anonymous throttles sharing a scope: {shared}"

