import ipaddress
import logging

from rest_framework.throttling import SimpleRateThrottle
from django.conf import settings

from api.utils.access.ip import get_client_ip

logger = logging.getLogger(__name__)

CLOUD_HOSTED = settings.APP_HOST == "cloud"

# A single IPv6 subscriber is normally allocated at least a /64, so
# per-address buckets could be rotated through for free.
IPV6_BUCKET_PREFIX = 64


def throttle_ident(request):
    """
    The client identity that per-IP throttle buckets are keyed on.

    Resolved with the same get_client_ip() used for audit logging and network
    access policies, so throttling always agrees with them about who the
    client is. DRF's default get_ident() keys on the raw X-Forwarded-For chain
    instead, which includes the proxy hops in front of the app. A hop can
    change between requests (e.g. a CDN edge appended by a load balancer),
    spreading one client across many buckets.

    Returns None if no valid client IP can be resolved.
    """
    raw = get_client_ip(request)
    if not raw:
        return None
    try:
        addr = ipaddress.ip_address(raw)
    except ValueError:
        return None
    if addr.version == 6:
        if addr.ipv4_mapped:
            return str(addr.ipv4_mapped)
        return str(
            ipaddress.IPv6Network((int(addr), IPV6_BUCKET_PREFIX), strict=False)
        )
    return str(addr)


class FixedWindowRateThrottle(SimpleRateThrottle):
    """
    Base for every Phase throttle: a fixed-window counter enforced with atomic
    cache operations (add + incr), keyed per client by throttle_ident().

    SimpleRateThrottle's default keeps a timestamp list per key and updates it
    with a read-modify-write, so concurrent requests for one key overwrite each
    other's writes and the limit under-counts. Subclasses provide
    get_cache_key() and a rate.
    """

    def get_ident(self, request):
        return throttle_ident(request) or super().get_ident(request)

    def allow_request(self, request, view):
        if self.rate is None:
            return True
        key = self.get_cache_key(request, view)
        if key is None:
            return True
        return self.consume(key)

    def consume(self, key):
        """Count one request against `key` in the current window."""
        now = self.timer()
        window = int(now // self.duration)
        self._window_reset = (window + 1) * self.duration
        self.key = f"{key}_{window}"

        # The TTL spans two windows so a counter can't expire while its window
        # is still being counted. Django's Redis incr() is EXISTS then INCR, and
        # an expiry between the two would recreate the key without a TTL.
        ttl = self.duration * 2
        self.cache.add(self.key, 0, ttl)
        try:
            count = self.cache.incr(self.key)
        except ValueError:
            # Evicted between add and incr
            self.cache.add(self.key, 0, ttl)
            count = self.cache.incr(self.key)

        if count == self.num_requests + 1:
            # Exactly one line per bucket per window: its first rejected request
            logger.warning("Rate limit exceeded: %s (limit %s)", self.key, self.rate)

        return count <= self.num_requests

    def wait(self):
        window_reset = getattr(self, "_window_reset", None)
        if window_reset is None:
            return None
        # Never report 0: DRF omits the Retry-After header for a falsy wait.
        return max(window_reset - self.timer(), 1)


class AnonIPRateThrottle(FixedWindowRateThrottle):
    """
    Per-client-IP limit for unauthenticated endpoints (login, signup, MFA...).

    Every subclass must set its own `scope`. The scope is part of the cache
    key, so throttles sharing one would draw down a single budget, each judged
    against its own rate.
    """

    def get_cache_key(self, request, view):
        if request.user and request.user.is_authenticated:
            return None  # Only throttle unauthenticated requests
        return self.cache_format % {
            "scope": self.scope,
            "ident": self.get_ident(request),
        }


class PlanBasedRateThrottle(FixedWindowRateThrottle):
    """
    Limits the rate of API calls based on the Organisation's plan.
    The limit is shared org-wide: all members, service accounts and
    service tokens of an organisation draw from a single bucket.
    Uses the pre-fetched organisation data from request.auth to avoid DB lookups.
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

        return self.consume(self._cache_key(org, request))

    @staticmethod
    def get_rate_for_plan(plan):
        # If self-hosted return the default rate limit. If not set, this will disable throttling
        if not CLOUD_HOSTED:
            return settings.PLAN_RATE_LIMITS["DEFAULT"]
        return settings.PLAN_RATE_LIMITS.get(plan) or settings.PLAN_RATE_LIMITS[
            "DEFAULT"
        ]
