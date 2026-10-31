"""PhaseTokenAuthentication: Secret-Id / Environment headers must not
act as a cross-org existence oracle, and must not override URL kwargs
on detail endpoints.
"""
import uuid
from unittest.mock import MagicMock, patch

import pytest
from rest_framework import exceptions
from rest_framework.test import APIRequestFactory

from api.auth import PhaseTokenAuthentication
from api.models import (
    DynamicSecret as RealDynamicSecret,
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
    ), _stub_user_token():
        yield


def _stub_caller_org(org):
    """Patch _resolve_caller_org to return a specific org."""
    return patch("api.auth._resolve_caller_org", return_value=org)


def _stub_user_token(org_member=None):
    """The User-token branch reads the org_member off the token row that
    get_token_from_header() loads — supply a benign one so we don't need
    real DB rows."""
    if org_member is None:
        org_member = MagicMock()
        org_member.deleted_at = None
        org_member.user = MagicMock(userId=str(uuid.uuid4()))
        org_member.organisation = MagicMock(id=str(uuid.uuid4()), deleted_at=None)
    return patch(
        "api.auth.get_token_from_header", return_value=MagicMock(user=org_member)
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
        caller_org = MagicMock(id="caller-org-id", deleted_at=None)

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
# URL kwargs take precedence over Secret-Id / Environment headers
# ════════════════════════════════════════════════════════════════════


class TestUrlKwargsBeatHeaders:

    def test_url_app_id_kwarg_makes_secret_id_header_inert(self):
        """When the URL routes a detail endpoint with `app_id`, the
        Secret-Id header must NOT be read. Pre-fix the header silently
        retargeted the request to an unrelated app."""
        caller_org = MagicMock(id="caller-org-id", deleted_at=None)
        url_app_id = "url-app-id"
        url_app = MagicMock(id=url_app_id, organisation=caller_org)

        om = MagicMock()
        om.deleted_at = None
        om.user = MagicMock(userId="user-1")
        om.organisation = caller_org

        with _stub_caller_org(caller_org), patch("api.auth.apps") as MockApps, patch(
            "api.auth.Secret"
        ) as MockSecret, _stub_user_token(om):
            App_cls = MagicMock()
            App_cls.objects.select_related.return_value.filter.return_value.get.return_value = (
                url_app
            )
            MockApps.get_model.return_value = App_cls

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
        caller_org = MagicMock(id="caller-org-id", deleted_at=None)
        url_env_id = "url-env-id"
        url_app = MagicMock(id="url-app-id", organisation=caller_org)
        url_env = MagicMock(id=url_env_id, app=url_app)

        om = MagicMock()
        om.deleted_at = None
        om.user = MagicMock(userId="user-1")
        om.organisation = caller_org

        with _stub_caller_org(caller_org), patch(
            "api.auth.Environment"
        ) as MockEnvironment, patch("api.auth.apps") as MockApps, _stub_user_token(om):
            # The lookup path that should fire: _env_qs().get(id=env_id_from_url)
            MockEnvironment.objects.select_related.return_value.filter.return_value.get.return_value = (
                url_env
            )

            request = _build_request(
                method="put",
                path=f"/v1/environments/{url_env_id}/",
                headers={"Environment": "some-cross-env-uuid"},
                resolver_kwargs={"env_id": url_env_id},
            )
            _user, auth = PhaseTokenAuthentication().authenticate(request)

            assert auth["app"] is url_app
