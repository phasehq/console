import logging

from rest_framework.throttling import SimpleRateThrottle
from django.conf import settings

logger = logging.getLogger(__name__)

CLOUD_HOSTED = settings.APP_HOST == "cloud"


class PlanBasedRateThrottle(SimpleRateThrottle):
    """
    Limits the rate of API calls based on the Organisation's plan.
    The limit is shared org-wide: all members, service accounts and
    service tokens of an organisation draw from a single bucket.
    Uses the pre-fetched organisation data from request.auth to avoid DB lookups.

    Enforcement uses a fixed-window atomic counter (cache add + incr) rather
    than SimpleRateThrottle's read-modify-write history list, so concurrent
    workers cannot under-count the shared bucket.
    """

    scope = "plan_based"

    @staticmethod
    def get_organisation(request):
        """Resolve the requesting organisation from the auth context."""
        if not (request.user.is_authenticated and request.auth):
            return None

        auth = request.auth
        try:
            org = auth.get("organisation")
            if org is not None:
                return org

            env = auth.get("environment")
            if env is not None:
                return env.app.organisation

            app = auth.get("app")
            if app is not None:
                return app.organisation

            for principal_key in ("org_member", "service_account"):
                principal = auth.get(principal_key)
                if principal is not None:
                    return principal.organisation

            service_token = auth.get("service_token")
            if service_token is not None:
                return service_token.app.organisation
        except AttributeError:
            pass

        return None

    def get_cache_key(self, request, view):
        return self._cache_key(self.get_organisation(request), request)

    def _cache_key(self, org, request):
        if org is not None:
            ident = f"org_{org.id}"
        else:
            ident = f"anon_{self.get_ident(request)}"

        return self.cache_format % {"scope": self.scope, "ident": ident}

    def allow_request(self, request, view):
        """
        Resolve the org's plan rate, then count this request against the
        org's shared fixed-window bucket atomically.
        """
        org = self.get_organisation(request)

        if org is not None:
            self.rate = self.get_rate_for_plan(org.plan)
        else:
            if request.user.is_authenticated and request.auth:
                logger.warning(
                    "Could not resolve an organisation for authenticated request to %s; "
                    "throttling in the per-IP fallback bucket",
                    request.path,
                )
            # Default fallback (reads from REST_FRAMEWORK['DEFAULT_THROTTLE_RATES']['plan_based'])
            self.rate = self.get_rate()

        self.num_requests, self.duration = self.parse_rate(self.rate)

        if self.rate is None:
            return True

        now = self.timer()
        window = int(now // self.duration)
        self._window_reset = (window + 1) * self.duration
        self.key = f"{self._cache_key(org, request)}_{window}"

        self.cache.add(self.key, 0, self.duration)
        try:
            count = self.cache.incr(self.key)
        except ValueError:
            # Window key expired between add and incr
            self.cache.add(self.key, 0, self.duration)
            count = self.cache.incr(self.key)

        return count <= self.num_requests

    def wait(self):
        window_reset = getattr(self, "_window_reset", None)
        if window_reset is None:
            return None
        return max(window_reset - self.timer(), 0)

    @staticmethod
    def get_rate_for_plan(plan):
        # If self-hosted return the default rate limit. If not set, this will disable throttling
        if not CLOUD_HOSTED:
            return settings.PLAN_RATE_LIMITS["DEFAULT"]
        return settings.PLAN_RATE_LIMITS.get(plan) or settings.PLAN_RATE_LIMITS[
            "DEFAULT"
        ]
