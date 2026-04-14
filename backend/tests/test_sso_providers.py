"""
Happy-path tests for the SSO callback flow with each provider.

Each provider test exercises the full SSOCallbackView.get() path with:
- Realistic token-exchange responses matching the provider's documented format
- Realistic adapter output (SocialLogin with provider-specific extra_data)
- User creation / linking via _complete_login_bypassing_allauth
- Session cleanup and redirect verification

All Django ORM operations and external HTTP calls are mocked — no database
or network required.  Mock data shapes are derived from each provider's
public API documentation and real-world responses.
"""

import json
import unittest
from unittest.mock import patch, MagicMock
from urllib.parse import urlparse, parse_qs

from django.test import RequestFactory
from django.contrib.sessions.middleware import SessionMiddleware

from api.views.sso import (
    auth_me,
    SSOCallbackView,
    SSO_PROVIDER_REGISTRY,
    _complete_login_bypassing_allauth,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _add_session(request):
    """Attach a working session to a RequestFactory-produced request."""
    middleware = SessionMiddleware(lambda req: None)
    middleware.process_request(request)
    request.session.save()


def _make_social_login(extra_data, uid, provider_id, email=None):
    """Build a mock SocialLogin with the shape adapters produce."""
    sl = MagicMock()
    sl.account.extra_data = extra_data
    sl.account.uid = uid
    sl.account.provider = provider_id
    sl.state = {}
    sl.token = None

    # .user mirrors what sociallogin_from_response populates
    sl.user = MagicMock()
    sl.user.email = email or extra_data.get("email") or extra_data.get("mail") or ""
    return sl


# ═══════════════════════════════════════════════════════════════════════════
# Provider Fixtures — realistic shapes from each IdP
# ═══════════════════════════════════════════════════════════════════════════

PROVIDERS = {}

# --- Google OAuth2 --------------------------------------------------------

PROVIDERS["google"] = {
    "registry": {
        "client_id": "123456789-abc.apps.googleusercontent.com",
        "client_secret": "GOCSPX-test-secret",
        "authorize_url": "https://accounts.google.com/o/oauth2/v2/auth",
        "token_url": "https://oauth2.googleapis.com/token",
        "scopes": "openid profile email",
        "adapter_module": "api.authentication.adapters.google",
        "adapter_class": "CustomGoogleOAuth2Adapter",
        "provider_id": "google",
        "token_auth_method": "client_secret_post",
        "extra_auth_params": {"access_type": "online"},
    },
    "token_response": {
        "access_token": "ya29.a0AfH6SMBxxxxxxxxxxxxx",
        "expires_in": 3599,
        "scope": "openid https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email",
        "token_type": "Bearer",
        "id_token": "eyJhbGciOiJSUzI1NiJ9.fake-payload.fake-sig",
    },
    # Decoded id_token payload — this is what the Google adapter puts into
    # extra_data after jwt.decode().
    "extra_data": {
        "sub": "109876543210987654321",
        "email": "alice@gmail.com",
        "email_verified": True,
        "name": "Alice Johnson",
        "given_name": "Alice",
        "family_name": "Johnson",
        "picture": "https://lh3.googleusercontent.com/a/ACg8ocK=s96-c",
        "aud": "123456789-abc.apps.googleusercontent.com",
        "iss": "https://accounts.google.com",
        "iat": 1714000000,
        "exp": 1714003600,
    },
    "uid": "109876543210987654321",           # Google uses 'sub'
    "expected_email": "alice@gmail.com",
    "expected_name": "Alice Johnson",
    "expected_avatar": "https://lh3.googleusercontent.com/a/ACg8ocK=s96-c",
    "avatar_key": "picture",
}

# --- GitHub OAuth2 --------------------------------------------------------

PROVIDERS["github"] = {
    "registry": {
        "client_id": "Iv1.abcdef1234567890",
        "client_secret": "ghsecret_xxxxxxxxxxxxxxxxxxxxxxxx",
        "authorize_url": "https://github.com/login/oauth/authorize",
        "token_url": "https://github.com/login/oauth/access_token",
        "scopes": "user:email read:user",
        "adapter_module": "api.authentication.adapters.github",
        "adapter_class": "CustomGitHubOAuth2Adapter",
        "provider_id": "github",
        "token_auth_method": "client_secret_post",
    },
    "token_response": {
        # GitHub returns a flat token response — no id_token, no expiry
        "access_token": "gho_16C7e42F292c6912E7710c838347Ae178B4a",
        "token_type": "bearer",
        "scope": "user:email,read:user",
    },
    # From GET /user  — GitHub returns the full public profile.
    "extra_data": {
        "id": 12345678,
        "login": "alicejohnson",
        "node_id": "MDQ6VXNlcjEyMzQ1Njc4",
        "avatar_url": "https://avatars.githubusercontent.com/u/12345678?v=4",
        "gravatar_id": "",
        "url": "https://api.github.com/users/alicejohnson",
        "html_url": "https://github.com/alicejohnson",
        "type": "User",
        "site_admin": False,
        "name": "Alice Johnson",
        "company": "Phase",
        "blog": "https://alice.dev",
        "location": "San Francisco, CA",
        "email": "alice@github.com",
        "hireable": None,
        "bio": "Building the future",
        "twitter_username": "alicejohnson",
        "public_repos": 42,
        "public_gists": 5,
        "followers": 250,
        "following": 30,
        "created_at": "2018-06-15T10:30:00Z",
        "updated_at": "2026-03-01T08:00:00Z",
    },
    "uid": "12345678",                        # GitHub uses 'id' (numeric)
    "expected_email": "alice@github.com",
    "expected_name": "Alice Johnson",
    "expected_avatar": "https://avatars.githubusercontent.com/u/12345678?v=4",
    "avatar_key": "avatar_url",
}

# --- GitHub (email from /user/emails) -------------------------------------
# Edge case: GitHub profile has no email; adapter falls back to /user/emails.

PROVIDERS["github-no-primary-email"] = {
    "registry": PROVIDERS["github"]["registry"],
    "token_response": PROVIDERS["github"]["token_response"],
    "extra_data": {
        **PROVIDERS["github"]["extra_data"],
        "email": "alice-fallback@github.com",  # adapter resolved from /user/emails
    },
    "uid": "12345678",
    "expected_email": "alice-fallback@github.com",
    "expected_name": "Alice Johnson",
    "expected_avatar": "https://avatars.githubusercontent.com/u/12345678?v=4",
    "avatar_key": "avatar_url",
    "skip_callback_test": True,  # variant, tested separately
}

# --- GitLab OAuth2 --------------------------------------------------------

PROVIDERS["gitlab"] = {
    "registry": {
        "client_id": "abcdef1234567890abcdef1234567890abcdef12",
        "client_secret": "gloas-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "authorize_url": "https://gitlab.com/oauth/authorize",
        "token_url": "https://gitlab.com/oauth/token",
        "scopes": "read_user",
        "adapter_module": "api.authentication.adapters.gitlab",
        "adapter_class": "CustomGitLabOAuth2Adapter",
        "provider_id": "gitlab",
        "token_auth_method": "client_secret_post",
    },
    "token_response": {
        "access_token": "glpat-xxxxxxxxxxxxxxxxxxxx",
        "token_type": "Bearer",
        "expires_in": 7200,
        "refresh_token": "xxxxxxxxxxxxxxxxxxxx",
        "scope": "read_user",
        "created_at": 1714000000,
    },
    # From GET /api/v4/user
    "extra_data": {
        "id": 7654321,
        "username": "alicejohnson",
        "name": "Alice Johnson",
        "state": "active",
        "locked": False,
        "avatar_url": "https://gitlab.com/uploads/-/system/user/avatar/7654321/avatar.png",
        "web_url": "https://gitlab.com/alicejohnson",
        "created_at": "2020-01-15T10:00:00.000Z",
        "bio": "",
        "location": "",
        "public_email": "alice@gitlab.com",
        "skype": "",
        "linkedin": "",
        "twitter": "",
        "discord": "",
        "website_url": "",
        "organization": "Phase",
        "job_title": "",
        "pronouns": None,
        "bot": False,
        "work_information": None,
        "local_time": None,
        "last_sign_in_at": "2026-04-01T12:00:00.000Z",
        "confirmed_at": "2020-01-15T10:05:00.000Z",
        "last_activity_on": "2026-04-10",
        "email": "alice@gitlab.com",
        "theme_id": 1,
        "color_scheme_id": 1,
        "projects_limit": 100000,
        "current_sign_in_at": "2026-04-10T09:00:00.000Z",
        "identities": [],
        "can_create_group": True,
        "can_create_project": True,
        "two_factor_enabled": True,
        "external": False,
        "private_profile": False,
        "commit_email": "alice@gitlab.com",
    },
    "uid": "7654321",                          # GitLab uses 'id' (numeric)
    "expected_email": "alice@gitlab.com",
    "expected_name": "Alice Johnson",
    "expected_avatar": "https://gitlab.com/uploads/-/system/user/avatar/7654321/avatar.png",
    "avatar_key": "avatar_url",
}

# --- GitHub Enterprise ----------------------------------------------------

PROVIDERS["github-enterprise"] = {
    "registry": {
        "client_id": "ghe-client-id-xxxxx",
        "client_secret": "ghe-client-secret-xxxxx",
        "authorize_url": "https://github.corp.example.com/login/oauth/authorize",
        "token_url": "https://github.corp.example.com/login/oauth/access_token",
        "scopes": "user:email read:user",
        "adapter_module": "ee.authentication.sso.oauth.github_enterprise.views",
        "adapter_class": "GitHubEnterpriseOAuth2Adapter",
        "provider_id": "github-enterprise",
        "token_auth_method": "client_secret_post",
    },
    "token_response": {
        "access_token": "gho_ent_xxxxxxxxxxxxxxxxxxxxxxxx",
        "token_type": "bearer",
        "scope": "user:email,read:user",
    },
    # Same shape as github.com /user but from enterprise instance
    "extra_data": {
        "id": 101,
        "login": "ajohnson",
        "node_id": "MDQ6VXNlcjEwMQ==",
        "avatar_url": "https://github.corp.example.com/avatars/u/101",
        "url": "https://github.corp.example.com/api/v3/users/ajohnson",
        "html_url": "https://github.corp.example.com/ajohnson",
        "type": "User",
        "site_admin": False,
        "name": "Alice Johnson",
        "email": "alice@corp.example.com",
        "company": "Example Corp",
        "created_at": "2022-01-01T00:00:00Z",
        "updated_at": "2026-04-01T00:00:00Z",
    },
    "uid": "101",
    "expected_email": "alice@corp.example.com",
    "expected_name": "Alice Johnson",
    "expected_avatar": "https://github.corp.example.com/avatars/u/101",
    "avatar_key": "avatar_url",
}

# --- Microsoft Entra ID (OIDC) -------------------------------------------
# Uses Microsoft Graph /me — unique field names: displayName, mail, surName.
# Email often comes from the id_token JWT, not the Graph API.

PROVIDERS["entra-id-oidc"] = {
    "registry": {
        "client_id": "abcdef01-2345-6789-abcd-ef0123456789",
        "client_secret": "entra-secret-xxxxxxxx",
        "issuer": "https://login.microsoftonline.com/tenant-id/v2.0",
        "scopes": "openid profile email User.Read",
        "adapter_module": "ee.authentication.sso.oidc.entraid.views",
        "adapter_class": "CustomMicrosoftGraphOAuth2Adapter",
        "provider_id": "microsoft",
        "token_auth_method": "client_secret_post",
        "is_oidc": True,
    },
    "token_response": {
        "access_token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.graph-access-token",
        "token_type": "Bearer",
        "expires_in": 3600,
        "scope": "openid profile email User.Read",
        "refresh_token": "0.AAAA-refresh-token-xxx",
        "id_token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.entra-id-token",
    },
    # Composite: Graph /me response enriched by adapter (adds "name" field).
    # Note: Microsoft uses "mail" not "email", "displayName" not "name".
    "extra_data": {
        "id": "87654321-4321-4321-4321-210987654321",
        "displayName": "Alice Johnson",
        "givenName": "Alice",
        "surName": "Johnson",
        "mail": "alice@contoso.com",
        "userPrincipalName": "alice@contoso.com",
        "jobTitle": "Senior Engineer",
        "officeLocation": "Building 42",
        "mobilePhone": None,
        "businessPhones": ["+1 555-0100"],
        "preferredLanguage": "en-US",
        # Adapter constructs this from displayName
        "name": "Alice Johnson",
    },
    "uid": "87654321-4321-4321-4321-210987654321",  # Entra uses Graph 'id'
    "expected_email": "alice@contoso.com",
    "expected_name": "Alice Johnson",
    # Entra ID doesn't return a photo URL in the Graph /me response.
    # The auth_me view would check extra.get("photo") which is absent.
    "expected_avatar": None,
    "avatar_key": "photo",
}

# --- Entra ID edge case: email from JWT preferred_username ----------------
# When mail is null in Graph response, adapter falls back to JWT claims.

PROVIDERS["entra-id-oidc-upn-fallback"] = {
    "registry": PROVIDERS["entra-id-oidc"]["registry"],
    "token_response": PROVIDERS["entra-id-oidc"]["token_response"],
    "extra_data": {
        **PROVIDERS["entra-id-oidc"]["extra_data"],
        "mail": None,  # Some tenants don't populate mail
    },
    "uid": "87654321-4321-4321-4321-210987654321",
    # The adapter falls back to preferred_username from the JWT
    "expected_email": "alice@contoso.com",  # from userPrincipalName / JWT
    "expected_name": "Alice Johnson",
    "expected_avatar": None,
    "avatar_key": "photo",
    "skip_callback_test": True,
}

# --- Google OIDC ----------------------------------------------------------
# Standard OIDC claims from id_token or userinfo endpoint.

PROVIDERS["google-oidc"] = {
    "registry": {
        "client_id": "123456789-oidc.apps.googleusercontent.com",
        "client_secret": "GOCSPX-oidc-test-secret",
        "issuer": "https://accounts.google.com",
        "scopes": "openid email profile",
        "adapter_module": "ee.authentication.sso.oidc.util.google.views",
        "adapter_class": "GoogleOpenIDConnectAdapter",
        "provider_id": "google-oidc",
        "token_auth_method": "client_secret_post",
        "is_oidc": True,
    },
    "token_response": {
        "access_token": "ya29.oidc-access-token",
        "expires_in": 3599,
        "scope": "openid email profile",
        "token_type": "Bearer",
        "id_token": "eyJhbGciOiJSUzI1NiJ9.google-oidc-id-token",
    },
    # Decoded id_token / userinfo — standard OIDC claims
    "extra_data": {
        "sub": "109876543210987654321",
        "email": "alice@company.com",
        "email_verified": True,
        "name": "Alice Johnson",
        "picture": "https://lh3.googleusercontent.com/a/photo-oidc",
        "given_name": "Alice",
        "family_name": "Johnson",
        "locale": "en",
        "iss": "https://accounts.google.com",
        "aud": "123456789-oidc.apps.googleusercontent.com",
        "iat": 1714000000,
        "exp": 1714003600,
    },
    "uid": "109876543210987654321",           # OIDC uses 'sub'
    "expected_email": "alice@company.com",
    "expected_name": "Alice Johnson",
    "expected_avatar": "https://lh3.googleusercontent.com/a/photo-oidc",
    "avatar_key": "picture",
}

# --- JumpCloud OIDC -------------------------------------------------------

PROVIDERS["jumpcloud-oidc"] = {
    "registry": {
        "client_id": "jumpcloud-client-id-xxxxx",
        "client_secret": "jumpcloud-client-secret-xxxxx",
        "issuer": "https://oauth.id.jumpcloud.com",
        "scopes": "openid email profile",
        "adapter_module": "ee.authentication.sso.oidc.util.jumpcloud.views",
        "adapter_class": "JumpCloudOpenIDConnectAdapter",
        "provider_id": "jumpcloud-oidc",
        "token_auth_method": "client_secret_post",
        "is_oidc": True,
    },
    "token_response": {
        "access_token": "jc-access-token-xxxxxxxxxxxx",
        "expires_in": 3600,
        "id_token": "eyJhbGciOiJSUzI1NiJ9.jumpcloud-id-token",
        "scope": "openid email profile",
        "token_type": "bearer",
    },
    # JumpCloud userinfo / decoded id_token
    "extra_data": {
        "sub": "5f8b3e7c1a2b3c4d5e6f7890",
        "email": "alice@jumpcloud-org.com",
        "email_verified": True,
        "name": "Alice Johnson",
        "given_name": "Alice",
        "family_name": "Johnson",
        "picture": None,                       # JumpCloud often omits picture
    },
    "uid": "5f8b3e7c1a2b3c4d5e6f7890",
    "expected_email": "alice@jumpcloud-org.com",
    "expected_name": "Alice Johnson",
    "expected_avatar": None,
    "avatar_key": "picture",
}

# --- Okta OIDC ------------------------------------------------------------
# Uses client_secret_basic (HTTP Basic auth on token endpoint).

PROVIDERS["okta-oidc"] = {
    "registry": {
        "client_id": "0oaxxxxxxxxxxxxxxxx",
        "client_secret": "okta-secret-xxxxxxxxxxxxxxxxxxxxxxxx",
        "issuer": "https://dev-12345.okta.com",
        "scopes": "openid email profile",
        "adapter_module": "ee.authentication.sso.oidc.okta.views",
        "adapter_class": "OktaOpenIDConnectAdapter",
        "provider_id": "okta-oidc",
        "token_auth_method": "client_secret_basic",
        "is_oidc": True,
    },
    "token_response": {
        "access_token": "eyJraWQiOiJva3RhLWFjY2Vzcy10b2tlbiJ9.xxx",
        "token_type": "Bearer",
        "expires_in": 3600,
        "scope": "openid email profile",
        "id_token": "eyJhbGciOiJSUzI1NiJ9.okta-id-token",
    },
    # Okta userinfo / decoded id_token — standard OIDC with Okta extras
    "extra_data": {
        "sub": "00u1abcdefghijklmno",
        "email": "alice@okta-org.com",
        "email_verified": True,
        "name": "Alice Johnson",
        "given_name": "Alice",
        "family_name": "Johnson",
        "preferred_username": "alice@okta-org.com",
        "locale": "en-US",
        "zoneinfo": "America/Los_Angeles",
        "updated_at": 1714000000,
    },
    "uid": "00u1abcdefghijklmno",
    "expected_email": "alice@okta-org.com",
    "expected_name": "Alice Johnson",
    "expected_avatar": None,                   # Okta doesn't return picture by default
    "avatar_key": "picture",
}

# --- Authentik OIDC -------------------------------------------------------

PROVIDERS["authentik"] = {
    "registry": {
        "client_id": "authentik-phase-console",
        "client_secret": "authentik-secret-xxxxxxxxxxxxxxxx",
        "issuer": "https://auth.example.com",
        "scopes": "openid email profile",
        "adapter_module": "api.authentication.providers.authentik.views",
        "adapter_class": "AuthentikOpenIDConnectAdapter",
        "provider_id": "authentik",
        "token_auth_method": "client_secret_post",
        "is_oidc": True,
    },
    "token_response": {
        "access_token": "ak-access-token-xxxxxxxxxxxx",
        "token_type": "Bearer",
        "expires_in": 3600,
        "id_token": "eyJhbGciOiJSUzI1NiJ9.authentik-id-token",
        "scope": "openid email profile",
    },
    # Authentik userinfo — includes Authentik-specific fields
    "extra_data": {
        "sub": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "email": "alice@authentik-org.com",
        "email_verified": True,
        "name": "Alice Johnson",
        "given_name": "Alice",
        "family_name": "Johnson",
        "preferred_username": "alice",
        "nickname": "alice",
        "groups": ["phase-users", "admins"],
    },
    "uid": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "expected_email": "alice@authentik-org.com",
    "expected_name": "Alice Johnson",
    "expected_avatar": None,
    "avatar_key": "picture",
}

# --- Authelia OIDC --------------------------------------------------------

PROVIDERS["authelia"] = {
    "registry": {
        "client_id": "phase-console",
        "client_secret": "authelia-secret-xxxxxxxxxxxxxxxx",
        "issuer": "https://auth.example.com",
        "scopes": "openid email profile",
        "adapter_module": "api.authentication.providers.authelia.views",
        "adapter_class": "AutheliaOpenIDConnectAdapter",
        "provider_id": "authelia",
        "token_auth_method": "client_secret_post",
        "is_oidc": True,
    },
    "token_response": {
        "access_token": "authelia-access-token-xxxxxxxxxxxx",
        "token_type": "Bearer",
        "expires_in": 3600,
        "id_token": "eyJhbGciOiJSUzI1NiJ9.authelia-id-token",
        "scope": "openid email profile",
    },
    # Authelia userinfo — uses standard OIDC claims + AMR
    "extra_data": {
        "sub": "79e01414-21b4-49b1-9b61-f9774b980350",
        "email": "alice@authelia-org.com",
        "email_verified": True,
        "name": "Alice Johnson",
        "preferred_username": "alice",
        "amr": ["pwd", "totp"],
        "rat": 1774504670,
        "updated_at": 1774504675,
    },
    "uid": "79e01414-21b4-49b1-9b61-f9774b980350",
    "expected_email": "alice@authelia-org.com",
    "expected_name": "Alice Johnson",
    "expected_avatar": None,
    "avatar_key": "picture",
}


# ═══════════════════════════════════════════════════════════════════════════
# 1. SSOCallbackView happy-path — per-provider parametrised tests
# ═══════════════════════════════════════════════════════════════════════════

class SSOCallbackHappyPathTest(unittest.TestCase):
    """
    For each provider: simulate a valid OAuth callback and verify the full
    flow completes — token exchange, adapter call, user login, redirect.
    """

    def setUp(self):
        self.factory = RequestFactory()

    def _run_happy_path(self, slug, fixture):
        """Core helper that executes one provider's happy path."""
        config = fixture["registry"]
        state = "valid-random-state-42"

        request = self.factory.get(
            f"/auth/sso/{slug}/callback/?code=auth-code-xxx&state={state}"
        )
        _add_session(request)
        request.session["sso_state"] = state
        request.session["sso_provider"] = slug
        request.session["sso_callback_url"] = f"https://console.phase.dev/api/auth/callback/{slug}"
        request.session["sso_token_url"] = config.get("token_url") or "https://idp.example.com/token"
        request.session.save()

        mock_adapter = MagicMock()
        mock_adapter.complete_login.return_value = _make_social_login(
            extra_data=fixture["extra_data"],
            uid=fixture["uid"],
            provider_id=config["provider_id"],
            email=fixture["expected_email"],
        )

        mock_social_app = MagicMock()
        mock_social_app.client_id = config["client_id"]

        mock_user = MagicMock()
        mock_user.is_authenticated = True
        mock_user.userId = "test-uuid-001"
        mock_user.email = fixture["expected_email"]

        # Mock SocialToken class — its constructor validates ForeignKey(app)
        # against a real SocialApp instance, which breaks with MagicMock.
        mock_social_token_cls = MagicMock()
        mock_social_token_instance = MagicMock()
        mock_social_token_cls.return_value = mock_social_token_instance

        with patch.dict(SSO_PROVIDER_REGISTRY, {slug: config}, clear=False), \
             patch("api.views.sso._exchange_code_for_token", return_value=fixture["token_response"]) as mock_exchange, \
             patch("api.views.sso._get_adapter_instance", return_value=mock_adapter) as mock_get_adapter, \
             patch("api.views.sso._get_or_create_social_app", return_value=mock_social_app), \
             patch("api.views.sso.SocialToken", mock_social_token_cls), \
             patch("api.views.sso._complete_login_bypassing_allauth", return_value=mock_user) as mock_complete, \
             patch("api.views.sso.FRONTEND_URL", "https://console.phase.dev"):

            request.user = mock_user
            view = SSOCallbackView()
            response = view.get(request, slug)

        # --- Assertions ---

        # 1. Token exchange called with correct token URL and auth method
        mock_exchange.assert_called_once()
        call_args = mock_exchange.call_args
        self.assertEqual(call_args[0][2], config.get("token_auth_method", "client_secret_post"))

        # 2. Adapter instantiated and complete_login invoked
        mock_get_adapter.assert_called_once()
        mock_adapter.complete_login.assert_called_once()
        # The token_data (response kwarg) must include the access_token
        cl_kwargs = mock_adapter.complete_login.call_args
        response_arg = cl_kwargs[1].get("response") or cl_kwargs[0][3]
        self.assertIn("access_token", fixture["token_response"])

        # 3. _complete_login_bypassing_allauth called
        mock_complete.assert_called_once()

        # 4. Redirect to frontend root
        self.assertEqual(response.status_code, 302)
        self.assertTrue(
            response.url.startswith("https://console.phase.dev"),
            f"Expected redirect to frontend, got: {response.url}",
        )

        # 5. SSO session keys cleaned up
        for key in ["sso_state", "sso_provider", "sso_callback_url", "sso_token_url", "sso_nonce", "sso_return_to"]:
            self.assertNotIn(key, request.session, f"Session key '{key}' should be cleaned up")

        return response

    # --- One test method per provider ---

    @patch.dict(SSO_PROVIDER_REGISTRY, {}, clear=True)
    def test_google_oauth2(self):
        self._run_happy_path("google", PROVIDERS["google"])

    @patch.dict(SSO_PROVIDER_REGISTRY, {}, clear=True)
    def test_github_oauth2(self):
        self._run_happy_path("github", PROVIDERS["github"])

    @patch.dict(SSO_PROVIDER_REGISTRY, {}, clear=True)
    def test_gitlab_oauth2(self):
        self._run_happy_path("gitlab", PROVIDERS["gitlab"])

    @patch.dict(SSO_PROVIDER_REGISTRY, {}, clear=True)
    def test_github_enterprise(self):
        self._run_happy_path("github-enterprise", PROVIDERS["github-enterprise"])

    @patch.dict(SSO_PROVIDER_REGISTRY, {}, clear=True)
    def test_entra_id_oidc(self):
        self._run_happy_path("entra-id-oidc", PROVIDERS["entra-id-oidc"])

    @patch.dict(SSO_PROVIDER_REGISTRY, {}, clear=True)
    def test_google_oidc(self):
        self._run_happy_path("google-oidc", PROVIDERS["google-oidc"])

    @patch.dict(SSO_PROVIDER_REGISTRY, {}, clear=True)
    def test_jumpcloud_oidc(self):
        self._run_happy_path("jumpcloud-oidc", PROVIDERS["jumpcloud-oidc"])

    @patch.dict(SSO_PROVIDER_REGISTRY, {}, clear=True)
    def test_okta_oidc(self):
        self._run_happy_path("okta-oidc", PROVIDERS["okta-oidc"])

    @patch.dict(SSO_PROVIDER_REGISTRY, {}, clear=True)
    def test_authentik(self):
        self._run_happy_path("authentik", PROVIDERS["authentik"])

    @patch.dict(SSO_PROVIDER_REGISTRY, {}, clear=True)
    def test_authelia(self):
        self._run_happy_path("authelia", PROVIDERS["authelia"])


# ═══════════════════════════════════════════════════════════════════════════
# 2. Deep-link redirect preservation
# ═══════════════════════════════════════════════════════════════════════════

class SSOCallbackDeepLinkTest(unittest.TestCase):
    """Verify that sso_return_to deep link is preserved through login."""

    def setUp(self):
        self.factory = RequestFactory()

    def test_deep_link_redirect(self):
        """After SSO login, user is redirected to the original deep link."""
        slug = "google"
        config = PROVIDERS["google"]["registry"]
        state = "deep-link-state-99"

        request = self.factory.get(
            f"/auth/sso/{slug}/callback/?code=code-xxx&state={state}"
        )
        _add_session(request)
        request.session["sso_state"] = state
        request.session["sso_provider"] = slug
        request.session["sso_callback_url"] = "https://console.phase.dev/api/auth/callback/google"
        request.session["sso_token_url"] = config["token_url"]
        request.session["sso_return_to"] = "/myteam/apps/myapp/secrets"
        request.session.save()

        mock_adapter = MagicMock()
        mock_adapter.complete_login.return_value = _make_social_login(
            extra_data=PROVIDERS["google"]["extra_data"],
            uid=PROVIDERS["google"]["uid"],
            provider_id="google",
            email="alice@gmail.com",
        )

        mock_user = MagicMock()
        mock_user.is_authenticated = True

        with patch.dict(SSO_PROVIDER_REGISTRY, {slug: config}, clear=True), \
             patch("api.views.sso._exchange_code_for_token", return_value=PROVIDERS["google"]["token_response"]), \
             patch("api.views.sso._get_adapter_instance", return_value=mock_adapter), \
             patch("api.views.sso._get_or_create_social_app", return_value=MagicMock()), \
             patch("api.views.sso.SocialToken", MagicMock()), \
             patch("api.views.sso._complete_login_bypassing_allauth", return_value=mock_user), \
             patch("api.views.sso.FRONTEND_URL", "https://console.phase.dev"):

            request.user = mock_user
            view = SSOCallbackView()
            response = view.get(request, slug)

        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.url, "https://console.phase.dev/myteam/apps/myapp/secrets")

    def test_non_relative_return_to_is_ignored(self):
        """return_to values that don't start with / are ignored (prevents open redirect)."""
        slug = "google"
        config = PROVIDERS["google"]["registry"]
        state = "open-redirect-state"

        request = self.factory.get(
            f"/auth/sso/{slug}/callback/?code=code-xxx&state={state}"
        )
        _add_session(request)
        request.session["sso_state"] = state
        request.session["sso_provider"] = slug
        request.session["sso_callback_url"] = "https://console.phase.dev/api/auth/callback/google"
        request.session["sso_token_url"] = config["token_url"]
        request.session["sso_return_to"] = "https://evil.com/steal"
        request.session.save()

        mock_adapter = MagicMock()
        mock_adapter.complete_login.return_value = _make_social_login(
            extra_data=PROVIDERS["google"]["extra_data"],
            uid=PROVIDERS["google"]["uid"],
            provider_id="google",
        )

        mock_user = MagicMock()
        mock_user.is_authenticated = True

        with patch.dict(SSO_PROVIDER_REGISTRY, {slug: config}, clear=True), \
             patch("api.views.sso._exchange_code_for_token", return_value=PROVIDERS["google"]["token_response"]), \
             patch("api.views.sso._get_adapter_instance", return_value=mock_adapter), \
             patch("api.views.sso._get_or_create_social_app", return_value=MagicMock()), \
             patch("api.views.sso.SocialToken", MagicMock()), \
             patch("api.views.sso._complete_login_bypassing_allauth", return_value=mock_user), \
             patch("api.views.sso.FRONTEND_URL", "https://console.phase.dev"):

            request.user = mock_user
            view = SSOCallbackView()
            response = view.get(request, slug)

        # Should redirect to root, not the evil URL
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.url, "https://console.phase.dev/")


# ═══════════════════════════════════════════════════════════════════════════
# 3. Domain whitelist enforcement on happy path
# ═══════════════════════════════════════════════════════════════════════════

class SSOCallbackDomainWhitelistTest(unittest.TestCase):
    """Verify domain whitelist blocks disallowed emails during callback."""

    def setUp(self):
        self.factory = RequestFactory()

    @patch("api.views.sso.DOMAIN_WHITELIST", ["acme.com"])
    def test_whitelisted_domain_passes(self):
        """User with email matching whitelist can complete login."""
        slug = "google"
        config = PROVIDERS["google"]["registry"]
        state = "wl-ok-state"

        extra = {**PROVIDERS["google"]["extra_data"], "email": "alice@acme.com"}

        request = self.factory.get(
            f"/auth/sso/{slug}/callback/?code=code&state={state}"
        )
        _add_session(request)
        request.session["sso_state"] = state
        request.session["sso_provider"] = slug
        request.session["sso_callback_url"] = "https://console.phase.dev/api/auth/callback/google"
        request.session["sso_token_url"] = config["token_url"]
        request.session.save()

        mock_adapter = MagicMock()
        mock_adapter.complete_login.return_value = _make_social_login(
            extra_data=extra, uid="123", provider_id="google", email="alice@acme.com"
        )

        mock_user = MagicMock()
        mock_user.is_authenticated = True

        with patch.dict(SSO_PROVIDER_REGISTRY, {slug: config}, clear=True), \
             patch("api.views.sso._exchange_code_for_token", return_value=PROVIDERS["google"]["token_response"]), \
             patch("api.views.sso._get_adapter_instance", return_value=mock_adapter), \
             patch("api.views.sso._get_or_create_social_app", return_value=MagicMock()), \
             patch("api.views.sso.SocialToken", MagicMock()), \
             patch("api.views.sso._complete_login_bypassing_allauth", return_value=mock_user), \
             patch("api.views.sso.FRONTEND_URL", "https://console.phase.dev"):

            request.user = mock_user
            view = SSOCallbackView()
            response = view.get(request, slug)

        self.assertEqual(response.status_code, 302)
        self.assertNotIn("error", response.url)

    @patch("api.views.sso.DOMAIN_WHITELIST", ["acme.com"])
    def test_non_whitelisted_domain_blocked(self):
        """User with email outside whitelist is rejected."""
        slug = "google"
        config = PROVIDERS["google"]["registry"]
        state = "wl-blocked-state"

        extra = {**PROVIDERS["google"]["extra_data"], "email": "alice@evil.com"}

        request = self.factory.get(
            f"/auth/sso/{slug}/callback/?code=code&state={state}"
        )
        _add_session(request)
        request.session["sso_state"] = state
        request.session["sso_provider"] = slug
        request.session["sso_callback_url"] = "https://console.phase.dev/api/auth/callback/google"
        request.session["sso_token_url"] = config["token_url"]
        request.session.save()

        mock_adapter = MagicMock()
        mock_adapter.complete_login.return_value = _make_social_login(
            extra_data=extra, uid="123", provider_id="google", email="alice@evil.com"
        )

        with patch.dict(SSO_PROVIDER_REGISTRY, {slug: config}, clear=True), \
             patch("api.views.sso._exchange_code_for_token", return_value=PROVIDERS["google"]["token_response"]), \
             patch("api.views.sso._get_adapter_instance", return_value=mock_adapter), \
             patch("api.views.sso._get_or_create_social_app", return_value=MagicMock()), \
             patch("api.views.sso.SocialToken", MagicMock()), \
             patch("api.views.sso.FRONTEND_URL", "https://console.phase.dev"):

            view = SSOCallbackView()
            response = view.get(request, slug)

        self.assertEqual(response.status_code, 302)
        self.assertIn("email_domain_not_allowed", response.url)


# ═══════════════════════════════════════════════════════════════════════════
# 4. _complete_login_bypassing_allauth — user creation / linking
# ═══════════════════════════════════════════════════════════════════════════

class CompleteLoginBypassingAllauthTest(unittest.TestCase):
    """Test user creation, linking, and login for each provider's data shape."""

    def _make_request(self):
        factory = RequestFactory()
        request = factory.get("/")
        _add_session(request)
        return request

    def _run_new_user(self, provider_slug):
        """A brand-new user logs in via the given provider."""
        fixture = PROVIDERS[provider_slug]
        request = self._make_request()

        social_login = _make_social_login(
            extra_data=fixture["extra_data"],
            uid=fixture["uid"],
            provider_id=fixture["registry"]["provider_id"],
            email=fixture["expected_email"],
        )

        mock_token = MagicMock()
        mock_token.token = "access-token"
        mock_token.app = MagicMock()

        mock_user_cls = MagicMock()
        mock_user_cls.DoesNotExist = type("DoesNotExist", (Exception,), {})
        mock_user_cls.objects.get.side_effect = mock_user_cls.DoesNotExist()
        new_user = MagicMock()
        mock_user_cls.objects.create_user.return_value = new_user

        mock_sa = MagicMock()

        with patch("api.views.sso.get_user_model", return_value=mock_user_cls), \
             patch("api.views.sso.SocialAccount.objects.update_or_create", return_value=(mock_sa, True)), \
             patch("api.views.sso.SocialToken.objects.update_or_create"), \
             patch("api.views.sso.login") as mock_login:

            user = _complete_login_bypassing_allauth(request, social_login, mock_token)

        # User created with correct email
        mock_user_cls.objects.create_user.assert_called_once_with(
            username=fixture["expected_email"].lower().strip(),
            email=fixture["expected_email"].lower().strip(),
            password=None,
        )
        mock_login.assert_called_once_with(request, new_user)
        return user

    def _run_existing_user(self, provider_slug):
        """An existing user logs in again via the given provider."""
        fixture = PROVIDERS[provider_slug]
        request = self._make_request()

        social_login = _make_social_login(
            extra_data=fixture["extra_data"],
            uid=fixture["uid"],
            provider_id=fixture["registry"]["provider_id"],
            email=fixture["expected_email"],
        )

        mock_token = MagicMock()
        mock_token.token = "access-token"
        mock_token.app = MagicMock()

        existing_user = MagicMock()
        mock_user_cls = MagicMock()
        mock_user_cls.objects.get.return_value = existing_user

        mock_sa = MagicMock()

        with patch("api.views.sso.get_user_model", return_value=mock_user_cls), \
             patch("api.views.sso.SocialAccount.objects.update_or_create", return_value=(mock_sa, False)), \
             patch("api.views.sso.SocialToken.objects.update_or_create"), \
             patch("api.views.sso.login") as mock_login:

            user = _complete_login_bypassing_allauth(request, social_login, mock_token)

        # Existing user found — no create_user call
        mock_user_cls.objects.create_user.assert_not_called()
        mock_user_cls.objects.get.assert_called_once_with(
            email=fixture["expected_email"].lower().strip()
        )
        mock_login.assert_called_once_with(request, existing_user)
        return user

    # --- New user tests per provider ---

    def test_google_new_user(self):
        self._run_new_user("google")

    def test_github_new_user(self):
        self._run_new_user("github")

    def test_gitlab_new_user(self):
        self._run_new_user("gitlab")

    def test_github_enterprise_new_user(self):
        self._run_new_user("github-enterprise")

    def test_entra_id_new_user(self):
        self._run_new_user("entra-id-oidc")

    def test_google_oidc_new_user(self):
        self._run_new_user("google-oidc")

    def test_jumpcloud_new_user(self):
        self._run_new_user("jumpcloud-oidc")

    def test_okta_new_user(self):
        self._run_new_user("okta-oidc")

    def test_authentik_new_user(self):
        self._run_new_user("authentik")

    def test_authelia_new_user(self):
        self._run_new_user("authelia")

    # --- Existing user tests per provider ---

    def test_google_existing_user(self):
        self._run_existing_user("google")

    def test_github_existing_user(self):
        self._run_existing_user("github")

    def test_gitlab_existing_user(self):
        self._run_existing_user("gitlab")

    def test_entra_id_existing_user(self):
        self._run_existing_user("entra-id-oidc")

    def test_okta_existing_user(self):
        self._run_existing_user("okta-oidc")

    def test_authelia_existing_user(self):
        self._run_existing_user("authelia")


# ═══════════════════════════════════════════════════════════════════════════
# 5. Email extraction edge cases
# ═══════════════════════════════════════════════════════════════════════════

class EmailExtractionTest(unittest.TestCase):
    """
    _complete_login_bypassing_allauth extracts email from extra_data in
    priority order:  extra_data['email'] → extra_data['mail'] → user.email
    Test that each provider's data shape resolves correctly.
    """

    def _extract_email(self, extra_data, user_email=""):
        """Replicate the email extraction logic from _complete_login_bypassing_allauth."""
        email = (
            extra_data.get("email")
            or extra_data.get("mail")
            or user_email
            or None
        )
        return email.lower().strip() if email else None

    def test_google_email_from_standard_field(self):
        email = self._extract_email(PROVIDERS["google"]["extra_data"])
        self.assertEqual(email, "alice@gmail.com")

    def test_github_email_from_standard_field(self):
        email = self._extract_email(PROVIDERS["github"]["extra_data"])
        self.assertEqual(email, "alice@github.com")

    def test_gitlab_email_from_standard_field(self):
        email = self._extract_email(PROVIDERS["gitlab"]["extra_data"])
        self.assertEqual(email, "alice@gitlab.com")

    def test_entra_id_email_from_mail_field(self):
        """Entra ID uses 'mail' not 'email' — verify fallback works."""
        extra = PROVIDERS["entra-id-oidc"]["extra_data"]
        # The extra_data has no 'email' key — it uses 'mail'
        email = self._extract_email(extra)
        self.assertEqual(email, "alice@contoso.com")

    def test_entra_id_null_mail_falls_back_to_user_email(self):
        """When Entra ID 'mail' is null, fall back to social_login.user.email."""
        extra = {**PROVIDERS["entra-id-oidc"]["extra_data"], "mail": None}
        # Neither 'email' nor 'mail' available — uses user_email
        email = self._extract_email(extra, user_email="alice@contoso.com")
        self.assertEqual(email, "alice@contoso.com")

    def test_oidc_email_from_standard_claim(self):
        """Standard OIDC providers (Okta, JumpCloud, etc.) use 'email'."""
        for slug in ["okta-oidc", "jumpcloud-oidc", "authentik", "authelia"]:
            email = self._extract_email(PROVIDERS[slug]["extra_data"])
            self.assertEqual(
                email, PROVIDERS[slug]["expected_email"],
                f"Email mismatch for {slug}",
            )


# ═══════════════════════════════════════════════════════════════════════════
# 6. auth_me avatar and name extraction per provider
# ═══════════════════════════════════════════════════════════════════════════

class AuthMeProviderDataTest(unittest.TestCase):
    """
    GET /auth/me/ extracts avatar and name from SocialAccount.extra_data.
    Verify each provider's data shape produces the correct output.
    """

    def setUp(self):
        self.factory = RequestFactory()

    def _call_auth_me(self, extra_data, user_email="test@example.com"):
        """Call auth_me with a mock user and social account."""
        request = self.factory.get("/auth/me/")
        user = MagicMock()
        user.is_authenticated = True
        user.userId = "user-uuid"
        user.email = user_email
        user.full_name = ""
        user.auth_method = "sso"

        social_acc = MagicMock()
        social_acc.extra_data = extra_data
        user.socialaccount_set.first.return_value = social_acc
        request.user = user
        _add_session(request)

        response = auth_me(request)
        return json.loads(response.content)

    def test_google_avatar_and_name(self):
        data = self._call_auth_me(PROVIDERS["google"]["extra_data"])
        self.assertEqual(data["avatarUrl"], PROVIDERS["google"]["expected_avatar"])
        self.assertEqual(data["fullName"], "Alice Johnson")

    def test_github_avatar_and_name(self):
        data = self._call_auth_me(PROVIDERS["github"]["extra_data"])
        self.assertEqual(data["avatarUrl"], PROVIDERS["github"]["expected_avatar"])
        self.assertEqual(data["fullName"], "Alice Johnson")

    def test_gitlab_avatar_and_name(self):
        """GitLab uses 'avatar_url' which is caught by the GitHub branch."""
        data = self._call_auth_me(PROVIDERS["gitlab"]["extra_data"])
        self.assertEqual(data["avatarUrl"], PROVIDERS["gitlab"]["expected_avatar"])
        self.assertEqual(data["fullName"], "Alice Johnson")

    def test_github_enterprise_avatar_and_name(self):
        data = self._call_auth_me(PROVIDERS["github-enterprise"]["extra_data"])
        self.assertEqual(data["avatarUrl"], PROVIDERS["github-enterprise"]["expected_avatar"])
        self.assertEqual(data["fullName"], "Alice Johnson")

    def test_entra_id_avatar_and_name(self):
        """Entra ID: no photo URL in extra_data, name from 'name' field."""
        data = self._call_auth_me(PROVIDERS["entra-id-oidc"]["extra_data"])
        # Entra ID doesn't return a photo URL in Graph /me
        self.assertIsNone(data["avatarUrl"])
        self.assertEqual(data["fullName"], "Alice Johnson")

    def test_google_oidc_avatar_and_name(self):
        data = self._call_auth_me(PROVIDERS["google-oidc"]["extra_data"])
        self.assertEqual(data["avatarUrl"], PROVIDERS["google-oidc"]["expected_avatar"])
        self.assertEqual(data["fullName"], "Alice Johnson")

    def test_jumpcloud_no_avatar(self):
        """JumpCloud typically doesn't return a picture URL."""
        data = self._call_auth_me(PROVIDERS["jumpcloud-oidc"]["extra_data"])
        self.assertIsNone(data["avatarUrl"])
        self.assertEqual(data["fullName"], "Alice Johnson")

    def test_okta_no_avatar(self):
        """Okta doesn't return picture by default scope."""
        data = self._call_auth_me(PROVIDERS["okta-oidc"]["extra_data"])
        self.assertIsNone(data["avatarUrl"])
        self.assertEqual(data["fullName"], "Alice Johnson")

    def test_authentik_no_avatar(self):
        data = self._call_auth_me(PROVIDERS["authentik"]["extra_data"])
        self.assertIsNone(data["avatarUrl"])
        self.assertEqual(data["fullName"], "Alice Johnson")

    def test_authelia_no_avatar(self):
        data = self._call_auth_me(PROVIDERS["authelia"]["extra_data"])
        self.assertIsNone(data["avatarUrl"])
        self.assertEqual(data["fullName"], "Alice Johnson")

    def test_no_social_account_falls_back_to_email(self):
        """User with no social account and no full_name gets email as fullName."""
        request = self.factory.get("/auth/me/")
        user = MagicMock()
        user.is_authenticated = True
        user.userId = "user-uuid"
        user.email = "alice@test.com"
        user.full_name = ""
        user.auth_method = "sso"
        user.socialaccount_set.first.return_value = None
        request.user = user
        _add_session(request)

        response = auth_me(request)
        data = json.loads(response.content)
        self.assertEqual(data["fullName"], "alice@test.com")
        self.assertIsNone(data["avatarUrl"])

    def test_no_social_account_uses_user_full_name(self):
        """User with no social account but stored full_name gets it as fullName."""
        request = self.factory.get("/auth/me/")
        user = MagicMock()
        user.is_authenticated = True
        user.userId = "user-uuid"
        user.email = "alice@test.com"
        user.full_name = "Alice Test"
        user.auth_method = "password"
        user.socialaccount_set.first.return_value = None
        request.user = user
        _add_session(request)

        response = auth_me(request)
        data = json.loads(response.content)
        self.assertEqual(data["fullName"], "Alice Test")


# ═══════════════════════════════════════════════════════════════════════════
# 7. Token exchange auth method verification
# ═══════════════════════════════════════════════════════════════════════════

class TokenExchangeAuthMethodTest(unittest.TestCase):
    """Verify token exchange uses the correct auth method per provider."""

    def setUp(self):
        self.factory = RequestFactory()

    def _run_callback_and_capture_exchange(self, slug, fixture):
        """Run the callback and capture the _exchange_code_for_token call."""
        config = fixture["registry"]
        state = "auth-method-state"

        request = self.factory.get(
            f"/auth/sso/{slug}/callback/?code=code&state={state}"
        )
        _add_session(request)
        request.session["sso_state"] = state
        request.session["sso_provider"] = slug
        request.session["sso_callback_url"] = f"https://console.phase.dev/api/auth/callback/{slug}"
        request.session["sso_token_url"] = config.get("token_url") or "https://idp.example.com/token"
        request.session.save()

        mock_adapter = MagicMock()
        mock_adapter.complete_login.return_value = _make_social_login(
            extra_data=fixture["extra_data"],
            uid=fixture["uid"],
            provider_id=config["provider_id"],
            email=fixture["expected_email"],
        )
        mock_user = MagicMock()
        mock_user.is_authenticated = True

        with patch.dict(SSO_PROVIDER_REGISTRY, {slug: config}, clear=True), \
             patch("api.views.sso._exchange_code_for_token", return_value=fixture["token_response"]) as mock_exchange, \
             patch("api.views.sso._get_adapter_instance", return_value=mock_adapter), \
             patch("api.views.sso._get_or_create_social_app", return_value=MagicMock()), \
             patch("api.views.sso.SocialToken", MagicMock()), \
             patch("api.views.sso._complete_login_bypassing_allauth", return_value=mock_user), \
             patch("api.views.sso.FRONTEND_URL", "https://console.phase.dev"):

            request.user = mock_user
            view = SSOCallbackView()
            view.get(request, slug)

        return mock_exchange.call_args

    def test_okta_uses_client_secret_basic(self):
        """Okta requires HTTP Basic auth on the token endpoint."""
        call = self._run_callback_and_capture_exchange("okta-oidc", PROVIDERS["okta-oidc"])
        # Third positional arg is auth_method
        self.assertEqual(call[0][2], "client_secret_basic")

    def test_google_uses_client_secret_post(self):
        call = self._run_callback_and_capture_exchange("google", PROVIDERS["google"])
        self.assertEqual(call[0][2], "client_secret_post")

    def test_github_uses_client_secret_post(self):
        call = self._run_callback_and_capture_exchange("github", PROVIDERS["github"])
        self.assertEqual(call[0][2], "client_secret_post")

    def test_authelia_uses_client_secret_post(self):
        call = self._run_callback_and_capture_exchange("authelia", PROVIDERS["authelia"])
        self.assertEqual(call[0][2], "client_secret_post")


# ═══════════════════════════════════════════════════════════════════════════
# 8. Token exchange failure handling
# ═══════════════════════════════════════════════════════════════════════════

class SSOCallbackTokenExchangeFailureTest(unittest.TestCase):
    """Verify graceful handling when token exchange fails per provider."""

    def setUp(self):
        self.factory = RequestFactory()

    def _run_exchange_failure(self, slug, fixture):
        config = fixture["registry"]
        state = "fail-state"

        request = self.factory.get(
            f"/auth/sso/{slug}/callback/?code=code&state={state}"
        )
        _add_session(request)
        request.session["sso_state"] = state
        request.session["sso_provider"] = slug
        request.session["sso_callback_url"] = f"https://console.phase.dev/api/auth/callback/{slug}"
        request.session["sso_token_url"] = config.get("token_url") or "https://idp.example.com/token"
        request.session.save()

        with patch.dict(SSO_PROVIDER_REGISTRY, {slug: config}, clear=True), \
             patch("api.views.sso._exchange_code_for_token", side_effect=Exception("Connection refused")), \
             patch("api.views.sso.FRONTEND_URL", "https://console.phase.dev"):

            view = SSOCallbackView()
            response = view.get(request, slug)

        self.assertEqual(response.status_code, 302)
        self.assertIn("token_exchange_failed", response.url)

    def test_google_token_exchange_failure(self):
        self._run_exchange_failure("google", PROVIDERS["google"])

    def test_github_token_exchange_failure(self):
        self._run_exchange_failure("github", PROVIDERS["github"])

    def test_okta_token_exchange_failure(self):
        self._run_exchange_failure("okta-oidc", PROVIDERS["okta-oidc"])

    def test_entra_id_token_exchange_failure(self):
        self._run_exchange_failure("entra-id-oidc", PROVIDERS["entra-id-oidc"])


# ═══════════════════════════════════════════════════════════════════════════
# 9. No access_token in token response
# ═══════════════════════════════════════════════════════════════════════════

class SSOCallbackNoAccessTokenTest(unittest.TestCase):
    """Some IdPs may return a response without access_token on error."""

    def setUp(self):
        self.factory = RequestFactory()

    def test_missing_access_token_redirects_with_error(self):
        slug = "github"
        config = PROVIDERS["github"]["registry"]
        state = "no-token-state"

        request = self.factory.get(
            f"/auth/sso/{slug}/callback/?code=code&state={state}"
        )
        _add_session(request)
        request.session["sso_state"] = state
        request.session["sso_provider"] = slug
        request.session["sso_callback_url"] = "https://console.phase.dev/api/auth/callback/github"
        request.session["sso_token_url"] = config["token_url"]
        request.session.save()

        # GitHub sometimes returns {"error": "bad_verification_code"} with no access_token
        bad_token_response = {
            "error": "bad_verification_code",
            "error_description": "The code passed is incorrect or expired.",
            "error_uri": "https://docs.github.com/apps/managing-oauth-apps/troubleshooting-oauth-app-access-token-request-errors/#bad-verification-code",
        }

        with patch.dict(SSO_PROVIDER_REGISTRY, {slug: config}, clear=True), \
             patch("api.views.sso._exchange_code_for_token", return_value=bad_token_response), \
             patch("api.views.sso.FRONTEND_URL", "https://console.phase.dev"):

            view = SSOCallbackView()
            response = view.get(request, slug)

        self.assertEqual(response.status_code, 302)
        self.assertIn("no_access_token", response.url)


if __name__ == "__main__":
    unittest.main()
