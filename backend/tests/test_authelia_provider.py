import unittest
from unittest.mock import patch, MagicMock, PropertyMock
from requests.exceptions import HTTPError
from allauth.socialaccount.providers.oauth2.views import OAuth2Error


# ---------------------------------------------------------------------------
# Normalized fixture data from a real Authelia login flow
# ---------------------------------------------------------------------------

AUTHELIA_BASE_URL = "https://auth.example.com"

OIDC_DISCOVERY_RESPONSE = {
    "token_endpoint": f"{AUTHELIA_BASE_URL}/api/oidc/token",
    "authorization_endpoint": f"{AUTHELIA_BASE_URL}/api/oidc/authorization",
    "userinfo_endpoint": f"{AUTHELIA_BASE_URL}/api/oidc/userinfo",
    "jwks_uri": f"{AUTHELIA_BASE_URL}/jwks.json",
    "issuer": AUTHELIA_BASE_URL,
}

USERINFO_RESPONSE = {
    "email": "testuser@example.com",
    "email_verified": True,
    "name": "Test User",
    "preferred_username": "testuser",
    "rat": 1774504670,
    "sub": "79e01414-21b4-49b1-9b61-f9774b980350",
    "updated_at": 1774504675,
}

ID_TOKEN_CLAIMS = {
    "amr": ["pwd", "kba"],
    "at_hash": "o1-g5CUAK6BoVgCWRvj5cw",
    "aud": ["phase-console"],
    "auth_time": 1774503606,
    "azp": "phase-console",
    "exp": 1774508274,
    "iat": 1774504674,
    "iss": "https://auth.example.com",
    "jti": "6ee8b8a7-138b-45de-88d2-c70498a53867",
    "nonce": "mOmkUsaBP2kp7tNuz-wKsg9XWFkSaQ_pndtRCqW0rSE",
    "sub": "79e01414-21b4-49b1-9b61-f9774b980350",
}


def _make_mock_request():
    return MagicMock()


def _make_mock_app(client_id="phase-console"):
    app = MagicMock()
    app.client_id = client_id
    return app


def _make_mock_token(access_token="fake-access-token", id_token=None):
    token = MagicMock()
    token.token = access_token
    if id_token is None:
        # Simulate the real Authelia path: token.id_token is None
        del token.id_token
    else:
        token.id_token = id_token
    return token


# ---------------------------------------------------------------------------
# Tests for AutheliaOpenIDConnectAdapter static configuration
# ---------------------------------------------------------------------------


class TestAutheliaAdapterConfiguration(unittest.TestCase):
    """Verify that the Authelia adapter has correct static configuration."""

    @patch.dict(
        "os.environ",
        {"AUTHELIA_URL": AUTHELIA_BASE_URL},
    )
    @patch(
        "api.authentication.adapters.generic.views.requests.get",
    )
    def test_provider_id(self, mock_get):
        # Arrange: OIDC discovery succeeds
        mock_resp = MagicMock()
        mock_resp.json.return_value = OIDC_DISCOVERY_RESPONSE
        mock_get.return_value = mock_resp

        # We need to reimport after patching the env var
        import importlib
        import api.authentication.providers.authelia.views as authelia_views

        # Assert
        self.assertEqual(authelia_views.AutheliaOpenIDConnectAdapter.provider_id, "authelia")

    @patch.dict(
        "os.environ",
        {"AUTHELIA_URL": AUTHELIA_BASE_URL},
    )
    @patch(
        "api.authentication.adapters.generic.views.requests.get",
    )
    def test_default_config_urls(self, mock_get):
        # Arrange: OIDC discovery succeeds
        mock_resp = MagicMock()
        mock_resp.json.return_value = OIDC_DISCOVERY_RESPONSE
        mock_get.return_value = mock_resp

        import api.authentication.providers.authelia.views as authelia_views

        # The default_config is built at module load time from the env var.
        # Since AUTHELIA_URL was empty at import time, the URLs will use the
        # empty string base. We check the keys exist and the structure is right.
        default_config = authelia_views.AutheliaOpenIDConnectAdapter.default_config
        self.assertIn("access_token_url", default_config)
        self.assertIn("authorize_url", default_config)
        self.assertIn("profile_url", default_config)
        self.assertIn("jwks_url", default_config)
        self.assertIn("issuer", default_config)


# ---------------------------------------------------------------------------
# Tests for OIDC discovery and fallback
# ---------------------------------------------------------------------------


class TestOIDCDiscovery(unittest.TestCase):
    """Test OIDC discovery fetch and fallback to default_config."""

    @patch(
        "api.authentication.adapters.generic.views.requests.get",
    )
    def test_successful_oidc_discovery(self, mock_get):
        # Arrange
        mock_resp = MagicMock()
        mock_resp.json.return_value = OIDC_DISCOVERY_RESPONSE
        mock_get.return_value = mock_resp

        from api.authentication.providers.authelia.views import (
            AutheliaOpenIDConnectAdapter,
        )

        adapter = AutheliaOpenIDConnectAdapter.__new__(AutheliaOpenIDConnectAdapter)
        adapter.oidc_config_url = f"{AUTHELIA_BASE_URL}/.well-known/openid-configuration"
        adapter.default_config = {
            "access_token_url": "fallback-token",
            "authorize_url": "fallback-authorize",
            "profile_url": "fallback-userinfo",
            "jwks_url": "fallback-jwks",
            "issuer": "fallback-issuer",
        }

        # Act
        adapter._fetch_oidc_config()

        # Assert: endpoints come from the discovery response, not defaults
        mock_get.assert_called_with(adapter.oidc_config_url)
        self.assertEqual(adapter.access_token_url, OIDC_DISCOVERY_RESPONSE["token_endpoint"])
        self.assertEqual(adapter.authorize_url, OIDC_DISCOVERY_RESPONSE["authorization_endpoint"])
        self.assertEqual(adapter.profile_url, OIDC_DISCOVERY_RESPONSE["userinfo_endpoint"])
        self.assertEqual(adapter.jwks_url, OIDC_DISCOVERY_RESPONSE["jwks_uri"])
        self.assertEqual(adapter.issuer, OIDC_DISCOVERY_RESPONSE["issuer"])

    @patch(
        "api.authentication.adapters.generic.views.requests.get",
    )
    def test_oidc_discovery_failure_falls_back_to_defaults(self, mock_get):
        # Arrange: discovery request raises
        mock_get.side_effect = ConnectionError("Connection refused")

        from api.authentication.providers.authelia.views import (
            AutheliaOpenIDConnectAdapter,
        )

        adapter = AutheliaOpenIDConnectAdapter.__new__(AutheliaOpenIDConnectAdapter)
        adapter.oidc_config_url = f"{AUTHELIA_BASE_URL}/.well-known/openid-configuration"
        adapter.default_config = {
            "access_token_url": f"{AUTHELIA_BASE_URL}/api/oidc/token",
            "authorize_url": f"{AUTHELIA_BASE_URL}/api/oidc/authorization",
            "profile_url": f"{AUTHELIA_BASE_URL}/api/oidc/userinfo",
            "jwks_url": f"{AUTHELIA_BASE_URL}/jwks.json",
            "issuer": AUTHELIA_BASE_URL,
        }

        # Act
        adapter._fetch_oidc_config()

        # Assert: falls back to default_config
        self.assertEqual(adapter.access_token_url, f"{AUTHELIA_BASE_URL}/api/oidc/token")
        self.assertEqual(adapter.authorize_url, f"{AUTHELIA_BASE_URL}/api/oidc/authorization")
        self.assertEqual(adapter.profile_url, f"{AUTHELIA_BASE_URL}/api/oidc/userinfo")
        self.assertEqual(adapter.jwks_url, f"{AUTHELIA_BASE_URL}/jwks.json")
        self.assertEqual(adapter.issuer, AUTHELIA_BASE_URL)

    @patch(
        "api.authentication.adapters.generic.views.requests.get",
    )
    def test_oidc_discovery_failure_no_defaults_raises(self, mock_get):
        # Arrange: discovery fails and no default_config is set
        mock_get.side_effect = ConnectionError("Connection refused")

        from api.authentication.adapters.generic.views import GenericOpenIDConnectAdapter

        adapter = GenericOpenIDConnectAdapter.__new__(GenericOpenIDConnectAdapter)
        adapter.oidc_config_url = f"{AUTHELIA_BASE_URL}/.well-known/openid-configuration"
        adapter.default_config = None

        # Act & Assert
        with self.assertRaises(ConnectionError):
            adapter._fetch_oidc_config()

    @patch(
        "api.authentication.adapters.generic.views.requests.get",
    )
    def test_oidc_discovery_no_url_raises_without_defaults(self, mock_get):
        # Arrange: no oidc_config_url and no defaults
        from api.authentication.adapters.generic.views import GenericOpenIDConnectAdapter

        adapter = GenericOpenIDConnectAdapter.__new__(GenericOpenIDConnectAdapter)
        adapter.oidc_config_url = None
        adapter.default_config = None

        # Act & Assert: should raise ValueError
        with self.assertRaises(ValueError):
            adapter._fetch_oidc_config()


# ---------------------------------------------------------------------------
# Tests for complete_login
# ---------------------------------------------------------------------------


class TestCompleteLogin(unittest.TestCase):
    """Test the complete_login flow including the id_token=None fallback."""

    def _make_adapter(self):
        """Create an adapter instance without triggering __init__ OIDC fetch."""
        from api.authentication.providers.authelia.views import (
            AutheliaOpenIDConnectAdapter,
        )

        adapter = AutheliaOpenIDConnectAdapter.__new__(AutheliaOpenIDConnectAdapter)
        adapter.profile_url = f"{AUTHELIA_BASE_URL}/api/oidc/userinfo"
        adapter.jwks_url = f"{AUTHELIA_BASE_URL}/jwks.json"
        adapter.issuer = AUTHELIA_BASE_URL
        adapter.access_token_url = f"{AUTHELIA_BASE_URL}/api/oidc/token"
        adapter.authorize_url = f"{AUTHELIA_BASE_URL}/api/oidc/authorization"
        return adapter

    @patch(
        "api.authentication.adapters.generic.views.requests.get",
    )
    def test_complete_login_userinfo_fallback_when_id_token_is_none(self, mock_get):
        """
        The real Authelia path: token.id_token is None, so the adapter
        falls back to the userinfo endpoint.
        """
        # Arrange
        adapter = self._make_adapter()

        mock_provider = MagicMock()
        mock_login = MagicMock()
        mock_provider.sociallogin_from_response.return_value = mock_login
        adapter.get_provider = MagicMock(return_value=mock_provider)

        mock_resp = MagicMock()
        mock_resp.json.return_value = USERINFO_RESPONSE
        mock_resp.raise_for_status = MagicMock()
        mock_get.return_value = mock_resp

        token = _make_mock_token(access_token="real-access-token", id_token=None)
        app = _make_mock_app()
        request = _make_mock_request()

        # Act
        result = adapter.complete_login(request, app, token)

        # Assert: userinfo endpoint was called with Bearer token
        mock_get.assert_called_once_with(
            f"{AUTHELIA_BASE_URL}/api/oidc/userinfo",
            headers={"Authorization": "Bearer real-access-token"},
        )
        mock_provider.sociallogin_from_response.assert_called_once_with(
            request, USERINFO_RESPONSE
        )
        self.assertEqual(result, mock_login)

    @patch(
        "api.authentication.adapters.generic.views.jwt.decode",
    )
    @patch(
        "api.authentication.adapters.generic.views.requests.get",
    )
    def test_complete_login_with_id_token_from_kwargs_response(self, mock_get, mock_jwt_decode):
        """
        When id_token is available in kwargs["response"], it should be
        decoded via JWKS instead of hitting the userinfo endpoint.
        """
        # Arrange
        adapter = self._make_adapter()

        mock_provider = MagicMock()
        mock_login = MagicMock()
        mock_provider.sociallogin_from_response.return_value = mock_login
        adapter.get_provider = MagicMock(return_value=mock_provider)

        mock_jwks = {"keys": [{"kty": "RSA", "kid": "test-key"}]}
        mock_jwks_resp = MagicMock()
        mock_jwks_resp.json.return_value = mock_jwks
        mock_get.return_value = mock_jwks_resp

        mock_jwt_decode.return_value = ID_TOKEN_CLAIMS

        token = _make_mock_token(access_token="real-access-token", id_token=None)
        app = _make_mock_app(client_id="phase-console")
        request = _make_mock_request()
        fake_id_token_jwt = "eyJhbGciOiJSUzI1NiJ9.payload.signature"

        # Act
        result = adapter.complete_login(
            request, app, token, response={"id_token": fake_id_token_jwt}
        )

        # Assert: JWKS endpoint was fetched and JWT was decoded
        mock_get.assert_called_once_with(f"{AUTHELIA_BASE_URL}/jwks.json")
        mock_jwt_decode.assert_called_once_with(
            fake_id_token_jwt,
            key=mock_jwks,
            algorithms=["RS256"],
            audience="phase-console",
            issuer=AUTHELIA_BASE_URL,
        )
        mock_provider.sociallogin_from_response.assert_called_once_with(
            request, ID_TOKEN_CLAIMS
        )
        self.assertEqual(result, mock_login)

    @patch(
        "api.authentication.adapters.generic.views.jwt.decode",
    )
    @patch(
        "api.authentication.adapters.generic.views.requests.get",
    )
    def test_complete_login_with_id_token_on_token_object(self, mock_get, mock_jwt_decode):
        """
        When token.id_token is set directly (not the typical Authelia path,
        but supported by the generic adapter).
        """
        # Arrange
        adapter = self._make_adapter()

        mock_provider = MagicMock()
        mock_login = MagicMock()
        mock_provider.sociallogin_from_response.return_value = mock_login
        adapter.get_provider = MagicMock(return_value=mock_provider)

        mock_jwks = {"keys": [{"kty": "RSA", "kid": "test-key"}]}
        mock_jwks_resp = MagicMock()
        mock_jwks_resp.json.return_value = mock_jwks
        mock_get.return_value = mock_jwks_resp

        mock_jwt_decode.return_value = ID_TOKEN_CLAIMS

        fake_id_token_jwt = "eyJhbGciOiJSUzI1NiJ9.payload.signature"
        token = _make_mock_token(access_token="real-access-token", id_token=fake_id_token_jwt)
        app = _make_mock_app(client_id="phase-console")
        request = _make_mock_request()

        # Act
        result = adapter.complete_login(request, app, token)

        # Assert: id_token from token object was used
        mock_jwt_decode.assert_called_once_with(
            fake_id_token_jwt,
            key=mock_jwks,
            algorithms=["RS256"],
            audience="phase-console",
            issuer=AUTHELIA_BASE_URL,
        )
        self.assertEqual(result, mock_login)

    @patch(
        "api.authentication.adapters.generic.views.requests.get",
    )
    def test_complete_login_raises_on_userinfo_failure(self, mock_get):
        """When the userinfo endpoint returns an error, it propagates up."""
        # Arrange
        adapter = self._make_adapter()

        mock_resp = MagicMock()
        mock_resp.raise_for_status.side_effect = HTTPError("401 Unauthorized")
        mock_get.return_value = mock_resp

        token = _make_mock_token(access_token="expired-token", id_token=None)
        app = _make_mock_app()
        request = _make_mock_request()

        # Act & Assert: The generic adapter's complete_login wraps exceptions
        # in OAuth2Error via try/except.
        with self.assertRaises(OAuth2Error):
            adapter.complete_login(request, app, token)


# ---------------------------------------------------------------------------
# Tests for _fetch_user_info
# ---------------------------------------------------------------------------


class TestFetchUserInfo(unittest.TestCase):
    """Test the _fetch_user_info method directly."""

    def _make_adapter(self):
        from api.authentication.providers.authelia.views import (
            AutheliaOpenIDConnectAdapter,
        )

        adapter = AutheliaOpenIDConnectAdapter.__new__(AutheliaOpenIDConnectAdapter)
        adapter.profile_url = f"{AUTHELIA_BASE_URL}/api/oidc/userinfo"
        return adapter

    @patch(
        "api.authentication.adapters.generic.views.requests.get",
    )
    def test_fetch_user_info_success(self, mock_get):
        # Arrange
        adapter = self._make_adapter()

        mock_resp = MagicMock()
        mock_resp.json.return_value = USERINFO_RESPONSE
        mock_resp.raise_for_status = MagicMock()
        mock_get.return_value = mock_resp

        token = _make_mock_token(access_token="valid-access-token")

        # Act
        result = adapter._fetch_user_info(token)

        # Assert
        mock_get.assert_called_once_with(
            f"{AUTHELIA_BASE_URL}/api/oidc/userinfo",
            headers={"Authorization": "Bearer valid-access-token"},
        )
        self.assertEqual(result, USERINFO_RESPONSE)
        self.assertEqual(result["email"], "testuser@example.com")
        self.assertEqual(result["sub"], "79e01414-21b4-49b1-9b61-f9774b980350")
        self.assertTrue(result["email_verified"])

    @patch(
        "api.authentication.adapters.generic.views.requests.get",
    )
    def test_fetch_user_info_401_raises(self, mock_get):
        # Arrange
        adapter = self._make_adapter()

        mock_resp = MagicMock()
        mock_resp.raise_for_status.side_effect = HTTPError(
            "401 Client Error: Unauthorized"
        )
        mock_get.return_value = mock_resp

        token = _make_mock_token(access_token="expired-token")

        # Act & Assert
        with self.assertRaises(HTTPError):
            adapter._fetch_user_info(token)


# ---------------------------------------------------------------------------
# Tests for _process_id_token
# ---------------------------------------------------------------------------


class TestProcessIdToken(unittest.TestCase):
    """Test JWT decode via JWKS."""

    def _make_adapter(self):
        from api.authentication.providers.authelia.views import (
            AutheliaOpenIDConnectAdapter,
        )

        adapter = AutheliaOpenIDConnectAdapter.__new__(AutheliaOpenIDConnectAdapter)
        adapter.jwks_url = f"{AUTHELIA_BASE_URL}/jwks.json"
        adapter.issuer = AUTHELIA_BASE_URL
        return adapter

    @patch(
        "api.authentication.adapters.generic.views.jwt.decode",
    )
    @patch(
        "api.authentication.adapters.generic.views.requests.get",
    )
    def test_process_id_token_success(self, mock_get, mock_jwt_decode):
        # Arrange
        adapter = self._make_adapter()

        mock_jwks = {"keys": [{"kty": "RSA", "kid": "authelia-key-1"}]}
        mock_jwks_resp = MagicMock()
        mock_jwks_resp.json.return_value = mock_jwks
        mock_get.return_value = mock_jwks_resp

        mock_jwt_decode.return_value = ID_TOKEN_CLAIMS

        app = _make_mock_app(client_id="phase-console")
        fake_jwt = "eyJhbGciOiJSUzI1NiJ9.payload.signature"

        # Act
        result = adapter._process_id_token(fake_jwt, app)

        # Assert
        mock_get.assert_called_once_with(f"{AUTHELIA_BASE_URL}/jwks.json")
        mock_jwt_decode.assert_called_once_with(
            fake_jwt,
            key=mock_jwks,
            algorithms=["RS256"],
            audience="phase-console",
            issuer=AUTHELIA_BASE_URL,
        )
        self.assertEqual(result, ID_TOKEN_CLAIMS)
        self.assertEqual(result["sub"], "79e01414-21b4-49b1-9b61-f9774b980350")
        self.assertEqual(result["iss"], "https://auth.example.com")

    @patch(
        "api.authentication.adapters.generic.views.jwt.decode",
    )
    @patch(
        "api.authentication.adapters.generic.views.requests.get",
    )
    def test_process_id_token_invalid_raises_oauth2error(self, mock_get, mock_jwt_decode):
        # Arrange
        adapter = self._make_adapter()

        mock_jwks_resp = MagicMock()
        mock_jwks_resp.json.return_value = {"keys": []}
        mock_get.return_value = mock_jwks_resp

        import jwt as pyjwt

        mock_jwt_decode.side_effect = pyjwt.InvalidTokenError("Signature verification failed")

        app = _make_mock_app(client_id="phase-console")
        fake_jwt = "eyJhbGciOiJSUzI1NiJ9.tampered.signature"

        # Act & Assert
        with self.assertRaises(OAuth2Error) as ctx:
            adapter._process_id_token(fake_jwt, app)
        self.assertIn("Invalid ID token", str(ctx.exception))


# ---------------------------------------------------------------------------
# Tests for pre_social_login
# ---------------------------------------------------------------------------


class TestPreSocialLogin(unittest.TestCase):
    """Test user creation, linking, and social account management."""

    def _make_adapter(self):
        from api.authentication.providers.authelia.views import (
            AutheliaOpenIDConnectAdapter,
        )

        adapter = AutheliaOpenIDConnectAdapter.__new__(AutheliaOpenIDConnectAdapter)
        return adapter

    def _make_sociallogin(self, email="testuser@example.com", uid="79e01414-21b4-49b1-9b61-f9774b980350", provider="authelia"):
        sociallogin = MagicMock()
        sociallogin.account.extra_data = {"email": email, "name": "Test User"}
        sociallogin.account.uid = uid
        sociallogin.account.provider = provider
        return sociallogin

    @patch("api.authentication.adapters.generic.views.SocialAccount.objects.get_or_create")
    @patch("api.authentication.adapters.generic.views.get_user_model")
    def test_existing_user_is_linked(self, mock_get_user_model, mock_get_or_create):
        # Arrange
        adapter = self._make_adapter()

        mock_user_class = MagicMock()
        mock_existing_user = MagicMock()
        mock_user_class.objects.get.return_value = mock_existing_user
        mock_get_user_model.return_value = mock_user_class

        mock_social_account = MagicMock()
        mock_get_or_create.return_value = (mock_social_account, False)

        sociallogin = self._make_sociallogin()
        request = _make_mock_request()

        # Act
        adapter.pre_social_login(request, sociallogin)

        # Assert
        mock_user_class.objects.get.assert_called_once_with(email="testuser@example.com")
        self.assertEqual(sociallogin.user, mock_existing_user)
        mock_get_or_create.assert_called_once()
        # Existing social account should have its extra_data updated
        self.assertEqual(
            mock_social_account.extra_data,
            {"email": "testuser@example.com", "name": "Test User"},
        )
        mock_social_account.save.assert_called_once()

    @patch("api.authentication.adapters.generic.views.SocialAccount.objects.get_or_create")
    @patch("api.authentication.adapters.generic.views.get_user_model")
    def test_new_user_is_created(self, mock_get_user_model, mock_get_or_create):
        # Arrange
        adapter = self._make_adapter()

        mock_user_class = MagicMock()
        mock_new_user = MagicMock()
        # DoesNotExist must be a real exception class for except to catch it
        mock_user_class.DoesNotExist = type("DoesNotExist", (Exception,), {})
        mock_user_class.objects.get.side_effect = mock_user_class.DoesNotExist
        mock_user_class.objects.create_user.return_value = mock_new_user
        mock_get_user_model.return_value = mock_user_class

        mock_social_account = MagicMock()
        mock_get_or_create.return_value = (mock_social_account, True)

        sociallogin = self._make_sociallogin()
        request = _make_mock_request()

        # Act
        adapter.pre_social_login(request, sociallogin)

        # Assert
        mock_user_class.objects.create_user.assert_called_once_with(
            email="testuser@example.com",
            username="testuser@example.com",
            password=None,
        )
        self.assertEqual(sociallogin.user, mock_new_user)
        # New social account was created, so save should NOT be called
        mock_social_account.save.assert_not_called()

    @patch("api.authentication.adapters.generic.views.SocialAccount.objects.get_or_create")
    @patch("api.authentication.adapters.generic.views.get_user_model")
    def test_no_email_returns_early(self, mock_get_user_model, mock_get_or_create):
        # Arrange
        adapter = self._make_adapter()

        sociallogin = MagicMock()
        sociallogin.account.extra_data = {}  # No email
        request = _make_mock_request()

        # Act
        adapter.pre_social_login(request, sociallogin)

        # Assert: no user lookup or creation attempted
        mock_get_user_model.return_value.objects.get.assert_not_called()
        mock_get_or_create.assert_not_called()

    @patch("api.authentication.adapters.generic.views.SocialAccount.objects.get_or_create")
    @patch("api.authentication.adapters.generic.views.get_user_model")
    def test_social_account_created_for_new_provider_link(self, mock_get_user_model, mock_get_or_create):
        # Arrange
        adapter = self._make_adapter()

        mock_user_class = MagicMock()
        mock_existing_user = MagicMock()
        mock_user_class.objects.get.return_value = mock_existing_user
        mock_get_user_model.return_value = mock_user_class

        mock_social_account = MagicMock()
        mock_get_or_create.return_value = (mock_social_account, True)  # newly created

        sociallogin = self._make_sociallogin()
        request = _make_mock_request()

        # Act
        adapter.pre_social_login(request, sociallogin)

        # Assert: get_or_create was called with correct defaults
        mock_get_or_create.assert_called_once_with(
            provider="authelia",
            uid="79e01414-21b4-49b1-9b61-f9774b980350",
            defaults={
                "user": mock_existing_user,
                "extra_data": {"email": "testuser@example.com", "name": "Test User"},
            },
        )
        # Newly created, save should NOT be called
        mock_social_account.save.assert_not_called()


# ---------------------------------------------------------------------------
# Tests for _set_default_config
# ---------------------------------------------------------------------------


class TestSetDefaultConfig(unittest.TestCase):
    """Test that _set_default_config correctly sets attributes."""

    def test_set_default_config(self):
        from api.authentication.adapters.generic.views import GenericOpenIDConnectAdapter

        adapter = GenericOpenIDConnectAdapter.__new__(GenericOpenIDConnectAdapter)
        adapter.default_config = {
            "access_token_url": "https://auth.example.com/api/oidc/token",
            "authorize_url": "https://auth.example.com/api/oidc/authorization",
            "profile_url": "https://auth.example.com/api/oidc/userinfo",
            "jwks_url": "https://auth.example.com/jwks.json",
            "issuer": "https://auth.example.com",
        }

        # Act
        adapter._set_default_config()

        # Assert
        self.assertEqual(adapter.access_token_url, "https://auth.example.com/api/oidc/token")
        self.assertEqual(adapter.authorize_url, "https://auth.example.com/api/oidc/authorization")
        self.assertEqual(adapter.profile_url, "https://auth.example.com/api/oidc/userinfo")
        self.assertEqual(adapter.jwks_url, "https://auth.example.com/jwks.json")
        self.assertEqual(adapter.issuer, "https://auth.example.com")


# ---------------------------------------------------------------------------
# Tests for _get_user_data routing
# ---------------------------------------------------------------------------


class TestGetUserData(unittest.TestCase):
    """Test that _get_user_data routes correctly between id_token and userinfo."""

    def _make_adapter(self):
        from api.authentication.providers.authelia.views import (
            AutheliaOpenIDConnectAdapter,
        )

        adapter = AutheliaOpenIDConnectAdapter.__new__(AutheliaOpenIDConnectAdapter)
        adapter.profile_url = f"{AUTHELIA_BASE_URL}/api/oidc/userinfo"
        adapter.jwks_url = f"{AUTHELIA_BASE_URL}/jwks.json"
        adapter.issuer = AUTHELIA_BASE_URL
        return adapter

    @patch(
        "api.authentication.adapters.generic.views.requests.get",
    )
    def test_routes_to_userinfo_when_no_id_token(self, mock_get):
        # Arrange
        adapter = self._make_adapter()

        mock_resp = MagicMock()
        mock_resp.json.return_value = USERINFO_RESPONSE
        mock_resp.raise_for_status = MagicMock()
        mock_get.return_value = mock_resp

        token = _make_mock_token(access_token="access-token")
        app = _make_mock_app()

        # Act
        result = adapter._get_user_data(token, None, app)

        # Assert
        self.assertEqual(result, USERINFO_RESPONSE)
        mock_get.assert_called_once()

    @patch(
        "api.authentication.adapters.generic.views.jwt.decode",
    )
    @patch(
        "api.authentication.adapters.generic.views.requests.get",
    )
    def test_routes_to_id_token_processing_when_id_token_present(self, mock_get, mock_jwt_decode):
        # Arrange
        adapter = self._make_adapter()

        mock_jwks_resp = MagicMock()
        mock_jwks_resp.json.return_value = {"keys": []}
        mock_get.return_value = mock_jwks_resp

        mock_jwt_decode.return_value = ID_TOKEN_CLAIMS

        token = _make_mock_token()
        app = _make_mock_app(client_id="phase-console")

        # Act
        result = adapter._get_user_data(token, "some.jwt.token", app)

        # Assert
        self.assertEqual(result, ID_TOKEN_CLAIMS)
        mock_jwt_decode.assert_called_once()


if __name__ == "__main__":
    unittest.main()
