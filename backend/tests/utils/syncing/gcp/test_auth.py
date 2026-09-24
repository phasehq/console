import base64
import json
import os
from unittest.mock import patch

import jwt
import pytest
import requests

from api.utils.crypto import random_key_pair
from api.utils.syncing.gcp import auth
from api.utils.syncing.gcp.auth import (
    GCPAuthError,
    TokenSource,
    build_assertion,
    default_issuer,
    exchange_token,
    generate_workload_identity_key,
    normalize_workload_identity_provider,
    open_workload_identity,
    seal_workload_identity,
)

from .conftest import FakeResponse

ORG_ID = "7b1e3f7a-2c1d-4a3b-9e8f-0123456789ab"
PROVIDER = "projects/123456789012/locations/global/workloadIdentityPools/phase/providers/phase-console"
ORIGIN = {"ALLOWED_ORIGINS": "https://console.phase.dev"}


@pytest.fixture(scope="module")
def identity():
    with patch.dict(os.environ, ORIGIN):
        return generate_workload_identity_key(ORG_ID)


@pytest.fixture
def credentials(identity):
    return {
        "workload_identity_provider": PROVIDER,
        "issuer": identity["issuer"],
        "subject": identity["subject"],
        "key_id": identity["key_id"],
        "private_key": identity["private_key"],
    }


def _public_key(identity):
    return jwt.PyJWK(identity["jwks"]["keys"][0]).key


# ---- the identity Phase mints -------------------------------------------------


def test_generated_identity(identity):
    assert identity["issuer"] == "https://console.phase.dev"
    assert identity["subject"] == f"phase:org:{ORG_ID}:key:{identity['key_id']}"
    assert len(identity["subject"].encode()) <= 127
    assert identity["private_key"].startswith("-----BEGIN PRIVATE KEY-----")


def test_jwks_has_only_the_fields_google_accepts(identity):
    (key,) = identity["jwks"]["keys"]
    assert set(key) == {"kty", "alg", "use", "kid", "n", "e"}
    assert key["kty"] == "RSA"
    assert key["alg"] == "RS256"
    assert key["kid"] == identity["key_id"]
    assert key["e"] == "AQAB"


def test_every_credential_gets_its_own_key(identity):
    with patch.dict(os.environ, ORIGIN):
        other = generate_workload_identity_key(ORG_ID)
    assert other["key_id"] != identity["key_id"]
    assert other["jwks"] != identity["jwks"]


@pytest.mark.parametrize(
    ("configured", "expected"),
    [
        ("https://console.phase.dev", "https://console.phase.dev"),
        ("https://phase.internal.example/some/path", "https://phase.internal.example"),
        ("http://localhost:8080", "https://localhost:8080"),
        # The first origin, as for links in emails.
        (" https://phase.example.com , https://other", "https://phase.example.com"),
        # Credentials in the URL never reach the issuer.
        ("https://user:secret@phase.example.com:8443", "https://phase.example.com:8443"),
        ("https://Phase.Example.com", "https://phase.example.com"),
    ],
)
def test_issuer_is_the_first_allowed_origin_over_https(monkeypatch, configured, expected):
    monkeypatch.setenv("ALLOWED_ORIGINS", configured)
    assert default_issuer() == expected


def test_issuer_needs_a_configured_url(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", "")
    with pytest.raises(GCPAuthError, match="ALLOWED_ORIGINS"):
        default_issuer()


@pytest.mark.parametrize(
    "configured",
    ["https://[::1]:8443", "https://phase_host.internal", "https://phase.example.com:port", "phase.example.com"],
)
def test_an_origin_that_cannot_be_an_issuer_fails_when_setup_starts(monkeypatch, configured):
    monkeypatch.setenv("ALLOWED_ORIGINS", configured)
    with pytest.raises(GCPAuthError, match="can't be used as the token issuer"):
        generate_workload_identity_key(ORG_ID)


# ---- provider names -----------------------------------------------------------


@pytest.mark.parametrize(
    "value",
    [
        PROVIDER,
        f"//iam.googleapis.com/{PROVIDER}",
        f"https://iam.googleapis.com/{PROVIDER}",
        f"  {PROVIDER}\n",
    ],
)
def test_provider_name_forms_are_normalized(value):
    assert normalize_workload_identity_provider(value) == PROVIDER


@pytest.mark.parametrize(
    "value",
    [
        "",
        "projects/my-project/locations/global/workloadIdentityPools/phase/providers/phase",
        "projects/123/locations/us-central1/workloadIdentityPools/phase/providers/phase",
        "projects/123/locations/global/workloadIdentityPools/Phase/providers/phase",
        "projects/123/locations/global/workloadIdentityPools/phase",
        "https://evil.example/projects/123/locations/global/workloadIdentityPools/phase/providers/phase",
    ],
)
def test_malformed_provider_names_are_rejected(value):
    with pytest.raises(ValueError):
        normalize_workload_identity_provider(value)


# ---- the token Phase signs ----------------------------------------------------


def test_assertion_claims(identity, credentials):
    token = build_assertion(credentials, now=1_800_000_000)

    header = jwt.get_unverified_header(token)
    assert header["alg"] == "RS256"
    assert header["kid"] == identity["key_id"]

    claims = jwt.decode(
        token,
        _public_key(identity),
        algorithms=["RS256"],
        audience=f"https://iam.googleapis.com/{PROVIDER}",
        issuer="https://console.phase.dev",
        options={"verify_exp": False, "verify_iat": False},
    )
    assert claims["sub"] == identity["subject"]
    # Backdated for clock skew. Google caps the federated token at the
    # assertion's lifetime, so this is how long one exchange lasts.
    assert claims["iat"] == 1_800_000_000 - 30
    assert claims["exp"] - claims["iat"] == 3600
    assert claims["jti"]


def test_assertion_accepts_the_audience_form_of_the_provider(identity, credentials):
    credentials["workload_identity_provider"] = f"//iam.googleapis.com/{PROVIDER}"
    token = build_assertion(credentials)
    claims = jwt.decode(
        token,
        _public_key(identity),
        algorithms=["RS256"],
        audience=f"https://iam.googleapis.com/{PROVIDER}",
    )
    assert claims["iss"] == "https://console.phase.dev"


# ---- exchanging it with Google's STS -------------------------------------------


def test_exchange_posts_a_token_exchange_request(identity, credentials):
    response = FakeResponse(200, {"access_token": "ya29.federated", "expires_in": 3599})
    with patch.object(auth.requests, "post", return_value=response) as post:
        token, expires_at = exchange_token(credentials)

    assert token == "ya29.federated"
    (url,), kwargs = post.call_args
    assert url == "https://sts.googleapis.com/v1/token"
    data = kwargs["data"]
    assert data["grant_type"] == "urn:ietf:params:oauth:grant-type:token-exchange"
    assert data["audience"] == f"//iam.googleapis.com/{PROVIDER}"
    assert data["scope"] == "https://www.googleapis.com/auth/cloud-platform"
    assert data["requested_token_type"] == "urn:ietf:params:oauth:token-type:access_token"
    assert data["subject_token_type"] == "urn:ietf:params:oauth:token-type:jwt"
    claims = jwt.decode(
        data["subject_token"],
        _public_key(identity),
        algorithms=["RS256"],
        audience=f"https://iam.googleapis.com/{PROVIDER}",
    )
    assert claims["sub"] == identity["subject"]
    assert kwargs["timeout"]


@pytest.mark.parametrize(
    ("body", "expected"),
    [
        ({"error": "invalid_grant", "error_description": "Invalid JWT signature."}, "Invalid JWT signature."),
        (
            {"error": {"code": 403, "status": "PERMISSION_DENIED", "message": "The caller does not have permission"}},
            "The caller does not have permission",
        ),
        (None, "HTTP 400"),
    ],
)
def test_sts_rejections_explain_themselves(credentials, body, expected):
    with patch.object(auth.requests, "post", return_value=FakeResponse(400, body)):
        with pytest.raises(GCPAuthError, match=expected) as error:
            exchange_token(credentials)
    assert "rejected Phase's Workload Identity token" in str(error.value)
    assert ".." not in str(error.value)


def test_unreachable_sts(credentials):
    with patch.object(auth.requests, "post", side_effect=requests.ConnectionError("down")):
        with pytest.raises(GCPAuthError, match="Could not reach"):
            exchange_token(credentials)


def test_incomplete_credentials(credentials):
    del credentials["private_key"]
    with patch.object(auth.requests, "post") as post:
        with pytest.raises(GCPAuthError, match="missing private_key"):
            exchange_token(credentials)
    post.assert_not_called()


def test_unreadable_private_key(credentials):
    credentials["private_key"] = "not a key"
    with patch.object(auth.requests, "post") as post:
        with pytest.raises(GCPAuthError, match="signing key can't be read"):
            exchange_token(credentials)
    post.assert_not_called()


def test_malformed_provider_is_an_auth_error(credentials):
    credentials["workload_identity_provider"] = "projects/x"
    with pytest.raises(GCPAuthError, match="full provider name"):
        exchange_token(credentials)


def test_unexpected_sts_response(credentials):
    with patch.object(auth.requests, "post", return_value=FakeResponse(200, {"token": "x"})):
        with pytest.raises(GCPAuthError, match="unexpected response"):
            exchange_token(credentials)


# ---- token reuse ------------------------------------------------------------------


def test_token_source_reuses_and_refreshes_tokens(credentials):
    with patch.object(auth, "exchange_token") as exchange, patch.object(auth.time, "time") as now:
        now.return_value = 1_000
        exchange.return_value = ("first", 1_000 + 3600)
        source = TokenSource(credentials)

        assert source.token() == "first"
        assert source.token() == "first"
        assert exchange.call_count == 1

        # Inside the refresh margin before expiry.
        now.return_value = 1_000 + 3600 - 60
        exchange.return_value = ("second", now.return_value + 3600)
        assert source.token() == "second"

        source.invalidate()
        exchange.return_value = ("third", now.return_value + 3600)
        assert source.token() == "third"
        assert exchange.call_count == 3


def test_sts_is_retried_on_rate_limits_and_outages(credentials):
    responses = [
        FakeResponse(429, {"error": "quota_exceeded"}),
        requests.ConnectionError("reset"),
        FakeResponse(200, {"access_token": "t", "expires_in": 3599}),
    ]

    def post(*args, **kwargs):
        response = responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response

    with patch.object(auth.requests, "post", side_effect=post) as mocked, patch.object(
        auth.time, "sleep"
    ) as sleep:
        token, _ = exchange_token(credentials)

    assert token == "t"
    assert mocked.call_count == 3
    assert sleep.call_count == 2


def test_sts_gives_up_after_repeated_outages(credentials):
    with patch.object(
        auth.requests, "post", return_value=FakeResponse(503, None)
    ) as mocked, patch.object(auth.time, "sleep"):
        with pytest.raises(GCPAuthError, match="HTTP 503"):
            exchange_token(credentials)
    assert mocked.call_count == auth.STS_MAX_ATTEMPTS


def test_sts_rejections_are_not_retried(credentials):
    body = {"error": "invalid_grant", "error_description": "Invalid JWT signature."}
    with patch.object(
        auth.requests, "post", return_value=FakeResponse(400, body)
    ) as mocked, patch.object(auth.time, "sleep"):
        with pytest.raises(GCPAuthError):
            exchange_token(credentials)
    assert mocked.call_count == 1


def test_short_lived_tokens_are_reused_for_half_their_life(credentials):
    """If Google ever returns a token shorter than the refresh margin, it's
    still reused instead of re-exchanged on every request."""
    with patch.object(auth, "exchange_token") as exchange, patch.object(auth.time, "time") as now:
        now.return_value = 1_000
        exchange.return_value = ("short", 1_000 + 270)
        source = TokenSource(credentials)
        for _ in range(5):
            source.token()
        assert exchange.call_count == 1

        now.return_value = 1_000 + 136
        source.token()
        assert exchange.call_count == 2


# ---- calls a user waits on -------------------------------------------------------


def test_an_interactive_exchange_is_tried_once_and_briefly(credentials):
    with patch.object(auth.requests, "post", return_value=FakeResponse(503, None)) as post, patch.object(
        auth.time, "sleep"
    ) as sleep:
        with pytest.raises(GCPAuthError, match="HTTP 503"):
            exchange_token(credentials, interactive=True)

    assert post.call_count == 1
    assert post.call_args.kwargs["timeout"] == auth.INTERACTIVE_REQUEST_TIMEOUT
    sleep.assert_not_called()


# ---- the identity package the browser carries -----------------------------------


@pytest.fixture
def server_keypair(monkeypatch):
    """The tests' own server key pair: the test SERVER_SECRET isn't a real one."""
    keypair = random_key_pair()
    monkeypatch.setattr(auth, "get_server_keypair", lambda: keypair)
    return keypair


def _package_identity(identity):
    return {**identity, "jwks": json.dumps(identity["jwks"])}


def test_the_identity_package_opens_for_its_organisation(identity, server_keypair):
    package = seal_workload_identity(ORG_ID, _package_identity(identity))

    assert "PRIVATE KEY" not in package
    opened = open_workload_identity(package, ORG_ID)
    assert opened == {
        field: _package_identity(identity)[field]
        for field in ("issuer", "subject", "key_id", "private_key", "jwks")
    }


def test_the_identity_package_is_bound_to_its_organisation(identity, server_keypair):
    package = seal_workload_identity(ORG_ID, _package_identity(identity))

    with pytest.raises(GCPAuthError, match="different organisation"):
        open_workload_identity(package, "another-org")


@pytest.mark.parametrize("package", [None, "", "not-a-package", "AAAA"])
def test_anything_but_a_package_is_refused(package, server_keypair):
    with pytest.raises(GCPAuthError, match="wasn't created by this Phase instance"):
        open_workload_identity(package, ORG_ID)


def test_a_tampered_package_is_refused(identity, server_keypair):
    package = bytearray(
        base64.urlsafe_b64decode(seal_workload_identity(ORG_ID, _package_identity(identity)))
    )
    package[10] ^= 1

    with pytest.raises(GCPAuthError, match="wasn't created by this Phase instance"):
        open_workload_identity(base64.urlsafe_b64encode(bytes(package)).decode(), ORG_ID)


def test_a_package_from_another_server_secret_is_refused(identity, server_keypair):
    other_server = random_key_pair()
    with patch.object(auth, "get_server_keypair", return_value=other_server):
        package = seal_workload_identity(ORG_ID, _package_identity(identity))

    with pytest.raises(GCPAuthError, match="wasn't created by this Phase instance"):
        open_workload_identity(package, ORG_ID)
