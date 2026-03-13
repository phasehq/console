import uuid
import pytest
from unittest.mock import Mock, MagicMock, patch, PropertyMock
from rest_framework.test import APIRequestFactory, force_authenticate
from rest_framework import status

from api.views.service_accounts import (
    PublicServiceAccountsView,
    PublicServiceAccountDetailView,
    PublicServiceAccountAccessView,
)


# ────────────────────────────────────────────────────────────────────
# Shared test helpers
# ────────────────────────────────────────────────────────────────────


def _make_org(plan="PR", org_id=None):
    org = Mock()
    org.id = org_id or uuid.uuid4()
    org.plan = plan
    org.organisation_id = org.id
    return org


def _make_role(name="Service", role_id=None, org=None, is_default=True, global_access=False):
    role = Mock()
    role.id = role_id or uuid.uuid4()
    role.name = name
    role.is_default = is_default
    role.organisation = org
    role.permissions = {
        "global_access": global_access,
    }
    return role


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


def _make_service_account(org=None, name="test-sa", sa_id=None, role=None):
    sa = Mock()
    sa.id = sa_id or str(uuid.uuid4())
    sa.name = name
    sa.organisation = org or _make_org()
    sa.organisation_id = sa.organisation.id
    sa.role = role or _make_role(org=sa.organisation)
    sa.identity_key = "aa" * 32
    sa.server_wrapped_keyring = "ph:v1:keyring"
    sa.server_wrapped_recovery = "ph:v1:recovery"
    sa.deleted_at = None
    sa.created_at = "2024-01-01T00:00:00Z"
    sa.updated_at = "2024-01-01T00:00:00Z"
    sa.apps = MagicMock()
    sa.serviceaccounttoken_set = MagicMock()
    sa.save = Mock()
    sa.delete = Mock()
    return sa


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


def _build_list_request(method, url, org, data=None, auth_type="User", role_name="Owner"):
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
        sa = _make_service_account(org=org)

    auth = _make_auth_org_only(
        org,
        auth_type=auth_type,
        org_member=org_member if auth_type == "User" else None,
        service_account=sa,
    )

    force_authenticate(request, user=org_member.user, token=auth)
    return request


def _build_detail_request(method, url, org, data=None, auth_type="User", role_name="Owner"):
    factory = APIRequestFactory()
    if method == "get":
        request = factory.get(url)
    elif method == "put":
        request = factory.put(url, data=data, format="json")
    elif method == "delete":
        request = factory.delete(url)
    else:
        raise ValueError(f"Unknown method: {method}")

    org_member = _make_org_member(org=org, role_name=role_name)

    sa = None
    if auth_type == "ServiceAccount":
        sa = _make_service_account(org=org)

    auth = _make_auth_org_only(
        org,
        auth_type=auth_type,
        org_member=org_member if auth_type == "User" else None,
        service_account=sa,
    )

    force_authenticate(request, user=org_member.user, token=auth)
    return request


# ════════════════════════════════════════════════════════════════════
# Tests for PublicServiceAccountsView — List
# ════════════════════════════════════════════════════════════════════


class TestServiceAccountsList:

    @pytest.fixture(autouse=True)
    def setup(self, settings):
        settings.DATABASES = {
            "default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}
        }
        self.view = PublicServiceAccountsView.as_view()
        self.org = _make_org()

    @patch("api.views.service_accounts.ServiceAccountSerializer")
    @patch("api.views.service_accounts.ServiceAccount")
    @patch("api.views.service_accounts.user_has_permission", return_value=True)
    @patch("api.views.service_accounts.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.service_accounts.IsIPAllowed.has_permission", return_value=True)
    def test_list_returns_200(self, _ip, _throttle, _perm, mock_sa_model, mock_serializer):
        sa1 = _make_service_account(org=self.org, name="sa-one")
        sa2 = _make_service_account(org=self.org, name="sa-two")

        mock_qs = MagicMock()
        mock_related = MagicMock()
        mock_ordered = [sa1, sa2]
        mock_related.order_by.return_value = mock_ordered
        mock_qs.select_related.return_value = mock_related
        mock_sa_model.objects.filter.return_value = mock_qs

        mock_serializer.return_value.data = {"id": "1", "name": "sa-one", "role": None}

        request = _build_list_request("get", "/public/v1/service-accounts/", self.org)
        response = self.view(request)

        assert response.status_code == status.HTTP_200_OK
        assert len(response.data) == 2

    @patch("api.views.service_accounts.user_has_permission", return_value=False)
    @patch("api.views.service_accounts.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.service_accounts.IsIPAllowed.has_permission", return_value=True)
    def test_list_permission_denied(self, _ip, _throttle, _perm):
        request = _build_list_request("get", "/public/v1/service-accounts/", self.org)
        response = self.view(request)
        assert response.status_code == status.HTTP_403_FORBIDDEN


# ════════════════════════════════════════════════════════════════════
# Tests for PublicServiceAccountsView — Create
# ════════════════════════════════════════════════════════════════════


class TestServiceAccountsCreate:

    @pytest.fixture(autouse=True)
    def setup(self, settings):
        settings.DATABASES = {
            "default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}
        }
        settings.APP_HOST = "selfhosted"
        self.view = PublicServiceAccountsView.as_view()
        self.org = _make_org()
        self.role = _make_role(org=self.org)

    @patch("api.views.service_accounts.ServiceAccountSerializer")
    @patch("api.views.service_accounts.ServiceAccountToken")
    @patch("api.views.service_accounts.ServiceAccount")
    @patch("api.views.service_accounts.Role")
    @patch("api.views.service_accounts.generate_server_managed_sa_keys")
    @patch("api.views.service_accounts.decrypt_asymmetric")
    @patch("api.views.service_accounts.ed25519_to_kx", return_value=("kx_pub", "kx_priv"))
    @patch("api.views.service_accounts.random_hex", return_value="aa" * 32)
    @patch("api.views.service_accounts.split_secret_hex", return_value=("share_a", "share_b"))
    @patch("api.views.service_accounts.wrap_share_hex", return_value="wrapped")
    @patch("api.views.service_accounts.get_server_keypair", return_value=(b"\x00" * 32, b"\x01" * 32))
    @patch("api.views.service_accounts.user_has_permission", return_value=True)
    @patch("api.views.service_accounts.role_has_global_access", return_value=False)
    @patch("api.views.service_accounts.transaction")
    @patch("api.views.service_accounts.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.service_accounts.IsIPAllowed.has_permission", return_value=True)
    def test_create_returns_201(
        self, _ip, _throttle, _tx, _global, _perm, _server_kp, _wrap, _split,
        _rand, _kx, _decrypt, _gen_keys, mock_role_model, mock_sa_model,
        mock_sat_model, mock_serializer,
    ):
        role = self.role
        mock_role_model.objects.get.return_value = role

        _gen_keys.return_value = ("identity_key", "wrapped_keyring", "wrapped_recovery")
        _decrypt.return_value = '{"publicKey": "aabb", "privateKey": "ccdd"}'

        sa = _make_service_account(org=self.org, role=role)
        mock_sa_model.objects.create.return_value = sa

        mock_serializer.return_value.data = {
            "id": str(sa.id),
            "name": sa.name,
            "role": {"id": str(role.id), "name": role.name},
        }

        request = _build_list_request(
            "post",
            "/public/v1/service-accounts/",
            self.org,
            data={"name": "new-sa", "role_id": str(role.id)},
        )
        response = self.view(request)

        assert response.status_code == status.HTTP_201_CREATED
        assert "token" in response.data
        assert "bearer_token" in response.data

    @patch("api.views.service_accounts.user_has_permission", return_value=True)
    @patch("api.views.service_accounts.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.service_accounts.IsIPAllowed.has_permission", return_value=True)
    def test_create_missing_name_returns_400(self, _ip, _throttle, _perm):
        request = _build_list_request(
            "post",
            "/public/v1/service-accounts/",
            self.org,
            data={"role_id": str(uuid.uuid4())},
        )
        response = self.view(request)
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    @patch("api.views.service_accounts.user_has_permission", return_value=True)
    @patch("api.views.service_accounts.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.service_accounts.IsIPAllowed.has_permission", return_value=True)
    def test_create_missing_role_returns_400(self, _ip, _throttle, _perm):
        request = _build_list_request(
            "post",
            "/public/v1/service-accounts/",
            self.org,
            data={"name": "test-sa"},
        )
        response = self.view(request)
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    @patch("api.views.service_accounts.Role")
    @patch("api.views.service_accounts.role_has_global_access", return_value=True)
    @patch("api.views.service_accounts.user_has_permission", return_value=True)
    @patch("api.views.service_accounts.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.service_accounts.IsIPAllowed.has_permission", return_value=True)
    def test_create_global_role_returns_400(self, _ip, _throttle, _perm, _global, mock_role):
        admin_role = _make_role(name="Admin", org=self.org, global_access=True)
        mock_role.objects.get.return_value = admin_role

        request = _build_list_request(
            "post",
            "/public/v1/service-accounts/",
            self.org,
            data={"name": "test-sa", "role_id": str(admin_role.id)},
        )
        response = self.view(request)
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "Admin" in response.data["error"]

    @patch("api.views.service_accounts.user_has_permission", return_value=True)
    @patch("api.views.service_accounts.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.service_accounts.IsIPAllowed.has_permission", return_value=True)
    def test_create_name_too_long_returns_400(self, _ip, _throttle, _perm):
        request = _build_list_request(
            "post",
            "/public/v1/service-accounts/",
            self.org,
            data={"name": "A" * 65, "role_id": str(uuid.uuid4())},
        )
        response = self.view(request)
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "64" in response.data["error"]

    @patch("api.views.service_accounts.Role")
    @patch("api.views.service_accounts.user_has_permission", return_value=True)
    @patch("api.views.service_accounts.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.service_accounts.IsIPAllowed.has_permission", return_value=True)
    def test_create_role_not_found_returns_404(self, _ip, _throttle, _perm, mock_role):
        from django.core.exceptions import ObjectDoesNotExist

        mock_role.objects.get.side_effect = ObjectDoesNotExist

        request = _build_list_request(
            "post",
            "/public/v1/service-accounts/",
            self.org,
            data={"name": "test-sa", "role_id": str(uuid.uuid4())},
        )
        response = self.view(request)
        assert response.status_code == status.HTTP_404_NOT_FOUND


# ════════════════════════════════════════════════════════════════════
# Tests for PublicServiceAccountDetailView — Get / Update / Delete
# ════════════════════════════════════════════════════════════════════


class TestServiceAccountDetail:

    @pytest.fixture(autouse=True)
    def setup(self, settings):
        settings.DATABASES = {
            "default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}
        }
        settings.APP_HOST = "selfhosted"
        self.view = PublicServiceAccountDetailView.as_view()
        self.org = _make_org()

    @patch("api.views.service_accounts.EnvironmentKey")
    @patch("api.views.service_accounts.ServiceAccount")
    @patch("api.views.service_accounts.user_has_permission", return_value=True)
    @patch("api.views.service_accounts.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.service_accounts.IsIPAllowed.has_permission", return_value=True)
    def test_get_returns_200(self, _ip, _throttle, _perm, mock_sa_model, _ek):
        sa = _make_service_account(org=self.org)
        sa.serviceaccounttoken_set.filter.return_value.order_by.return_value = []
        sa.apps.filter.return_value.order_by.return_value = []
        mock_sa_model.objects.select_related.return_value.get.return_value = sa

        request = _build_detail_request("get", f"/public/v1/service-accounts/{sa.id}/", self.org)
        response = self.view(request, sa_id=str(sa.id))

        assert response.status_code == status.HTTP_200_OK
        assert response.data["name"] == sa.name

    @patch("api.views.service_accounts.ServiceAccount")
    @patch("api.views.service_accounts.user_has_permission", return_value=True)
    @patch("api.views.service_accounts.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.service_accounts.IsIPAllowed.has_permission", return_value=True)
    def test_get_not_found_returns_404(self, _ip, _throttle, _perm, mock_sa_model):
        from django.core.exceptions import ObjectDoesNotExist

        mock_sa_model.objects.select_related.return_value.get.side_effect = ObjectDoesNotExist

        request = _build_detail_request("get", "/public/v1/service-accounts/bad/", self.org)
        response = self.view(request, sa_id="bad")

        assert response.status_code == status.HTTP_404_NOT_FOUND

    @patch("api.views.service_accounts.EnvironmentKey")
    @patch("api.views.service_accounts.ServiceAccount")
    @patch("api.views.service_accounts.Role")
    @patch("api.views.service_accounts.role_has_global_access", return_value=False)
    @patch("api.views.service_accounts.user_has_permission", return_value=True)
    @patch("api.views.service_accounts.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.service_accounts.IsIPAllowed.has_permission", return_value=True)
    def test_update_name_returns_200(self, _ip, _throttle, _perm, _global, mock_role, mock_sa_model, _ek):
        sa = _make_service_account(org=self.org)
        sa.serviceaccounttoken_set.filter.return_value.order_by.return_value = []
        sa.apps.filter.return_value.order_by.return_value = []
        mock_sa_model.objects.select_related.return_value.get.return_value = sa

        request = _build_detail_request(
            "put", f"/public/v1/service-accounts/{sa.id}/", self.org,
            data={"name": "renamed-sa"},
        )
        response = self.view(request, sa_id=str(sa.id))

        assert response.status_code == status.HTTP_200_OK
        assert sa.name == "renamed-sa"
        sa.save.assert_called_once()

    @patch("api.views.service_accounts.ServiceAccount")
    @patch("api.views.service_accounts.user_has_permission", return_value=True)
    @patch("api.views.service_accounts.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.service_accounts.IsIPAllowed.has_permission", return_value=True)
    def test_update_no_fields_returns_400(self, _ip, _throttle, _perm, mock_sa_model):
        sa = _make_service_account(org=self.org)
        mock_sa_model.objects.select_related.return_value.get.return_value = sa

        request = _build_detail_request(
            "put", f"/public/v1/service-accounts/{sa.id}/", self.org,
            data={},
        )
        response = self.view(request, sa_id=str(sa.id))

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    @patch("api.views.service_accounts.ServiceAccount")
    @patch("api.views.service_accounts.user_has_permission", return_value=True)
    @patch("api.views.service_accounts.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.service_accounts.IsIPAllowed.has_permission", return_value=True)
    def test_delete_returns_204(self, _ip, _throttle, _perm, mock_sa_model):
        sa = _make_service_account(org=self.org)
        mock_sa_model.objects.select_related.return_value.get.return_value = sa

        request = _build_detail_request("delete", f"/public/v1/service-accounts/{sa.id}/", self.org)
        response = self.view(request, sa_id=str(sa.id))

        assert response.status_code == status.HTTP_204_NO_CONTENT
        sa.delete.assert_called_once()

    @patch("api.views.service_accounts.ServiceAccount")
    @patch("api.views.service_accounts.user_has_permission", return_value=True)
    @patch("api.views.service_accounts.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.service_accounts.IsIPAllowed.has_permission", return_value=True)
    def test_delete_not_found_returns_404(self, _ip, _throttle, _perm, mock_sa_model):
        from django.core.exceptions import ObjectDoesNotExist

        mock_sa_model.objects.select_related.return_value.get.side_effect = ObjectDoesNotExist

        request = _build_detail_request("delete", "/public/v1/service-accounts/bad/", self.org)
        response = self.view(request, sa_id="bad")

        assert response.status_code == status.HTTP_404_NOT_FOUND

    @patch("api.views.service_accounts.user_has_permission", return_value=False)
    @patch("api.views.service_accounts.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.service_accounts.IsIPAllowed.has_permission", return_value=True)
    def test_delete_permission_denied(self, _ip, _throttle, _perm):
        request = _build_detail_request(
            "delete", "/public/v1/service-accounts/some-id/", self.org
        )
        response = self.view(request, sa_id="some-id")

        assert response.status_code == status.HTTP_403_FORBIDDEN

    @patch("api.views.service_accounts.ServiceAccount")
    @patch("api.views.service_accounts.user_has_permission", return_value=True)
    @patch("api.views.service_accounts.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.service_accounts.IsIPAllowed.has_permission", return_value=True)
    def test_update_blank_name_returns_400(self, _ip, _throttle, _perm, mock_sa_model):
        sa = _make_service_account(org=self.org)
        mock_sa_model.objects.select_related.return_value.get.return_value = sa

        request = _build_detail_request(
            "put", f"/public/v1/service-accounts/{sa.id}/", self.org,
            data={"name": "   "},
        )
        response = self.view(request, sa_id=str(sa.id))

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    @patch("api.views.service_accounts.ServiceAccount")
    @patch("api.views.service_accounts.Role")
    @patch("api.views.service_accounts.role_has_global_access", return_value=True)
    @patch("api.views.service_accounts.user_has_permission", return_value=True)
    @patch("api.views.service_accounts.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.service_accounts.IsIPAllowed.has_permission", return_value=True)
    def test_update_global_role_returns_400(self, _ip, _throttle, _perm, _global, mock_role, mock_sa_model):
        sa = _make_service_account(org=self.org)
        mock_sa_model.objects.select_related.return_value.get.return_value = sa

        admin_role = _make_role(name="Admin", org=self.org, global_access=True)
        mock_role.objects.get.return_value = admin_role

        request = _build_detail_request(
            "put", f"/public/v1/service-accounts/{sa.id}/", self.org,
            data={"role_id": str(admin_role.id)},
        )
        response = self.view(request, sa_id=str(sa.id))

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "Admin" in response.data["error"]
