import pytest
import json
import base64
from unittest.mock import patch, MagicMock
from django.test import RequestFactory
from api.views.auth import github_integration_callback


class TestGitHubIntegrationCallbackURLValidation:
    """Tests that the GitHub OAuth callback validates host URLs."""

    def _make_state(self, host_url="https://github.com", **kwargs):
        """Create a base64-encoded state parameter."""
        state = {
            "returnUrl": "/",
            "isEnterprise": True,
            "hostUrl": host_url,
            "apiUrl": host_url,
            "orgId": "test-org",
            "name": "test",
            **kwargs,
        }
        return base64.b64encode(json.dumps(state).encode()).decode()

    def test_rejects_private_ip_host_url(self):
        """host_url pointing to a private IP should be rejected."""
        factory = RequestFactory()
        state = self._make_state(host_url="http://169.254.169.254/latest/meta-data")
        request = factory.get(
            "/oauth/github/callback",
            {"code": "test-code", "state": state},
        )

        with patch.dict("os.environ", {"ALLOWED_ORIGINS": "https://example.com"}):
            response = github_integration_callback(request)

        assert response.status_code == 302
        assert "invalid_host_url" in response.url

    def test_rejects_localhost_host_url(self):
        """host_url pointing to localhost should be rejected."""
        factory = RequestFactory()
        state = self._make_state(host_url="http://127.0.0.1:8080")
        request = factory.get(
            "/oauth/github/callback",
            {"code": "test-code", "state": state},
        )

        with patch.dict("os.environ", {"ALLOWED_ORIGINS": "https://example.com"}):
            response = github_integration_callback(request)

        assert response.status_code == 302
        assert "invalid_host_url" in response.url

    def test_rejects_internal_network_host_url(self):
        """host_url pointing to internal network should be rejected."""
        factory = RequestFactory()
        state = self._make_state(host_url="http://10.0.0.1")
        request = factory.get(
            "/oauth/github/callback",
            {"code": "test-code", "state": state},
        )

        with patch.dict("os.environ", {"ALLOWED_ORIGINS": "https://example.com"}):
            response = github_integration_callback(request)

        assert response.status_code == 302
        assert "invalid_host_url" in response.url

    def test_rejects_non_http_scheme(self):
        """host_url with non-http scheme should be rejected."""
        factory = RequestFactory()
        state = self._make_state(host_url="file:///etc/passwd")
        request = factory.get(
            "/oauth/github/callback",
            {"code": "test-code", "state": state},
        )

        with patch.dict("os.environ", {"ALLOWED_ORIGINS": "https://example.com"}):
            response = github_integration_callback(request)

        assert response.status_code == 302
        assert "invalid_host_url" in response.url

    @patch("api.views.auth.requests.post")
    @patch("api.views.auth.store_oauth_token")
    @patch("api.views.auth.get_secret", return_value="fake-secret")
    def test_allows_valid_github_host_url(self, mock_secret, mock_store, mock_post):
        """A valid public GitHub URL should be allowed through."""
        factory = RequestFactory()
        state = self._make_state(host_url="https://github.com")
        request = factory.get(
            "/oauth/github/callback",
            {"code": "test-code", "state": state},
        )

        mock_post.return_value = MagicMock(
            json=MagicMock(return_value={"access_token": "gho_test123"})
        )

        with patch.dict(
            "os.environ",
            {
                "ALLOWED_ORIGINS": "https://example.com",
                "GITHUB_ENTERPRISE_INTEGRATION_CLIENT_ID": "test-id",
            },
        ):
            with patch("api.views.auth.validate_url_is_safe"):
                response = github_integration_callback(request)

        # Should redirect back to app (not error)
        assert response.status_code == 302
        assert "invalid_host_url" not in response.url
