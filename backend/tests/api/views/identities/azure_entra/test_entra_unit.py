import django
from django.conf import settings

if not settings.configured:
    settings.configure(
        SECRET_KEY="test-key",
        INSTALLED_APPS=[
            "django.contrib.auth",
            "django.contrib.contenttypes",
            "rest_framework",
        ],
        REST_FRAMEWORK={
            "DEFAULT_RENDERER_CLASSES": ("rest_framework.renderers.JSONRenderer",),
        },
    )
    django.setup()

import unittest
import json
import base64
from unittest.mock import MagicMock, patch
from django.test import RequestFactory
from api.views.identities.azure.entra import azure_entra_auth


TENANT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
RESOURCE = "https://management.azure.com/"
OID = "11111111-2222-3333-4444-555555555555"

# Minimal JWT-like structure (header.payload.signature)
# These are base64url-encoded JSON — content doesn't matter for unit tests
# because we mock jwt.decode and PyJWKClient.
FAKE_JWT = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0aWQiOiJhYWFhYWFhYS1iYmJiLWNjY2MtZGRkZC1lZWVlZWVlZWVlZWUiLCJvaWQiOiIxMTExMTExMS0yMjIyLTMzMzMtNDQ0NC01NTU1NTU1NTU1NTUiLCJhdWQiOiJodHRwczovL21hbmFnZW1lbnQuYXp1cmUuY29tLyIsImlzcyI6Imh0dHBzOi8vc3RzLndpbmRvd3MubmV0L2FhYWFhYWFhLWJiYmItY2NjYy1kZGRkLWVlZWVlZWVlZWVlZS8iLCJ2ZXIiOiIxLjAiLCJleHAiOjk5OTk5OTk5OTl9.fakesig"
ENCODED_JWT = base64.b64encode(FAKE_JWT.encode("utf-8")).decode("utf-8")


class TestAzureEntraAuth(unittest.TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.service_account_id = "12345678-1234-1234-1234-123456789abc"

        self.valid_payload = {
            "account": {"type": "service", "id": self.service_account_id},
            "azureEntra": {"jwt": ENCODED_JWT},
            "tokenRequest": {"ttl": 60},
        }

    def make_request(self, payload):
        return self.factory.post(
            "/api/identities/azure/entra",
            data=payload,
            content_type="application/json",
        )

    def test_invalid_json_payload(self):
        request = self.factory.post(
            "/api/identities/azure/entra",
            data="invalid json",
            content_type="application/json",
        )
        response = azure_entra_auth(request)
        self.assertEqual(response.status_code, 400)
        self.assertIn("Invalid JSON", response.content.decode())

    def test_missing_jwt(self):
        payload = {
            "account": {"type": "service", "id": self.service_account_id},
            "azureEntra": {},
        }
        request = self.make_request(payload)
        response = azure_entra_auth(request)
        self.assertEqual(response.status_code, 400)
        self.assertIn("Missing azureEntra.jwt", response.content.decode())

    @patch("api.views.identities.azure.entra.resolve_service_account")
    def test_service_account_not_found(self, mock_resolve):
        mock_resolve.return_value = None
        request = self.make_request(self.valid_payload)
        response = azure_entra_auth(request)
        self.assertEqual(response.status_code, 404)
        self.assertIn("Service account not found", response.content.decode())

    @patch("api.views.identities.azure.entra.resolve_service_account")
    def test_no_azure_entra_identity_attached(self, mock_resolve):
        mock_sa = MagicMock()
        mock_sa.server_wrapped_keyring = "keyring"
        mock_sa.identities.filter.return_value = []
        mock_resolve.return_value = mock_sa

        request = self.make_request(self.valid_payload)
        response = azure_entra_auth(request)
        self.assertEqual(response.status_code, 404)
        self.assertIn("No Azure identity attached", response.content.decode())

    @patch("api.views.identities.azure.entra.resolve_service_account")
    @patch("api.views.identities.azure.entra.validate_azure_jwt")
    def test_invalid_jwt_signature(self, mock_validate, mock_resolve):
        mock_identity = MagicMock()
        mock_identity.config = {"tenantId": TENANT_ID, "resource": RESOURCE}

        mock_sa = MagicMock()
        mock_sa.server_wrapped_keyring = "keyring"
        mock_sa.identities.filter.return_value = [mock_identity]
        mock_resolve.return_value = mock_sa

        mock_validate.side_effect = ValueError("Signature verification failed")

        request = self.make_request(self.valid_payload)
        response = azure_entra_auth(request)
        self.assertEqual(response.status_code, 401)
        self.assertIn("Azure JWT validation failed", response.content.decode())

    @patch("api.views.identities.azure.entra.resolve_service_account")
    @patch("api.views.identities.azure.entra.validate_azure_jwt")
    def test_expired_jwt(self, mock_validate, mock_resolve):
        mock_identity = MagicMock()
        mock_identity.config = {"tenantId": TENANT_ID, "resource": RESOURCE}

        mock_sa = MagicMock()
        mock_sa.server_wrapped_keyring = "keyring"
        mock_sa.identities.filter.return_value = [mock_identity]
        mock_resolve.return_value = mock_sa

        mock_validate.side_effect = ValueError("Signature has expired")

        request = self.make_request(self.valid_payload)
        response = azure_entra_auth(request)
        self.assertEqual(response.status_code, 401)
        self.assertIn("Azure JWT validation failed", response.content.decode())

    @patch("api.views.identities.azure.entra.resolve_service_account")
    @patch("api.views.identities.azure.entra.validate_azure_jwt")
    def test_tenant_mismatch(self, mock_validate, mock_resolve):
        mock_identity = MagicMock()
        mock_identity.config = {"tenantId": TENANT_ID, "resource": RESOURCE}

        mock_sa = MagicMock()
        mock_sa.server_wrapped_keyring = "keyring"
        mock_sa.identities.filter.return_value = [mock_identity]
        mock_resolve.return_value = mock_sa

        mock_validate.side_effect = ValueError("Tenant ID mismatch")

        request = self.make_request(self.valid_payload)
        response = azure_entra_auth(request)
        self.assertEqual(response.status_code, 401)
        self.assertIn("Azure JWT validation failed", response.content.decode())

    @patch("api.views.identities.azure.entra.resolve_service_account")
    @patch("api.views.identities.azure.entra.validate_azure_jwt")
    def test_untrusted_service_principal(self, mock_validate, mock_resolve):
        mock_identity = MagicMock()
        mock_identity.config = {"tenantId": TENANT_ID, "resource": RESOURCE}
        mock_identity.get_trusted_list.return_value = [
            "99999999-9999-9999-9999-999999999999"
        ]

        mock_sa = MagicMock()
        mock_sa.server_wrapped_keyring = "keyring"
        mock_sa.identities.filter.return_value = [mock_identity]
        mock_resolve.return_value = mock_sa

        mock_validate.return_value = {
            "tid": TENANT_ID,
            "oid": OID,
            "aud": RESOURCE,
            "iss": f"https://sts.windows.net/{TENANT_ID}/",
            "ver": "1.0",
        }

        request = self.make_request(self.valid_payload)
        response = azure_entra_auth(request)
        self.assertEqual(response.status_code, 403)
        self.assertIn("Untrusted service principal", response.content.decode())

    @patch("api.views.identities.azure.entra.resolve_service_account")
    @patch("api.views.identities.azure.entra.validate_azure_jwt")
    @patch("api.views.identities.azure.entra.mint_service_account_token")
    def test_valid_authentication_success(
        self, mock_mint, mock_validate, mock_resolve
    ):
        mock_identity = MagicMock()
        mock_identity.config = {"tenantId": TENANT_ID, "resource": RESOURCE}
        mock_identity.default_ttl_seconds = 3600
        mock_identity.max_ttl_seconds = 86400
        mock_identity.get_trusted_list.return_value = [OID]

        mock_sa = MagicMock()
        mock_sa.server_wrapped_keyring = "keyring"
        mock_sa.identities.filter.return_value = [mock_identity]
        mock_resolve.return_value = mock_sa

        mock_validate.return_value = {
            "tid": TENANT_ID,
            "oid": OID,
            "aud": RESOURCE,
            "iss": f"https://sts.windows.net/{TENANT_ID}/",
            "ver": "1.0",
        }
        mock_mint.return_value = {"token": "success"}

        request = self.make_request(self.valid_payload)
        response = azure_entra_auth(request)
        self.assertEqual(response.status_code, 200)
        self.assertIn("authentication", json.loads(response.content))

    @patch("api.views.identities.azure.entra.resolve_service_account")
    @patch("api.views.identities.azure.entra.validate_azure_jwt")
    @patch("api.views.identities.azure.entra.mint_service_account_token")
    def test_multiple_identities_selection(
        self, mock_mint, mock_validate, mock_resolve
    ):
        """When multiple azure_entra identities exist, the one matching the JWT's tid is selected."""
        other_tenant = "ffffffff-ffff-ffff-ffff-ffffffffffff"

        id1 = MagicMock()
        id1.config = {"tenantId": other_tenant, "resource": RESOURCE}
        id1.get_trusted_list.return_value = []

        id2 = MagicMock()
        id2.config = {"tenantId": TENANT_ID, "resource": RESOURCE}
        id2.default_ttl_seconds = 3600
        id2.max_ttl_seconds = 86400
        id2.get_trusted_list.return_value = [OID]

        mock_sa = MagicMock()
        mock_sa.server_wrapped_keyring = "keyring"
        mock_sa.identities.filter.return_value = [id1, id2]
        mock_resolve.return_value = mock_sa

        mock_validate.return_value = {
            "tid": TENANT_ID,
            "oid": OID,
            "aud": RESOURCE,
            "iss": f"https://sts.windows.net/{TENANT_ID}/",
            "ver": "1.0",
        }
        mock_mint.return_value = {"token": "success"}

        request = self.make_request(self.valid_payload)
        response = azure_entra_auth(request)
        self.assertEqual(response.status_code, 200)
        self.assertIn("authentication", json.loads(response.content))

    @patch("api.views.identities.azure.entra.resolve_service_account")
    @patch("api.views.identities.azure.entra.validate_azure_jwt")
    def test_wildcard_rejected(self, mock_validate, mock_resolve):
        mock_identity = MagicMock()
        mock_identity.config = {"tenantId": TENANT_ID, "resource": RESOURCE}
        mock_identity.get_trusted_list.return_value = ["*"]

        mock_sa = MagicMock()
        mock_sa.server_wrapped_keyring = "keyring"
        mock_sa.identities.filter.return_value = [mock_identity]
        mock_resolve.return_value = mock_sa

        mock_validate.return_value = {
            "tid": TENANT_ID,
            "oid": OID,
            "aud": RESOURCE,
            "iss": f"https://sts.windows.net/{TENANT_ID}/",
            "ver": "1.0",
        }

        request = self.make_request(self.valid_payload)
        response = azure_entra_auth(request)
        self.assertEqual(response.status_code, 400)
        self.assertIn("'*' is not allowed", response.content.decode())

    @patch("api.views.identities.azure.entra.resolve_service_account")
    @patch("api.views.identities.azure.entra.validate_azure_jwt")
    def test_ttl_exceeds_max(self, mock_validate, mock_resolve):
        mock_identity = MagicMock()
        mock_identity.config = {"tenantId": TENANT_ID, "resource": RESOURCE}
        mock_identity.default_ttl_seconds = 3600
        mock_identity.max_ttl_seconds = 3600
        mock_identity.get_trusted_list.return_value = [OID]

        mock_sa = MagicMock()
        mock_sa.server_wrapped_keyring = "keyring"
        mock_sa.identities.filter.return_value = [mock_identity]
        mock_resolve.return_value = mock_sa

        mock_validate.return_value = {
            "tid": TENANT_ID,
            "oid": OID,
            "aud": RESOURCE,
            "iss": f"https://sts.windows.net/{TENANT_ID}/",
            "ver": "1.0",
        }

        payload = {**self.valid_payload, "tokenRequest": {"ttl": 99999}}
        request = self.make_request(payload)
        response = azure_entra_auth(request)
        self.assertEqual(response.status_code, 400)
        self.assertIn("exceeds maximum allowed TTL", response.content.decode())
