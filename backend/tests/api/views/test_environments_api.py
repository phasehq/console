import uuid
import pytest
from unittest.mock import Mock, MagicMock, patch
from rest_framework.test import APIRequestFactory, force_authenticate
from rest_framework import status

from api.views.environments import PublicEnvironmentsView, PublicEnvironmentDetailView


# ────────────────────────────────────────────────────────────────────
# Shared test helpers
# ────────────────────────────────────────────────────────────────────


def _make_app(sse_enabled=True, plan="PR", org_id=None):
    org = Mock()
    org.id = org_id or uuid.uuid4()
    org.plan = plan
    org.organisation_id = org.id

    app = Mock()
    app.id = uuid.uuid4()
    app.sse_enabled = sse_enabled
    app.organisation = org
    app.organisation_id = org.id
    return app


def _make_env(app=None, name="staging", env_type="staging", index=1, env_id=None):
    env = Mock(spec=["id", "name", "env_type", "index", "app", "app_id", "save", "delete",
                      "created_at", "updated_at"])
    env.id = env_id or uuid.uuid4()
    env.name = name
    env.env_type = env_type
    env.index = index
    env.app = app
    env.app_id = app.id if app else uuid.uuid4()
    env.created_at = "2024-01-01T00:00:00Z"
    env.updated_at = "2024-01-01T00:00:00Z"
    return env


def _make_user():
    user = Mock()
    user.userId = uuid.uuid4()
    user.id = user.userId
    user.is_authenticated = True
    user.is_active = True
    return user


def _make_auth(app, auth_type="User", org_member=None, service_account=None):
    return {
        "token": "Bearer User test_token",
        "auth_type": auth_type,
        "app": app,
        "environment": None,
        "org_member": org_member,
        "service_token": None,
        "service_account": service_account,
        "service_account_token": None,
    }


def _build_request(method, url, app, data=None, auth_type="User", role_name="Owner"):
    """Build an API request with force_authenticate + custom auth dict."""
    factory = APIRequestFactory()
    user = _make_user()

    if method == "get":
        request = factory.get(url)
    elif method == "post":
        request = factory.post(url, data=data, format="json")
    elif method == "put":
        request = factory.put(url, data=data, format="json")
    elif method == "delete":
        request = factory.delete(url)
    else:
        raise ValueError(f"Unknown method: {method}")

    org_member = Mock()
    org_member.id = uuid.uuid4()
    org_member.user = user
    org_member.deleted_at = None
    org_member.role = Mock()
    org_member.role.name = role_name

    sa = None
    if auth_type == "ServiceAccount":
        sa = Mock()
        sa.id = uuid.uuid4()
        sa.organisation_id = app.organisation_id

    auth = _make_auth(
        app,
        auth_type=auth_type,
        org_member=org_member if auth_type == "User" else None,
        service_account=sa,
    )

    # force_authenticate sets request.user and request.auth on the DRF Request wrapper
    force_authenticate(request, user=user, token=auth)
    return request


# ════════════════════════════════════════════════════════════════════
# Tests for PublicEnvironmentsView (list + create)
# ════════════════════════════════════════════════════════════════════


class TestPublicEnvironmentsViewList:

    @pytest.fixture(autouse=True)
    def setup(self, settings):
        settings.DATABASES = {
            "default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}
        }
        self.view = PublicEnvironmentsView.as_view()
        self.app = _make_app()

    @patch("api.views.environments.EnvironmentSerializer")
    @patch("api.views.environments.EnvironmentKey")
    @patch("api.views.environments.Environment")
    @patch("api.views.environments.user_has_permission", return_value=True)
    @patch("api.views.environments.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.environments.IsIPAllowed.has_permission", return_value=True)
    def test_list_environments(self, _ip, _throttle, _perm, mock_env_model, mock_ek_model, mock_serializer):
        env_ids = [uuid.uuid4(), uuid.uuid4(), uuid.uuid4()]
        mock_ek_model.objects.filter.return_value.values_list.return_value = env_ids

        mock_qs = MagicMock()
        mock_qs.order_by.return_value = [Mock(), Mock(), Mock()]
        mock_env_model.objects.filter.return_value = mock_qs
        mock_serializer.return_value.data = [
            {"id": "1", "name": "dev"},
            {"id": "2", "name": "staging"},
            {"id": "3", "name": "prod"},
        ]

        request = _build_request("get", "/public/v1/environments/", self.app)
        response = self.view(request)

        assert response.status_code == status.HTTP_200_OK
        assert len(response.data) == 3

    @patch("api.views.environments.EnvironmentSerializer")
    @patch("api.views.environments.EnvironmentKey")
    @patch("api.views.environments.Environment")
    @patch("api.views.environments.user_has_permission", return_value=True)
    @patch("api.views.environments.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.environments.IsIPAllowed.has_permission", return_value=True)
    def test_list_environments_empty(self, _ip, _throttle, _perm, mock_env_model, mock_ek_model, mock_serializer):
        mock_ek_model.objects.filter.return_value.values_list.return_value = []

        mock_qs = MagicMock()
        mock_qs.order_by.return_value = []
        mock_env_model.objects.filter.return_value = mock_qs
        mock_serializer.return_value.data = []

        request = _build_request("get", "/public/v1/environments/", self.app)
        response = self.view(request)

        assert response.status_code == status.HTTP_200_OK
        assert len(response.data) == 0

    @patch("api.views.environments.user_has_permission", return_value=True)
    @patch("api.views.environments.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.environments.IsIPAllowed.has_permission", return_value=True)
    def test_sse_not_enabled_returns_403(self, _ip, _throttle, _perm):
        app = _make_app(sse_enabled=False)
        request = _build_request("get", "/public/v1/environments/", app)
        response = self.view(request)
        assert response.status_code == status.HTTP_403_FORBIDDEN

    @patch("api.views.environments.user_has_permission", return_value=False)
    @patch("api.views.environments.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.environments.IsIPAllowed.has_permission", return_value=True)
    def test_no_permission_returns_403(self, _ip, _throttle, _perm):
        request = _build_request("get", "/public/v1/environments/", self.app)
        response = self.view(request)
        assert response.status_code == status.HTTP_403_FORBIDDEN


class TestPublicEnvironmentsViewCreate:

    @pytest.fixture(autouse=True)
    def setup(self, settings):
        settings.DATABASES = {
            "default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}
        }
        self.view = PublicEnvironmentsView.as_view()
        self.app = _make_app()

    @patch("api.views.environments.EnvironmentSerializer")
    @patch("api.views.environments.create_environment")
    @patch("api.views.environments.can_use_custom_envs", return_value=True)
    @patch("api.views.environments.can_add_environment", return_value=True)
    @patch("api.views.environments.user_has_permission", return_value=True)
    @patch("api.views.environments.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.environments.IsIPAllowed.has_permission", return_value=True)
    def test_create_environment_success(
        self, _ip, _throttle, _perm, _quota, _custom, mock_create, mock_serializer
    ):
        new_env = _make_env(app=self.app, name="test-env", env_type="custom", index=3)
        mock_create.return_value = new_env
        mock_serializer.return_value.data = {"id": str(new_env.id), "name": "test-env"}

        request = _build_request(
            "post", "/public/v1/environments/", self.app,
            data={"name": "test-env"},
        )
        response = self.view(request)

        assert response.status_code == status.HTTP_201_CREATED
        mock_create.assert_called_once()
        call_args = mock_create.call_args
        assert call_args[0] == (self.app, "test-env", "custom")
        assert call_args[1]["requesting_user"] is not None
        assert call_args[1]["requesting_sa"] is None

    @patch("api.views.environments.user_has_permission", return_value=True)
    @patch("api.views.environments.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.environments.IsIPAllowed.has_permission", return_value=True)
    def test_create_missing_name_returns_400(self, _ip, _throttle, _perm):
        request = _build_request(
            "post", "/public/v1/environments/", self.app,
            data={},
        )
        response = self.view(request)
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    @patch("api.views.environments.create_environment")
    @patch("api.views.environments.can_use_custom_envs", return_value=True)
    @patch("api.views.environments.can_add_environment", return_value=True)
    @patch("api.views.environments.user_has_permission", return_value=True)
    @patch("api.views.environments.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.environments.IsIPAllowed.has_permission", return_value=True)
    def test_create_invalid_name_returns_400(
        self, _ip, _throttle, _perm, _quota, _custom, mock_create
    ):
        mock_create.side_effect = ValueError("Environment name is invalid.")

        request = _build_request(
            "post", "/public/v1/environments/", self.app,
            data={"name": "bad name!!"},
        )
        response = self.view(request)
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    @patch("api.views.environments.create_environment")
    @patch("api.views.environments.can_use_custom_envs", return_value=True)
    @patch("api.views.environments.can_add_environment", return_value=True)
    @patch("api.views.environments.user_has_permission", return_value=True)
    @patch("api.views.environments.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.environments.IsIPAllowed.has_permission", return_value=True)
    def test_create_duplicate_name_returns_400(
        self, _ip, _throttle, _perm, _quota, _custom, mock_create
    ):
        mock_create.side_effect = ValueError("An environment named 'staging' already exists")

        request = _build_request(
            "post", "/public/v1/environments/", self.app,
            data={"name": "staging"},
        )
        response = self.view(request)
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    @patch("api.views.environments.can_add_environment", return_value=False)
    @patch("api.views.environments.user_has_permission", return_value=True)
    @patch("api.views.environments.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.environments.IsIPAllowed.has_permission", return_value=True)
    def test_create_quota_exceeded_returns_403(self, _ip, _throttle, _perm, _quota):
        request = _build_request(
            "post", "/public/v1/environments/", self.app,
            data={"name": "new-env"},
        )
        response = self.view(request)
        assert response.status_code == status.HTTP_403_FORBIDDEN

    @patch("api.views.environments.can_use_custom_envs", return_value=False)
    @patch("api.views.environments.can_add_environment", return_value=True)
    @patch("api.views.environments.user_has_permission", return_value=True)
    @patch("api.views.environments.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.environments.IsIPAllowed.has_permission", return_value=True)
    def test_create_custom_env_free_plan_returns_403(
        self, _ip, _throttle, _perm, _quota, _custom
    ):
        request = _build_request(
            "post", "/public/v1/environments/", self.app,
            data={"name": "my-env"},
        )
        response = self.view(request)
        assert response.status_code == status.HTTP_403_FORBIDDEN


# ════════════════════════════════════════════════════════════════════
# Tests for PublicEnvironmentDetailView (get, update, delete)
# ════════════════════════════════════════════════════════════════════


class TestPublicEnvironmentDetailViewGet:

    @pytest.fixture(autouse=True)
    def setup(self, settings):
        settings.DATABASES = {
            "default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}
        }
        self.view = PublicEnvironmentDetailView.as_view()
        self.app = _make_app()

    @patch("api.views.environments.user_can_access_environment", return_value=True)
    @patch("api.views.environments.EnvironmentSerializer")
    @patch("api.views.environments.Environment")
    @patch("api.views.environments.user_has_permission", return_value=True)
    @patch("api.views.environments.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.environments.IsIPAllowed.has_permission", return_value=True)
    def test_get_environment_success(self, _ip, _throttle, _perm, mock_env_model, mock_serializer, _access):
        env = _make_env(app=self.app, name="staging")
        mock_env_model.objects.select_related.return_value.get.return_value = env
        mock_serializer.return_value.data = {"id": str(env.id), "name": "staging"}

        request = _build_request("get", f"/public/v1/environments/{env.id}/", self.app)
        response = self.view(request, env_id=env.id)

        assert response.status_code == status.HTTP_200_OK
        assert response.data["name"] == "staging"

    @patch("api.views.environments.Environment")
    @patch("api.views.environments.user_has_permission", return_value=True)
    @patch("api.views.environments.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.environments.IsIPAllowed.has_permission", return_value=True)
    def test_get_environment_not_found(self, _ip, _throttle, _perm, mock_env_model):
        mock_env_model.DoesNotExist = Exception
        mock_env_model.objects.select_related.return_value.get.side_effect = Exception("not found")

        request = _build_request("get", "/public/v1/environments/fake/", self.app)
        response = self.view(request, env_id=uuid.uuid4())
        assert response.status_code == status.HTTP_404_NOT_FOUND

    @patch("api.views.environments.Environment")
    @patch("api.views.environments.user_has_permission", return_value=True)
    @patch("api.views.environments.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.environments.IsIPAllowed.has_permission", return_value=True)
    def test_get_environment_wrong_app_returns_404(self, _ip, _throttle, _perm, mock_env_model):
        """Env belongs to a different app — should return 404."""
        other_app = _make_app()
        env = _make_env(app=other_app, name="staging")
        mock_env_model.objects.select_related.return_value.get.return_value = env

        request = _build_request("get", f"/public/v1/environments/{env.id}/", self.app)
        response = self.view(request, env_id=env.id)
        assert response.status_code == status.HTTP_404_NOT_FOUND

    @patch("api.views.environments.user_can_access_environment", return_value=False)
    @patch("api.views.environments.Environment")
    @patch("api.views.environments.user_has_permission", return_value=True)
    @patch("api.views.environments.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.environments.IsIPAllowed.has_permission", return_value=True)
    def test_get_environment_no_env_access_returns_403(self, _ip, _throttle, _perm, mock_env_model, _access):
        """User has app access but no EnvironmentKey for this env."""
        env = _make_env(app=self.app, name="staging")
        mock_env_model.objects.select_related.return_value.get.return_value = env

        request = _build_request("get", f"/public/v1/environments/{env.id}/", self.app)
        response = self.view(request, env_id=env.id)
        assert response.status_code == status.HTTP_403_FORBIDDEN


class TestPublicEnvironmentDetailViewUpdate:

    @pytest.fixture(autouse=True)
    def setup(self, settings):
        settings.DATABASES = {
            "default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}
        }
        self.view = PublicEnvironmentDetailView.as_view()
        self.app = _make_app()

    @patch("api.views.environments.user_can_access_environment", return_value=True)
    @patch("api.views.environments.EnvironmentSerializer")
    @patch("api.views.environments.Environment")
    @patch("api.views.environments.can_use_custom_envs", return_value=True)
    @patch("api.views.environments.user_has_permission", return_value=True)
    @patch("api.views.environments.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.environments.IsIPAllowed.has_permission", return_value=True)
    def test_update_environment_success(
        self, _ip, _throttle, _perm, _custom, mock_env_model, mock_serializer, _access
    ):
        env = _make_env(app=self.app, name="old-name", env_type="custom", index=3)
        mock_env_model.objects.select_related.return_value.get.return_value = env
        # No duplicates
        mock_env_model.objects.filter.return_value.exclude.return_value.exists.return_value = False
        mock_serializer.return_value.data = {"id": str(env.id), "name": "new-name"}

        request = _build_request(
            "put", f"/public/v1/environments/{env.id}/", self.app,
            data={"name": "new-name"},
        )
        response = self.view(request, env_id=env.id)

        assert response.status_code == status.HTTP_200_OK
        assert env.name == "new-name"
        env.save.assert_called_once()

    @patch("api.views.environments.user_can_access_environment", return_value=True)
    @patch("api.views.environments.Environment")
    @patch("api.views.environments.can_use_custom_envs", return_value=True)
    @patch("api.views.environments.user_has_permission", return_value=True)
    @patch("api.views.environments.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.environments.IsIPAllowed.has_permission", return_value=True)
    def test_update_invalid_name_returns_400(self, _ip, _throttle, _perm, _custom, mock_env_model, _access):
        env = _make_env(app=self.app, name="staging", env_type="staging", index=1)
        mock_env_model.objects.select_related.return_value.get.return_value = env

        request = _build_request(
            "put", f"/public/v1/environments/{env.id}/", self.app,
            data={"name": "bad name!!"},
        )
        response = self.view(request, env_id=env.id)
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    @patch("api.views.environments.user_can_access_environment", return_value=True)
    @patch("api.views.environments.Environment")
    @patch("api.views.environments.can_use_custom_envs", return_value=True)
    @patch("api.views.environments.user_has_permission", return_value=True)
    @patch("api.views.environments.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.environments.IsIPAllowed.has_permission", return_value=True)
    def test_update_duplicate_name_returns_409(self, _ip, _throttle, _perm, _custom, mock_env_model, _access):
        env = _make_env(app=self.app, name="staging", env_type="staging", index=1)
        mock_env_model.objects.select_related.return_value.get.return_value = env
        # Duplicate exists
        mock_env_model.objects.filter.return_value.exclude.return_value.exists.return_value = True

        request = _build_request(
            "put", f"/public/v1/environments/{env.id}/", self.app,
            data={"name": "production"},
        )
        response = self.view(request, env_id=env.id)
        assert response.status_code == status.HTTP_409_CONFLICT

    @patch("api.views.environments.user_can_access_environment", return_value=True)
    @patch("api.views.environments.Environment")
    @patch("api.views.environments.can_use_custom_envs", return_value=False)
    @patch("api.views.environments.user_has_permission", return_value=True)
    @patch("api.views.environments.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.environments.IsIPAllowed.has_permission", return_value=True)
    def test_update_custom_env_free_plan_returns_403(
        self, _ip, _throttle, _perm, _custom, mock_env_model, _access
    ):
        env = _make_env(app=self.app, name="my-env", env_type="custom", index=3)
        mock_env_model.objects.select_related.return_value.get.return_value = env

        request = _build_request(
            "put", f"/public/v1/environments/{env.id}/", self.app,
            data={"name": "renamed"},
        )
        response = self.view(request, env_id=env.id)
        assert response.status_code == status.HTTP_403_FORBIDDEN

    @patch("api.views.environments.user_can_access_environment", return_value=True)
    @patch("api.views.environments.Environment")
    @patch("api.views.environments.user_has_permission", return_value=True)
    @patch("api.views.environments.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.environments.IsIPAllowed.has_permission", return_value=True)
    def test_update_missing_name_returns_400(self, _ip, _throttle, _perm, mock_env_model, _access):
        env = _make_env(app=self.app, name="staging", env_type="staging", index=1)
        mock_env_model.objects.select_related.return_value.get.return_value = env

        request = _build_request(
            "put", f"/public/v1/environments/{env.id}/", self.app,
            data={},
        )
        response = self.view(request, env_id=env.id)
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    @patch("api.views.environments.user_can_access_environment", return_value=False)
    @patch("api.views.environments.Environment")
    @patch("api.views.environments.user_has_permission", return_value=True)
    @patch("api.views.environments.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.environments.IsIPAllowed.has_permission", return_value=True)
    def test_update_no_env_access_returns_403(self, _ip, _throttle, _perm, mock_env_model, _access):
        """User has app access but no EnvironmentKey for this env."""
        env = _make_env(app=self.app, name="staging", env_type="staging", index=1)
        mock_env_model.objects.select_related.return_value.get.return_value = env

        request = _build_request(
            "put", f"/public/v1/environments/{env.id}/", self.app,
            data={"name": "new-name"},
        )
        response = self.view(request, env_id=env.id)
        assert response.status_code == status.HTTP_403_FORBIDDEN


class TestPublicEnvironmentDetailViewDelete:

    @pytest.fixture(autouse=True)
    def setup(self, settings):
        settings.DATABASES = {
            "default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}
        }
        self.view = PublicEnvironmentDetailView.as_view()
        self.app = _make_app()

    @patch("api.views.environments.user_can_access_environment", return_value=True)
    @patch("api.views.environments.Environment")
    @patch("api.views.environments.can_use_custom_envs", return_value=True)
    @patch("api.views.environments.user_has_permission", return_value=True)
    @patch("api.views.environments.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.environments.IsIPAllowed.has_permission", return_value=True)
    def test_delete_environment_success(self, _ip, _throttle, _perm, _custom, mock_env_model, _access):
        env = _make_env(app=self.app, name="test-env", env_type="custom", index=3)
        mock_env_model.objects.select_related.return_value.get.return_value = env

        request = _build_request("delete", f"/public/v1/environments/{env.id}/", self.app)
        response = self.view(request, env_id=env.id)

        assert response.status_code == status.HTTP_204_NO_CONTENT
        env.delete.assert_called_once()

    @patch("api.views.environments.Environment")
    @patch("api.views.environments.user_has_permission", return_value=True)
    @patch("api.views.environments.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.environments.IsIPAllowed.has_permission", return_value=True)
    def test_delete_environment_not_found(self, _ip, _throttle, _perm, mock_env_model):
        mock_env_model.DoesNotExist = Exception
        mock_env_model.objects.select_related.return_value.get.side_effect = Exception("not found")

        request = _build_request("delete", "/public/v1/environments/fake/", self.app)
        response = self.view(request, env_id=uuid.uuid4())
        assert response.status_code == status.HTTP_404_NOT_FOUND

    @patch("api.views.environments.user_can_access_environment", return_value=True)
    @patch("api.views.environments.Environment")
    @patch("api.views.environments.can_use_custom_envs", return_value=False)
    @patch("api.views.environments.user_has_permission", return_value=True)
    @patch("api.views.environments.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.environments.IsIPAllowed.has_permission", return_value=True)
    def test_delete_custom_env_free_plan_returns_403(
        self, _ip, _throttle, _perm, _custom, mock_env_model, _access
    ):
        env = _make_env(app=self.app, name="my-env", env_type="custom", index=3)
        mock_env_model.objects.select_related.return_value.get.return_value = env

        request = _build_request("delete", f"/public/v1/environments/{env.id}/", self.app)
        response = self.view(request, env_id=env.id)
        assert response.status_code == status.HTTP_403_FORBIDDEN

    @patch("api.views.environments.user_can_access_environment", return_value=False)
    @patch("api.views.environments.Environment")
    @patch("api.views.environments.user_has_permission", return_value=True)
    @patch("api.views.environments.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.environments.IsIPAllowed.has_permission", return_value=True)
    def test_delete_no_env_access_returns_403(self, _ip, _throttle, _perm, mock_env_model, _access):
        """User has app access but no EnvironmentKey for this env."""
        env = _make_env(app=self.app, name="test-env", env_type="custom", index=3)
        mock_env_model.objects.select_related.return_value.get.return_value = env

        request = _build_request("delete", f"/public/v1/environments/{env.id}/", self.app)
        response = self.view(request, env_id=env.id)
        assert response.status_code == status.HTTP_403_FORBIDDEN


# ════════════════════════════════════════════════════════════════════
# RBAC tests
# ════════════════════════════════════════════════════════════════════


class TestEnvironmentsAPIRBAC:

    @pytest.fixture(autouse=True)
    def setup(self, settings):
        settings.DATABASES = {
            "default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}
        }
        self.list_view = PublicEnvironmentsView.as_view()
        self.detail_view = PublicEnvironmentDetailView.as_view()
        self.app = _make_app()

    @patch("api.views.environments.user_has_permission", return_value=False)
    @patch("api.views.environments.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.environments.IsIPAllowed.has_permission", return_value=True)
    def test_developer_cannot_delete(self, _ip, _throttle, _perm):
        env_id = uuid.uuid4()
        request = _build_request(
            "delete", f"/public/v1/environments/{env_id}/", self.app, role_name="Developer"
        )
        response = self.detail_view(request, env_id=env_id)
        assert response.status_code == status.HTTP_403_FORBIDDEN

    @patch("api.views.environments.user_has_permission", return_value=False)
    @patch("api.views.environments.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.environments.IsIPAllowed.has_permission", return_value=True)
    def test_developer_cannot_create(self, _ip, _throttle, _perm):
        request = _build_request(
            "post", "/public/v1/environments/", self.app,
            data={"name": "new-env"},
            role_name="Developer",
        )
        response = self.list_view(request)
        assert response.status_code == status.HTTP_403_FORBIDDEN

    @patch("api.views.environments.EnvironmentSerializer")
    @patch("api.views.environments.EnvironmentKey")
    @patch("api.views.environments.Environment")
    @patch("api.views.environments.user_has_permission", return_value=True)
    @patch("api.views.environments.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.environments.IsIPAllowed.has_permission", return_value=True)
    def test_owner_can_list(self, _ip, _throttle, _perm, mock_env_model, mock_ek_model, mock_serializer):
        mock_ek_model.objects.filter.return_value.values_list.return_value = []

        mock_qs = MagicMock()
        mock_qs.order_by.return_value = []
        mock_env_model.objects.filter.return_value = mock_qs
        mock_serializer.return_value.data = []

        request = _build_request("get", "/public/v1/environments/", self.app, role_name="Owner")
        response = self.list_view(request)
        assert response.status_code == status.HTTP_200_OK


# ════════════════════════════════════════════════════════════════════
# SSE gate tests
# ════════════════════════════════════════════════════════════════════


class TestEnvironmentsAPISSEGate:

    @pytest.fixture(autouse=True)
    def setup(self, settings):
        settings.DATABASES = {
            "default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}
        }
        self.list_view = PublicEnvironmentsView.as_view()
        self.detail_view = PublicEnvironmentDetailView.as_view()

    @patch("api.views.environments.user_has_permission", return_value=True)
    @patch("api.views.environments.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.environments.IsIPAllowed.has_permission", return_value=True)
    def test_list_rejects_non_sse_app(self, _ip, _throttle, _perm):
        app = _make_app(sse_enabled=False)
        request = _build_request("get", "/public/v1/environments/", app)
        response = self.list_view(request)
        assert response.status_code == status.HTTP_403_FORBIDDEN

    @patch("api.views.environments.user_has_permission", return_value=True)
    @patch("api.views.environments.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.environments.IsIPAllowed.has_permission", return_value=True)
    def test_detail_rejects_non_sse_app(self, _ip, _throttle, _perm):
        app = _make_app(sse_enabled=False)
        env_id = uuid.uuid4()
        request = _build_request("get", f"/public/v1/environments/{env_id}/", app)
        response = self.detail_view(request, env_id=env_id)
        assert response.status_code == status.HTTP_403_FORBIDDEN


# ════════════════════════════════════════════════════════════════════
# Service account app-membership security tests
# ════════════════════════════════════════════════════════════════════


class TestServiceAccountAppMembership:
    """
    Verify that service accounts must be members of the app (via the apps M2M)
    to access environment endpoints — not just belong to the same org.
    """

    @pytest.fixture(autouse=True)
    def setup(self, settings):
        settings.DATABASES = {
            "default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}
        }
        self.list_view = PublicEnvironmentsView.as_view()
        self.detail_view = PublicEnvironmentDetailView.as_view()
        self.app = _make_app()

    def _build_sa_request(self, method, url, app, data=None, is_app_member=True):
        """Build a request authenticated as a ServiceAccount."""
        factory = APIRequestFactory()
        user = _make_user()

        if method == "get":
            request = factory.get(url)
        elif method == "post":
            request = factory.post(url, data=data, format="json")
        elif method == "delete":
            request = factory.delete(url)
        else:
            raise ValueError(f"Unknown method: {method}")

        sa = Mock()
        sa.id = uuid.uuid4()
        sa.organisation_id = app.organisation_id
        sa.deleted_at = None

        # Wire up app.service_accounts M2M mock
        sa_qs = MagicMock()
        if is_app_member:
            sa_qs.filter.return_value.exists.return_value = True
        else:
            sa_qs.filter.return_value.exists.return_value = False
        app.service_accounts = sa_qs

        auth = _make_auth(app, auth_type="ServiceAccount", service_account=sa)
        force_authenticate(request, user=user, token=auth)
        return request

    @patch("api.views.environments.EnvironmentSerializer")
    @patch("api.views.environments.EnvironmentKey")
    @patch("api.views.environments.Environment")
    @patch("api.views.environments.user_has_permission", return_value=True)
    @patch("api.views.environments.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.environments.IsIPAllowed.has_permission", return_value=True)
    def test_sa_app_member_can_list(self, _ip, _throttle, _perm, mock_env_model, mock_ek_model, mock_serializer):
        mock_ek_model.objects.filter.return_value.values_list.return_value = []

        mock_qs = MagicMock()
        mock_qs.order_by.return_value = []
        mock_env_model.objects.filter.return_value = mock_qs
        mock_serializer.return_value.data = []

        request = self._build_sa_request("get", "/public/v1/environments/", self.app, is_app_member=True)
        response = self.list_view(request)
        assert response.status_code == status.HTTP_200_OK

    @patch("api.views.environments.EnvironmentSerializer")
    @patch("api.views.environments.create_environment")
    @patch("api.views.environments.can_use_custom_envs", return_value=True)
    @patch("api.views.environments.can_add_environment", return_value=True)
    @patch("api.views.environments.user_has_permission", return_value=True)
    @patch("api.views.environments.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.environments.IsIPAllowed.has_permission", return_value=True)
    def test_sa_app_member_can_create(
        self, _ip, _throttle, _perm, _quota, _custom, mock_create, mock_serializer
    ):
        new_env = _make_env(app=self.app, name="test-env", env_type="custom", index=3)
        mock_create.return_value = new_env
        mock_serializer.return_value.data = {"id": str(new_env.id), "name": "test-env"}

        request = self._build_sa_request(
            "post", "/public/v1/environments/", self.app,
            data={"name": "test-env"}, is_app_member=True,
        )
        response = self.list_view(request)
        assert response.status_code == status.HTTP_201_CREATED
        mock_create.assert_called_once()
        call_args = mock_create.call_args
        assert call_args[0] == (self.app, "test-env", "custom")
        assert call_args[1]["requesting_user"] is None
        assert call_args[1]["requesting_sa"] is not None

    @patch("api.views.environments.user_has_permission", return_value=True)
    @patch("api.views.environments.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.environments.IsIPAllowed.has_permission", return_value=True)
    def test_sa_non_member_cannot_list(self, _ip, _throttle, _perm):
        """SA in same org but NOT a member of the app should be rejected."""
        request = self._build_sa_request("get", "/public/v1/environments/", self.app, is_app_member=False)
        response = self.list_view(request)
        assert response.status_code == status.HTTP_403_FORBIDDEN

    @patch("api.views.environments.user_has_permission", return_value=True)
    @patch("api.views.environments.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.environments.IsIPAllowed.has_permission", return_value=True)
    def test_sa_non_member_cannot_create(self, _ip, _throttle, _perm):
        """SA in same org but NOT a member of the app should be rejected."""
        request = self._build_sa_request(
            "post", "/public/v1/environments/", self.app,
            data={"name": "test-env"}, is_app_member=False,
        )
        response = self.list_view(request)
        assert response.status_code == status.HTTP_403_FORBIDDEN

    @patch("api.views.environments.user_has_permission", return_value=True)
    @patch("api.views.environments.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.environments.IsIPAllowed.has_permission", return_value=True)
    def test_sa_non_member_cannot_delete(self, _ip, _throttle, _perm):
        """SA in same org but NOT a member of the app should be rejected."""
        env_id = uuid.uuid4()
        request = self._build_sa_request("delete", f"/public/v1/environments/{env_id}/", self.app, is_app_member=False)
        response = self.detail_view(request, env_id=env_id)
        assert response.status_code == status.HTTP_403_FORBIDDEN
