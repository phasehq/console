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
    """Stamp freshness after a password-only re-login. For a TOTP-enrolled
    user, password alone must NOT mint freshness — the next sensitive op then
    falls through to a full TOTP re-auth. Password-only accounts stamp."""
    from api.utils.mfa import user_has_active_totp

    if not user_has_active_totp(user):
        stamp_auth_time(request)


def relogin_preserving_session(request, user):
    """Re-issue the session after a credential rotation. login() cycles the
    session key, so the SSO auth context (auth_method + org-SSO binding) is
    captured and restored — otherwise require_sso enforcement loses its
    markers. Freshness re-stamps only for password-only accounts."""
    from django.contrib.auth import login

    prev_auth_method = request.session.get("auth_method", "password")
    prev_sso_org_id = request.session.get("auth_sso_org_id")
    prev_sso_provider_id = request.session.get("auth_sso_provider_id")
    login(request, user)
    request.session["auth_method"] = prev_auth_method
    if prev_sso_org_id:
        request.session["auth_sso_org_id"] = prev_sso_org_id
    if prev_sso_provider_id:
        request.session["auth_sso_provider_id"] = prev_sso_provider_id
    stamp_auth_time_after_relogin(request, user)


def is_safe_redirect_path(value):
    """True only for a same-origin relative path safe to redirect to.

    A leading-slash check is not enough: browsers treat a backslash as a
    slash, so `/\\evil.com` parses to an external authority. Require exactly
    one leading forward slash and no backslash or control characters."""
    if not isinstance(value, str) or not value:
        return False
    if value[0] != "/" or value.startswith("//"):
        return False
    if "\\" in value:
        return False
    return all(ord(c) >= 0x20 for c in value)


def auth_fresh_until(request):
    """Epoch second after which the session stops being fresh, or None when
    no auth_time is stamped. Exposed via /auth/me so the frontend can warn
    before a sensitive action instead of surprising the user with a
    re-login redirect — advisory only, the mutation gates stay
    server-side."""
    auth_time = request.session.get("auth_time")
    if not isinstance(auth_time, int):
        return None
    return auth_time + AUTH_FRESHNESS_MAX_AGE


def session_is_fresh(request):
    """Sessions created before this feature carry no auth_time and are
    treated as stale — the fail-safe direction."""
    deadline = auth_fresh_until(request)
    return deadline is not None and int(time.time()) <= deadline


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
