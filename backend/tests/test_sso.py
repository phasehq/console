"""Tests for SSO auth views (api.views.sso).

Uses unittest.TestCase (no database required) — all Django ORM
interactions are mocked so these tests run in CI without Postgres.
"""

import unittest
from unittest.mock import patch, MagicMock
from urllib.parse import urlparse, parse_qs

from django.test import RequestFactory
from django.contrib.sessions.middleware import SessionMiddleware

from api.views.sso import (
    auth_me,
    SSOAuthorizeView,
    SSOCallbackView,
    SSO_PROVIDER_REGISTRY,
    _get_callback_url,
    _check_email_domain_allowed,
    _safe_oidc_request,
    _exchange_code_for_token,
    _get_oidc_endpoints,
)


def _add_session_to_request(request):
    """Helper to add session support to a request."""
    middleware = SessionMiddleware(lambda req: None)
    middleware.process_request(request)
    request.session.save()


class AuthMeViewTest(unittest.TestCase):
    """Tests for GET /auth/me/."""

    def setUp(self):
        self.factory = RequestFactory()

    def test_unauthenticated_returns_error(self):
        """Unauthenticated requests are rejected."""
        request = self.factory.get("/auth/me/")
        request.user = MagicMock()
        request.user.is_authenticated = False
        _add_session_to_request(request)

        response = auth_me(request)
        self.assertIn(response.status_code, [401, 403])

    def test_returns_user_info_when_authenticated(self):
        """Authenticated user gets their info back."""
        request = self.factory.get("/auth/me/")
        user = MagicMock()
        user.is_authenticated = True
        user.userId = "test-uuid"
        user.email = "test@example.com"
        user.full_name = ""
        user.auth_method = "sso"
        user.socialaccount_set.first.return_value = None
        request.user = user
        _add_session_to_request(request)

        response = auth_me(request)
        self.assertEqual(response.status_code, 200)

        import json
        data = json.loads(response.content)
        self.assertEqual(data["email"], "test@example.com")
        self.assertEqual(data["fullName"], "test@example.com")  # falls back to email
        self.assertIsNone(data["avatarUrl"])

    def test_returns_social_account_data(self):
        """Social account data (avatar, name) is returned for SSO users."""
        request = self.factory.get("/auth/me/")
        user = MagicMock()
        user.is_authenticated = True
        user.userId = "test-uuid"
        user.email = "test@example.com"
        user.full_name = ""
        user.auth_method = "sso"

        social_acc = MagicMock()
        social_acc.extra_data = {
            "name": "Test User",
            "picture": "https://example.com/avatar.jpg",
        }
        user.socialaccount_set.first.return_value = social_acc
        request.user = user
        _add_session_to_request(request)

        response = auth_me(request)
        import json
        data = json.loads(response.content)
        self.assertEqual(data["fullName"], "Test User")
        self.assertEqual(data["avatarUrl"], "https://example.com/avatar.jpg")

    def test_github_avatar_url(self):
        """GitHub uses avatar_url key."""
        request = self.factory.get("/auth/me/")
        user = MagicMock()
        user.is_authenticated = True
        user.userId = "test-uuid"
        user.email = "test@example.com"
        user.full_name = ""
        user.auth_method = "sso"

        social_acc = MagicMock()
        social_acc.extra_data = {
            "name": "GH User",
            "avatar_url": "https://github.com/avatar.jpg",
        }
        user.socialaccount_set.first.return_value = social_acc
        request.user = user
        _add_session_to_request(request)

        response = auth_me(request)
        import json
        data = json.loads(response.content)
        self.assertEqual(data["avatarUrl"], "https://github.com/avatar.jpg")

    def test_entra_id_photo(self):
        """Microsoft Entra ID uses photo key."""
        request = self.factory.get("/auth/me/")
        user = MagicMock()
        user.is_authenticated = True
        user.userId = "test-uuid"
        user.email = "test@example.com"
        user.full_name = ""
        user.auth_method = "sso"

        social_acc = MagicMock()
        social_acc.extra_data = {
            "name": "Entra User",
            "photo": "https://graph.microsoft.com/photo.jpg",
        }
        user.socialaccount_set.first.return_value = social_acc
        request.user = user
        _add_session_to_request(request)

        response = auth_me(request)
        import json
        data = json.loads(response.content)
        self.assertEqual(data["avatarUrl"], "https://graph.microsoft.com/photo.jpg")


class SSOAuthorizeViewTest(unittest.TestCase):
    """Tests for GET /auth/sso/<provider>/authorize/."""

    def setUp(self):
        self.factory = RequestFactory()

    def test_unknown_provider_returns_404(self):
        """Requesting an unknown provider returns a 404."""
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
        parsed = urlparse(response.url)
        params = parse_qs(parsed.query)

        self.assertEqual(parsed.scheme, "https")
        self.assertEqual(parsed.hostname, "idp.example.com")
        self.assertEqual(params["client_id"][0], "test-client-id")
        self.assertEqual(params["response_type"][0], "code")
        self.assertIn("state", params)

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
        """State parameter is stored in session for CSRF validation."""
        request = self.factory.get("/auth/sso/test-provider/authorize/")
        _add_session_to_request(request)

        view = SSOAuthorizeView()
        response = view.get(request, "test-provider")

        self.assertIn("sso_state", request.session)
        self.assertEqual(request.session["sso_provider"], "test-provider")

        parsed = urlparse(response.url)
        params = parse_qs(parsed.query)
        self.assertEqual(params["state"][0], request.session["sso_state"])

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
    def test_preserves_callback_url(self):
        """callbackUrl query param is stored in session."""
        request = self.factory.get("/auth/sso/test-provider/authorize/?callbackUrl=/team/settings")
        _add_session_to_request(request)

        view = SSOAuthorizeView()
        view.get(request, "test-provider")

        self.assertEqual(request.session["sso_return_to"], "/team/settings")

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
    @patch("api.views.sso._get_oidc_endpoints")
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
    @patch("api.views.sso._get_oidc_endpoints")
    def test_oidc_discovery_failure_returns_502(self, mock_discovery):
        """If OIDC discovery fails, return 502."""
        mock_discovery.return_value = None

        request = self.factory.get("/auth/sso/test-oidc/authorize/")
        _add_session_to_request(request)

        view = SSOAuthorizeView()
        response = view.get(request, "test-oidc")
        self.assertEqual(response.status_code, 502)


class SSOCallbackViewTest(unittest.TestCase):
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

    def test_provider_error_redirects_with_encoded_error(self):
        """Provider returning an error redirects with URL-encoded description."""
        request = self.factory.get(
            "/auth/sso/google/callback/?error=access_denied&error_description=User+denied+access"
        )
        _add_session_to_request(request)

        view = SSOCallbackView()
        response = view.get(request, "google")
        self.assertEqual(response.status_code, 302)
        self.assertIn("error=", response.url)
        self.assertNotIn(" ", response.url)

    def test_unknown_provider_redirects_with_error(self):
        """Unknown provider in callback redirects to login."""
        request = self.factory.get("/auth/sso/nonexistent/callback/?code=abc&state=valid")
        _add_session_to_request(request)
        request.session["sso_state"] = "valid"
        request.session.save()

        view = SSOCallbackView()
        response = view.get(request, "nonexistent")
        self.assertEqual(response.status_code, 302)
        self.assertIn("error=unknown_provider", response.url)


class DomainWhitelistTest(unittest.TestCase):
    """Tests for email domain whitelist enforcement."""

    @patch("api.views.sso.DOMAIN_WHITELIST", [])
    def test_no_whitelist_allows_all(self):
        self.assertTrue(_check_email_domain_allowed("user@anything.com"))

    @patch("api.views.sso.DOMAIN_WHITELIST", ["acme.com", "example.org"])
    def test_allowed_domain_passes(self):
        self.assertTrue(_check_email_domain_allowed("user@acme.com"))
        self.assertTrue(_check_email_domain_allowed("admin@example.org"))

    @patch("api.views.sso.DOMAIN_WHITELIST", ["acme.com"])
    def test_blocked_domain_fails(self):
        self.assertFalse(_check_email_domain_allowed("user@other.com"))

    @patch("api.views.sso.DOMAIN_WHITELIST", ["acme.com"])
    def test_case_insensitive(self):
        self.assertTrue(_check_email_domain_allowed("user@ACME.COM"))


class CallbackUrlTest(unittest.TestCase):
    """Tests for callback URL generation."""

    @patch("api.views.sso.FRONTEND_URL", "https://app.phase.dev")
    def test_callback_url_uses_frontend_url(self):
        """Callback URL uses the frontend base URL for legacy compat."""
        url = _get_callback_url("google")
        self.assertEqual(url, "https://app.phase.dev/api/auth/callback/google")


class ProviderRegistryTest(unittest.TestCase):
    """Tests for the SSO provider registry."""

    def test_registry_structure(self):
        """Registry entries have required fields."""
        for slug, config in SSO_PROVIDER_REGISTRY.items():
            self.assertIn("client_id", config)
            self.assertIn("client_secret", config)
            self.assertIn("adapter_module", config)
            self.assertIn("adapter_class", config)
            self.assertIn("provider_id", config)
            self.assertIn("scopes", config)


class SSRFGuardTest(unittest.TestCase):
    """Regressions for the SSRF guards on OIDC discovery and token
    exchange. On cloud, URLs must be passed through validate_url_is_safe
    and redirects must be disabled to defeat 30x pivots."""

    @patch("api.views.sso.settings")
    @patch("api.views.sso.validate_url_is_safe")
    @patch("api.views.sso.http_requests.request")
    def test_safe_oidc_request_validates_on_cloud(
        self, mock_request, mock_validate, mock_settings
    ):
        mock_settings.APP_HOST = "cloud"
        _safe_oidc_request("GET", "https://issuer.example.com/foo")
        mock_validate.assert_called_once_with("https://issuer.example.com/foo")
        # allow_redirects must be False regardless of caller
        self.assertFalse(mock_request.call_args.kwargs.get("allow_redirects"))

    @patch("api.views.sso.settings")
    @patch("api.views.sso.validate_url_is_safe")
    @patch("api.views.sso.http_requests.request")
    def test_safe_oidc_request_skips_validation_self_hosted(
        self, mock_request, mock_validate, mock_settings
    ):
        mock_settings.APP_HOST = "self"
        _safe_oidc_request("GET", "https://internal.corp/foo")
        mock_validate.assert_not_called()
        self.assertFalse(mock_request.call_args.kwargs.get("allow_redirects"))

    @patch("api.views.sso.settings")
    @patch("api.views.sso.validate_url_is_safe")
    def test_safe_oidc_request_raises_on_private_ip(
        self, mock_validate, mock_settings
    ):
        from django.core.exceptions import ValidationError

        mock_settings.APP_HOST = "cloud"
        mock_validate.side_effect = ValidationError("private IP")
        with self.assertRaises(ValueError):
            _safe_oidc_request("GET", "http://169.254.169.254/latest/meta-data/")

    @patch("api.views.sso.settings")
    @patch("api.views.sso.http_requests.request")
    @patch("api.views.sso.validate_url_is_safe")
    def test_discovery_rejects_unsafe_token_endpoint(
        self, mock_validate, mock_request, mock_settings
    ):
        """A malicious discovery doc returning an internal token_endpoint
        must be rejected even if the issuer URL itself was safe."""
        from django.core.exceptions import ValidationError

        mock_settings.APP_HOST = "cloud"

        def validate_side_effect(url):
            if "169.254" in url:
                raise ValidationError("private IP")

        mock_validate.side_effect = validate_side_effect

        resp = MagicMock()
        resp.json.return_value = {
            "authorization_endpoint": "https://issuer.example.com/authorize",
            "token_endpoint": "http://169.254.169.254/token",
        }
        mock_request.return_value = resp

        # Clear any stale cache so the fetch actually runs
        from api.views import sso as sso_mod
        sso_mod._oidc_cache.clear()

        endpoints = _get_oidc_endpoints("https://issuer.example.com")
        self.assertIsNone(endpoints)

    @patch("api.views.sso.settings")
    @patch("api.views.sso.http_requests.request")
    def test_exchange_code_uses_safe_request(self, mock_request, mock_settings):
        """Token exchange must go through _safe_oidc_request so the
        POST can't be redirected to an internal host."""
        mock_settings.APP_HOST = "self"  # skip IP validation, just check redirects
        resp = MagicMock()
        resp.json.return_value = {"access_token": "abc"}
        mock_request.return_value = resp

        _exchange_code_for_token(
            "https://idp.example.com/token",
            {"code": "x", "client_id": "cid", "client_secret": "csecret"},
            "client_secret_post",
            "cid",
            "csecret",
        )
        self.assertEqual(mock_request.call_args.args[0], "POST")
        self.assertFalse(mock_request.call_args.kwargs.get("allow_redirects"))
