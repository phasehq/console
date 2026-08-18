"""CSRF protection for session-authenticated endpoints.

Coverage: the session-cookie mutation surface is GraphQL + logout, both now
CSRF-enforced (token from /auth/csrf/ in the body — the proxy marks cookies
HttpOnly — sent as X-CSRFToken). Everything else is intentionally out of scope:
Public* REST APIs use bearer-token auth (DRF skips CSRF for token/anonymous),
identity/SCIM are signature/token, the Stripe webhook is signature-verified, and
Lockbox is a public shared-link. The anonymous auth_password endpoints are DRF +
AllowAny, so DRF does not enforce CSRF on them — login-CSRF is an accepted
lower-severity gap (closing it needs a non-standard mechanism).
"""

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
