import re
from urllib.parse import urlparse, urlunparse

import jwt
from jwt import PyJWKClient

JWKS_CACHE_TTL = 3600  # 1 hour

# Module-level cache of PyJWKClient instances keyed by JWKS URI.
# Each client caches Azure's public signing keys for JWKS_CACHE_TTL seconds,
# avoiding a round-trip to login.microsoftonline.com on every auth request.
_jwk_clients: dict[str, PyJWKClient] = {}


def validate_tenant_id(tenant_id: str):
    """Ensure tenant_id is a valid UUID to prevent URL injection."""
    if not re.match(
        r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
        tenant_id,
        re.I,
    ):
        raise ValueError("Invalid tenant ID format")


def validate_azure_jwt(token_str: str, tenant_id: str, resource: str) -> dict:
    """
    Validate an Azure AD JWT and return its claims.

    Handles both v1.0 and v2.0 tokens. The token version is determined by the
    `accessTokenAcceptedVersion` on the *resource* app registration in Azure AD,
    NOT by the client or token endpoint used.

    - v1.0 tokens (default for https://management.azure.com/):
        iss = https://sts.windows.net/{tid}/
        aud = resource URI string (e.g. https://management.azure.com/)
        JWKS = https://login.microsoftonline.com/{tid}/discovery/keys

    - v2.0 tokens (custom app registrations with accessTokenAcceptedVersion=2):
        iss = https://login.microsoftonline.com/{tid}/v2.0
        aud = client ID GUID
        JWKS = https://login.microsoftonline.com/{tid}/discovery/v2.0/keys
    """
    validate_tenant_id(tenant_id)

    # Step 1: Decode header + payload WITHOUT verification to determine token version
    try:
        unverified = jwt.decode(token_str, options={"verify_signature": False})
        token_ver = unverified.get("ver", "1.0")
    except Exception:
        raise ValueError("Malformed JWT")

    # Step 2: Select JWKS endpoint and expected issuer based on token version
    if token_ver == "2.0":
        jwks_uri = f"https://login.microsoftonline.com/{tenant_id}/discovery/v2.0/keys"
        expected_issuer = f"https://login.microsoftonline.com/{tenant_id}/v2.0"
    else:
        jwks_uri = (
            f"https://login.microsoftonline.com/{tenant_id}/discovery/keys"
        )
        expected_issuer = f"https://sts.windows.net/{tenant_id}/"

    # Step 3: Fetch signing key and validate (reuse cached client per JWKS URI)
    if jwks_uri not in _jwk_clients:
        _jwk_clients[jwks_uri] = PyJWKClient(jwks_uri, cache_jwk_set=True, lifespan=JWKS_CACHE_TTL)
    jwk_client = _jwk_clients[jwks_uri]
    signing_key = jwk_client.get_signing_key_from_jwt(token_str)

    # Azure may issue tokens with or without a trailing slash on the audience.
    # Normalize via urlparse and accept both variants.
    parsed = urlparse(resource)
    normalized = urlunparse(parsed._replace(path=parsed.path.rstrip("/")))
    audiences = [normalized, normalized + "/"]

    claims = jwt.decode(
        token_str,
        signing_key.key,
        algorithms=["RS256"],
        audience=audiences,
        issuer=expected_issuer,
        options={"require": ["exp", "iss", "aud", "oid", "tid"]},
    )

    if claims.get("tid") != tenant_id:
        raise ValueError("Tenant ID mismatch")

    return claims
