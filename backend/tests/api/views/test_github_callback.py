"""Security tests for the GitHub secret-sync OAuth flow (GHSA-68r4-53vq-4fqm):
CSRF/auth-gated authorize, session-bound host, callback state nonce."""

import uuid
from importlib import import_module
from unittest.mock import MagicMock, Mock, patch

import pytest
from django.conf import settings as dj_settings
from django.contrib.auth.models import AnonymousUser
from django.test import RequestFactory


class _OrgDoesNotExist(Exception):
    pass


def _user(authenticated=True):
    user = Mock()
    user.userId = uuid.uuid4()
    user.id = user.userId
    user.is_authenticated = authenticated
    return user


def _org(org_id=None):
    org = Mock()
    org.id = org_id or uuid.uuid4()
    return org


def _attach_session(request, initial=None):
    engine = import_module(dj_settings.SESSION_ENGINE)
    request.session = engine.SessionStore()
    for key, value in (initial or {}).items():
        request.session[key] = value
    return request


def _org_model(org=None, missing=False):
    """A stand-in for apps.get_model("api", "Organisation")."""
    model = MagicMock()
    model.DoesNotExist = _OrgDoesNotExist
    if missing:
        model.objects.get.side_effect = _OrgDoesNotExist()
    else:
        model.objects.get.return_value = org
    return model


def _patch_apps(org_model):
    """Patch the `apps` registry so get_model returns our stub."""
    mock_apps = MagicMock()
    mock_apps.get_model.return_value = org_model
    return patch("api.views.auth.apps", mock_apps)


# ────────────────────────────────────────────────────────────────────
#  return-url sanitisation (open-redirect guard)
# ────────────────────────────────────────────────────────────────────


class TestSafeReturnUrl:
    @pytest.mark.parametrize(
        "candidate,expected",
        [
            ("/apps", "/apps"),
            ("/team/settings?tab=1", "/team/settings?tab=1"),
            ("/", "/"),
            ("//evil.example.com", "/"),  # scheme-relative
            ("///evil.example.com", "/"),
            ("https://evil.example.com", "/"),  # absolute
            ("http://evil.example.com/x", "/"),
            ("/\\evil.example.com", "/"),  # backslash normalised to //
            ("/\t/evil.example.com", "/"),  # control char
            ("javascript:alert(1)", "/"),  # not root-relative
            ("apps", "/"),  # not root-relative
            ("", "/"),
            (None, "/"),
        ],
    )
    def test_safe_return_url(self, candidate, expected):
        from api.views.auth import _safe_return_url

        assert _safe_return_url(candidate) == expected


# ────────────────────────────────────────────────────────────────────
#  authorize
# ────────────────────────────────────────────────────────────────────


class TestGithubIntegrationAuthorize:
    def _post(self, **params):
        # authorize is POST-only; params arrive as form data.
        factory = RequestFactory()
        request = factory.post("/oauth/github/authorize", params)
        return _attach_session(request)

    def test_rejects_get(self):
        # @require_POST → 405; closes the cross-site GET CSRF vector.
        from api.views.auth import github_integration_authorize

        factory = RequestFactory()
        request = _attach_session(factory.get("/oauth/github/authorize"))
        request.user = _user()

        response = github_integration_authorize(request)
        assert response.status_code == 405

    def test_requires_authentication(self):
        from api.views.auth import github_integration_authorize

        request = self._post(orgId=str(uuid.uuid4()))
        request.user = AnonymousUser()

        response = github_integration_authorize(request)

        assert response.status_code == 302
        assert "login_required" in response.url
        assert "gh_int_state" not in request.session

    def test_denied_without_permission(self, monkeypatch):
        from api.views import auth as auth_views

        org = _org()
        request = self._post(orgId=str(org.id), returnUrl="/apps")
        request.user = _user()

        with _patch_apps(_org_model(org)), patch.object(
            auth_views, "user_has_permission", return_value=False
        ):
            response = auth_views.github_integration_authorize(request)

        assert response.status_code == 302
        assert "permission_denied" in response.url
        assert "gh_int_state" not in request.session

    def test_unknown_org_is_rejected(self, monkeypatch):
        from api.views import auth as auth_views

        request = self._post(orgId=str(uuid.uuid4()))
        request.user = _user()

        with _patch_apps(_org_model(missing=True)), patch.object(
            auth_views, "user_has_permission", return_value=True
        ):
            response = auth_views.github_integration_authorize(request)

        assert response.status_code == 302
        assert "org_not_found" in response.url
        assert "gh_int_state" not in request.session

    def test_cloud_ignores_attacker_host_and_pins_github(self, settings, monkeypatch):
        settings.APP_HOST = "cloud"
        monkeypatch.setenv("GITHUB_INTEGRATION_CLIENT_ID", "cid-123")
        from api.views import auth as auth_views

        org = _org()
        # Attacker-style params: try to force an evil host + enterprise mode.
        request = self._post(
            orgId=str(org.id),
            hostUrl="https://evil.example.com",
            apiUrl="https://evil.example.com",
            isEnterprise="true",
            name="GitHub Actions",
        )
        request.user = _user()

        with _patch_apps(_org_model(org)), patch.object(
            auth_views, "user_has_permission", return_value=True
        ):
            response = auth_views.github_integration_authorize(request)

        assert response.status_code == 302
        # Redirect must target real GitHub, not the attacker host.
        assert response.url.startswith("https://github.com/login/oauth/authorize")
        assert "evil.example.com" not in response.url
        # Session is pinned to github.com, enterprise coerced off.
        assert request.session["gh_int_host_url"] == "https://github.com"
        assert request.session["gh_int_api_url"] == "https://api.github.com"
        assert request.session["gh_int_is_enterprise"] is False
        assert request.session["gh_int_org_id"] == str(org.id)
        assert request.session["gh_int_state"]
        assert f"state={request.session['gh_int_state']}" in response.url

    def test_self_hosted_enterprise_accepts_browser_host(self, settings, monkeypatch):
        # Operator-supplied GHE host is honoured and stored for the callback,
        # which reads it from the session (see test_happy_path_uses_session_not_query).
        settings.APP_HOST = "self"
        monkeypatch.setenv("GITHUB_ENTERPRISE_INTEGRATION_CLIENT_ID", "ent-cid")
        from api.views import auth as auth_views

        org = _org()
        request = self._post(
            orgId=str(org.id),
            hostUrl="https://ghe.internal.corp",
            apiUrl="https://ghe.internal.corp/api/v3",
            isEnterprise="true",
        )
        request.user = _user()

        with _patch_apps(_org_model(org)), patch.object(
            auth_views, "user_has_permission", return_value=True
        ):
            response = auth_views.github_integration_authorize(request)

        assert response.status_code == 302
        assert response.url.startswith(
            "https://ghe.internal.corp/login/oauth/authorize"
        )
        assert request.session["gh_int_host_url"] == "https://ghe.internal.corp"
        assert request.session["gh_int_api_url"] == "https://ghe.internal.corp/api/v3"
        assert request.session["gh_int_is_enterprise"] is True

    def test_self_hosted_enterprise_api_url_derived_when_omitted(
        self, settings, monkeypatch
    ):
        settings.APP_HOST = "self"
        monkeypatch.setenv("GITHUB_ENTERPRISE_INTEGRATION_CLIENT_ID", "ent-cid")
        from api.views import auth as auth_views

        org = _org()
        request = self._post(
            orgId=str(org.id),
            hostUrl="https://ghe.internal.corp",
            isEnterprise="true",
        )
        request.user = _user()

        with _patch_apps(_org_model(org)), patch.object(
            auth_views, "user_has_permission", return_value=True
        ):
            response = auth_views.github_integration_authorize(request)

        assert response.status_code == 302
        assert request.session["gh_int_api_url"] == "https://ghe.internal.corp/api/v3"

    def test_self_hosted_enterprise_rejects_bad_scheme(self, settings, monkeypatch):
        settings.APP_HOST = "self"
        monkeypatch.setenv("GITHUB_ENTERPRISE_INTEGRATION_CLIENT_ID", "ent-cid")
        from api.views import auth as auth_views

        org = _org()
        request = self._post(
            orgId=str(org.id),
            hostUrl="javascript:alert(1)",
            isEnterprise="true",
            returnUrl="/apps",
        )
        request.user = _user()

        with _patch_apps(_org_model(org)), patch.object(
            auth_views, "user_has_permission", return_value=True
        ):
            response = auth_views.github_integration_authorize(request)

        assert response.status_code == 302
        assert "invalid_host_url" in response.url
        assert "gh_int_state" not in request.session

    def test_return_url_must_be_relative(self, settings, monkeypatch):
        settings.APP_HOST = "cloud"
        monkeypatch.setenv("GITHUB_INTEGRATION_CLIENT_ID", "cid-123")
        from api.views import auth as auth_views

        org = _org()
        request = self._post(orgId=str(org.id), returnUrl="//evil.example.com/x")
        request.user = _user()

        with _patch_apps(_org_model(org)), patch.object(
            auth_views, "user_has_permission", return_value=True
        ):
            response = auth_views.github_integration_authorize(request)

        # Open-redirect target is dropped back to "/".
        assert request.session["gh_int_return_url"] == "/"


# ────────────────────────────────────────────────────────────────────
#  callback
# ────────────────────────────────────────────────────────────────────


class TestGithubIntegrationCallback:
    def _session_for(self, org_id, host_url="https://github.com", state="good-state"):
        return {
            "gh_int_state": state,
            "gh_int_org_id": str(org_id),
            "gh_int_host_url": host_url,
            "gh_int_api_url": "https://api.github.com",
            "gh_int_is_enterprise": False,
            "gh_int_name": "GitHub Actions",
            "gh_int_return_url": "/apps",
        }

    def _callback(self, query, session):
        factory = RequestFactory()
        request = factory.get("/oauth/github/callback", query)
        _attach_session(request, session)
        return request

    def test_rejects_request_without_session_state(self):
        from api.views import auth as auth_views

        request = self._callback(
            {"code": "x", "state": "anything"}, session={}
        )
        request.user = _user()

        with patch.object(auth_views, "requests") as mock_requests, patch.object(
            auth_views, "store_oauth_token"
        ) as mock_store, patch.object(
            auth_views, "get_secret", return_value="SUPER-SECRET"
        ):
            response = auth_views.github_integration_callback(request)

        assert response.status_code == 302
        assert "invalid_state" in response.url
        # The client secret must never be sent, and nothing gets stored.
        mock_requests.post.assert_not_called()
        mock_store.assert_not_called()

    def test_rejects_forged_state(self):
        from api.views import auth as auth_views

        org = _org()
        session = self._session_for(org.id, state="server-nonce")
        request = self._callback(
            {"code": "x", "state": "attacker-nonce"}, session=session
        )
        request.user = _user()

        with patch.object(auth_views, "requests") as mock_requests, patch.object(
            auth_views, "store_oauth_token"
        ) as mock_store, patch.object(
            auth_views, "get_secret", return_value="SUPER-SECRET"
        ):
            response = auth_views.github_integration_callback(request)

        assert "invalid_state" in response.url
        mock_requests.post.assert_not_called()
        mock_store.assert_not_called()

    def test_happy_path_uses_session_not_query(self, monkeypatch):
        monkeypatch.setenv("GITHUB_INTEGRATION_CLIENT_ID", "cid-123")
        from api.views import auth as auth_views

        org = _org()
        session = self._session_for(org.id)
        # Attacker appends their host to the callback query — it must be ignored.
        request = self._callback(
            {
                "code": "real-code",
                "state": "good-state",
                "hostUrl": "https://evil.example.com",
                "orgId": str(uuid.uuid4()),
            },
            session=session,
        )
        request.user = _user()

        mock_response = MagicMock()
        mock_response.json.return_value = {"access_token": "gho_abc"}

        with _patch_apps(_org_model(org)), patch.object(
            auth_views, "user_has_permission", return_value=True
        ), patch.object(
            auth_views.requests, "post", return_value=mock_response
        ) as mock_post, patch.object(
            auth_views, "store_oauth_token"
        ) as mock_store, patch.object(
            auth_views, "get_secret", return_value="SUPER-SECRET"
        ):
            response = auth_views.github_integration_callback(request)

        # Token exchange goes to the SESSION host (github.com), not the attacker.
        post_url = mock_post.call_args.args[0]
        assert post_url == "https://github.com/login/oauth/access_token"
        assert mock_post.call_args.kwargs["data"]["client_secret"] == "SUPER-SECRET"

        # Credential is stored for the SESSION org, not the attacker's query org.
        stored_args = mock_store.call_args.args
        assert stored_args[0] == "github"
        assert stored_args[5] == str(org.id)

        assert response.status_code == 302
        assert response.url == f"{auth_views.FRONTEND_URL}/apps"
        # State is consumed (one-time use).
        assert "gh_int_state" not in request.session

    def test_revoked_permission_blocks_exchange(self, monkeypatch):
        monkeypatch.setenv("GITHUB_INTEGRATION_CLIENT_ID", "cid-123")
        from api.views import auth as auth_views

        org = _org()
        session = self._session_for(org.id)
        request = self._callback(
            {"code": "real-code", "state": "good-state"}, session=session
        )
        request.user = _user()

        with _patch_apps(_org_model(org)), patch.object(
            auth_views, "user_has_permission", return_value=False
        ), patch.object(
            auth_views.requests, "post"
        ) as mock_post, patch.object(
            auth_views, "store_oauth_token"
        ) as mock_store, patch.object(
            auth_views, "get_secret", return_value="SUPER-SECRET"
        ):
            response = auth_views.github_integration_callback(request)

        assert "permission_denied" in response.url
        mock_post.assert_not_called()
        mock_store.assert_not_called()

    def test_unauthenticated_callback_blocked(self):
        from api.views import auth as auth_views

        org = _org()
        session = self._session_for(org.id)
        request = self._callback(
            {"code": "real-code", "state": "good-state"}, session=session
        )
        request.user = AnonymousUser()

        with patch.object(auth_views, "requests") as mock_requests, patch.object(
            auth_views, "store_oauth_token"
        ) as mock_store, patch.object(
            auth_views, "get_secret", return_value="SUPER-SECRET"
        ):
            response = auth_views.github_integration_callback(request)

        assert "login_required" in response.url
        mock_requests.post.assert_not_called()
        mock_store.assert_not_called()

    def test_missing_code_after_valid_state(self, monkeypatch):
        monkeypatch.setenv("GITHUB_INTEGRATION_CLIENT_ID", "cid-123")
        from api.views import auth as auth_views

        org = _org()
        session = self._session_for(org.id)
        request = self._callback({"state": "good-state"}, session=session)
        request.user = _user()

        with _patch_apps(_org_model(org)), patch.object(
            auth_views, "user_has_permission", return_value=True
        ), patch.object(
            auth_views.requests, "post"
        ) as mock_post, patch.object(
            auth_views, "store_oauth_token"
        ) as mock_store, patch.object(
            auth_views, "get_secret", return_value="SUPER-SECRET"
        ):
            response = auth_views.github_integration_callback(request)

        assert "missing_code" in response.url
        mock_post.assert_not_called()
        mock_store.assert_not_called()
