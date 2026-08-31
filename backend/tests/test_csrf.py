"""CSRF protection for session-authenticated endpoints.

Coverage: the session-cookie mutation surface is CSRF-enforced — GraphQL and
logout (via CsrfViewMiddleware), the GitHub integration authorize form-POST
(csrfmiddlewaretoken form field), and the pre-login TOTP verify endpoint
(enforced in-view, since DRF's @api_view bypasses the middleware and the
endpoint is anonymous). The SPA fetches the token from /auth/csrf/ in the body
(the proxy marks cookies HttpOnly) and sends it as X-CSRFToken. Everything
else is intentionally out of scope: Public* REST APIs use bearer-token auth
(DRF skips CSRF for token/anonymous), identity/SCIM are signature/token, the
Stripe webhook is signature-verified, and Lockbox is a public shared-link. The
anonymous auth_password endpoints are DRF + AllowAny, so DRF does not enforce
CSRF on them — login-CSRF is an accepted lower-severity gap (closing it needs
a non-standard mechanism).
"""

from django.core.cache import cache
from django.test import Client


def test_csrf_endpoint_returns_token():
    resp = Client().get("/auth/csrf/")
    assert resp.status_code == 200
    assert resp.json()["csrfToken"]


def test_graphql_post_without_csrf_is_rejected():
    client = Client(enforce_csrf_checks=True)
    resp = client.post(
        "/graphql/",
        data={"query": "{ __typename }"},
        content_type="application/json",
    )
    assert resp.status_code == 403
    assert b"CSRF verification failed" in resp.content


def test_graphql_post_with_csrf_passes_csrf():
    client = Client(enforce_csrf_checks=True)
    token = client.get("/auth/csrf/").json()["csrfToken"]
    resp = client.post(
        "/graphql/",
        data={"query": "{ __typename }"},
        content_type="application/json",
        HTTP_X_CSRFTOKEN=token,
    )
    # The token clears CSRF; the request then fails at the auth layer (the
    # unauthenticated caller is denied), NOT at CSRF — proving the token worked.
    assert b"CSRF verification failed" not in resp.content


def test_logout_without_csrf_is_rejected():
    client = Client(enforce_csrf_checks=True)
    resp = client.post("/logout/")
    assert resp.status_code == 403
    assert b"CSRF verification failed" in resp.content


def test_logout_with_csrf_passes():
    client = Client(enforce_csrf_checks=True)
    token = client.get("/auth/csrf/").json()["csrfToken"]
    resp = client.post("/logout/", HTTP_X_CSRFTOKEN=token)
    assert resp.status_code == 200
    assert resp.json()["message"] == "Logged out"


def test_mfa_verify_without_csrf_is_rejected():
    # MfaVerifyThrottle (10/min, shared cache) can bleed across runs.
    cache.clear()
    client = Client(enforce_csrf_checks=True)
    resp = client.post(
        "/auth/mfa/verify/",
        data={"code": "000000"},
        content_type="application/json",
    )
    assert resp.status_code == 403
    assert resp.json()["code"] == "csrf_failed"


def test_mfa_verify_with_csrf_passes_csrf():
    cache.clear()
    client = Client(enforce_csrf_checks=True)
    token = client.get("/auth/csrf/").json()["csrfToken"]
    resp = client.post(
        "/auth/mfa/verify/",
        data={"code": "000000"},
        content_type="application/json",
        HTTP_X_CSRFTOKEN=token,
    )
    # CSRF cleared; the request then fails at the flow layer (no pending
    # sign-in in the session), NOT at CSRF.
    assert resp.status_code == 400
    assert resp.json()["code"] == "no_pending"


def test_github_authorize_without_csrf_is_rejected():
    client = Client(enforce_csrf_checks=True)
    resp = client.post("/oauth/github/authorize", data={"orgId": "x"})
    assert resp.status_code == 403
    assert b"CSRF verification failed" in resp.content


def test_github_authorize_with_csrf_passes_csrf():
    client = Client(enforce_csrf_checks=True)
    token = client.get("/auth/csrf/").json()["csrfToken"]
    # The SPA submits this as a real form POST, so the token rides in the
    # csrfmiddlewaretoken form field rather than a header.
    resp = client.post(
        "/oauth/github/authorize",
        data={"csrfmiddlewaretoken": token, "orgId": "x"},
    )
    # CSRF cleared; the unauthenticated caller is redirected to login,
    # NOT rejected with a CSRF 403.
    assert resp.status_code == 302
    assert b"CSRF verification failed" not in resp.content
