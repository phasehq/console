"""CSRF protection for session-authenticated endpoints.

Enforced surface: GraphQL, logout, the GitHub authorize form-POST, and the
pre-login TOTP verify endpoint (in-view — DRF views bypass the middleware).
Out of scope by design: bearer-token REST APIs, SCIM, the Stripe webhook,
Lockbox (public link), and the anonymous auth_password endpoints (login-CSRF
is an accepted lower-severity gap).
"""

from unittest.mock import Mock, patch

import pytest
from django.core.cache import cache
from django.middleware.csrf import rotate_token
from django.test import Client, RequestFactory


CSRF_FAILURE = {"error": "CSRF verification failed.", "code": "csrf_failed"}


def test_csrf_endpoint_returns_token():
    resp = Client().get("/auth/csrf/")
    assert resp.status_code == 200
    assert resp.json()["csrfToken"]
    assert resp.cookies["csrftoken"].value
    assert "no-store" in resp["Cache-Control"]
    assert "Cookie" in resp["Vary"]


def test_graphql_post_without_csrf_is_rejected():
    client = Client(enforce_csrf_checks=True)
    resp = client.post(
        "/graphql/",
        data={"query": "{ __typename }"},
        content_type="application/json",
    )
    assert resp.status_code == 403
    assert resp["Content-Type"] == "application/json"
    assert resp.json() == CSRF_FAILURE


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
    assert resp["Content-Type"] == "application/json"
    assert resp.json() == CSRF_FAILURE


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
    assert resp["Content-Type"] == "application/json"
    assert resp.json() == CSRF_FAILURE


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
    resp = client.post(
        "/oauth/github/authorize", data={"orgId": "x"}, HTTP_ACCEPT="text/html"
    )
    assert resp.status_code == 403
    assert resp["Content-Type"] == "application/json"
    assert resp.json() == CSRF_FAILURE


def test_github_authorize_with_csrf_passes_csrf():
    client = Client(enforce_csrf_checks=True)
    token = client.get("/auth/csrf/").json()["csrfToken"]
    # Form POST: the token rides in the form field, not a header
    resp = client.post(
        "/oauth/github/authorize",
        data={"csrfmiddlewaretoken": token, "orgId": "x"},
    )
    # CSRF cleared; the unauthenticated caller is redirected to login,
    # NOT rejected with a CSRF 403.
    assert resp.status_code == 302
    assert b"CSRF verification failed" not in resp.content


PROTECTED_ROUTES = (
    "/graphql/",
    "/logout/",
    "/auth/mfa/verify/",
    "/oauth/github/authorize",
)


@pytest.fixture
def browser_client(settings):
    # Match the existing ALLOWED_ORIGINS -> CSRF_TRUSTED_ORIGINS contract.
    # Do not override SECURE_PROXY_SSL_HEADER: exercise the shipped setting.
    settings.ALLOWED_HOSTS = ["testserver", "backend", "console.example.com"]
    settings.CSRF_TRUSTED_ORIGINS = [
        "https://console.phase.dev",
        "https://console.example.com",
        "https://console.internal:8443",
    ]
    cache.clear()
    return Client(enforce_csrf_checks=True)


def _post_protected(client, route, token, **headers):
    if route.endswith("/oauth/github/authorize"):
        return client.post(route, {"csrfmiddlewaretoken": token}, **headers)
    payload = {"query": "{ __typename }"} if route.endswith("/graphql/") else {}
    return client.post(
        route,
        payload,
        content_type="application/json",
        HTTP_X_CSRFTOKEN=token,
        **headers,
    )


@pytest.mark.parametrize("route", PROTECTED_ROUTES)
@pytest.mark.parametrize(
    "origin,prefix,forwarded_proto",
    [
        ("https://console.example.com", "", None),  # bundled nginx
        ("https://console.phase.dev", "/service", "https"),  # cloud ALB
        ("https://console.example.com", "", "http"),  # multiple proxy hops
        ("https://console.internal:8443", "/service", None),  # custom ingress
    ],
)
def test_trusted_browser_origin_over_http_backend(
    browser_client, route, origin, prefix, forwarded_proto
):
    token = browser_client.get(f"{prefix}/auth/csrf/").json()["csrfToken"]
    headers = {"HTTP_ORIGIN": origin, "HTTP_HOST": "backend:8000"}
    if forwarded_proto is not None:
        headers["HTTP_X_FORWARDED_PROTO"] = forwarded_proto

    # Only the user lookup is mocked; routing, middleware and GraphQL execute.
    if route == "/graphql/":
        with patch(
            "django.contrib.auth.get_user", return_value=Mock(is_authenticated=True)
        ):
            response = _post_protected(browser_client, prefix + route, token, **headers)
        assert response.status_code == 200
        assert response.json()["data"]["__typename"] == "Query"
    else:
        response = _post_protected(browser_client, prefix + route, token, **headers)
        if route == "/logout/":
            assert response.status_code == 200
        elif route == "/auth/mfa/verify/":
            assert response.status_code == 400
            assert response.json()["code"] == "no_pending"
        else:
            assert response.status_code == 302
            assert "login_required" in response["Location"]
    assert not response.wsgi_request.is_secure()


@pytest.mark.parametrize("route", PROTECTED_ROUTES)
@pytest.mark.parametrize("origin", ["https://untrusted.example", "null"])
def test_valid_token_does_not_allow_untrusted_origin(browser_client, route, origin):
    token = browser_client.get("/auth/csrf/").json()["csrfToken"]
    response = _post_protected(browser_client, route, token, HTTP_ORIGIN=origin)
    assert response.status_code == 403
    assert response.json() == CSRF_FAILURE


@pytest.mark.parametrize("route", PROTECTED_ROUTES)
def test_trusted_origin_does_not_allow_mismatched_token(browser_client, route):
    browser_client.get("/auth/csrf/")
    unrelated_token = Client().get("/auth/csrf/").json()["csrfToken"]
    response = _post_protected(
        browser_client, route, unrelated_token, HTTP_ORIGIN="https://console.example.com"
    )
    assert response.status_code == 403
    assert response.json() == CSRF_FAILURE


def test_https_alias_must_be_in_trusted_origins_without_proxy_trust(browser_client):
    token = browser_client.get("/auth/csrf/").json()["csrfToken"]
    response = _post_protected(
        browser_client,
        "/logout/",
        token,
        HTTP_HOST="console.example.com",
        HTTP_ORIGIN="https://console.example.com:8443",
        HTTP_X_FORWARDED_PROTO="https",
    )
    assert response.status_code == 403


def test_token_refresh_recovers_from_login_secret_rotation(browser_client):
    stale_token = browser_client.get("/auth/csrf/").json()["csrfToken"]
    # login() rotates the CSRF secret and sends it back in a cookie.
    login_request = RequestFactory().get("/")
    rotate_token(login_request)
    browser_client.cookies["csrftoken"] = login_request.META["CSRF_COOKIE"]
    rejected = _post_protected(browser_client, "/logout/", stale_token)
    assert rejected.status_code == 403
    fresh_token = browser_client.get("/auth/csrf/").json()["csrfToken"]
    assert _post_protected(browser_client, "/logout/", fresh_token).status_code == 200


@pytest.mark.parametrize(
    "secure,referer,status",
    [
        (False, None, 200),
        (False, "https://untrusted.example/", 200),
        (True, None, 403),
        (True, "https://console.example.com/account", 200),
        (True, "https://untrusted.example/", 403),
    ],
)
def test_missing_origin_referer_behavior(browser_client, secure, referer, status):
    # Document the tradeoff: an HTTP backend cannot apply Django's HTTPS-only
    # Referer fallback. A valid CSRF token is still required in either case.
    token = browser_client.get("/auth/csrf/").json()["csrfToken"]
    headers = {"HTTP_REFERER": referer} if referer else {}
    response = _post_protected(
        browser_client, "/logout/", token, secure=secure, **headers
    )
    assert response.status_code == status


@pytest.mark.parametrize("prefix", ["", "/service/public"])
def test_public_api_post_reaches_token_auth_without_csrf(browser_client, prefix):
    response = browser_client.post(
        f"{prefix}/v1/apps/", {}, content_type="application/json"
    )
    assert response.status_code == 401
    assert response["WWW-Authenticate"] == "Bearer"
    assert b"CSRF" not in response.content
