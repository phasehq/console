"""PhaseTokenAuthentication: Secret-Id / Environment headers must not
act as a cross-org existence oracle, and must not override URL kwargs
on detail endpoints.
"""
import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from rest_framework import exceptions
from rest_framework.test import APIRequestFactory

from api.auth import PhaseTokenAuthentication
from api.models import (
    DynamicSecret as RealDynamicSecret,
    Environment as RealEnvironment,
    Secret as RealSecret,
)


def _resolver_match(**kwargs):
    rm = MagicMock()
    rm.kwargs = kwargs
    return rm


def _build_request(method="get", path="/", headers=None, resolver_kwargs=None):
    factory = APIRequestFactory()
    builder = getattr(factory, method)
    extras = {f"HTTP_{k.upper().replace('-', '_')}": v for k, v in (headers or {}).items()}
    extras["HTTP_AUTHORIZATION"] = "Bearer User test-token"
    request = builder(path, **extras)
    request.resolver_match = _resolver_match(**(resolver_kwargs or {}))
    return request


# ─────────────────────────────────────────────────────────────────
# Helpers to short-circuit the parts of auth() we're not testing
# ─────────────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _stub_auth_scaffolding():
    """Make every code-path past the env/app resolution succeed cheaply —
    these tests only care about how that resolution behaves."""
    with patch("api.auth.get_token_type", return_value="User"), patch(
        "api.auth.token_is_expired_or_deleted", return_value=False
    ), patch("api.auth.user_can_access_environment", return_value=True), patch(
        "api.auth.user_can_access_app", return_value=True
    ):
        yield


def _stub_caller_org(org):
    """Patch _resolve_caller_org to return a specific org."""
    return patch("api.auth._resolve_caller_org", return_value=org)


def _stub_user_token():
    """The User-token branch loads the org_member + user_token rows after
    env resolution — supply benign mocks so we don't need real DB rows."""
    om = MagicMock()
    om.deleted_at = None
    om.user = MagicMock(userId=str(uuid.uuid4()))
    om.organisation = MagicMock(id=str(uuid.uuid4()))
    return patch("api.auth.get_org_member_from_user_token", return_value=om), patch(
        "api.auth.UserToken"
    ) if False else (
        patch("api.auth.get_org_member_from_user_token", return_value=om)
    )


# ════════════════════════════════════════════════════════════════════
# Cross-org existence oracle
# ════════════════════════════════════════════════════════════════════


class TestSecretIdCrossOrgOracle:

    def test_cross_org_secret_id_returns_404_same_as_nonexistent(self):
        """A Secret-Id pointing at a real secret in another org must hit
        the same code path as a nonexistent UUID. The pre-fix behaviour
        let a downstream env-access check fire instead, returning a
        different status — an existence oracle."""
        caller_org = MagicMock(id="caller-org-id")

        # caller_org-scoped queryset comes back empty (mimics "the
        # secret exists but in a different org"). The fix routes that
        # through the same NotFound path as a bogus UUID.
        # Patch the queryset chain on the *real* model classes, so the
        # `except (Secret.DoesNotExist, ValueError)` clauses in auth.py
        # still receive a real exception subclass.
        with _stub_caller_org(caller_org), patch.object(
            RealSecret, "objects"
        ) as MockSecretMgr, patch.object(
            RealDynamicSecret, "objects"
        ) as MockDynMgr:
            MockSecretMgr.select_related.return_value.filter.return_value.get.side_effect = (
                RealSecret.DoesNotExist
            )
            MockDynMgr.select_related.return_value.filter.return_value.get.side_effect = (
                RealDynamicSecret.DoesNotExist
            )

            request = _build_request(headers={"Secret-Id": str(uuid.uuid4())})
            with pytest.raises(exceptions.NotFound, match="Secret not found"):
                PhaseTokenAuthentication().authenticate(request)


# ════════════════════════════════════════════════════════════════════
# Legacy service-token environment scope
# ════════════════════════════════════════════════════════════════════


class TestLegacyServiceTokenScope:

    @staticmethod
    def _service_token(org, app_id="token-app"):
        app = SimpleNamespace(id=app_id, organisation=org)
        return SimpleNamespace(
            app=app,
            app_id=app_id,
            keys=MagicMock(),
            created_by=SimpleNamespace(user=MagicMock()),
        )

    @staticmethod
    def _request(env_id):
        request = _build_request(headers={"Environment": env_id})
        request.META["HTTP_AUTHORIZATION"] = "Bearer Service test-token"
        return request

    def test_environment_lookup_is_scoped_to_service_tokens_org(self):
        token_org = SimpleNamespace(id="token-org")
        token = self._service_token(token_org)
        victim_app = SimpleNamespace(
            id="victim-app",
            organisation=SimpleNamespace(id="victim-org"),
        )
        victim_env = SimpleNamespace(
            id="victim-env",
            app=victim_app,
            app_id=victim_app.id,
        )

        with patch("api.auth.get_token_type", return_value="Service"), patch(
            "api.auth.get_service_token", return_value=token
        ), patch.object(RealEnvironment, "objects") as MockEnvironmentMgr:
            env_qs = MockEnvironmentMgr.select_related.return_value
            env_qs.get.return_value = victim_env
            env_qs.filter.return_value.get.side_effect = RealEnvironment.DoesNotExist

            with pytest.raises(exceptions.AuthenticationFailed, match="Environment not found"):
                PhaseTokenAuthentication().authenticate(self._request(victim_env.id))

            env_qs.filter.assert_called_once_with(app__organisation=token_org)

    def test_service_token_rejects_unprovisioned_environment(self):
        token_org = SimpleNamespace(id="token-org")
        token = self._service_token(token_org)
        env = SimpleNamespace(id="other-env", app=token.app, app_id=token.app_id)
        token.keys.filter.return_value.exists.return_value = False

        with patch("api.auth.get_token_type", return_value="Service"), patch(
            "api.auth.get_service_token", return_value=token
        ), patch.object(RealEnvironment, "objects") as MockEnvironmentMgr:
            env_qs = MockEnvironmentMgr.select_related.return_value
            env_qs.get.return_value = env
            env_qs.filter.return_value.get.return_value = env

            with pytest.raises(
                exceptions.AuthenticationFailed,
                match="Service token cannot access this environment",
            ):
                PhaseTokenAuthentication().authenticate(self._request(env.id))

            token.keys.filter.assert_called_once_with(
                environment_id=env.id, deleted_at=None
            )

    def test_service_token_rejects_environment_from_another_app(self):
        token_org = SimpleNamespace(id="token-org")
        token = self._service_token(token_org)
        other_app = SimpleNamespace(id="other-app", organisation=token_org)
        env = SimpleNamespace(id="other-env", app=other_app, app_id=other_app.id)
        token.keys.filter.return_value.exists.return_value = True

        with patch("api.auth.get_token_type", return_value="Service"), patch(
            "api.auth.get_service_token", return_value=token
        ), patch.object(RealEnvironment, "objects") as MockEnvironmentMgr:
            env_qs = MockEnvironmentMgr.select_related.return_value
            env_qs.get.return_value = env
            env_qs.filter.return_value.get.return_value = env

            with pytest.raises(
                exceptions.AuthenticationFailed,
                match="Service token cannot access this environment",
            ):
                PhaseTokenAuthentication().authenticate(self._request(env.id))

            token.keys.filter.assert_not_called()

    def test_service_token_accepts_its_provisioned_environment(self):
        token_org = SimpleNamespace(id="token-org")
        token = self._service_token(token_org)
        env = SimpleNamespace(id="allowed-env", app=token.app, app_id=token.app_id)
        token.keys.filter.return_value.exists.return_value = True

        with patch("api.auth.get_token_type", return_value="Service"), patch(
            "api.auth.get_service_token", return_value=token
        ), patch.object(RealEnvironment, "objects") as MockEnvironmentMgr:
            env_qs = MockEnvironmentMgr.select_related.return_value
            env_qs.get.return_value = env
            env_qs.filter.return_value.get.return_value = env

            _user, auth = PhaseTokenAuthentication().authenticate(self._request(env.id))

            assert auth["environment"] is env
            assert auth["service_token"] is token
            token.keys.filter.assert_called_once_with(
                environment_id=env.id, deleted_at=None
            )


# ════════════════════════════════════════════════════════════════════
# URL kwargs take precedence over Secret-Id / Environment headers
# ════════════════════════════════════════════════════════════════════


class TestUrlKwargsBeatHeaders:

    def test_url_app_id_kwarg_makes_secret_id_header_inert(self):
        """When the URL routes a detail endpoint with `app_id`, the
        Secret-Id header must NOT be read. Pre-fix the header silently
        retargeted the request to an unrelated app."""
        caller_org = MagicMock(id="caller-org-id")
        url_app_id = "url-app-id"
        url_app = MagicMock(id=url_app_id, organisation=caller_org)

        with _stub_caller_org(caller_org), patch("api.auth.apps") as MockApps, patch(
            "api.auth.Secret"
        ) as MockSecret, patch("api.auth.get_org_member_from_user_token") as MockOm:
            App_cls = MagicMock()
            App_cls.objects.select_related.return_value.filter.return_value.get.return_value = (
                url_app
            )
            MockApps.get_model.return_value = App_cls

            om = MagicMock()
            om.deleted_at = None
            om.user = MagicMock(userId="user-1")
            om.organisation = caller_org
            MockOm.return_value = om

            # Patch the UserToken lookup at the end of the User branch
            with patch("api.models.UserToken") as MockToken:
                MockToken.objects.get.return_value = MagicMock()

                request = _build_request(
                    method="put",
                    path=f"/v1/apps/{url_app_id}/",
                    headers={"Secret-Id": "some-cross-app-secret-uuid"},
                    resolver_kwargs={"app_id": url_app_id},
                )
                _user, auth = PhaseTokenAuthentication().authenticate(request)

            # Secret-Id was IGNORED — no call to Secret.objects went out.
            MockSecret.objects.select_related.assert_not_called()
            # URL-path app won.
            assert auth["app"] is url_app

    def test_url_env_id_kwarg_makes_environment_header_inert(self):
        """Same contract for Environment header on detail endpoints with
        `env_id` in the URL."""
        caller_org = MagicMock(id="caller-org-id")
        url_env_id = "url-env-id"
        url_app = MagicMock(id="url-app-id", organisation=caller_org)
        url_env = MagicMock(id=url_env_id, app=url_app)

        with _stub_caller_org(caller_org), patch(
            "api.auth.Environment"
        ) as MockEnvironment, patch("api.auth.apps") as MockApps, patch(
            "api.auth.get_org_member_from_user_token"
        ) as MockOm:
            # The lookup path that should fire: _env_qs().get(id=env_id_from_url)
            MockEnvironment.objects.select_related.return_value.filter.return_value.get.return_value = (
                url_env
            )

            om = MagicMock()
            om.deleted_at = None
            om.user = MagicMock(userId="user-1")
            om.organisation = caller_org
            MockOm.return_value = om

            with patch("api.models.UserToken") as MockToken:
                MockToken.objects.get.return_value = MagicMock()

                request = _build_request(
                    method="put",
                    path=f"/v1/environments/{url_env_id}/",
                    headers={"Environment": "some-cross-env-uuid"},
                    resolver_kwargs={"env_id": url_env_id},
                )
                _user, auth = PhaseTokenAuthentication().authenticate(request)

            assert auth["app"] is url_app
