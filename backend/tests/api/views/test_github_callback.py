"""Security tests for the GitHub secret-sync OAuth flow.

GHSA-68r4-53vq-4fqm: CSRF/auth-gated authorize, session-bound host, callback
state nonce. GHSA-xq89-779j-j6xg: the GitHub Enterprise host comes from the
operator's GITHUB_ENTERPRISE_INTEGRATION_HOST_URL, never the request or the
session, since the callback sends the GHE client secret to it."""

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


def _frontend_url():
    from api.views.auth import FRONTEND_URL

    return FRONTEND_URL


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

    def test_org_pending_deletion_is_rejected(self):
        from api.views import auth as auth_views

        org_id = str(uuid.uuid4())
        org_model = _org_model(missing=True)
        request = self._post(orgId=org_id)
        request.user = _user()

        with _patch_apps(org_model), patch.object(
            auth_views, "user_has_permission", return_value=True
        ):
            response = auth_views.github_integration_authorize(request)

        # Locked orgs are excluded from the lookup, so they read as not found.
        org_model.objects.get.assert_called_once_with(
            id=org_id, deleted_at__isnull=True
        )
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
        assert request.session["gh_int_is_enterprise"] is False
        assert request.session["gh_int_org_id"] == str(org.id)
        assert request.session["gh_int_state"]
        assert f"state={request.session['gh_int_state']}" in response.url

    def _enterprise_authorize(self, settings, monkeypatch, configured_host, **params):
        settings.APP_HOST = "self"
        monkeypatch.setenv("GITHUB_ENTERPRISE_INTEGRATION_CLIENT_ID", "ent-cid")
        if configured_host is None:
            monkeypatch.delenv("GITHUB_ENTERPRISE_INTEGRATION_HOST_URL", raising=False)
        else:
            monkeypatch.setenv("GITHUB_ENTERPRISE_INTEGRATION_HOST_URL", configured_host)
        from api.views import auth as auth_views

        org = _org()
        request = self._post(
            orgId=str(org.id), isEnterprise="true", returnUrl="/apps", **params
        )
        request.user = _user()

        with _patch_apps(_org_model(org)), patch.object(
            auth_views, "user_has_permission", return_value=True
        ):
            response = auth_views.github_integration_authorize(request)
        return request, response

    @pytest.mark.parametrize(
        "caller_host",
        [
            "http://172.20.0.1:9999",  # attacker listener from the advisory PoC
            "https://evil.example.com",
            "javascript:alert(1)",
        ],
    )
    def test_self_hosted_enterprise_ignores_caller_host(
        self, settings, monkeypatch, caller_host
    ):
        # The callback sends the client secret to this host, so the request
        # never gets to choose it.
        request, response = self._enterprise_authorize(
            settings,
            monkeypatch,
            "https://ghe.internal.corp",
            hostUrl=caller_host,
            apiUrl=caller_host,
        )

        assert response.status_code == 302
        assert response.url.startswith(
            "https://ghe.internal.corp/login/oauth/authorize?"
        )
        assert "client_id=ent-cid" in response.url
        assert request.session["gh_int_is_enterprise"] is True
        assert "gh_int_host_url" not in request.session

    @pytest.mark.parametrize(
        "configured_host",
        ["https://ghe.internal.corp/", " https://ghe.internal.corp/api/v3 "],
    )
    def test_self_hosted_enterprise_uses_origin_of_configured_host(
        self, settings, monkeypatch, configured_host
    ):
        _, response = self._enterprise_authorize(settings, monkeypatch, configured_host)

        assert response.url.startswith(
            "https://ghe.internal.corp/login/oauth/authorize?"
        )

    @pytest.mark.parametrize(
        "configured_host", [None, "", "ghe.internal.corp", "ftp://ghe.internal.corp"]
    )
    def test_self_hosted_enterprise_requires_configured_host(
        self, settings, monkeypatch, configured_host
    ):
        request, response = self._enterprise_authorize(
            settings, monkeypatch, configured_host, hostUrl="http://172.20.0.1:9999"
        )

        assert response.url == (
            f"{_frontend_url()}/apps?error=integration_not_configured"
        )
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

        # Token exchange goes to github.com, not the attacker's query host.
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

    def _run_enterprise_callback(self, session, org):
        from api.views import auth as auth_views

        request = self._callback(
            {"code": "real-code", "state": "good-state"}, session=session
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
            auth_views, "get_secret", side_effect=lambda key: f"secret:{key}"
        ):
            response = auth_views.github_integration_callback(request)
        return response, mock_post, mock_store

    def _legacy_enterprise_session(self, org_id):
        # Sessions are signed cookies, so one issued by an older version that
        # stored a caller-chosen host can be replayed.
        session = self._session_for(org_id, host_url="http://172.20.0.1:9999")
        session["gh_int_is_enterprise"] = True
        return session

    def test_enterprise_exchange_uses_configured_host(self, monkeypatch):
        monkeypatch.setenv("GITHUB_ENTERPRISE_INTEGRATION_CLIENT_ID", "ent-cid")
        monkeypatch.setenv(
            "GITHUB_ENTERPRISE_INTEGRATION_HOST_URL", "https://ghe.internal.corp"
        )
        org = _org()

        response, mock_post, mock_store = self._run_enterprise_callback(
            self._legacy_enterprise_session(org.id), org
        )

        assert (
            mock_post.call_args.args[0]
            == "https://ghe.internal.corp/login/oauth/access_token"
        )
        data = mock_post.call_args.kwargs["data"]
        assert data["client_id"] == "ent-cid"
        assert data["client_secret"] == "secret:GITHUB_ENTERPRISE_INTEGRATION_CLIENT_SECRET"
        _, _, _, host_url, api_url, org_id = mock_store.call_args.args
        assert host_url == "https://ghe.internal.corp"
        assert api_url == "https://ghe.internal.corp/api/v3"
        assert org_id == str(org.id)
        assert response.url == f"{_frontend_url()}/apps"

    def test_enterprise_without_configured_host_never_sends_secret(self, monkeypatch):
        monkeypatch.setenv("GITHUB_ENTERPRISE_INTEGRATION_CLIENT_ID", "ent-cid")
        monkeypatch.delenv("GITHUB_ENTERPRISE_INTEGRATION_HOST_URL", raising=False)
        org = _org()

        response, mock_post, mock_store = self._run_enterprise_callback(
            self._legacy_enterprise_session(org.id), org
        )

        assert response.url == (
            f"{_frontend_url()}/apps?error=integration_not_configured"
        )
        mock_post.assert_not_called()
        mock_store.assert_not_called()

    def test_non_enterprise_session_is_pinned_to_github(self, monkeypatch):
        monkeypatch.setenv("GITHUB_INTEGRATION_CLIENT_ID", "cid-123")
        org = _org()
        session = self._session_for(org.id, host_url="https://evil.example.com")

        response, mock_post, mock_store = self._run_enterprise_callback(session, org)

        assert mock_post.call_args.args[0] == "https://github.com/login/oauth/access_token"
        _, _, _, host_url, api_url, _ = mock_store.call_args.args
        assert host_url == "https://github.com"
        assert api_url == "https://api.github.com"

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

    def test_org_pending_deletion_blocks_exchange(self, monkeypatch):
        monkeypatch.setenv("GITHUB_INTEGRATION_CLIENT_ID", "cid-123")
        from api.views import auth as auth_views

        org = _org()
        org_model = _org_model(missing=True)
        session = self._session_for(org.id)
        request = self._callback(
            {"code": "real-code", "state": "good-state"}, session=session
        )
        request.user = _user()

        with _patch_apps(org_model), patch.object(
            auth_views, "user_has_permission", return_value=True
        ), patch.object(
            auth_views.requests, "post"
        ) as mock_post, patch.object(
            auth_views, "store_oauth_token"
        ) as mock_store, patch.object(
            auth_views, "get_secret", return_value="SUPER-SECRET"
        ):
            response = auth_views.github_integration_callback(request)

        org_model.objects.get.assert_called_once_with(
            id=str(org.id), deleted_at__isnull=True
        )
        assert "org_not_found" in response.url
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
