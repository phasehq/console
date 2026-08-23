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


def stamp_auth_time_after_relogin(request, user):
    """Freshness stamp for the password-verified re-login sites
    (change-password, keyring recovery, email change). Only password is
    proven at those sites, so for a TOTP-enrolled user this must NOT mint
    freshness — a real login would demand the second factor. Leaving
    auth_time untouched keeps any prior (possibly stale) stamp, so the
    next sensitive op falls through to a full TOTP-backed re-auth.
    Password-only accounts stamp as before."""
    from api.utils.mfa import user_has_active_totp

    if not user_has_active_totp(user):
        stamp_auth_time(request)


def is_safe_redirect_path(value):
    """True only for a same-origin relative path safe to redirect to.

    A leading-slash prefix check alone is not enough: browsers treat a
    backslash as a slash when resolving a URL, so `/\\evil.com` (and
    `/\\/evil.com`, control-char variants) parse to an external authority
    despite passing `startswith('/') and not startswith('//')`. Require a
    string that starts with exactly one forward slash and contains no
    backslash or control characters."""
    if not isinstance(value, str) or not value:
        return False
    if value[0] != "/" or value.startswith("//"):
        return False
    if "\\" in value:
        return False
    return all(ord(c) >= 0x20 for c in value)


def session_is_fresh(request):
    """Sessions created before this feature carry no auth_time and are
    treated as stale — the fail-safe direction."""
    auth_time = request.session.get("auth_time")
    if not isinstance(auth_time, int):
        return False
    return (int(time.time()) - auth_time) <= AUTH_FRESHNESS_MAX_AGE


def require_fresh_session_graphql(context):
    """GraphQL variant of the freshness gate. The frontend matches the
    exact error message to trigger a re-login redirect; the extensions
    code lets Apollo's global errorLink suppress the raw-string toast."""
    from graphql import GraphQLError

    if not session_is_fresh(context):
        raise GraphQLError("reauth_required", extensions={"code": "REAUTH_REQUIRED"})


def require_fresh_session(view_func):
    """Gate a JSON view on session freshness. The frontend treats the
    reauth_required code as a redirect to /login with a return URL."""

    @functools.wraps(view_func)
    def wrapper(request, *args, **kwargs):
        if not session_is_fresh(request):
            return JsonResponse(REAUTH_ERROR, status=401)
        return view_func(request, *args, **kwargs)

    return wrapper
