"""
Unit tests for validate_azure_jwt() — the JWT validation utility.

These tests exercise the v1/v2 token branching, JWKS URI selection, issuer
validation, audience normalization, tenant ID checks, and error handling
directly, rather than going through the REST view (which mocks this function).

Both user tokens and service principal tokens have the same JWT structure
(oid, tid, aud, iss, ver), so these tests cover both identity types.
"""

import unittest
from unittest.mock import patch, MagicMock

from api.utils.identity.azure import validate_azure_jwt, validate_tenant_id, _jwk_clients


TENANT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
OID_SERVICE_PRINCIPAL = "11111111-2222-3333-4444-555555555555"
OID_USER = "66666666-7777-8888-9999-aaaaaaaaaaaa"
RESOURCE = "https://management.azure.com/"
CUSTOM_RESOURCE = "https://myapp.example.com/api"

# v1 token claims (default for management.azure.com)
V1_CLAIMS = {
    "ver": "1.0",
    "tid": TENANT_ID,
    "oid": OID_SERVICE_PRINCIPAL,
    "aud": "https://management.azure.com",
    "iss": f"https://sts.windows.net/{TENANT_ID}/",
    "exp": 9999999999,
    "iat": 1700000000,
    "nbf": 1700000000,
}

# v2 token claims (custom app registrations)
V2_CLAIMS = {
    "ver": "2.0",
    "tid": TENANT_ID,
    "oid": OID_SERVICE_PRINCIPAL,
    "aud": "b304d72d-85c6-42e3-8227-ad650e418701",
    "iss": f"https://login.microsoftonline.com/{TENANT_ID}/v2.0",
    "exp": 9999999999,
    "iat": 1700000000,
    "nbf": 1700000000,
}

# User token claims (same structure, different oid)
V1_USER_CLAIMS = {
    **V1_CLAIMS,
    "oid": OID_USER,
    "upn": "user@example.com",
}


def _mock_jwt_decode_factory(unverified_claims, verified_claims=None):
    """Create a side_effect for jwt.decode that handles both unverified and verified calls."""
    def side_effect(token, *args, **kwargs):
        options = kwargs.get("options", {})
        if options.get("verify_signature") is False:
            return unverified_claims
        return verified_claims if verified_claims is not None else unverified_claims
    return side_effect


class TestValidateTenantId(unittest.TestCase):
    def test_valid_uuid(self):
        validate_tenant_id("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")

    def test_valid_uuid_uppercase(self):
        validate_tenant_id("AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE")

    def test_invalid_format(self):
        with self.assertRaises(ValueError):
            validate_tenant_id("not-a-uuid")

    def test_path_traversal(self):
        with self.assertRaises(ValueError):
            validate_tenant_id("../../../etc/passwd")

    def test_empty_string(self):
        with self.assertRaises(ValueError):
            validate_tenant_id("")

    def test_url_injection(self):
        with self.assertRaises(ValueError):
            validate_tenant_id("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/../../evil")


class TestValidateAzureJwt(unittest.TestCase):
    def setUp(self):
        # Clear the module-level JWKS client cache between tests
        _jwk_clients.clear()

    @patch("api.utils.identity.azure._jwk_clients", {})
    @patch("api.utils.identity.azure.PyJWKClient")
    @patch("api.utils.identity.azure.jwt.decode")
    def test_v1_token_uses_correct_jwks_and_issuer(self, mock_decode, mock_jwk_class):
        """v1 tokens should use /discovery/keys and sts.windows.net issuer."""
        mock_signing_key = MagicMock()
        mock_client = MagicMock()
        mock_client.get_signing_key_from_jwt.return_value = mock_signing_key
        mock_jwk_class.return_value = mock_client

        mock_decode.side_effect = _mock_jwt_decode_factory(V1_CLAIMS)

        result = validate_azure_jwt("fake.jwt.token", TENANT_ID, RESOURCE)

        # Verify correct JWKS URI was used
        mock_jwk_class.assert_called_once_with(
            f"https://login.microsoftonline.com/{TENANT_ID}/discovery/keys",
            cache_jwk_set=True,
            lifespan=3600,
        )

        # Verify jwt.decode was called with correct issuer
        verified_call = mock_decode.call_args_list[1]
        assert verified_call.kwargs["issuer"] == f"https://sts.windows.net/{TENANT_ID}/"
        assert verified_call.kwargs["algorithms"] == ["RS256"]

        assert result["tid"] == TENANT_ID

    @patch("api.utils.identity.azure._jwk_clients", {})
    @patch("api.utils.identity.azure.PyJWKClient")
    @patch("api.utils.identity.azure.jwt.decode")
    def test_v2_token_uses_correct_jwks_and_issuer(self, mock_decode, mock_jwk_class):
        """v2 tokens should use /discovery/v2.0/keys and login.microsoftonline.com issuer."""
        mock_signing_key = MagicMock()
        mock_client = MagicMock()
        mock_client.get_signing_key_from_jwt.return_value = mock_signing_key
        mock_jwk_class.return_value = mock_client

        mock_decode.side_effect = _mock_jwt_decode_factory(V2_CLAIMS)

        result = validate_azure_jwt(
            "fake.jwt.token",
            TENANT_ID,
            V2_CLAIMS["aud"],
        )

        # Verify correct JWKS URI was used (v2.0 path)
        mock_jwk_class.assert_called_once_with(
            f"https://login.microsoftonline.com/{TENANT_ID}/discovery/v2.0/keys",
            cache_jwk_set=True,
            lifespan=3600,
        )

        # Verify jwt.decode was called with correct v2 issuer
        verified_call = mock_decode.call_args_list[1]
        assert verified_call.kwargs["issuer"] == f"https://login.microsoftonline.com/{TENANT_ID}/v2.0"

        assert result["tid"] == TENANT_ID

    @patch("api.utils.identity.azure._jwk_clients", {})
    @patch("api.utils.identity.azure.PyJWKClient")
    @patch("api.utils.identity.azure.jwt.decode")
    def test_missing_ver_defaults_to_v1(self, mock_decode, mock_jwk_class):
        """When 'ver' claim is missing, should default to v1.0 behavior."""
        mock_signing_key = MagicMock()
        mock_client = MagicMock()
        mock_client.get_signing_key_from_jwt.return_value = mock_signing_key
        mock_jwk_class.return_value = mock_client

        claims_no_ver = {k: v for k, v in V1_CLAIMS.items() if k != "ver"}
        mock_decode.side_effect = _mock_jwt_decode_factory(claims_no_ver)

        validate_azure_jwt("fake.jwt.token", TENANT_ID, RESOURCE)

        # Should use v1 JWKS URI (no v2.0 in path)
        mock_jwk_class.assert_called_once_with(
            f"https://login.microsoftonline.com/{TENANT_ID}/discovery/keys",
            cache_jwk_set=True,
            lifespan=3600,
        )

        # Should use v1 issuer
        verified_call = mock_decode.call_args_list[1]
        assert verified_call.kwargs["issuer"] == f"https://sts.windows.net/{TENANT_ID}/"

    @patch("api.utils.identity.azure._jwk_clients", {})
    @patch("api.utils.identity.azure.PyJWKClient")
    @patch("api.utils.identity.azure.jwt.decode")
    def test_audience_with_trailing_slash(self, mock_decode, mock_jwk_class):
        """Resource configured with trailing slash should accept aud without it."""
        mock_signing_key = MagicMock()
        mock_client = MagicMock()
        mock_client.get_signing_key_from_jwt.return_value = mock_signing_key
        mock_jwk_class.return_value = mock_client

        mock_decode.side_effect = _mock_jwt_decode_factory(V1_CLAIMS)

        validate_azure_jwt("fake.jwt.token", TENANT_ID, "https://management.azure.com/")

        # Verify audience list includes both variants
        verified_call = mock_decode.call_args_list[1]
        audiences = verified_call.kwargs["audience"]
        assert "https://management.azure.com" in audiences
        assert "https://management.azure.com/" in audiences

    @patch("api.utils.identity.azure._jwk_clients", {})
    @patch("api.utils.identity.azure.PyJWKClient")
    @patch("api.utils.identity.azure.jwt.decode")
    def test_audience_without_trailing_slash(self, mock_decode, mock_jwk_class):
        """Resource configured without trailing slash should also accept aud with it."""
        mock_signing_key = MagicMock()
        mock_client = MagicMock()
        mock_client.get_signing_key_from_jwt.return_value = mock_signing_key
        mock_jwk_class.return_value = mock_client

        mock_decode.side_effect = _mock_jwt_decode_factory(V1_CLAIMS)

        validate_azure_jwt("fake.jwt.token", TENANT_ID, "https://management.azure.com")

        verified_call = mock_decode.call_args_list[1]
        audiences = verified_call.kwargs["audience"]
        assert "https://management.azure.com" in audiences
        assert "https://management.azure.com/" in audiences

    @patch("api.utils.identity.azure._jwk_clients", {})
    @patch("api.utils.identity.azure.PyJWKClient")
    @patch("api.utils.identity.azure.jwt.decode")
    def test_custom_resource_audience(self, mock_decode, mock_jwk_class):
        """Custom resource URIs should also get trailing-slash normalization."""
        mock_signing_key = MagicMock()
        mock_client = MagicMock()
        mock_client.get_signing_key_from_jwt.return_value = mock_signing_key
        mock_jwk_class.return_value = mock_client

        custom_claims = {**V1_CLAIMS, "aud": CUSTOM_RESOURCE}
        mock_decode.side_effect = _mock_jwt_decode_factory(custom_claims)

        validate_azure_jwt("fake.jwt.token", TENANT_ID, CUSTOM_RESOURCE)

        verified_call = mock_decode.call_args_list[1]
        audiences = verified_call.kwargs["audience"]
        assert "https://myapp.example.com/api" in audiences
        assert "https://myapp.example.com/api/" in audiences

    @patch("api.utils.identity.azure._jwk_clients", {})
    @patch("api.utils.identity.azure.PyJWKClient")
    @patch("api.utils.identity.azure.jwt.decode")
    def test_tenant_id_mismatch_rejected(self, mock_decode, mock_jwk_class):
        """JWT with tid that doesn't match configured tenant should be rejected."""
        mock_signing_key = MagicMock()
        mock_client = MagicMock()
        mock_client.get_signing_key_from_jwt.return_value = mock_signing_key
        mock_jwk_class.return_value = mock_client

        wrong_tid_claims = {**V1_CLAIMS, "tid": "ffffffff-ffff-ffff-ffff-ffffffffffff"}
        mock_decode.side_effect = _mock_jwt_decode_factory(wrong_tid_claims)

        with self.assertRaises(ValueError) as ctx:
            validate_azure_jwt("fake.jwt.token", TENANT_ID, RESOURCE)
        assert "Tenant ID mismatch" in str(ctx.exception)

    def test_invalid_tenant_id_rejected(self):
        """Non-UUID tenant ID should be rejected before any JWT processing."""
        with self.assertRaises(ValueError) as ctx:
            validate_azure_jwt("fake.jwt.token", "not-a-uuid", RESOURCE)
        assert "Invalid tenant ID format" in str(ctx.exception)

    @patch("api.utils.identity.azure.jwt.decode")
    def test_malformed_jwt_rejected(self, mock_decode):
        """Malformed JWT that can't be decoded should raise ValueError."""
        mock_decode.side_effect = Exception("Invalid token")

        with self.assertRaises(ValueError) as ctx:
            validate_azure_jwt("garbage", TENANT_ID, RESOURCE)
        assert "Malformed JWT" in str(ctx.exception)

    @patch("api.utils.identity.azure._jwk_clients", {})
    @patch("api.utils.identity.azure.PyJWKClient")
    @patch("api.utils.identity.azure.jwt.decode")
    def test_service_principal_token(self, mock_decode, mock_jwk_class):
        """Service principal tokens (oid = SP object ID) should validate correctly."""
        mock_signing_key = MagicMock()
        mock_client = MagicMock()
        mock_client.get_signing_key_from_jwt.return_value = mock_signing_key
        mock_jwk_class.return_value = mock_client

        mock_decode.side_effect = _mock_jwt_decode_factory(V1_CLAIMS)

        result = validate_azure_jwt("fake.jwt.token", TENANT_ID, RESOURCE)
        assert result["oid"] == OID_SERVICE_PRINCIPAL

    @patch("api.utils.identity.azure._jwk_clients", {})
    @patch("api.utils.identity.azure.PyJWKClient")
    @patch("api.utils.identity.azure.jwt.decode")
    def test_user_token(self, mock_decode, mock_jwk_class):
        """User tokens (oid = user object ID, has upn) should validate identically."""
        mock_signing_key = MagicMock()
        mock_client = MagicMock()
        mock_client.get_signing_key_from_jwt.return_value = mock_signing_key
        mock_jwk_class.return_value = mock_client

        mock_decode.side_effect = _mock_jwt_decode_factory(V1_USER_CLAIMS)

        result = validate_azure_jwt("fake.jwt.token", TENANT_ID, RESOURCE)
        assert result["oid"] == OID_USER
        assert result.get("upn") == "user@example.com"

    @patch("api.utils.identity.azure._jwk_clients", {})
    @patch("api.utils.identity.azure.PyJWKClient")
    @patch("api.utils.identity.azure.jwt.decode")
    def test_required_claims_enforced(self, mock_decode, mock_jwk_class):
        """jwt.decode must be called with require for exp, iss, aud, oid, tid."""
        mock_signing_key = MagicMock()
        mock_client = MagicMock()
        mock_client.get_signing_key_from_jwt.return_value = mock_signing_key
        mock_jwk_class.return_value = mock_client

        mock_decode.side_effect = _mock_jwt_decode_factory(V1_CLAIMS)

        validate_azure_jwt("fake.jwt.token", TENANT_ID, RESOURCE)

        verified_call = mock_decode.call_args_list[1]
        required = verified_call.kwargs["options"]["require"]
        assert set(required) == {"exp", "iss", "aud", "oid", "tid"}

    @patch("api.utils.identity.azure._jwk_clients", {})
    @patch("api.utils.identity.azure.PyJWKClient")
    @patch("api.utils.identity.azure.jwt.decode")
    def test_algorithm_pinned_to_rs256(self, mock_decode, mock_jwk_class):
        """Only RS256 should be accepted — prevents algorithm confusion attacks."""
        mock_signing_key = MagicMock()
        mock_client = MagicMock()
        mock_client.get_signing_key_from_jwt.return_value = mock_signing_key
        mock_jwk_class.return_value = mock_client

        mock_decode.side_effect = _mock_jwt_decode_factory(V1_CLAIMS)

        validate_azure_jwt("fake.jwt.token", TENANT_ID, RESOURCE)

        verified_call = mock_decode.call_args_list[1]
        assert verified_call.kwargs["algorithms"] == ["RS256"]

    @patch("api.utils.identity.azure._jwk_clients", {})
    @patch("api.utils.identity.azure.PyJWKClient")
    @patch("api.utils.identity.azure.jwt.decode")
    def test_jwk_client_cached_per_uri(self, mock_decode, mock_jwk_class):
        """PyJWKClient should be reused for the same JWKS URI across calls."""
        mock_signing_key = MagicMock()
        mock_client = MagicMock()
        mock_client.get_signing_key_from_jwt.return_value = mock_signing_key
        mock_jwk_class.return_value = mock_client

        mock_decode.side_effect = _mock_jwt_decode_factory(V1_CLAIMS)

        validate_azure_jwt("fake.jwt.token", TENANT_ID, RESOURCE)
        validate_azure_jwt("fake.jwt.token", TENANT_ID, RESOURCE)

        # PyJWKClient should only be constructed once for the same tenant
        mock_jwk_class.assert_called_once()
