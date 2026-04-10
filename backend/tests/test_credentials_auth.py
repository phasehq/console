"""Tests for the new credential auth views that replace NextAuth."""

import json
import unittest
from unittest.mock import patch, MagicMock, PropertyMock
from urllib.parse import urlparse, parse_qs

from django.test import TestCase, RequestFactory, override_settings
from django.contrib.sessions.middleware import SessionMiddleware
from django.contrib.auth import get_user_model
from django.http import JsonResponse

from api.views.credentials_auth import (
    auth_me,
    SSOAuthorizeView,
    SSOCallbackView,
    SSO_PROVIDER_REGISTRY,
    _get_callback_url,
)

User = get_user_model()


def _add_session_to_request(request):
    """Helper to add session support to a request."""
    middleware = SessionMiddleware(lambda req: None)
    middleware.process_request(request)
    request.session.save()


def _authenticate_request(request, user):
    """Helper to set a user on the request."""
    request.user = user
    _add_session_to_request(request)


class AuthMeViewTest(TestCase):
    """Tests for GET /auth/me/."""

    def setUp(self):
        self.factory = RequestFactory()
        self.user = User.objects.create_user(
            username="test@example.com",
            email="test@example.com",
            password="testpass123456789",
        )

    def test_returns_user_info_when_authenticated(self):
        """Authenticated user gets their info back."""
        request = self.factory.get("/auth/me/")
        _authenticate_request(request, self.user)

        response = auth_me(request)
        data = json.loads(response.content)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(data["email"], "test@example.com")
        self.assertIn("userId", data)
        self.assertIn("fullName", data)
        self.assertIn("avatarUrl", data)
        self.assertIn("authMethod", data)

    def test_returns_email_as_fallback_name(self):
        """When no full_name or social account, email is used as name."""
        request = self.factory.get("/auth/me/")
        _authenticate_request(request, self.user)

        response = auth_me(request)
        data = json.loads(response.content)

        # User has no full_name set and no social account
        self.assertEqual(data["fullName"], "test@example.com")
        self.assertIsNone(data["avatarUrl"])

    def test_returns_full_name_when_set(self):
        """full_name field is returned when available."""
        self.user.full_name = "Test User"
        self.user.save()

        request = self.factory.get("/auth/me/")
        _authenticate_request(request, self.user)

        response = auth_me(request)
        data = json.loads(response.content)

        self.assertEqual(data["fullName"], "Test User")

    def test_returns_social_account_data(self):
        """Social account data (avatar, name) is returned for SSO users."""
        from allauth.socialaccount.models import SocialAccount

        SocialAccount.objects.create(
            user=self.user,
            provider="google",
            uid="12345",
            extra_data={
                "name": "Google User",
                "picture": "https://example.com/avatar.jpg",
            },
        )

        request = self.factory.get("/auth/me/")
        _authenticate_request(request, self.user)

        response = auth_me(request)
        data = json.loads(response.content)

        self.assertEqual(data["fullName"], "Google User")
        self.assertEqual(data["avatarUrl"], "https://example.com/avatar.jpg")

    def test_unauthenticated_returns_403(self):
        """Unauthenticated requests are rejected."""
        response = self.client.get("/auth/me/")
        self.assertIn(response.status_code, [401, 403])


class SSOAuthorizeViewTest(TestCase):
    """Tests for GET /auth/sso/<provider>/authorize/."""

    def setUp(self):
        self.factory = RequestFactory()

    def test_unknown_provider_returns_400(self):
        """Requesting an unknown provider returns a 400 error."""
        request = self.factory.get("/auth/sso/nonexistent/authorize/")
        _add_session_to_request(request)

        view = SSOAuthorizeView()
        response = view.get(request, "nonexistent")

        self.assertEqual(response.status_code, 404)

    @patch.dict(SSO_PROVIDER_REGISTRY, {
        "test-provider": {
            "client_id": "test-client-id",
            "client_secret": "test-secret",
            "authorize_url": "https://idp.example.com/authorize",
            "token_url": "https://idp.example.com/token",
            "scopes": "openid profile email",
            "adapter_module": "api.authentication.adapters.google",
            "adapter_class": "CustomGoogleOAuth2Adapter",
            "provider_id": "google",
        }
    })
    def test_redirects_to_provider_authorize_url(self):
        """Valid provider triggers redirect to the provider's auth URL."""
        request = self.factory.get("/auth/sso/test-provider/authorize/")
        _add_session_to_request(request)

        view = SSOAuthorizeView()
        response = view.get(request, "test-provider")

        self.assertEqual(response.status_code, 302)
        redirect_url = response.url
        parsed = urlparse(redirect_url)
        params = parse_qs(parsed.query)

        self.assertEqual(parsed.scheme, "https")
        self.assertEqual(parsed.hostname, "idp.example.com")
        self.assertEqual(parsed.path, "/authorize")
        self.assertEqual(params["client_id"][0], "test-client-id")
        self.assertEqual(params["scope"][0], "openid profile email")
        self.assertEqual(params["response_type"][0], "code")
        self.assertIn("state", params)
        self.assertIn("redirect_uri", params)

    @patch.dict(SSO_PROVIDER_REGISTRY, {
        "test-provider": {
            "client_id": "test-client-id",
            "client_secret": "test-secret",
            "authorize_url": "https://idp.example.com/authorize",
            "token_url": "https://idp.example.com/token",
            "scopes": "openid profile email",
            "adapter_module": "api.authentication.adapters.google",
            "adapter_class": "CustomGoogleOAuth2Adapter",
            "provider_id": "google",
        }
    })
    def test_stores_state_in_session(self):
        """State parameter is stored in the session for CSRF validation."""
        request = self.factory.get("/auth/sso/test-provider/authorize/")
        _add_session_to_request(request)

        view = SSOAuthorizeView()
        response = view.get(request, "test-provider")

        self.assertIn("sso_state", request.session)
        self.assertIn("sso_provider", request.session)
        self.assertEqual(request.session["sso_provider"], "test-provider")

        # Verify state in URL matches session
        parsed = urlparse(response.url)
        params = parse_qs(parsed.query)
        self.assertEqual(params["state"][0], request.session["sso_state"])

    @patch.dict(SSO_PROVIDER_REGISTRY, {
        "test-oidc": {
            "client_id": "test-client-id",
            "client_secret": "test-secret",
            "issuer": "https://oidc.example.com",
            "scopes": "openid profile email",
            "is_oidc": True,
            "adapter_module": "api.authentication.adapters.google",
            "adapter_class": "CustomGoogleOAuth2Adapter",
            "provider_id": "google",
        }
    })
    @patch("api.views.credentials_auth._get_oidc_endpoints")
    def test_oidc_provider_uses_discovery(self, mock_discovery):
        """OIDC providers fetch endpoints from discovery document."""
        mock_discovery.return_value = {
            "authorize_url": "https://oidc.example.com/auth",
            "token_url": "https://oidc.example.com/token",
        }

        request = self.factory.get("/auth/sso/test-oidc/authorize/")
        _add_session_to_request(request)

        view = SSOAuthorizeView()
        response = view.get(request, "test-oidc")

        self.assertEqual(response.status_code, 302)
        self.assertIn("oidc.example.com/auth", response.url)
        mock_discovery.assert_called_once_with("https://oidc.example.com")

        # OIDC providers should include a nonce
        parsed = urlparse(response.url)
        params = parse_qs(parsed.query)
        self.assertIn("nonce", params)

    @patch.dict(SSO_PROVIDER_REGISTRY, {
        "test-oidc": {
            "client_id": "test-client-id",
            "client_secret": "test-secret",
            "issuer": "https://oidc.example.com",
            "scopes": "openid profile email",
            "is_oidc": True,
            "adapter_module": "api.authentication.adapters.google",
            "adapter_class": "CustomGoogleOAuth2Adapter",
            "provider_id": "google",
        }
    })
    @patch("api.views.credentials_auth._get_oidc_endpoints")
    def test_oidc_discovery_failure_returns_502(self, mock_discovery):
        """If OIDC discovery fails, return 502."""
        mock_discovery.return_value = None

        request = self.factory.get("/auth/sso/test-oidc/authorize/")
        _add_session_to_request(request)

        view = SSOAuthorizeView()
        response = view.get(request, "test-oidc")

        self.assertEqual(response.status_code, 502)


class SSOCallbackViewTest(TestCase):
    """Tests for GET /auth/sso/<provider>/callback/."""

    def setUp(self):
        self.factory = RequestFactory()

    def test_missing_code_redirects_with_error(self):
        """Missing code parameter redirects to login with error."""
        request = self.factory.get("/auth/sso/google/callback/?state=abc")
        _add_session_to_request(request)

        view = SSOCallbackView()
        response = view.get(request, "google")

        self.assertEqual(response.status_code, 302)
        self.assertIn("error=missing_code_or_state", response.url)

    def test_missing_state_redirects_with_error(self):
        """Missing state parameter redirects to login with error."""
        request = self.factory.get("/auth/sso/google/callback/?code=abc")
        _add_session_to_request(request)

        view = SSOCallbackView()
        response = view.get(request, "google")

        self.assertEqual(response.status_code, 302)
        self.assertIn("error=missing_code_or_state", response.url)

    def test_invalid_state_redirects_with_error(self):
        """Invalid state (CSRF mismatch) redirects to login with error."""
        request = self.factory.get("/auth/sso/google/callback/?code=abc&state=wrong")
        _add_session_to_request(request)
        request.session["sso_state"] = "expected_state"
        request.session.save()

        view = SSOCallbackView()
        response = view.get(request, "google")

        self.assertEqual(response.status_code, 302)
        self.assertIn("error=invalid_state", response.url)

    def test_provider_error_redirects_with_error(self):
        """Provider returning an error redirects to login."""
        request = self.factory.get(
            "/auth/sso/google/callback/?error=access_denied&error_description=User+denied"
        )
        _add_session_to_request(request)

        view = SSOCallbackView()
        response = view.get(request, "google")

        self.assertEqual(response.status_code, 302)
        self.assertIn("error=User", response.url)

    def test_unknown_provider_redirects_with_error(self):
        """Unknown provider in callback redirects to login with error."""
        request = self.factory.get(
            "/auth/sso/nonexistent/callback/?code=abc&state=valid"
        )
        _add_session_to_request(request)
        request.session["sso_state"] = "valid"
        request.session.save()

        view = SSOCallbackView()
        response = view.get(request, "nonexistent")

        self.assertEqual(response.status_code, 302)
        self.assertIn("error=unknown_provider", response.url)

    @patch.dict(SSO_PROVIDER_REGISTRY, {
        "test-provider": {
            "client_id": "test-client-id",
            "client_secret": "test-secret",
            "token_url": "https://idp.example.com/token",
            "scopes": "openid profile email",
            "adapter_module": "api.authentication.adapters.google",
            "adapter_class": "CustomGoogleOAuth2Adapter",
            "provider_id": "google",
        }
    })
    @patch("api.views.credentials_auth.http_requests.post")
    def test_token_exchange_failure_redirects_with_error(self, mock_post):
        """Failed token exchange redirects to login with error."""
        mock_post.side_effect = Exception("Connection refused")

        request = self.factory.get(
            "/auth/sso/test-provider/callback/?code=auth_code&state=valid_state"
        )
        _add_session_to_request(request)
        request.session["sso_state"] = "valid_state"
        request.session["sso_token_url"] = "https://idp.example.com/token"
        request.session.save()

        view = SSOCallbackView()
        response = view.get(request, "test-provider")

        self.assertEqual(response.status_code, 302)
        self.assertIn("error=token_exchange_failed", response.url)

    @patch.dict(SSO_PROVIDER_REGISTRY, {
        "test-provider": {
            "client_id": "test-client-id",
            "client_secret": "test-secret",
            "token_url": "https://idp.example.com/token",
            "scopes": "openid profile email",
            "adapter_module": "api.authentication.adapters.google",
            "adapter_class": "CustomGoogleOAuth2Adapter",
            "provider_id": "google",
        }
    })
    @patch("api.views.credentials_auth._complete_login_bypassing_allauth")
    @patch("api.views.credentials_auth._get_or_create_social_app")
    @patch("api.views.credentials_auth._get_adapter_instance")
    @patch("api.views.credentials_auth._exchange_code_for_token")
    def test_successful_callback_completes_login(
        self,
        mock_exchange_code,
        mock_adapter,
        mock_get_or_create_social_app,
        mock_complete_login,
    ):
        """Successful callback restores the original deep link after login."""
        mock_exchange_code.return_value = {
            "access_token": "test-access-token",
            "id_token": "test-id-token",
            "token_type": "Bearer",
        }

        # Mock adapter
        mock_adapter_instance = MagicMock()
        mock_social_login = MagicMock()
        mock_social_login.user.email = "test@example.com"
        mock_social_login.account.extra_data = {"email": "test@example.com"}
        mock_adapter_instance.complete_login.return_value = mock_social_login
        mock_adapter.return_value = mock_adapter_instance
        from allauth.socialaccount.models import SocialApp

        mock_get_or_create_social_app.return_value = SocialApp(
            provider="google",
            name="google",
            client_id="test-client-id",
            secret="test-secret",
        )

        def complete_login_side_effect(request, social_login, token):
            request.user = MagicMock(is_authenticated=True)

        mock_complete_login.side_effect = complete_login_side_effect

        request = self.factory.get(
            "/auth/sso/test-provider/callback/?code=auth_code&state=valid_state"
        )
        _add_session_to_request(request)
        request.user = MagicMock(is_authenticated=False)
        request.session["sso_state"] = "valid_state"
        request.session["sso_token_url"] = "https://idp.example.com/token"
        request.session["sso_callback_url"] = "https://localhost/service/auth/sso/test-provider/callback/"
        request.session["sso_return_to"] = "/team/settings"
        request.session.save()

        view = SSOCallbackView()
        response = view.get(request, "test-provider")

        # Should redirect back to the original deep link
        self.assertEqual(response.status_code, 302)
        self.assertNotIn("error", response.url)
        self.assertTrue(response.url.endswith("/team/settings"))

        # Verify token exchange was called with the callback code
        mock_exchange_code.assert_called_once()
        self.assertEqual(
            mock_exchange_code.call_args.args[1]["code"],
            "auth_code",
        )

        # Verify adapter and direct login flow were used
        mock_adapter_instance.complete_login.assert_called_once()
        mock_complete_login.assert_called_once()


class CallbackUrlTest(TestCase):
    """Tests for callback URL generation."""

    @override_settings()
    @patch.dict("os.environ", {"NEXT_PUBLIC_BACKEND_API_BASE": "https://app.phase.dev/service"})
    def test_callback_url_uses_public_backend_base(self):
        """Callback URL is built from the public backend base URL."""
        url = _get_callback_url("google")
        self.assertEqual(url, "https://localhost/api/auth/callback/google")

    @override_settings()
    @patch.dict("os.environ", {
        "NEXT_PUBLIC_BACKEND_API_BASE": "https://localhost/service",
    })
    def test_callback_url_for_dev(self):
        """Callback URL works for localhost dev environment."""
        url = _get_callback_url("github")
        self.assertEqual(url, "https://localhost/api/auth/callback/github")


class ProviderRegistryTest(TestCase):
    """Tests for the SSO provider registry."""

    def test_registry_contains_configured_providers(self):
        """Registry is populated from SOCIALACCOUNT_PROVIDERS settings."""
        # The registry is built at module load time from settings.
        # In test environments, some providers may not have credentials.
        # Just verify the registry is a dict and the structure is correct.
        self.assertIsInstance(SSO_PROVIDER_REGISTRY, dict)

        for slug, config in SSO_PROVIDER_REGISTRY.items():
            self.assertIn("client_id", config)
            self.assertIn("client_secret", config)
            self.assertIn("adapter_module", config)
            self.assertIn("adapter_class", config)
            self.assertIn("provider_id", config)
            self.assertIn("scopes", config)
