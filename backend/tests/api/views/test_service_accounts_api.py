import uuid
import pytest
from unittest.mock import Mock, MagicMock, patch, PropertyMock
from rest_framework.test import APIRequestFactory, force_authenticate
from rest_framework import status

from api.views.service_accounts import (
    PublicServiceAccountsView,
    PublicServiceAccountDetailView,
    PublicServiceAccountAccessView,
    PublicServiceAccountTokensView,
    PublicServiceAccountTokenDetailView,
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
    # Default to org-level (no team) so existing tests don't hit team-
    # owned access checks. Tests covering team-owned SAs override this.
    sa.team = None
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


# ════════════════════════════════════════════════════════════════════
# Tests for PublicServiceAccountTokensView / TokenDetailView — team scoping
# ════════════════════════════════════════════════════════════════════


class TestServiceAccountTokensTeamScoping:
    """Non-team-members (other than Owner / Admin) must not be able to
    create or delete tokens for a team-owned service account. The view
    returns 404 (not 403) so SA existence isn't leaked across team
    boundaries — same convention as the detail and access views."""

    @pytest.fixture(autouse=True)
    def setup(self, settings):
        settings.AUTHENTICATION_BACKENDS = ['api.auth.PhaseTokenAuthentication']
        self.org = _make_org()
        self.post_view = PublicServiceAccountTokensView.as_view()
        self.delete_view = PublicServiceAccountTokenDetailView.as_view()

    def _team_owned_sa(self):
        sa = _make_service_account(org=self.org)
        sa.team = Mock()
        sa.team.id = uuid.uuid4()
        sa.team.deleted_at = None
        return sa

    @patch("api.views.service_accounts._caller_can_manage_sa_tokens", return_value=False)
    @patch("api.views.service_accounts.ServiceAccount")
    @patch("api.views.service_accounts.user_has_permission", return_value=True)
    @patch("api.views.service_accounts.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.service_accounts.IsIPAllowed.has_permission", return_value=True)
    def test_create_token_non_team_member_returns_404(
        self, _ip, _throttle, _perm, mock_sa_model, _can_access
    ):
        sa = self._team_owned_sa()
        mock_sa_model.objects.get.return_value = sa

        request = _build_list_request(
            "post",
            f"/public/v1/service-accounts/{sa.id}/tokens/",
            self.org,
            data={"name": "new-token"},
        )
        response = self.post_view(request, sa_id=str(sa.id))

        assert response.status_code == status.HTTP_404_NOT_FOUND
        # Body must not reveal the SA's existence.
        assert "not found" in response.data["error"].lower()

    @patch("api.views.service_accounts._caller_can_manage_sa_tokens", return_value=False)
    @patch("api.views.service_accounts.ServiceAccount")
    @patch("api.views.service_accounts.user_has_permission", return_value=True)
    @patch("api.views.service_accounts.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.service_accounts.IsIPAllowed.has_permission", return_value=True)
    def test_delete_token_non_team_member_returns_404(
        self, _ip, _throttle, _perm, mock_sa_model, _can_access
    ):
        sa = self._team_owned_sa()
        mock_sa_model.objects.get.return_value = sa
        fake_token_id = str(uuid.uuid4())

        request = _build_detail_request(
            "delete",
            f"/public/v1/service-accounts/{sa.id}/tokens/{fake_token_id}/",
            self.org,
        )
        response = self.delete_view(request, sa_id=str(sa.id), token_id=fake_token_id)

        assert response.status_code == status.HTTP_404_NOT_FOUND
        assert "not found" in response.data["error"].lower()

    @patch("api.views.service_accounts._caller_can_manage_sa_tokens", return_value=False)
    @patch("api.views.service_accounts.ServiceAccount")
    @patch("api.views.service_accounts.user_has_permission", return_value=True)
    @patch("api.views.service_accounts.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.service_accounts.IsIPAllowed.has_permission", return_value=True)
    def test_create_token_non_team_member_does_not_mint(
        self, _ip, _throttle, _perm, mock_sa_model, _can_access
    ):
        """Belt-and-suspenders: the 404 must short-circuit before the
        SSK keyring is touched, so a non-team-member can't even
        accidentally trigger token generation."""
        sa = self._team_owned_sa()
        mock_sa_model.objects.get.return_value = sa

        with patch("api.views.service_accounts._mint_sa_token") as mint:
            request = _build_list_request(
                "post",
                f"/public/v1/service-accounts/{sa.id}/tokens/",
                self.org,
                data={"name": "new-token"},
            )
            response = self.post_view(request, sa_id=str(sa.id))

        assert response.status_code == status.HTTP_404_NOT_FOUND
        mint.assert_not_called()

    @patch("api.views.service_accounts.user_has_permission", return_value=False)
    @patch("api.views.service_accounts.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.service_accounts.IsIPAllowed.has_permission", return_value=True)
    def test_create_token_missing_org_permission_returns_403(
        self, _ip, _throttle, _perm
    ):
        sa_id = str(uuid.uuid4())
        request = _build_list_request(
            "post",
            f"/public/v1/service-accounts/{sa_id}/tokens/",
            self.org,
            data={"name": "new-token"},
        )
        response = self.post_view(request, sa_id=sa_id)

        assert response.status_code == status.HTTP_403_FORBIDDEN

    @patch("api.views.service_accounts.user_has_permission", return_value=False)
    @patch("api.views.service_accounts.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.service_accounts.IsIPAllowed.has_permission", return_value=True)
    def test_delete_token_missing_org_permission_returns_403(
        self, _ip, _throttle, _perm
    ):
        sa_id = str(uuid.uuid4())
        token_id = str(uuid.uuid4())
        request = _build_detail_request(
            "delete",
            f"/public/v1/service-accounts/{sa_id}/tokens/{token_id}/",
            self.org,
        )
        response = self.delete_view(request, sa_id=sa_id, token_id=token_id)

        assert response.status_code == status.HTTP_403_FORBIDDEN


# ════════════════════════════════════════════════════════════════════
# PublicServiceAccountTokensView — caller-scope (P1-2)
#
# `ServiceAccountTokens:create` is an org-level permission, but minting
# a token for an SA inherits that SA's access. A non-global Manager (or
# any SA) must NOT be able to mint a bearer for a sibling SA they don't
# otherwise control — otherwise it's a lateral-takeover primitive.
# ════════════════════════════════════════════════════════════════════


class TestServiceAccountTokensCallerScope:

    @pytest.fixture(autouse=True)
    def setup(self, settings):
        self.org = _make_org()
        self.post_view = PublicServiceAccountTokensView.as_view()
        self.delete_view = PublicServiceAccountTokenDetailView.as_view()

    @patch("api.views.service_accounts.role_has_global_access", return_value=False)
    @patch("api.views.service_accounts.ServiceAccount")
    @patch("api.views.service_accounts.user_has_permission", return_value=True)
    @patch("api.views.service_accounts.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.service_accounts.IsIPAllowed.has_permission", return_value=True)
    def test_sa_cannot_mint_token_for_unrelated_org_sa(
        self, _ip, _throttle, _perm, mock_sa_model, _no_global
    ):
        # Target: org-level SA owned by no team.
        target = _make_service_account(org=self.org, name="victim-sa")
        target.team = None
        mock_sa_model.objects.get.return_value = target

        request = _build_list_request(
            "post",
            f"/public/v1/service-accounts/{target.id}/tokens/",
            self.org,
            data={"name": "lateral-take"},
            auth_type="ServiceAccount",
        )
        with patch("api.views.service_accounts._mint_sa_token") as mint:
            response = self.post_view(request, sa_id=str(target.id))

        assert response.status_code == status.HTTP_404_NOT_FOUND
        mint.assert_not_called()

    @patch("api.views.service_accounts.role_has_global_access", return_value=False)
    @patch("api.views.service_accounts.ServiceAccount")
    @patch("api.views.service_accounts.user_has_permission", return_value=True)
    @patch("api.views.service_accounts.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.service_accounts.IsIPAllowed.has_permission", return_value=True)
    def test_non_global_user_cannot_mint_token_for_org_sa(
        self, _ip, _throttle, _perm, mock_sa_model, _no_global
    ):
        target = _make_service_account(org=self.org, name="victim-sa")
        target.team = None
        mock_sa_model.objects.get.return_value = target

        request = _build_list_request(
            "post",
            f"/public/v1/service-accounts/{target.id}/tokens/",
            self.org,
            data={"name": "manager-lateral"},
            auth_type="User",
            role_name="Manager",
        )
        with patch("api.views.service_accounts._mint_sa_token") as mint:
            response = self.post_view(request, sa_id=str(target.id))

        assert response.status_code == status.HTTP_404_NOT_FOUND
        mint.assert_not_called()


# ════════════════════════════════════════════════════════════════════
# PublicServiceAccountTokensView — expires_in validation (P1-10)
#
# Token expiry comes in as `expires_in` (positive integer seconds).
# `expires_at` and the legacy `expiry` field are explicitly rejected —
# previously the endpoint silently dropped unrecognised input and
# minted a never-expiring token.
# ════════════════════════════════════════════════════════════════════


class TestServiceAccountTokensExpiresInValidation:

    @pytest.fixture(autouse=True)
    def setup(self, settings):
        self.org = _make_org()
        self.post_view = PublicServiceAccountTokensView.as_view()

    def _wire_target_sa(self, mock_sa_model):
        sa = _make_service_account(org=self.org, name="target-sa")
        sa.team = None
        sa.server_wrapped_keyring = "ph:v1:ring"
        sa.identity_key = "00" * 32
        mock_sa_model.objects.get.return_value = sa
        return sa

    def _post(self, sa_id, data):
        return _build_list_request(
            "post", f"/public/v1/service-accounts/{sa_id}/tokens/", self.org,
            data=data,
        )

    @patch("api.views.service_accounts._caller_can_manage_sa_tokens", return_value=True)
    @patch("api.views.service_accounts.ServiceAccount")
    @patch("api.views.service_accounts.user_has_permission", return_value=True)
    @patch("api.views.service_accounts.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.service_accounts.IsIPAllowed.has_permission", return_value=True)
    def test_expires_at_rejected(self, _ip, _throttle, _perm, mock_sa_model, _scope):
        sa = self._wire_target_sa(mock_sa_model)
        request = self._post(sa.id, {"name": "t", "expires_at": "2020-01-01T00:00:00Z"})
        with patch("api.views.service_accounts._mint_sa_token") as mint:
            response = self.post_view(request, sa_id=str(sa.id))
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "expires_in" in response.data["error"]
        mint.assert_not_called()

    @patch("api.views.service_accounts._caller_can_manage_sa_tokens", return_value=True)
    @patch("api.views.service_accounts.ServiceAccount")
    @patch("api.views.service_accounts.user_has_permission", return_value=True)
    @patch("api.views.service_accounts.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.service_accounts.IsIPAllowed.has_permission", return_value=True)
    def test_legacy_expiry_field_rejected(self, _ip, _throttle, _perm, mock_sa_model, _scope):
        sa = self._wire_target_sa(mock_sa_model)
        request = self._post(sa.id, {"name": "t", "expiry": 1700000000000})
        with patch("api.views.service_accounts._mint_sa_token") as mint:
            response = self.post_view(request, sa_id=str(sa.id))
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "expires_in" in response.data["error"]
        mint.assert_not_called()

    @pytest.mark.parametrize("bad_value", [-1, 0, "24h", "3600", 1.5, True, [3600]])
    @patch("api.views.service_accounts._caller_can_manage_sa_tokens", return_value=True)
    @patch("api.views.service_accounts.ServiceAccount")
    @patch("api.views.service_accounts.user_has_permission", return_value=True)
    @patch("api.views.service_accounts.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.service_accounts.IsIPAllowed.has_permission", return_value=True)
    def test_invalid_expires_in_rejected(
        self, _ip, _throttle, _perm, mock_sa_model, _scope, bad_value
    ):
        sa = self._wire_target_sa(mock_sa_model)
        request = self._post(sa.id, {"name": "t", "expires_in": bad_value})
        with patch("api.views.service_accounts._mint_sa_token") as mint:
            response = self.post_view(request, sa_id=str(sa.id))
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "positive integer" in response.data["error"]
        mint.assert_not_called()

    @patch("api.views.service_accounts._caller_can_manage_sa_tokens", return_value=True)
    @patch("api.views.service_accounts.ServiceAccount")
    @patch("api.views.service_accounts.user_has_permission", return_value=True)
    @patch("api.views.service_accounts.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.service_accounts.IsIPAllowed.has_permission", return_value=True)
    def test_valid_expires_in_passes_absolute_datetime(
        self, _ip, _throttle, _perm, mock_sa_model, _scope
    ):
        """`expires_in` seconds must be converted to an absolute datetime
        ~now+seconds and handed to `_mint_sa_token` so it lands in the DB."""
        from django.utils import timezone
        sa = self._wire_target_sa(mock_sa_model)
        request = self._post(sa.id, {"name": "t", "expires_in": 3600})

        minted = Mock()
        minted.id = uuid.uuid4()
        minted.name = "t"
        minted.created_at = "2026-01-01T00:00:00Z"
        minted.expires_at = "2026-01-01T01:00:00Z"

        with patch(
            "api.views.service_accounts._mint_sa_token",
            return_value=(minted, "full", "bearer"),
        ) as mint, patch(
            "api.views.service_accounts.log_audit_event"
        ):
            before = timezone.now()
            response = self.post_view(request, sa_id=str(sa.id))
            after = timezone.now()

        assert response.status_code == status.HTTP_201_CREATED
        mint.assert_called_once()
        passed_expires_at = mint.call_args.kwargs["expires_at"]
        assert passed_expires_at is not None
        # Allow ~1s slack for execution; lower bound = before+3600, upper = after+3600.
        from datetime import timedelta
        assert before + timedelta(seconds=3600) <= passed_expires_at <= after + timedelta(seconds=3600)

    @patch("api.views.service_accounts._caller_can_manage_sa_tokens", return_value=True)
    @patch("api.views.service_accounts.ServiceAccount")
    @patch("api.views.service_accounts.user_has_permission", return_value=True)
    @patch("api.views.service_accounts.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.service_accounts.IsIPAllowed.has_permission", return_value=True)
    def test_no_expires_in_means_no_expiry(
        self, _ip, _throttle, _perm, mock_sa_model, _scope
    ):
        sa = self._wire_target_sa(mock_sa_model)
        request = self._post(sa.id, {"name": "t"})  # no expires_in

        minted = Mock()
        minted.id = uuid.uuid4()
        minted.name = "t"
        minted.created_at = "2026-01-01T00:00:00Z"
        minted.expires_at = None

        with patch(
            "api.views.service_accounts._mint_sa_token",
            return_value=(minted, "full", "bearer"),
        ) as mint, patch(
            "api.views.service_accounts.log_audit_event"
        ):
            response = self.post_view(request, sa_id=str(sa.id))

        assert response.status_code == status.HTTP_201_CREATED
        assert mint.call_args.kwargs["expires_at"] is None
