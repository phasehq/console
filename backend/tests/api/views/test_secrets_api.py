"""PublicSecretsView DELETE — env-scoping regression tests."""
import json
import uuid
import pytest
from unittest.mock import Mock, MagicMock, patch
from rest_framework.test import APIRequestFactory, force_authenticate
from rest_framework import status

from api.views.secrets import PublicSecretsView


@pytest.fixture(autouse=True)
def _patch_permission_helpers():
    """Bypass the RBAC + IP gates; these tests only cover env-scoping."""
    with patch("api.views.secrets.user_has_permission", return_value=True):
        yield


# ────────────────────────────────────────────────────────────────────
# Shared helpers
# ────────────────────────────────────────────────────────────────────


def _make_org():
    org = Mock()
    org.id = uuid.uuid4()
    org.plan = "PR"
    return org


def _make_app(org=None, sse_enabled=True):
    app = Mock()
    app.id = uuid.uuid4()
    app.sse_enabled = sse_enabled
    app.organisation = org or _make_org()
    return app


def _make_env(app=None):
    env = Mock()
    env.id = uuid.uuid4()
    env.name = "Development"
    env.env_type = "dev"
    env.app = app or _make_app()
    return env


def _make_user():
    user = Mock()
    user.userId = uuid.uuid4()
    user.id = user.userId
    user.is_authenticated = True
    user.is_active = True
    return user


def _make_org_member(user):
    om = Mock()
    om.id = uuid.uuid4()
    om.user = user
    om.deleted_at = None
    om.role = Mock()
    om.role.name = "Owner"
    return om


def _make_auth(env, user):
    return {
        "token": "Bearer User test_token",
        "auth_type": "User",
        "app": env.app,
        "environment": env,
        "org_member": _make_org_member(user),
        "service_token": None,
        "service_account": None,
        "service_account_token": None,
    }


def _build_delete_request(env, body):
    factory = APIRequestFactory()
    user = _make_user()
    request = factory.delete(
        "/public/v1/secrets/", data=json.dumps(body), content_type="application/json"
    )
    force_authenticate(request, user=user, token=_make_auth(env, user))
    return request


# ════════════════════════════════════════════════════════════════════
# PublicSecretsView.delete — env-scoping regression
# ════════════════════════════════════════════════════════════════════


class TestPublicSecretsDeleteEnvScoping:

    @pytest.fixture(autouse=True)
    def setup(self, settings):
        self.view = PublicSecretsView.as_view()
        self.org = _make_org()
        self.app = _make_app(org=self.org, sse_enabled=True)
        self.env = _make_env(app=self.app)

    def _patch_secret_filter(self, returned_secrets):
        """Mock Secret.objects.filter(...).prefetch_related('tags') to
        return `returned_secrets`. The view always calls these in sequence."""
        qs = MagicMock()
        qs.prefetch_related.return_value = returned_secrets
        return patch("api.views.secrets.Secret.objects.filter", return_value=qs)

    @patch("api.views.secrets.log_secret_events_bulk")
    @patch("api.views.secrets.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.secrets.IsIPAllowed.has_permission", return_value=True)
    def test_delete_cross_env_id_returns_404(self, _ip, _throttle, _audit):
        # Caller authenticated for env A submits a UUID owned by env B —
        # filter is env-scoped, so the queryset comes back empty.
        foreign_id = str(uuid.uuid4())
        with self._patch_secret_filter([]):  # nothing in this env matches
            request = _build_delete_request(self.env, {"secrets": [foreign_id]})
            response = self.view(request)

        assert response.status_code == status.HTTP_404_NOT_FOUND
        assert foreign_id in json.loads(response.content)["error"]

    @patch("api.views.secrets.log_secret_events_bulk")
    @patch("api.views.secrets.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.secrets.IsIPAllowed.has_permission", return_value=True)
    def test_delete_mixed_batch_rejected_atomically(self, _ip, _throttle, _audit):
        """If one id in the batch belongs to a different env, the whole
        batch must 404 — no partial deletion."""
        in_env_id = str(uuid.uuid4())
        cross_env_id = str(uuid.uuid4())

        in_env_secret = Mock()
        in_env_secret.id = in_env_id
        in_env_secret.save = Mock()

        with self._patch_secret_filter([in_env_secret]):
            request = _build_delete_request(
                self.env, {"secrets": [in_env_id, cross_env_id]}
            )
            response = self.view(request)

        assert response.status_code == status.HTTP_404_NOT_FOUND
        assert cross_env_id in json.loads(response.content)["error"]
        # The in-env secret must NOT have been soft-deleted
        in_env_secret.save.assert_not_called()

    @patch("api.views.secrets.log_secret_events_bulk")
    @patch("api.views.secrets.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.secrets.IsIPAllowed.has_permission", return_value=True)
    def test_delete_empty_secrets_list_returns_400(self, _ip, _throttle, _audit):
        request = _build_delete_request(self.env, {"secrets": []})
        response = self.view(request)
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    @patch("api.views.secrets.log_secret_events_bulk")
    @patch("api.views.secrets.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.secrets.IsIPAllowed.has_permission", return_value=True)
    def test_delete_in_env_secret_succeeds(self, _ip, _throttle, _audit):
        secret_id = str(uuid.uuid4())
        secret = Mock()
        secret.id = secret_id
        secret.rotating_secret_id = None
        secret.save = Mock()

        with self._patch_secret_filter([secret]):
            request = _build_delete_request(self.env, {"secrets": [secret_id]})
            response = self.view(request)

        assert response.status_code == status.HTTP_200_OK
        secret.save.assert_called_once()
        assert response.data["message"] == "Deleted 1 secret"

    @patch("api.views.secrets.log_secret_events_bulk")
    @patch("api.views.secrets.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.secrets.IsIPAllowed.has_permission", return_value=True)
    def test_delete_filter_scoped_by_environment(self, _ip, _throttle, _audit):
        """The candidate-secrets queryset must filter by environment=env
        and deleted_at__isnull=True — pinning the contract."""
        secret_id = str(uuid.uuid4())
        with patch("api.views.secrets.Secret.objects.filter") as mock_filter:
            mock_filter.return_value.prefetch_related.return_value = []
            request = _build_delete_request(self.env, {"secrets": [secret_id]})
            self.view(request)

        # Find the call that fetched candidate secrets and assert env-scope.
        candidate_call = next(
            c for c in mock_filter.call_args_list
            if "id__in" in c.kwargs or (c.args and isinstance(c.args[0], list))
        )
        assert candidate_call.kwargs.get("environment") == self.env
        assert candidate_call.kwargs.get("deleted_at__isnull") is True


def _build_put_request(env, body):
    factory = APIRequestFactory()
    user = _make_user()
    request = factory.put(
        "/public/v1/secrets/", data=json.dumps(body), content_type="application/json"
    )
    force_authenticate(request, user=user, token=_make_auth(env, user))
    return request


# ════════════════════════════════════════════════════════════════════
# PublicSecretsView.put — bulk update must record override-less secrets
# ════════════════════════════════════════════════════════════════════


class TestPublicSecretsPutRecordsOverridelessUpdates:
    """Regression: a bulk PUT of a secret with no personal override must still
    be appended to `updated_secrets` — so it's returned, audit-logged, and the
    environment sync is triggered once. A prior indentation bug nested the
    append inside the `if override` branch, silently dropping these updates."""

    @pytest.fixture(autouse=True)
    def setup(self, settings):
        self.view = PublicSecretsView.as_view()
        self.org = _make_org()
        self.app = _make_app(org=self.org, sse_enabled=True)
        self.env = _make_env(app=self.app)

    @patch("api.views.secrets.SecretSerializer")
    @patch(
        "api.views.secrets.get_environment_crypto_context",
        return_value=(b"salt", b"pub", b"priv"),
    )
    @patch("api.views.secrets.log_secret_events_bulk")
    @patch("api.views.secrets.encrypt_asymmetric", return_value="ph:v1:enc")
    @patch("api.views.secrets.get_environment_keys", return_value=(b"pub", b"priv"))
    @patch("api.views.secrets.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.secrets.IsIPAllowed.has_permission", return_value=True)
    def test_put_overrideless_secret_is_recorded_logged_and_triggers_sync(
        self, _ip, _throttle, _keys, _enc, mock_audit, _ctx, mock_serializer
    ):
        secret_id = str(uuid.uuid4())
        secret_obj = Mock()
        secret_obj.id = secret_id
        secret_obj.rotating_secret_id = None
        secret_obj.type = "secret"
        secret_obj.version = 1
        secret_obj.key = "ph:v1:k"
        secret_obj.key_digest = "digest"
        secret_obj.comment = "ph:v1:c"
        secret_obj.value = "ph:v1:v"
        secret_obj.save = Mock()

        mock_serializer.return_value.data = [{"id": secret_id, "value": "v2"}]

        with patch(
            "api.views.secrets.Secret.objects.get", return_value=secret_obj
        ):
            # No "override" key — the common CLI/SDK update.
            request = _build_put_request(
                self.env, {"secrets": [{"id": secret_id, "value": "v2"}]}
            )
            response = self.view(request)

        assert response.status_code == status.HTTP_200_OK
        # Written with per-secret triggering deferred...
        secret_obj.save.assert_called_once_with(trigger_sync=False)
        # ...the env sync fired exactly once afterwards (only happens if appended)...
        self.env.save.assert_called_once()
        # ...and the update was audit-logged in a non-empty batch.
        assert secret_obj in mock_audit.call_args.args[0]
