import uuid
import pytest
from unittest.mock import Mock, MagicMock, patch, PropertyMock
from rest_framework.test import APIRequestFactory, force_authenticate
from rest_framework import status

from api.views.apps import PublicAppsView, PublicAppDetailView


# ────────────────────────────────────────────────────────────────────
# Shared test helpers
# ────────────────────────────────────────────────────────────────────


def _make_org(plan="PR", org_id=None):
    org = Mock()
    org.id = org_id or uuid.uuid4()
    org.plan = plan
    org.organisation_id = org.id
    return org


def _make_app(org=None, sse_enabled=True, name="my-app", app_id=None):
    if org is None:
        org = _make_org()
    app = Mock(spec=[
        "id", "name", "description", "sse_enabled", "organisation", "organisation_id",
        "identity_key", "app_version", "app_token", "app_seed", "wrapped_key_share",
        "is_deleted", "created_at", "updated_at", "save", "delete",
        "members", "service_accounts",
    ])
    app.id = app_id or uuid.uuid4()
    app.name = name
    app.description = None
    app.sse_enabled = sse_enabled
    app.organisation = org
    app.organisation_id = org.id
    app.identity_key = "deadbeef" * 8
    app.app_version = 1
    app.app_token = "aabbccdd" * 8
    app.app_seed = "encrypted_seed"
    app.wrapped_key_share = "wrapped_share"
    app.is_deleted = False
    app.created_at = "2024-01-01T00:00:00Z"
    app.updated_at = "2024-01-01T00:00:00Z"
    return app


def _make_user():
    user = Mock()
    user.userId = uuid.uuid4()
    user.id = user.userId
    user.is_authenticated = True
    user.is_active = True
    return user


def _make_org_member(org=None, role_name="Owner"):
    member = Mock()
    member.id = uuid.uuid4()
    member.user = _make_user()
    member.organisation = org or _make_org()
    member.deleted_at = None
    member.role = Mock()
    member.role.name = role_name
    member.apps = Mock()
    return member


def _make_auth_org_only(org, auth_type="User", org_member=None, service_account=None):
    return {
        "token": "Bearer User test_token",
        "auth_type": auth_type,
        "app": None,
        "environment": None,
        "org_member": org_member,
        "service_token": None,
        "service_account": service_account,
        "service_account_token": None,
        "organisation": org,
        "org_only": True,
    }


def _make_auth_app(app, auth_type="User", org_member=None, service_account=None):
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


def _build_list_request(method, url, org, data=None, auth_type="User", role_name="Owner"):
    """Build a request in org-only mode for list/create endpoints."""
    factory = APIRequestFactory()

    if method == "get":
        request = factory.get(url)
    elif method == "post":
        request = factory.post(url, data=data, format="json")
    else:
        raise ValueError(f"Unknown method: {method}")

    org_member = _make_org_member(org=org, role_name=role_name)

    sa = None
    if auth_type == "ServiceAccount":
        sa = Mock()
        sa.id = uuid.uuid4()
        sa.organisation = org
        sa.organisation_id = org.id
        sa.apps = Mock()

    auth = _make_auth_org_only(
        org,
        auth_type=auth_type,
        org_member=org_member if auth_type == "User" else None,
        service_account=sa,
    )

    force_authenticate(request, user=org_member.user, token=auth)
    return request


def _build_detail_request(method, url, app, data=None, auth_type="User", role_name="Owner"):
    """Build a request in app mode for detail endpoints."""
    factory = APIRequestFactory()

    if method == "get":
        request = factory.get(url)
    elif method == "put":
        request = factory.put(url, data=data, format="json")
    elif method == "delete":
        request = factory.delete(url)
    else:
        raise ValueError(f"Unknown method: {method}")

    org_member = _make_org_member(org=app.organisation, role_name=role_name)

    sa = None
    if auth_type == "ServiceAccount":
        sa = Mock()
        sa.id = uuid.uuid4()
        sa.organisation = app.organisation
        sa.organisation_id = app.organisation_id

    auth = _make_auth_app(
        app,
        auth_type=auth_type,
        org_member=org_member if auth_type == "User" else None,
        service_account=sa,
    )

    force_authenticate(request, user=org_member.user, token=auth)
    return request


# ════════════════════════════════════════════════════════════════════
# Tests for PublicAppsView — List
# ════════════════════════════════════════════════════════════════════


class TestPublicAppsViewList:

    @pytest.fixture(autouse=True)
    def setup(self, settings):
        settings.DATABASES = {
            "default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}
        }
        self.view = PublicAppsView.as_view()
        self.org = _make_org()

    @patch("api.views.apps.AppSerializer")
    @patch("api.views.apps.App")
    @patch("api.views.apps.user_has_permission", return_value=True)
    @patch("api.views.apps.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.apps.IsIPAllowed.has_permission", return_value=True)
    def test_list_apps_success(self, _ip, _throttle, _perm, mock_app_model, mock_serializer):
        mock_org_qs = MagicMock()
        mock_filtered = MagicMock()
        mock_filtered.order_by.return_value = [Mock(), Mock()]
        mock_org_qs.filter.return_value = mock_filtered
        mock_app_model.objects.filter.return_value = mock_org_qs

        mock_serializer.return_value.data = [
            {"id": "1", "name": "app-1"},
            {"id": "2", "name": "app-2"},
        ]

        request = _build_list_request("get", "/public/v1/apps/", self.org)
        response = self.view(request)

        assert response.status_code == status.HTTP_200_OK
        assert len(response.data) == 2

    @patch("api.views.apps.AppSerializer")
    @patch("api.views.apps.App")
    @patch("api.views.apps.user_has_permission", return_value=True)
    @patch("api.views.apps.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.apps.IsIPAllowed.has_permission", return_value=True)
    def test_list_apps_empty(self, _ip, _throttle, _perm, mock_app_model, mock_serializer):
        mock_org_qs = MagicMock()
        mock_filtered = MagicMock()
        mock_filtered.order_by.return_value = []
        mock_org_qs.filter.return_value = mock_filtered
        mock_app_model.objects.filter.return_value = mock_org_qs

        mock_serializer.return_value.data = []

        request = _build_list_request("get", "/public/v1/apps/", self.org)
        response = self.view(request)

        assert response.status_code == status.HTTP_200_OK
        assert len(response.data) == 0

    @patch("api.views.apps.user_has_permission", return_value=False)
    @patch("api.views.apps.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.apps.IsIPAllowed.has_permission", return_value=True)
    def test_list_no_permission_returns_403(self, _ip, _throttle, _perm):
        request = _build_list_request("get", "/public/v1/apps/", self.org, role_name="Developer")
        response = self.view(request)
        assert response.status_code == status.HTTP_403_FORBIDDEN


# ════════════════════════════════════════════════════════════════════
# Tests for PublicAppsView — Create
# ════════════════════════════════════════════════════════════════════


class TestPublicAppsViewCreate:

    @pytest.fixture(autouse=True)
    def setup(self, settings):
        settings.DATABASES = {
            "default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}
        }
        settings.APP_HOST = "self"
        self.view = PublicAppsView.as_view()
        self.org = _make_org()

    @patch("api.views.apps.AppSerializer")
    @patch("api.views.apps.create_environment")
    @patch("api.views.apps.OrganisationMember")
    @patch("api.views.apps.Role")
    @patch("api.views.apps.App")
    @patch("api.views.apps.transaction")
    @patch("api.views.apps.encrypt_raw", return_value=bytearray(b"\x00" * 104))
    @patch("api.views.apps.get_server_keypair", return_value=(b"\x00" * 32, b"\x01" * 32))
    @patch("api.views.apps.wrap_share_hex", return_value="wrapped_share")
    @patch("api.views.apps.split_secret_hex", return_value=("share0", "share1"))
    @patch("api.views.apps.env_keypair", return_value=("pub_hex", "priv_hex"))
    @patch("api.views.apps.random_hex", return_value="aa" * 32)
    @patch("api.views.apps.can_add_app", return_value=True)
    @patch("api.views.apps.user_has_permission", return_value=True)
    @patch("api.views.apps.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.apps.IsIPAllowed.has_permission", return_value=True)
    def test_create_app_success(
        self, _ip, _throttle, _perm, _quota,
        _random, _keypair, _split, _wrap, _server_kp, _encrypt,
        _txn, mock_app_model, mock_role, mock_org_member, mock_create_env, mock_serializer,
    ):
        new_app = _make_app(org=self.org, name="test-app")
        mock_app_model.objects.create.return_value = new_app

        # Mock admin query to return empty (no admins to add)
        mock_role.objects.filter.return_value = []
        mock_org_member.objects.filter.return_value = []

        mock_serializer.return_value.data = {"id": str(new_app.id), "name": "test-app"}

        request = _build_list_request(
            "post", "/public/v1/apps/", self.org,
            data={"name": "test-app"},
        )
        response = self.view(request)

        assert response.status_code == status.HTTP_201_CREATED
        mock_app_model.objects.create.assert_called_once()
        # Verify create_environment was called 3 times (dev, staging, prod)
        assert mock_create_env.call_count == 3

    @patch("api.views.apps.user_has_permission", return_value=True)
    @patch("api.views.apps.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.apps.IsIPAllowed.has_permission", return_value=True)
    def test_create_missing_name_returns_400(self, _ip, _throttle, _perm):
        request = _build_list_request(
            "post", "/public/v1/apps/", self.org,
            data={},
        )
        response = self.view(request)
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    @patch("api.views.apps.user_has_permission", return_value=True)
    @patch("api.views.apps.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.apps.IsIPAllowed.has_permission", return_value=True)
    def test_create_blank_name_returns_400(self, _ip, _throttle, _perm):
        request = _build_list_request(
            "post", "/public/v1/apps/", self.org,
            data={"name": "   "},
        )
        response = self.view(request)
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    @patch("api.views.apps.user_has_permission", return_value=True)
    @patch("api.views.apps.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.apps.IsIPAllowed.has_permission", return_value=True)
    def test_create_name_too_long_returns_400(self, _ip, _throttle, _perm):
        request = _build_list_request(
            "post", "/public/v1/apps/", self.org,
            data={"name": "x" * 65},
        )
        response = self.view(request)
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    @patch("api.views.apps.can_add_app", return_value=False)
    @patch("api.views.apps.user_has_permission", return_value=True)
    @patch("api.views.apps.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.apps.IsIPAllowed.has_permission", return_value=True)
    def test_create_quota_exceeded_returns_403(self, _ip, _throttle, _perm, _quota):
        request = _build_list_request(
            "post", "/public/v1/apps/", self.org,
            data={"name": "new-app"},
        )
        response = self.view(request)
        assert response.status_code == status.HTTP_403_FORBIDDEN

    @patch("api.views.apps.user_has_permission", return_value=False)
    @patch("api.views.apps.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.apps.IsIPAllowed.has_permission", return_value=True)
    def test_create_no_permission_returns_403(self, _ip, _throttle, _perm):
        request = _build_list_request(
            "post", "/public/v1/apps/", self.org,
            data={"name": "new-app"},
            role_name="Developer",
        )
        response = self.view(request)
        assert response.status_code == status.HTTP_403_FORBIDDEN

    # --- Custom environments field ---

    @patch("api.views.apps.user_has_permission", return_value=True)
    @patch("api.views.apps.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.apps.IsIPAllowed.has_permission", return_value=True)
    def test_create_envs_not_a_list_returns_400(self, _ip, _throttle, _perm):
        request = _build_list_request(
            "post", "/public/v1/apps/", self.org,
            data={"name": "my-app", "environments": "not-a-list"},
        )
        response = self.view(request)
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data["error"] == "'environments' must be a list of environment names."

    @patch("api.views.apps.user_has_permission", return_value=True)
    @patch("api.views.apps.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.apps.IsIPAllowed.has_permission", return_value=True)
    def test_create_envs_empty_list_returns_400(self, _ip, _throttle, _perm):
        request = _build_list_request(
            "post", "/public/v1/apps/", self.org,
            data={"name": "my-app", "environments": []},
        )
        response = self.view(request)
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data["error"] == "'environments' must not be empty."

    @patch("api.views.apps.user_has_permission", return_value=True)
    @patch("api.views.apps.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.apps.IsIPAllowed.has_permission", return_value=True)
    def test_create_envs_non_string_entry_returns_400(self, _ip, _throttle, _perm):
        request = _build_list_request(
            "post", "/public/v1/apps/", self.org,
            data={"name": "my-app", "environments": ["valid", 123]},
        )
        response = self.view(request)
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data["error"] == "Each environment name must be a non-empty string."

    @patch("api.views.apps.user_has_permission", return_value=True)
    @patch("api.views.apps.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.apps.IsIPAllowed.has_permission", return_value=True)
    def test_create_envs_blank_entry_returns_400(self, _ip, _throttle, _perm):
        request = _build_list_request(
            "post", "/public/v1/apps/", self.org,
            data={"name": "my-app", "environments": ["valid", "  "]},
        )
        response = self.view(request)
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data["error"] == "Each environment name must be a non-empty string."

    @patch("api.views.apps.user_has_permission", return_value=True)
    @patch("api.views.apps.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.apps.IsIPAllowed.has_permission", return_value=True)
    def test_create_envs_duplicate_names_returns_400(self, _ip, _throttle, _perm):
        request = _build_list_request(
            "post", "/public/v1/apps/", self.org,
            data={"name": "my-app", "environments": ["staging", "Staging"]},
        )
        response = self.view(request)
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "Duplicate environment name" in response.data["error"]

    @patch("api.views.apps.can_use_custom_envs", return_value=False)
    @patch("api.views.apps.user_has_permission", return_value=True)
    @patch("api.views.apps.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.apps.IsIPAllowed.has_permission", return_value=True)
    def test_create_custom_envs_free_plan_returns_403(self, _ip, _throttle, _perm, _custom):
        request = _build_list_request(
            "post", "/public/v1/apps/", self.org,
            data={"name": "my-app", "environments": ["test", "live"]},
        )
        response = self.view(request)
        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert "Free plan" in response.data["error"]

    @patch("api.views.apps.AppSerializer")
    @patch("api.views.apps.create_environment")
    @patch("api.views.apps.OrganisationMember")
    @patch("api.views.apps.Role")
    @patch("api.views.apps.App")
    @patch("api.views.apps.transaction")
    @patch("api.views.apps.encrypt_raw", return_value=bytearray(b"\x00" * 104))
    @patch("api.views.apps.get_server_keypair", return_value=(b"\x00" * 32, b"\x01" * 32))
    @patch("api.views.apps.wrap_share_hex", return_value="wrapped_share")
    @patch("api.views.apps.split_secret_hex", return_value=("share0", "share1"))
    @patch("api.views.apps.env_keypair", return_value=("pub_hex", "priv_hex"))
    @patch("api.views.apps.random_hex", return_value="aa" * 32)
    @patch("api.views.apps.can_add_app", return_value=True)
    @patch("api.views.apps.can_use_custom_envs", return_value=True)
    @patch("api.views.apps.user_has_permission", return_value=True)
    @patch("api.views.apps.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.apps.IsIPAllowed.has_permission", return_value=True)
    def test_create_app_with_custom_envs(
        self, _ip, _throttle, _perm, _custom, _quota,
        _random, _keypair, _split, _wrap, _server_kp, _encrypt,
        _txn, mock_app_model, mock_role, mock_org_member, mock_create_env, mock_serializer,
    ):
        new_app = _make_app(org=self.org, name="test-app")
        mock_app_model.objects.create.return_value = new_app
        mock_role.objects.filter.return_value = []
        mock_org_member.objects.filter.return_value = []
        mock_serializer.return_value.data = {"id": str(new_app.id), "name": "test-app"}

        request = _build_list_request(
            "post", "/public/v1/apps/", self.org,
            data={"name": "test-app", "environments": ["test", "live"]},
        )
        response = self.view(request)

        assert response.status_code == status.HTTP_201_CREATED
        assert mock_create_env.call_count == 2
        # Verify both calls used "custom" env_type
        for call in mock_create_env.call_args_list:
            assert call[0][2] == "custom"
        # Verify env names
        env_names = [call[0][1] for call in mock_create_env.call_args_list]
        assert env_names == ["test", "live"]


# ════════════════════════════════════════════════════════════════════
# Tests for PublicAppDetailView — Get
# ════════════════════════════════════════════════════════════════════


class TestPublicAppDetailViewGet:

    @pytest.fixture(autouse=True)
    def setup(self, settings):
        settings.DATABASES = {
            "default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}
        }
        self.view = PublicAppDetailView.as_view()
        self.org = _make_org()
        self.app = _make_app(org=self.org)

    @patch("api.views.apps.AppSerializer")
    @patch("api.views.apps.user_has_permission", return_value=True)
    @patch("api.views.apps.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.apps.IsIPAllowed.has_permission", return_value=True)
    def test_get_app_success(self, _ip, _throttle, _perm, mock_serializer):
        mock_serializer.return_value.data = {"id": str(self.app.id), "name": "my-app"}

        request = _build_detail_request("get", f"/public/v1/apps/{self.app.id}/", self.app)
        response = self.view(request, app_id=self.app.id)

        assert response.status_code == status.HTTP_200_OK
        assert response.data["name"] == "my-app"

    @patch("api.views.apps.user_has_permission", return_value=True)
    @patch("api.views.apps.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.apps.IsIPAllowed.has_permission", return_value=True)
    def test_get_non_sse_app_returns_403(self, _ip, _throttle, _perm):
        app = _make_app(org=self.org, sse_enabled=False)
        request = _build_detail_request("get", f"/public/v1/apps/{app.id}/", app)
        response = self.view(request, app_id=app.id)
        assert response.status_code == status.HTTP_403_FORBIDDEN

    @patch("api.views.apps.user_has_permission", return_value=False)
    @patch("api.views.apps.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.apps.IsIPAllowed.has_permission", return_value=True)
    def test_get_no_permission_returns_403(self, _ip, _throttle, _perm):
        request = _build_detail_request(
            "get", f"/public/v1/apps/{self.app.id}/", self.app, role_name="Developer"
        )
        # Developer has read permission on Apps by default, but we mocked it to False
        response = self.view(request, app_id=self.app.id)
        assert response.status_code == status.HTTP_403_FORBIDDEN


# ════════════════════════════════════════════════════════════════════
# Tests for PublicAppDetailView — Update
# ════════════════════════════════════════════════════════════════════


class TestPublicAppDetailViewUpdate:

    @pytest.fixture(autouse=True)
    def setup(self, settings):
        settings.DATABASES = {
            "default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}
        }
        self.view = PublicAppDetailView.as_view()
        self.org = _make_org()
        self.app = _make_app(org=self.org)

    @patch("api.views.apps.AppSerializer")
    @patch("api.views.apps.user_has_permission", return_value=True)
    @patch("api.views.apps.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.apps.IsIPAllowed.has_permission", return_value=True)
    def test_update_name_success(self, _ip, _throttle, _perm, mock_serializer):
        mock_serializer.return_value.data = {"id": str(self.app.id), "name": "new-name"}

        request = _build_detail_request(
            "put", f"/public/v1/apps/{self.app.id}/", self.app,
            data={"name": "new-name"},
        )
        response = self.view(request, app_id=self.app.id)

        assert response.status_code == status.HTTP_200_OK
        assert self.app.name == "new-name"
        self.app.save.assert_called_once()

    @patch("api.views.apps.AppSerializer")
    @patch("api.views.apps.user_has_permission", return_value=True)
    @patch("api.views.apps.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.apps.IsIPAllowed.has_permission", return_value=True)
    def test_update_description_success(self, _ip, _throttle, _perm, mock_serializer):
        mock_serializer.return_value.data = {
            "id": str(self.app.id), "name": "my-app", "description": "new desc"
        }

        request = _build_detail_request(
            "put", f"/public/v1/apps/{self.app.id}/", self.app,
            data={"description": "new desc"},
        )
        response = self.view(request, app_id=self.app.id)

        assert response.status_code == status.HTTP_200_OK
        assert self.app.description == "new desc"

    @patch("api.views.apps.user_has_permission", return_value=True)
    @patch("api.views.apps.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.apps.IsIPAllowed.has_permission", return_value=True)
    def test_update_no_fields_returns_400(self, _ip, _throttle, _perm):
        request = _build_detail_request(
            "put", f"/public/v1/apps/{self.app.id}/", self.app,
            data={},
        )
        response = self.view(request, app_id=self.app.id)
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    @patch("api.views.apps.user_has_permission", return_value=True)
    @patch("api.views.apps.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.apps.IsIPAllowed.has_permission", return_value=True)
    def test_update_blank_name_returns_400(self, _ip, _throttle, _perm):
        request = _build_detail_request(
            "put", f"/public/v1/apps/{self.app.id}/", self.app,
            data={"name": ""},
        )
        response = self.view(request, app_id=self.app.id)
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    @patch("api.views.apps.user_has_permission", return_value=True)
    @patch("api.views.apps.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.apps.IsIPAllowed.has_permission", return_value=True)
    def test_update_name_too_long_returns_400(self, _ip, _throttle, _perm):
        request = _build_detail_request(
            "put", f"/public/v1/apps/{self.app.id}/", self.app,
            data={"name": "x" * 65},
        )
        response = self.view(request, app_id=self.app.id)
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    @patch("api.views.apps.user_has_permission", return_value=True)
    @patch("api.views.apps.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.apps.IsIPAllowed.has_permission", return_value=True)
    def test_update_description_too_long_returns_400(self, _ip, _throttle, _perm):
        request = _build_detail_request(
            "put", f"/public/v1/apps/{self.app.id}/", self.app,
            data={"description": "x" * 10001},
        )
        response = self.view(request, app_id=self.app.id)
        assert response.status_code == status.HTTP_400_BAD_REQUEST


# ════════════════════════════════════════════════════════════════════
# Tests for PublicAppDetailView — Delete
# ════════════════════════════════════════════════════════════════════


class TestPublicAppDetailViewDelete:

    @pytest.fixture(autouse=True)
    def setup(self, settings):
        settings.DATABASES = {
            "default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}
        }
        settings.APP_HOST = "self"
        self.view = PublicAppDetailView.as_view()
        self.org = _make_org()
        self.app = _make_app(org=self.org)

    @patch("api.views.apps.CLOUD_HOSTED", False)
    @patch("api.views.apps.user_has_permission", return_value=True)
    @patch("api.views.apps.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.apps.IsIPAllowed.has_permission", return_value=True)
    def test_delete_app_success(self, _ip, _throttle, _perm):
        request = _build_detail_request(
            "delete", f"/public/v1/apps/{self.app.id}/", self.app,
        )
        response = self.view(request, app_id=self.app.id)

        assert response.status_code == status.HTTP_204_NO_CONTENT
        self.app.save.assert_called_once()
        self.app.delete.assert_called_once()
        assert self.app.wrapped_key_share == ""

    @patch("api.views.apps.user_has_permission", return_value=False)
    @patch("api.views.apps.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.apps.IsIPAllowed.has_permission", return_value=True)
    def test_delete_no_permission_returns_403(self, _ip, _throttle, _perm):
        request = _build_detail_request(
            "delete", f"/public/v1/apps/{self.app.id}/", self.app,
            role_name="Developer",
        )
        response = self.view(request, app_id=self.app.id)
        assert response.status_code == status.HTTP_403_FORBIDDEN


# ════════════════════════════════════════════════════════════════════
# SSE gate tests
# ════════════════════════════════════════════════════════════════════


class TestAppsAPISSEGate:

    @pytest.fixture(autouse=True)
    def setup(self, settings):
        settings.DATABASES = {
            "default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}
        }
        self.view = PublicAppDetailView.as_view()
        self.org = _make_org()

    @patch("api.views.apps.user_has_permission", return_value=True)
    @patch("api.views.apps.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.apps.IsIPAllowed.has_permission", return_value=True)
    def test_detail_rejects_non_sse_app(self, _ip, _throttle, _perm):
        app = _make_app(org=self.org, sse_enabled=False)
        request = _build_detail_request("get", f"/public/v1/apps/{app.id}/", app)
        response = self.view(request, app_id=app.id)
        assert response.status_code == status.HTTP_403_FORBIDDEN

    @patch("api.views.apps.user_has_permission", return_value=True)
    @patch("api.views.apps.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.apps.IsIPAllowed.has_permission", return_value=True)
    def test_update_rejects_non_sse_app(self, _ip, _throttle, _perm):
        app = _make_app(org=self.org, sse_enabled=False)
        request = _build_detail_request(
            "put", f"/public/v1/apps/{app.id}/", app, data={"name": "new"}
        )
        response = self.view(request, app_id=app.id)
        assert response.status_code == status.HTTP_403_FORBIDDEN

    @patch("api.views.apps.user_has_permission", return_value=True)
    @patch("api.views.apps.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.apps.IsIPAllowed.has_permission", return_value=True)
    def test_delete_rejects_non_sse_app(self, _ip, _throttle, _perm):
        app = _make_app(org=self.org, sse_enabled=False)
        request = _build_detail_request("delete", f"/public/v1/apps/{app.id}/", app)
        response = self.view(request, app_id=app.id)
        assert response.status_code == status.HTTP_403_FORBIDDEN


# ════════════════════════════════════════════════════════════════════
# RBAC tests
# ════════════════════════════════════════════════════════════════════


class TestAppsAPIRBAC:

    @pytest.fixture(autouse=True)
    def setup(self, settings):
        settings.DATABASES = {
            "default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}
        }
        self.list_view = PublicAppsView.as_view()
        self.detail_view = PublicAppDetailView.as_view()
        self.org = _make_org()
        self.app = _make_app(org=self.org)

    @patch("api.views.apps.user_has_permission", return_value=False)
    @patch("api.views.apps.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.apps.IsIPAllowed.has_permission", return_value=True)
    def test_developer_cannot_create(self, _ip, _throttle, _perm):
        request = _build_list_request(
            "post", "/public/v1/apps/", self.org,
            data={"name": "new-app"},
            role_name="Developer",
        )
        response = self.list_view(request)
        assert response.status_code == status.HTTP_403_FORBIDDEN

    @patch("api.views.apps.user_has_permission", return_value=False)
    @patch("api.views.apps.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.apps.IsIPAllowed.has_permission", return_value=True)
    def test_developer_cannot_delete(self, _ip, _throttle, _perm):
        request = _build_detail_request(
            "delete", f"/public/v1/apps/{self.app.id}/", self.app,
            role_name="Developer",
        )
        response = self.detail_view(request, app_id=self.app.id)
        assert response.status_code == status.HTTP_403_FORBIDDEN

    @patch("api.views.apps.user_has_permission", return_value=False)
    @patch("api.views.apps.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.apps.IsIPAllowed.has_permission", return_value=True)
    def test_developer_cannot_update(self, _ip, _throttle, _perm):
        request = _build_detail_request(
            "put", f"/public/v1/apps/{self.app.id}/", self.app,
            data={"name": "new"},
            role_name="Developer",
        )
        response = self.detail_view(request, app_id=self.app.id)
        assert response.status_code == status.HTTP_403_FORBIDDEN

    @patch("api.views.apps.AppSerializer")
    @patch("api.views.apps.App")
    @patch("api.views.apps.user_has_permission", return_value=True)
    @patch("api.views.apps.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.apps.IsIPAllowed.has_permission", return_value=True)
    def test_owner_can_list(self, _ip, _throttle, _perm, mock_app_model, mock_serializer):
        mock_org_qs = MagicMock()
        mock_filtered = MagicMock()
        mock_filtered.order_by.return_value = []
        mock_org_qs.filter.return_value = mock_filtered
        mock_app_model.objects.filter.return_value = mock_org_qs
        mock_serializer.return_value.data = []

        request = _build_list_request("get", "/public/v1/apps/", self.org, role_name="Owner")
        response = self.list_view(request)
        assert response.status_code == status.HTTP_200_OK
