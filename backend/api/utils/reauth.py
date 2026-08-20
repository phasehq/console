import os
import time
import functools

from django.http import JsonResponse

# Sensitive account operations (linking/unlinking sign-in identities,
# account deletion) require a recently-authenticated session. Sessions
# are signed cookies, so the stamp itself is tamper-proof.
AUTH_FRESHNESS_MAX_AGE = int(os.getenv("AUTH_FRESHNESS_MAX_AGE_SECONDS", "900"))

REAUTH_ERROR = {
    "error": "Please sign in again to continue.",
    "code": "reauth_required",
}


def stamp_auth_time(request):
    """Record the moment of authentication in the session. Must be
    called after login() — login() cycles the session key."""
    request.session["auth_time"] = int(time.time())


def session_is_fresh(request):
    """Sessions created before this feature carry no auth_time and are
    treated as stale — the fail-safe direction."""
    auth_time = request.session.get("auth_time")
    if not isinstance(auth_time, int):
        return False
    return (int(time.time()) - auth_time) <= AUTH_FRESHNESS_MAX_AGE


def require_fresh_session_graphql(context):
    """GraphQL variant of the freshness gate. The frontend matches the
    exact error message to trigger a re-login redirect."""
    from graphql import GraphQLError

    if not session_is_fresh(context):
        raise GraphQLError("reauth_required")


def require_fresh_session(view_func):
    """Gate a JSON view on session freshness. The frontend treats the
    reauth_required code as a redirect to /login with a return URL."""

    @functools.wraps(view_func)
    def wrapper(request, *args, **kwargs):
        if not session_is_fresh(request):
            return JsonResponse(REAUTH_ERROR, status=401)
        return view_func(request, *args, **kwargs)

    return wrapper
