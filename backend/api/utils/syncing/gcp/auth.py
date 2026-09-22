"""Google Cloud authentication via Workload Identity Federation.

Phase is the OIDC identity provider. Each Integration Credential has its own
RSA signing key; the customer uploads the public half (a JWKS) to a Workload
Identity Pool provider, so Google never has to reach this Phase instance and
no instance-level Google credentials are needed. At sync time Phase signs a
short-lived JWT and exchanges it at Google's Security Token Service for a
federated access token, which Secret Manager accepts directly.
"""

import base64
import os
import re
import secrets
import time
from urllib.parse import urlparse

import jwt
import requests
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from django.conf import settings

from api.utils.syncing.auth import decrypt_credential_values

STS_TOKEN_URL = "https://sts.googleapis.com/v1/token"
CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform"

GCP_CREDENTIAL_FIELDS = (
    "workload_identity_provider",
    "issuer",
    "subject",
    "key_id",
    "private_key",
)

# Google rejects tokens whose iat is in the future, so backdate a little to
# absorb clock skew between this host and Google.
CLOCK_SKEW_SECONDS = 30
# Google caps the federated token at the assertion's remaining lifetime, so
# this sets how long one exchange lasts. Google allows up to 24 hours.
ASSERTION_LIFETIME_SECONDS = 3600
# Re-mint the federated token this long before it expires.
TOKEN_REFRESH_MARGIN_SECONDS = 300
REQUEST_TIMEOUT = (5, 30)
STS_MAX_ATTEMPTS = 3
STS_RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}

WORKLOAD_IDENTITY_PROVIDER_PATTERN = re.compile(
    r"^projects/\d{1,20}/locations/global/"
    r"workloadIdentityPools/[a-z0-9-]{4,32}/"
    r"providers/[a-z0-9-]{4,32}$"
)
# The exact shapes generate_workload_identity_key produces. They end up in
# setup scripts, so nothing else is accepted.
KEY_ID_PATTERN = re.compile(r"^[0-9a-f]{32}$")
ISSUER_PATTERN = re.compile(r"^https://[A-Za-z0-9.-]{1,253}(?::\d{1,5})?$")


class GCPAuthError(Exception):
    """An authentication failure whose message is safe to show the user."""


def normalize_workload_identity_provider(value):
    """Return the bare provider resource name.

    Also accepts the //iam.googleapis.com/ and https://iam.googleapis.com/
    audience forms that gcloud and the Cloud console print.
    """
    name = (value or "").strip()
    for prefix in ("https://iam.googleapis.com/", "//iam.googleapis.com/"):
        if name.startswith(prefix):
            name = name[len(prefix) :]
    if not WORKLOAD_IDENTITY_PROVIDER_PATTERN.match(name):
        raise ValueError(
            "Enter the full provider name, e.g. projects/123456789012/locations/"
            "global/workloadIdentityPools/phase/providers/phase-console"
        )
    return name


def default_issuer():
    """The token issuer: this instance's public origin, as https.

    With an uploaded JWKS Google only compares this string with the
    provider's issuer URI and never fetches it, so a private hostname works.
    """
    candidates = [
        settings.OAUTH_REDIRECT_URI,
        os.getenv("ALLOWED_ORIGINS", "").split(",")[0],
    ]
    for candidate in candidates:
        host = urlparse((candidate or "").strip()).netloc
        if host:
            return f"https://{host}"
    raise GCPAuthError(
        "This Phase instance has no public URL configured (OAUTH_REDIRECT_URI), "
        "which Google Cloud credentials use as their token issuer."
    )


def _b64url_uint(value):
    raw = value.to_bytes((value.bit_length() + 7) // 8, "big")
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def public_jwks(private_key_pem, key_id):
    """The JWKS the customer uploads to their provider.

    Built by hand because Google only accepts kty/alg/use/kid/n/e for RSA
    keys, and PyJWT's to_jwk() adds key_ops.
    """
    private_key = serialization.load_pem_private_key(
        private_key_pem.encode(), password=None
    )
    numbers = private_key.public_key().public_numbers()
    return {
        "keys": [
            {
                "kty": "RSA",
                "alg": "RS256",
                "use": "sig",
                "kid": key_id,
                "n": _b64url_uint(numbers.n),
                "e": _b64url_uint(numbers.e),
            }
        ]
    }


def workload_identity_subject(organisation_id, key_id):
    """The token subject: names the organisation, so a credential's identity
    can be checked against the org it's saved in. Well under Google's
    127-byte limit for google.subject."""
    return f"phase:org:{organisation_id}:key:{key_id}"


def generate_workload_identity_key(organisation_id):
    """Create the signing identity for a new Google Cloud credential."""
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_key_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()
    key_id = secrets.token_hex(16)
    return {
        "issuer": default_issuer(),
        "subject": workload_identity_subject(organisation_id, key_id),
        "key_id": key_id,
        "private_key": private_key_pem,
        "jwks": public_jwks(private_key_pem, key_id),
    }


def get_gcp_credentials(credential):
    """Decrypt the fields of a Google Cloud ProviderCredentials row."""
    return decrypt_credential_values(credential, GCP_CREDENTIAL_FIELDS)


def build_assertion(credentials, now=None):
    """Sign the short-lived JWT that Google's STS exchanges for a token."""
    provider = normalize_workload_identity_provider(
        credentials["workload_identity_provider"]
    )
    issued_at = int(now if now is not None else time.time()) - CLOCK_SKEW_SECONDS
    claims = {
        "iss": credentials["issuer"],
        "sub": credentials["subject"],
        # The provider's default allowed audience.
        "aud": f"https://iam.googleapis.com/{provider}",
        "iat": issued_at,
        "exp": issued_at + ASSERTION_LIFETIME_SECONDS,
        "jti": secrets.token_hex(16),
    }
    return jwt.encode(
        claims,
        credentials["private_key"],
        algorithm="RS256",
        headers={"kid": credentials["key_id"]},
    )


def _sts_error_message(response):
    try:
        body = response.json()
    except ValueError:
        body = {}
    detail = None
    if isinstance(body, dict):
        error = body.get("error")
        if isinstance(error, dict):
            detail = error.get("message")
        else:
            detail = body.get("error_description") or error
    detail = str(detail or f"HTTP {response.status_code}").rstrip(". ")
    return (
        f"Google Cloud rejected Phase's Workload Identity token: {detail}. Check "
        "that the provider exists and trusts this credential's key, issuer and subject."
    )


def exchange_token(credentials):
    """Exchange a signed assertion for a federated access token.

    Returns (access_token, expires_at) with expires_at in epoch seconds.
    """
    missing = [
        field for field in GCP_CREDENTIAL_FIELDS if not credentials.get(field)
    ]
    if missing:
        raise GCPAuthError(
            f"This Google Cloud credential is incomplete (missing {', '.join(missing)}). "
            "Create a new credential."
        )
    try:
        provider = normalize_workload_identity_provider(
            credentials["workload_identity_provider"]
        )
    except ValueError as e:
        raise GCPAuthError(str(e))

    try:
        assertion = build_assertion(credentials)
    except (ValueError, TypeError, jwt.PyJWTError):
        raise GCPAuthError(
            "This credential's signing key can't be read. Create a new credential."
        )

    response = None
    for attempt in range(1, STS_MAX_ATTEMPTS + 1):
        try:
            response = requests.post(
                STS_TOKEN_URL,
                data={
                    "grant_type": "urn:ietf:params:oauth:grant-type:token-exchange",
                    "audience": f"//iam.googleapis.com/{provider}",
                    "scope": CLOUD_PLATFORM_SCOPE,
                    "requested_token_type": "urn:ietf:params:oauth:token-type:access_token",
                    "subject_token": assertion,
                    "subject_token_type": "urn:ietf:params:oauth:token-type:jwt",
                },
                timeout=REQUEST_TIMEOUT,
            )
        except requests.RequestException:
            response = None
        if (
            response is not None
            and response.status_code not in STS_RETRYABLE_STATUS_CODES
        ):
            break
        if attempt < STS_MAX_ATTEMPTS:
            time.sleep(2**attempt)

    if response is None:
        raise GCPAuthError(
            "Could not reach Google's Security Token Service (sts.googleapis.com)."
        )
    if response.status_code != 200:
        raise GCPAuthError(_sts_error_message(response))

    try:
        body = response.json()
        access_token = body["access_token"]
        expires_in = int(body.get("expires_in") or 3600)
    except (ValueError, KeyError, TypeError):
        raise GCPAuthError(
            "Google's Security Token Service returned an unexpected response."
        )
    return access_token, time.time() + expires_in


class TokenSource:
    """Mints federated tokens on demand and re-mints them before expiry, so a
    long sync outlives the hour a single token lasts."""

    def __init__(self, credentials):
        self._credentials = credentials
        self._token = None
        self._refresh_at = 0

    def token(self):
        now = time.time()
        if self._token is None or now >= self._refresh_at:
            self._token, expires_at = exchange_token(self._credentials)
            lifetime = max(expires_at - now, 0)
            # Refresh inside the margin, or halfway through a short-lived token.
            self._refresh_at = now + max(
                lifetime - TOKEN_REFRESH_MARGIN_SECONDS, lifetime / 2
            )
        return self._token

    def invalidate(self):
        self._token = None
