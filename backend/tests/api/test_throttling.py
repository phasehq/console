import pytest
from unittest.mock import Mock, patch
from rest_framework.test import APIRequestFactory
from api.throttling import PlanBasedRateThrottle


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

        # 4. Assign the fresh LocMemCache to the throttle and clear it
        from django.core.cache import cache

        self.throttle.cache = cache
        cache.clear()

    def test_get_cache_key_authenticated_user(self):
        """Test cache key generation for standard authenticated user"""
        request = self.factory.get("/")
        request.user = Mock(is_authenticated=True)
        request.auth = {"org_member": Mock(id=123)}

        key = self.throttle.get_cache_key(request, None)
        assert "plan_based" in key
        assert "user_123" in key

    def test_get_cache_key_service_account(self):
        """Test cache key generation for service account"""
        request = self.factory.get("/")
        request.user = Mock(is_authenticated=True)
        request.auth = {"service_account": Mock(id=456)}

        key = self.throttle.get_cache_key(request, None)
        assert "plan_based" in key
        assert "sa_456" in key

    def test_get_cache_key_anonymous(self):
        """Test cache key generation for anonymous user"""
        request = self.factory.get("/")
        request.user = Mock(is_authenticated=False)
        request.auth = None

        key = self.throttle.get_cache_key(request, None)
        assert "plan_based" in key
        assert "anon" in key

    @patch("api.throttling.CLOUD_HOSTED", True)
    def test_rate_selection_cloud_hosted_free_plan(self, settings):
        """Test that Free plan rate is applied in cloud mode"""
        settings.PLAN_RATE_LIMITS = {
            "FR": "10/min",
            "PR": "100/min",
            "DEFAULT": "5/min",
        }

        request = self.factory.get("/")
        request.user = Mock(is_authenticated=True)

        # Mock environment structure
        mock_env = Mock()
        mock_env.app.organisation.plan = "FR"
        request.auth = {"environment": mock_env}

        # Mock get_rate to return default (simulating DRF settings)
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

        request = self.factory.get("/")
        request.user = Mock(is_authenticated=True)

        mock_env = Mock()
        mock_env.app.organisation.plan = "PR"
        request.auth = {"environment": mock_env}

        with patch.object(PlanBasedRateThrottle, "get_rate", return_value="5/min"):
            self.throttle.allow_request(request, None)

        assert self.throttle.rate == "100/min"

    @patch("api.throttling.CLOUD_HOSTED", False)
    def test_rate_selection_self_hosted_uses_default(self, settings):
        """Test that self-hosted mode ignores plan and uses default"""
        settings.PLAN_RATE_LIMITS = {"FR": "10/min", "DEFAULT": "5/min"}

        request = self.factory.get("/")
        request.user = Mock(is_authenticated=True)

        mock_env = Mock()
        mock_env.app.organisation.plan = "FR"  # Should be ignored
        request.auth = {"environment": mock_env}

        with patch.object(PlanBasedRateThrottle, "get_rate", return_value="5/min"):
            self.throttle.allow_request(request, None)

        assert self.throttle.rate == "5/min"

    @patch("api.throttling.CLOUD_HOSTED", True)
    def test_rate_selection_anonymous_uses_default(self, settings):
        """Test that anonymous requests use the default rate"""
        settings.PLAN_RATE_LIMITS = {"DEFAULT": "5/min"}

        request = self.factory.get("/")
        request.user = Mock(is_authenticated=False)
        request.auth = None

        with patch.object(PlanBasedRateThrottle, "get_rate", return_value="5/min"):
            self.throttle.allow_request(request, None)

        assert self.throttle.rate == "5/min"

    @patch("api.throttling.CLOUD_HOSTED", False)
    def test_self_hosted_no_default_disables_throttling(self, settings):
        """Test that self-hosted mode with no default set disables throttling"""
        settings.PLAN_RATE_LIMITS = {"DEFAULT": None}

        request = self.factory.get("/")
        request.user = Mock(is_authenticated=True)
        request.auth = {}

        # Reset rate to None to force allow_request to call get_rate() again
        # This ensures we test the logic inside get_rate with the new settings
        self.throttle.rate = None

        # We do NOT mock get_rate here. We want to verify that the REAL get_rate
        # returns None when CLOUD_HOSTED is False and DEFAULT is None.
        allowed = self.throttle.allow_request(request, None)

        assert allowed is True
