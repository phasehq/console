from rest_framework.throttling import SimpleRateThrottle
from django.conf import settings

CLOUD_HOSTED = settings.APP_HOST == "cloud"


class PlanBasedRateThrottle(SimpleRateThrottle):
    """
    Limits the rate of API calls based on the Organisation's plan.
    Uses the pre-fetched organisation data from request.auth to avoid DB lookups.
    """

    scope = "plan_based"

    def get_cache_key(self, request, view):
        # Identify the user or service account
        ident = self.get_ident(request)

        if request.user.is_authenticated and request.auth:
            if request.auth.get("org_member"):
                ident = f"user_{request.auth['org_member'].id}"
            elif request.auth.get("service_account"):
                ident = f"sa_{request.auth['service_account'].id}"
        else:
            ident = f"anon_{ident}"

        return self.cache_format % {"scope": self.scope, "ident": ident}

    def allow_request(self, request, view):
        """
        Override allow_request to dynamically set the rate based on the request user's plan.
        """
        # Default fallback (reads from REST_FRAMEWORK['DEFAULT_THROTTLE_RATES']['plan_based'])
        new_rate = self.get_rate()

        if request.user.is_authenticated and request.auth:
            env = request.auth.get("environment")
            if env:
                try:
                    plan = env.app.organisation.plan
                    new_rate = self.get_rate_for_plan(plan)
                except AttributeError:
                    pass

        # Update the throttle configuration for this specific request
        self.rate = new_rate
        self.num_requests, self.duration = self.parse_rate(self.rate)

        return super().allow_request(request, view)

    @staticmethod
    def get_rate_for_plan(plan):
        # If self-hosted return the default rate limit. If not set, this will disable throttling
        if not CLOUD_HOSTED:
            return settings.PLAN_RATE_LIMITS["DEFAULT"]
        return settings.PLAN_RATE_LIMITS.get(plan, settings.PLAN_RATE_LIMITS["DEFAULT"])
