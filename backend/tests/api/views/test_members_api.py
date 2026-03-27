import uuid
import pytest
from unittest.mock import Mock, MagicMock, patch
from django.core.exceptions import ObjectDoesNotExist
from rest_framework.test import APIRequestFactory, force_authenticate
from rest_framework import status

from api.views.members import (
    PublicMembersView,
    PublicMemberDetailView,
    PublicMemberAccessView,
    PublicInvitesView,
    PublicInviteDetailView,
)


# ────────────────────────────────────────────────────────────────────
# Shared test helpers
# ────────────────────────────────────────────────────────────────────


def _make_org(plan="PR"):
    org = Mock()
    org.id = uuid.uuid4()
    org.plan = plan
    org.organisation_id = org.id
    return org


def _make_role(name="Developer"):
    role = Mock()
    role.id = uuid.uuid4()
    role.name = name
    return role


def _make_user(email="actor@example.com"):
    user = Mock()
    user.userId = uuid.uuid4()
    user.id = user.userId
    user.email = email
    user.username = email.split("@")[0]
    user.is_authenticated = True
    user.is_active = True
    return user


def _make_org_member(org=None, role_name="Owner", email="actor@example.com"):
    org = org or _make_org()
    member = Mock()
    member.id = uuid.uuid4()
    member.user = _make_user(email)
    member.organisation = org
    member.deleted_at = None
    member.role = _make_role(role_name)
    member.apps = MagicMock()
    member.identity_key = "ab" * 32
    member.created_at = "2025-01-01T00:00:00Z"
    member.updated_at = "2025-01-01T00:00:00Z"
    return member


def _make_sa(org=None):
    sa = Mock()
    sa.id = uuid.uuid4()
    sa.name = "deploy-bot"
    org = org or _make_org()
    sa.organisation = org
    sa.organisation_id = org.id
    sa.apps = MagicMock()
    return sa


def _make_auth(org, auth_type="User", org_member=None, service_account=None):
    return {
        "token": "Bearer test_token",
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


def _build_request(method, url, org, data=None, auth_type="User", role_name="Owner", acting_member=None):
    factory = APIRequestFactory()
    if method == "get":
        request = factory.get(url)
    elif method == "post":
        request = factory.post(url, data=data or {}, format="json")
    elif method == "put":
        request = factory.put(url, data=data or {}, format="json")
    elif method == "delete":
        request = factory.delete(url)
    else:
        raise ValueError(f"Unknown method: {method}")

    if acting_member is None:
        acting_member = _make_org_member(org=org, role_name=role_name)
    sa = _make_sa(org) if auth_type == "ServiceAccount" else None
    auth = _make_auth(
        org,
        auth_type=auth_type,
        org_member=acting_member if auth_type == "User" else None,
        service_account=sa,
    )
    force_authenticate(request, user=acting_member.user, token=auth)
    return request, acting_member, sa


# ════════════════════════════════════════════════════════════════════
# PublicMembersView — List
# ════════════════════════════════════════════════════════════════════


class TestPublicMembersViewList:

    @pytest.fixture(autouse=True)
    def setup(self, settings):
        settings.DATABASES = {
            "default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}
        }
        self.view = PublicMembersView.as_view()
        self.org = _make_org()

    @patch("api.views.members.OrganisationMemberSerializer")
    @patch("api.views.members.OrganisationMember")
    @patch("api.views.members.user_has_permission", return_value=True)
    @patch("api.views.members.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.members.IsIPAllowed.has_permission", return_value=True)
    def test_list_success(self, _ip, _throttle, _perm, mock_member_model, mock_serializer):
        m1 = _make_org_member(org=self.org)
        m2 = _make_org_member(org=self.org)
        qs = MagicMock()
        qs.filter.return_value.order_by.return_value = [m1, m2]
        mock_member_model.objects.select_related.return_value = qs
        mock_serializer.return_value.data = [{"id": str(m1.id)}, {"id": str(m2.id)}]

        request, _, _ = _build_request("get", "/public/v1/members/", self.org)
        response = self.view(request)

        assert response.status_code == status.HTTP_200_OK
        assert len(response.data) == 2

    @patch("api.views.members.OrganisationMemberSerializer")
    @patch("api.views.members.OrganisationMember")
    @patch("api.views.members.user_has_permission", return_value=True)
    @patch("api.views.members.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.members.IsIPAllowed.has_permission", return_value=True)
    def test_list_empty(self, _ip, _throttle, _perm, mock_member_model, mock_serializer):
        qs = MagicMock()
        qs.filter.return_value.order_by.return_value = []
        mock_member_model.objects.select_related.return_value = qs
        mock_serializer.return_value.data = []

        request, _, _ = _build_request("get", "/public/v1/members/", self.org)
        response = self.view(request)

        assert response.status_code == status.HTTP_200_OK
        assert response.data == []

    @patch("api.views.members.user_has_permission", return_value=False)
    @patch("api.views.members.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.members.IsIPAllowed.has_permission", return_value=True)
    def test_list_no_permission_returns_403(self, _ip, _throttle, _perm):
        request, _, _ = _build_request("get", "/public/v1/members/", self.org, role_name="Developer")
        response = self.view(request)
        assert response.status_code == status.HTTP_403_FORBIDDEN


# ════════════════════════════════════════════════════════════════════
# PublicMembersView — Invite
# ════════════════════════════════════════════════════════════════════


class TestPublicMembersViewInvite:

    @pytest.fixture(autouse=True)
    def setup(self, settings):
        settings.DATABASES = {
            "default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}
        }
        self.view = PublicMembersView.as_view()
        self.org = _make_org()
        self.role = _make_role("Developer")

    def _mock_invite(self, role=None):
        invite = Mock()
        invite.id = uuid.uuid4()
        invite.invitee_email = "new@example.com"
        invite.role = role or self.role
        invite.invited_by = None
        invite.invited_by_service_account = None
        invite.apps = MagicMock()
        invite.created_at = "2025-01-01T00:00:00Z"
        invite.expires_at = "2025-01-15T00:00:00Z"
        invite.valid = True
        return invite

    @patch("api.views.members.OrganisationMemberInviteSerializer")
    @patch("api.views.members.log_audit_event")
    @patch("api.views.members.get_actor_info", return_value=("user", "uid", {}))
    @patch("api.views.members.get_resolver_request_meta", return_value=("127.0.0.1", "pytest"))
    @patch("api.tasks.emails.send_invite_email_job")
    @patch("api.views.members.can_add_account", return_value=True)
    @patch("api.views.members.OrganisationMemberInvite")
    @patch("api.views.members.OrganisationMember")
    @patch("api.views.members.App")
    @patch("api.views.members.Role")
    @patch("api.views.members.role_has_permission", return_value=False)
    @patch("api.views.members.role_has_global_access", return_value=False)
    @patch("api.views.members.user_has_permission", return_value=True)
    @patch("api.views.members.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.members.IsIPAllowed.has_permission", return_value=True)
    def test_invite_success_user_auth(
        self, _ip, _throttle, _perm, _global, _role_perm,
        mock_role_model, mock_app_model, mock_member_model, mock_invite_model,
        _quota, _email, _meta, _actor, _audit, mock_serializer,
    ):
        invite = self._mock_invite()
        mock_role_model.objects.get.return_value = self.role
        mock_member_model.objects.filter.return_value.exists.return_value = False
        mock_invite_model.objects.filter.return_value.exists.return_value = False
        mock_invite_model.objects.create.return_value = invite
        mock_app_model.objects.filter.return_value = []
        mock_serializer.return_value.data = {"id": str(invite.id), "inviteeEmail": "new@example.com"}

        request, acting_member, _ = _build_request(
            "post", "/public/v1/members/", self.org,
            data={"email": "new@example.com", "role_id": str(self.role.id)},
        )
        response = self.view(request)

        assert response.status_code == status.HTTP_201_CREATED
        create_kwargs = mock_invite_model.objects.create.call_args[1]
        assert create_kwargs["invited_by"] == acting_member
        assert create_kwargs["invited_by_service_account"] is None

    @patch("api.views.members.OrganisationMemberInviteSerializer")
    @patch("api.views.members.log_audit_event")
    @patch("api.views.members.get_actor_info", return_value=("sa", "sa-id", {"name": "deploy-bot"}))
    @patch("api.views.members.get_resolver_request_meta", return_value=("127.0.0.1", "pytest"))
    @patch("api.tasks.emails.send_invite_email_job")
    @patch("api.views.members.can_add_account", return_value=True)
    @patch("api.views.members.OrganisationMemberInvite")
    @patch("api.views.members.OrganisationMember")
    @patch("api.views.members.App")
    @patch("api.views.members.Role")
    @patch("api.views.members.role_has_permission", return_value=False)
    @patch("api.views.members.role_has_global_access", return_value=False)
    @patch("api.views.members.user_has_permission", return_value=True)
    @patch("api.views.members.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.members.IsIPAllowed.has_permission", return_value=True)
    def test_invite_success_sa_auth(
        self, _ip, _throttle, _perm, _global, _role_perm,
        mock_role_model, mock_app_model, mock_member_model, mock_invite_model,
        _quota, _email, _meta, _actor, _audit, mock_serializer,
    ):
        invite = self._mock_invite()
        mock_role_model.objects.get.return_value = self.role
        mock_member_model.objects.filter.return_value.exists.return_value = False
        mock_invite_model.objects.filter.return_value.exists.return_value = False
        mock_invite_model.objects.create.return_value = invite
        mock_app_model.objects.filter.return_value = []
        mock_serializer.return_value.data = {"id": str(invite.id)}

        request, _, sa = _build_request(
            "post", "/public/v1/members/", self.org,
            data={"email": "new@example.com", "role_id": str(self.role.id)},
            auth_type="ServiceAccount",
        )
        response = self.view(request)

        assert response.status_code == status.HTTP_201_CREATED
        create_kwargs = mock_invite_model.objects.create.call_args[1]
        assert create_kwargs["invited_by"] is None
        assert create_kwargs["invited_by_service_account"] == sa

    @patch("api.views.members.user_has_permission", return_value=True)
    @patch("api.views.members.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.members.IsIPAllowed.has_permission", return_value=True)
    def test_invite_missing_email_returns_400(self, _ip, _throttle, _perm):
        request, _, _ = _build_request(
            "post", "/public/v1/members/", self.org,
            data={"role_id": str(self.role.id)},
        )
        response = self.view(request)
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "email" in response.data["error"]

    @patch("api.views.members.user_has_permission", return_value=True)
    @patch("api.views.members.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.members.IsIPAllowed.has_permission", return_value=True)
    def test_invite_missing_role_id_returns_400(self, _ip, _throttle, _perm):
        request, _, _ = _build_request(
            "post", "/public/v1/members/", self.org,
            data={"email": "new@example.com"},
        )
        response = self.view(request)
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "role_id" in response.data["error"]

    @patch("api.views.members.Role")
    @patch("api.views.members.user_has_permission", return_value=True)
    @patch("api.views.members.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.members.IsIPAllowed.has_permission", return_value=True)
    def test_invite_role_not_found_returns_404(self, _ip, _throttle, _perm, mock_role_model):
        from api.models import Role
        mock_role_model.DoesNotExist = Role.DoesNotExist
        mock_role_model.objects.get.side_effect = Role.DoesNotExist

        request, _, _ = _build_request(
            "post", "/public/v1/members/", self.org,
            data={"email": "new@example.com", "role_id": str(uuid.uuid4())},
        )
        response = self.view(request)
        assert response.status_code == status.HTTP_404_NOT_FOUND

    @patch("api.views.members.Role")
    @patch("api.views.members.role_has_global_access", return_value=True)
    @patch("api.views.members.user_has_permission", return_value=True)
    @patch("api.views.members.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.members.IsIPAllowed.has_permission", return_value=True)
    def test_invite_global_access_role_blocked_returns_400(self, _ip, _throttle, _perm, _global, mock_role_model):
        admin_role = _make_role("Admin")
        mock_role_model.objects.get.return_value = admin_role

        request, _, _ = _build_request(
            "post", "/public/v1/members/", self.org,
            data={"email": "new@example.com", "role_id": str(admin_role.id)},
        )
        response = self.view(request)
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "cannot be invited" in response.data["error"]

    @patch("api.views.members.Role")
    @patch("api.views.members.role_has_permission", return_value=True)
    @patch("api.views.members.role_has_global_access", return_value=False)
    @patch("api.views.members.user_has_permission", return_value=True)
    @patch("api.views.members.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.members.IsIPAllowed.has_permission", return_value=True)
    def test_invite_sa_token_create_role_blocked_returns_400(
        self, _ip, _throttle, _perm, _global, _role_perm, mock_role_model
    ):
        mock_role_model.objects.get.return_value = _make_role("Manager")

        request, _, _ = _build_request(
            "post", "/public/v1/members/", self.org,
            data={"email": "new@example.com", "role_id": str(uuid.uuid4())},
        )
        response = self.view(request)
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "service account tokens" in response.data["error"]

    @patch("api.views.members.OrganisationMember")
    @patch("api.views.members.Role")
    @patch("api.views.members.role_has_permission", return_value=False)
    @patch("api.views.members.role_has_global_access", return_value=False)
    @patch("api.views.members.user_has_permission", return_value=True)
    @patch("api.views.members.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.members.IsIPAllowed.has_permission", return_value=True)
    def test_invite_duplicate_member_returns_409(
        self, _ip, _throttle, _perm, _global, _role_perm, mock_role_model, mock_member_model
    ):
        mock_role_model.objects.get.return_value = self.role
        mock_member_model.objects.filter.return_value.exists.return_value = True

        request, _, _ = _build_request(
            "post", "/public/v1/members/", self.org,
            data={"email": "existing@example.com", "role_id": str(self.role.id)},
        )
        response = self.view(request)
        assert response.status_code == status.HTTP_409_CONFLICT
        assert "already a member" in response.data["error"]

    @patch("api.views.members.OrganisationMemberInvite")
    @patch("api.views.members.OrganisationMember")
    @patch("api.views.members.Role")
    @patch("api.views.members.role_has_permission", return_value=False)
    @patch("api.views.members.role_has_global_access", return_value=False)
    @patch("api.views.members.user_has_permission", return_value=True)
    @patch("api.views.members.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.members.IsIPAllowed.has_permission", return_value=True)
    def test_invite_active_invite_exists_returns_409(
        self, _ip, _throttle, _perm, _global, _role_perm,
        mock_role_model, mock_member_model, mock_invite_model,
    ):
        mock_role_model.objects.get.return_value = self.role
        mock_member_model.objects.filter.return_value.exists.return_value = False
        mock_invite_model.objects.filter.return_value.exists.return_value = True

        request, _, _ = _build_request(
            "post", "/public/v1/members/", self.org,
            data={"email": "pending@example.com", "role_id": str(self.role.id)},
        )
        response = self.view(request)
        assert response.status_code == status.HTTP_409_CONFLICT
        assert "active invite" in response.data["error"]

    @patch("api.views.members.can_add_account", return_value=False)
    @patch("api.views.members.OrganisationMemberInvite")
    @patch("api.views.members.OrganisationMember")
    @patch("api.views.members.Role")
    @patch("api.views.members.role_has_permission", return_value=False)
    @patch("api.views.members.role_has_global_access", return_value=False)
    @patch("api.views.members.user_has_permission", return_value=True)
    @patch("api.views.members.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.members.IsIPAllowed.has_permission", return_value=True)
    def test_invite_quota_exceeded_returns_403(
        self, _ip, _throttle, _perm, _global, _role_perm,
        mock_role_model, mock_member_model, mock_invite_model, _quota,
    ):
        mock_role_model.objects.get.return_value = self.role
        mock_member_model.objects.filter.return_value.exists.return_value = False
        mock_invite_model.objects.filter.return_value.exists.return_value = False

        request, _, _ = _build_request(
            "post", "/public/v1/members/", self.org,
            data={"email": "new@example.com", "role_id": str(self.role.id)},
        )
        response = self.view(request)
        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert "quota" in response.data["error"]

    @patch("api.views.members.user_has_permission", return_value=False)
    @patch("api.views.members.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.members.IsIPAllowed.has_permission", return_value=True)
    def test_invite_no_permission_returns_403(self, _ip, _throttle, _perm):
        request, _, _ = _build_request(
            "post", "/public/v1/members/", self.org,
            data={"email": "new@example.com", "role_id": str(self.role.id)},
            role_name="Developer",
        )
        response = self.view(request)
        assert response.status_code == status.HTTP_403_FORBIDDEN


# ════════════════════════════════════════════════════════════════════
# PublicMemberDetailView — Get
# ════════════════════════════════════════════════════════════════════


class TestPublicMemberDetailViewGet:

    @pytest.fixture(autouse=True)
    def setup(self, settings):
        settings.DATABASES = {
            "default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}
        }
        self.view = PublicMemberDetailView.as_view()
        self.org = _make_org()

    @patch("api.views.members.OrganisationMemberSerializer")
    @patch("api.views.members.OrganisationMember")
    @patch("api.views.members.user_has_permission", return_value=True)
    @patch("api.views.members.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.members.IsIPAllowed.has_permission", return_value=True)
    def test_get_success(self, _ip, _throttle, _perm, mock_member_model, mock_serializer):
        target = _make_org_member(org=self.org, email="target@example.com")
        mock_member_model.objects.select_related.return_value.get.return_value = target
        mock_serializer.return_value.data = {"id": str(target.id), "email": "target@example.com"}

        request, _, _ = _build_request("get", f"/public/v1/members/{target.id}/", self.org)
        response = self.view(request, member_id=target.id)

        assert response.status_code == status.HTTP_200_OK
        assert response.data["email"] == "target@example.com"

    @patch("api.views.members.OrganisationMember")
    @patch("api.views.members.user_has_permission", return_value=True)
    @patch("api.views.members.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.members.IsIPAllowed.has_permission", return_value=True)
    def test_get_not_found_returns_404(self, _ip, _throttle, _perm, mock_member_model):
        mock_member_model.objects.select_related.return_value.get.side_effect = ObjectDoesNotExist

        request, _, _ = _build_request("get", f"/public/v1/members/{uuid.uuid4()}/", self.org)
        response = self.view(request, member_id=uuid.uuid4())
        assert response.status_code == status.HTTP_404_NOT_FOUND

    @patch("api.views.members.user_has_permission", return_value=False)
    @patch("api.views.members.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.members.IsIPAllowed.has_permission", return_value=True)
    def test_get_no_permission_returns_403(self, _ip, _throttle, _perm):
        request, _, _ = _build_request(
            "get", f"/public/v1/members/{uuid.uuid4()}/", self.org, role_name="Developer"
        )
        response = self.view(request, member_id=uuid.uuid4())
        assert response.status_code == status.HTTP_403_FORBIDDEN


# ════════════════════════════════════════════════════════════════════
# PublicMemberDetailView — Update role
# ════════════════════════════════════════════════════════════════════


class TestPublicMemberDetailViewUpdate:

    @pytest.fixture(autouse=True)
    def setup(self, settings):
        settings.DATABASES = {
            "default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}
        }
        self.view = PublicMemberDetailView.as_view()
        self.org = _make_org()

    @patch("api.views.members.OrganisationMemberSerializer")
    @patch("api.views.members.log_audit_event")
    @patch("api.views.members.get_actor_info", return_value=("user", "uid", {}))
    @patch("api.views.members.get_resolver_request_meta", return_value=("127.0.0.1", "pytest"))
    @patch("api.views.members.Role")
    @patch("api.views.members.OrganisationMember")
    @patch("api.views.members.role_has_global_access", return_value=False)
    @patch("api.views.members.user_has_permission", return_value=True)
    @patch("api.views.members.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.members.IsIPAllowed.has_permission", return_value=True)
    def test_update_role_success(
        self, _ip, _throttle, _perm, _global,
        mock_member_model, mock_role_model, _meta, _actor, _audit, mock_serializer,
    ):
        target = _make_org_member(org=self.org, role_name="Developer", email="target@example.com")
        new_role = _make_role("Manager")
        mock_member_model.objects.select_related.return_value.get.return_value = target
        mock_role_model.objects.get.return_value = new_role
        mock_serializer.return_value.data = {"id": str(target.id), "role": {"name": "Manager"}}

        request, acting_member, _ = _build_request(
            "put", f"/public/v1/members/{target.id}/", self.org,
            data={"role_id": str(new_role.id)},
        )
        assert str(acting_member.id) != str(target.id)

        response = self.view(request, member_id=target.id)

        assert response.status_code == status.HTTP_200_OK
        assert target.role == new_role
        target.save.assert_called_once()

    @patch("api.views.members.OrganisationMember")
    @patch("api.views.members.user_has_permission", return_value=True)
    @patch("api.views.members.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.members.IsIPAllowed.has_permission", return_value=True)
    def test_update_member_not_found_returns_404(self, _ip, _throttle, _perm, mock_member_model):
        mock_member_model.objects.select_related.return_value.get.side_effect = ObjectDoesNotExist

        request, _, _ = _build_request(
            "put", f"/public/v1/members/{uuid.uuid4()}/", self.org,
            data={"role_id": str(uuid.uuid4())},
        )
        response = self.view(request, member_id=uuid.uuid4())
        assert response.status_code == status.HTTP_404_NOT_FOUND

    @patch("api.views.members.OrganisationMember")
    @patch("api.views.members.user_has_permission", return_value=True)
    @patch("api.views.members.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.members.IsIPAllowed.has_permission", return_value=True)
    def test_update_self_returns_403(self, _ip, _throttle, _perm, mock_member_model):
        acting_member = _make_org_member(org=self.org)
        request, _, _ = _build_request(
            "put", f"/public/v1/members/{acting_member.id}/", self.org,
            data={"role_id": str(uuid.uuid4())},
            acting_member=acting_member,
        )
        mock_member_model.objects.select_related.return_value.get.return_value = acting_member

        response = self.view(request, member_id=acting_member.id)
        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert "own role" in response.data["error"]

    @patch("api.views.members.OrganisationMember")
    @patch("api.views.members.role_has_global_access", side_effect=[True, False])
    @patch("api.views.members.user_has_permission", return_value=True)
    @patch("api.views.members.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.members.IsIPAllowed.has_permission", return_value=True)
    def test_update_global_access_member_without_global_access_returns_403(
        self, _ip, _throttle, _perm, _global, mock_member_model
    ):
        # target has global-access role; acting member does not
        target = _make_org_member(org=self.org, role_name="Admin", email="admin@example.com")
        mock_member_model.objects.select_related.return_value.get.return_value = target

        request, _, _ = _build_request(
            "put", f"/public/v1/members/{target.id}/", self.org,
            data={"role_id": str(uuid.uuid4())},
            role_name="Developer",
        )
        response = self.view(request, member_id=target.id)
        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert "global access" in response.data["error"]

    @patch("api.views.members.OrganisationMember")
    @patch("api.views.members.role_has_global_access", return_value=False)
    @patch("api.views.members.user_has_permission", return_value=True)
    @patch("api.views.members.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.members.IsIPAllowed.has_permission", return_value=True)
    def test_update_missing_role_id_returns_400(self, _ip, _throttle, _perm, _global, mock_member_model):
        target = _make_org_member(org=self.org, email="target@example.com")
        mock_member_model.objects.select_related.return_value.get.return_value = target

        request, _, _ = _build_request(
            "put", f"/public/v1/members/{target.id}/", self.org,
            data={},
        )
        response = self.view(request, member_id=target.id)
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "role_id" in response.data["error"]

    @patch("api.views.members.Role")
    @patch("api.views.members.OrganisationMember")
    @patch("api.views.members.role_has_global_access", return_value=False)
    @patch("api.views.members.user_has_permission", return_value=True)
    @patch("api.views.members.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.members.IsIPAllowed.has_permission", return_value=True)
    def test_update_owner_role_blocked_returns_403(
        self, _ip, _throttle, _perm, _global, mock_member_model, mock_role_model
    ):
        target = _make_org_member(org=self.org, email="target@example.com")
        owner_role = _make_role("Owner")
        mock_member_model.objects.select_related.return_value.get.return_value = target
        mock_role_model.objects.get.return_value = owner_role

        request, _, _ = _build_request(
            "put", f"/public/v1/members/{target.id}/", self.org,
            data={"role_id": str(owner_role.id)},
        )
        response = self.view(request, member_id=target.id)
        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert "Owner" in response.data["error"]

    @patch("api.views.members.Role")
    @patch("api.views.members.OrganisationMember")
    # side_effect order: member.role=False (skip global-member check), new_role=True, acting.role=False
    @patch("api.views.members.role_has_global_access", side_effect=[False, True, False])
    @patch("api.views.members.user_has_permission", return_value=True)
    @patch("api.views.members.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.members.IsIPAllowed.has_permission", return_value=True)
    def test_update_global_role_without_global_access_returns_403(
        self, _ip, _throttle, _perm, _global, mock_member_model, mock_role_model
    ):
        target = _make_org_member(org=self.org, email="target@example.com")
        admin_role = _make_role("Admin")
        mock_member_model.objects.select_related.return_value.get.return_value = target
        mock_role_model.objects.get.return_value = admin_role

        request, _, _ = _build_request(
            "put", f"/public/v1/members/{target.id}/", self.org,
            data={"role_id": str(admin_role.id)},
            role_name="Developer",
        )
        response = self.view(request, member_id=target.id)
        assert response.status_code == status.HTTP_403_FORBIDDEN

    @patch("api.views.members.Role")
    @patch("api.views.members.OrganisationMember")
    # SA auth skips the self-check block; role_has_global_access called once (new_role=True)
    @patch("api.views.members.role_has_global_access", side_effect=[True])
    @patch("api.views.members.user_has_permission", return_value=True)
    @patch("api.views.members.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.members.IsIPAllowed.has_permission", return_value=True)
    def test_update_sa_cannot_assign_global_access_role_returns_403(
        self, _ip, _throttle, _perm, _global, mock_member_model, mock_role_model
    ):
        target = _make_org_member(org=self.org, email="target@example.com")
        admin_role = _make_role("Admin")
        mock_member_model.objects.select_related.return_value.get.return_value = target
        mock_role_model.objects.get.return_value = admin_role

        request, _, _ = _build_request(
            "put", f"/public/v1/members/{target.id}/", self.org,
            data={"role_id": str(admin_role.id)},
            auth_type="ServiceAccount",
        )
        response = self.view(request, member_id=target.id)
        assert response.status_code == status.HTTP_403_FORBIDDEN

    @patch("api.views.members.user_has_permission", return_value=False)
    @patch("api.views.members.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.members.IsIPAllowed.has_permission", return_value=True)
    def test_update_no_permission_returns_403(self, _ip, _throttle, _perm):
        request, _, _ = _build_request(
            "put", f"/public/v1/members/{uuid.uuid4()}/", self.org,
            data={"role_id": str(uuid.uuid4())},
            role_name="Developer",
        )
        response = self.view(request, member_id=uuid.uuid4())
        assert response.status_code == status.HTTP_403_FORBIDDEN


# ════════════════════════════════════════════════════════════════════
# PublicMemberDetailView — Delete
# ════════════════════════════════════════════════════════════════════


class TestPublicMemberDetailViewDelete:

    @pytest.fixture(autouse=True)
    def setup(self, settings):
        settings.DATABASES = {
            "default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}
        }
        self.view = PublicMemberDetailView.as_view()
        self.org = _make_org()

    @patch("api.views.members.log_audit_event")
    @patch("api.views.members.get_actor_info", return_value=("user", "uid", {}))
    @patch("api.views.members.get_resolver_request_meta", return_value=("127.0.0.1", "pytest"))
    @patch("api.views.members.CLOUD_HOSTED", False)
    @patch("api.views.members.OrganisationMember")
    @patch("api.views.members.user_has_permission", return_value=True)
    @patch("api.views.members.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.members.IsIPAllowed.has_permission", return_value=True)
    def test_delete_success_soft_deletes_member(
        self, _ip, _throttle, _perm, mock_member_model, _meta, _actor, _audit
    ):
        target = _make_org_member(org=self.org, email="target@example.com")
        mock_member_model.objects.select_related.return_value.get.return_value = target

        request, acting_member, _ = _build_request(
            "delete", f"/public/v1/members/{target.id}/", self.org,
        )
        assert str(acting_member.id) != str(target.id)

        response = self.view(request, member_id=target.id)

        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert target.deleted_at is not None
        target.save.assert_called_once()

    @patch("api.views.members.OrganisationMember")
    @patch("api.views.members.user_has_permission", return_value=True)
    @patch("api.views.members.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.members.IsIPAllowed.has_permission", return_value=True)
    def test_delete_not_found_returns_404(self, _ip, _throttle, _perm, mock_member_model):
        mock_member_model.objects.select_related.return_value.get.side_effect = ObjectDoesNotExist

        request, _, _ = _build_request(
            "delete", f"/public/v1/members/{uuid.uuid4()}/", self.org,
        )
        response = self.view(request, member_id=uuid.uuid4())
        assert response.status_code == status.HTTP_404_NOT_FOUND

    @patch("api.views.members.OrganisationMember")
    @patch("api.views.members.user_has_permission", return_value=True)
    @patch("api.views.members.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.members.IsIPAllowed.has_permission", return_value=True)
    def test_delete_self_returns_403(self, _ip, _throttle, _perm, mock_member_model):
        acting_member = _make_org_member(org=self.org)
        request, _, _ = _build_request(
            "delete", f"/public/v1/members/{acting_member.id}/", self.org,
            acting_member=acting_member,
        )
        mock_member_model.objects.select_related.return_value.get.return_value = acting_member

        response = self.view(request, member_id=acting_member.id)
        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert "yourself" in response.data["error"]

    @patch("api.views.members.user_has_permission", return_value=False)
    @patch("api.views.members.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.members.IsIPAllowed.has_permission", return_value=True)
    def test_delete_no_permission_returns_403(self, _ip, _throttle, _perm):
        request, _, _ = _build_request(
            "delete", f"/public/v1/members/{uuid.uuid4()}/", self.org,
            role_name="Developer",
        )
        response = self.view(request, member_id=uuid.uuid4())
        assert response.status_code == status.HTTP_403_FORBIDDEN


# ════════════════════════════════════════════════════════════════════
# PublicMemberAccessView — Access management
# ════════════════════════════════════════════════════════════════════


class TestPublicMemberAccessView:

    @pytest.fixture(autouse=True)
    def setup(self, settings):
        settings.DATABASES = {
            "default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}
        }
        self.view = PublicMemberAccessView.as_view()
        self.org = _make_org()

    def _make_sse_app(self):
        app = Mock()
        app.id = uuid.uuid4()
        app.name = "test-app"
        app.sse_enabled = True
        app.organisation = self.org
        return app

    def _make_env(self, app):
        env = Mock()
        env.id = uuid.uuid4()
        env.app = app
        return env

    @patch("api.views.members.OrganisationMemberSerializer")
    @patch("api.views.members.log_audit_event")
    @patch("api.views.members.get_actor_info", return_value=("user", "uid", {}))
    @patch("api.views.members.get_resolver_request_meta", return_value=("127.0.0.1", "pytest"))
    @patch("api.views.members.EnvironmentKey")
    @patch("api.views.members.ServerEnvironmentKey")
    @patch("api.views.members.Environment")
    @patch("api.views.members.App")
    @patch("api.views.members.transaction")
    @patch("api.views.members._wrap_env_secrets_for_key", return_value=("wrapped_seed", "wrapped_salt"))
    @patch("api.views.members.decrypt_asymmetric", return_value="decrypted_value")
    @patch("api.views.members.get_server_keypair", return_value=(b"\x00" * 32, b"\x01" * 32))
    @patch("api.views.members._ed25519_pk_to_curve25519", return_value=b"\x02" * 32)
    @patch("api.views.members.OrganisationMember")
    @patch("api.views.members.user_has_permission", return_value=True)
    @patch("api.views.members.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.members.IsIPAllowed.has_permission", return_value=True)
    def test_access_grant_success(
        self, _ip, _throttle, _perm,
        mock_member_model, _ed25519, _server_kp, _decrypt, _wrap,
        mock_txn, mock_app_model, mock_env_model, mock_sek_model, mock_ek_model,
        _meta, _actor, _audit, mock_serializer,
    ):
        app = self._make_sse_app()
        env = self._make_env(app)
        target = _make_org_member(org=self.org, email="target@example.com")

        mock_member_model.objects.select_related.return_value.get.return_value = target
        mock_app_model.objects.get.return_value = app
        mock_env_model.objects.filter.return_value.values_list.return_value = [env.id]
        mock_env_model.objects.get.return_value = env

        # No current app access
        target.apps.filter.return_value = []
        # No current env keys
        mock_ek_model.objects.filter.return_value = []

        # SEK exists
        sek = Mock()
        sek.wrapped_seed = "ws"
        sek.wrapped_salt = "wsa"
        sek.identity_key = "ik"
        mock_sek_model.objects.get.return_value = sek

        mock_serializer.return_value.data = {"id": str(target.id)}

        request, _, _ = _build_request(
            "put", f"/public/v1/members/{target.id}/access/", self.org,
            data={"apps": [{"id": str(app.id), "environments": [str(env.id)]}]},
        )
        response = self.view(request, member_id=target.id)

        assert response.status_code == status.HTTP_200_OK
        mock_ek_model.objects.bulk_create.assert_called_once()

    @patch("api.views.members.OrganisationMember")
    @patch("api.views.members.user_has_permission", return_value=True)
    @patch("api.views.members.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.members.IsIPAllowed.has_permission", return_value=True)
    def test_access_member_not_found_returns_404(self, _ip, _throttle, _perm, mock_member_model):
        mock_member_model.objects.select_related.return_value.get.side_effect = ObjectDoesNotExist

        request, _, _ = _build_request(
            "put", f"/public/v1/members/{uuid.uuid4()}/access/", self.org,
            data={"apps": []},
        )
        response = self.view(request, member_id=uuid.uuid4())
        assert response.status_code == status.HTTP_404_NOT_FOUND

    @patch("api.views.members.OrganisationMember")
    @patch("api.views.members.user_has_permission", return_value=True)
    @patch("api.views.members.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.members.IsIPAllowed.has_permission", return_value=True)
    def test_access_missing_identity_key_returns_400(self, _ip, _throttle, _perm, mock_member_model):
        target = _make_org_member(org=self.org)
        target.identity_key = None
        mock_member_model.objects.select_related.return_value.get.return_value = target

        request, _, _ = _build_request(
            "put", f"/public/v1/members/{target.id}/access/", self.org,
            data={"apps": []},
        )
        response = self.view(request, member_id=target.id)
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "identity key" in response.data["error"]

    @patch("api.views.members.OrganisationMember")
    @patch("api.views.members.user_has_permission", return_value=True)
    @patch("api.views.members.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.members.IsIPAllowed.has_permission", return_value=True)
    def test_access_missing_apps_field_returns_400(self, _ip, _throttle, _perm, mock_member_model):
        target = _make_org_member(org=self.org)
        mock_member_model.objects.select_related.return_value.get.return_value = target

        request, _, _ = _build_request(
            "put", f"/public/v1/members/{target.id}/access/", self.org,
            data={},
        )
        response = self.view(request, member_id=target.id)
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "apps" in response.data["error"]

    @patch("api.views.members.App")
    @patch("api.views.members.OrganisationMember")
    @patch("api.views.members.user_has_permission", return_value=True)
    @patch("api.views.members.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.members.IsIPAllowed.has_permission", return_value=True)
    def test_access_non_sse_app_returns_400(self, _ip, _throttle, _perm, mock_member_model, mock_app_model):
        target = _make_org_member(org=self.org)
        mock_member_model.objects.select_related.return_value.get.return_value = target
        non_sse_app = Mock()
        non_sse_app.id = uuid.uuid4()
        non_sse_app.name = "no-sse"
        non_sse_app.sse_enabled = False
        mock_app_model.objects.get.return_value = non_sse_app

        request, _, _ = _build_request(
            "put", f"/public/v1/members/{target.id}/access/", self.org,
            data={"apps": [{"id": str(non_sse_app.id), "environments": [str(uuid.uuid4())]}]},
        )
        response = self.view(request, member_id=target.id)
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "SSE" in response.data["error"]

    @patch("api.views.members.App")
    @patch("api.views.members.OrganisationMember")
    @patch("api.views.members.user_has_permission", return_value=True)
    @patch("api.views.members.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.members.IsIPAllowed.has_permission", return_value=True)
    def test_access_empty_environments_returns_400(self, _ip, _throttle, _perm, mock_member_model, mock_app_model):
        target = _make_org_member(org=self.org)
        mock_member_model.objects.select_related.return_value.get.return_value = target
        app = self._make_sse_app()
        mock_app_model.objects.get.return_value = app

        request, _, _ = _build_request(
            "put", f"/public/v1/members/{target.id}/access/", self.org,
            data={"apps": [{"id": str(app.id), "environments": []}]},
        )
        response = self.view(request, member_id=target.id)
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "empty" in response.data["error"]

    @patch("api.views.members.Environment")
    @patch("api.views.members.App")
    @patch("api.views.members.OrganisationMember")
    @patch("api.views.members.user_has_permission", return_value=True)
    @patch("api.views.members.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.members.IsIPAllowed.has_permission", return_value=True)
    def test_access_invalid_environment_returns_404(
        self, _ip, _throttle, _perm, mock_member_model, mock_app_model, mock_env_model
    ):
        target = _make_org_member(org=self.org)
        mock_member_model.objects.select_related.return_value.get.return_value = target
        app = self._make_sse_app()
        mock_app_model.objects.get.return_value = app
        # Return empty queryset — no valid envs
        mock_env_model.objects.filter.return_value.values_list.return_value = []

        fake_env_id = str(uuid.uuid4())
        request, _, _ = _build_request(
            "put", f"/public/v1/members/{target.id}/access/", self.org,
            data={"apps": [{"id": str(app.id), "environments": [fake_env_id]}]},
        )
        response = self.view(request, member_id=target.id)
        assert response.status_code == status.HTTP_404_NOT_FOUND
        assert fake_env_id in response.data["error"]

    @patch("api.views.members.user_has_permission", return_value=False)
    @patch("api.views.members.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.members.IsIPAllowed.has_permission", return_value=True)
    def test_access_no_permission_returns_403(self, _ip, _throttle, _perm):
        request, _, _ = _build_request(
            "put", f"/public/v1/members/{uuid.uuid4()}/access/", self.org,
            data={"apps": []},
            role_name="Developer",
        )
        response = self.view(request, member_id=uuid.uuid4())
        assert response.status_code == status.HTTP_403_FORBIDDEN


# ════════════════════════════════════════════════════════════════════
# PublicInvitesView — List
# ════════════════════════════════════════════════════════════════════


class TestPublicInvitesView:

    @pytest.fixture(autouse=True)
    def setup(self, settings):
        settings.DATABASES = {
            "default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}
        }
        self.view = PublicInvitesView.as_view()
        self.org = _make_org()

    @patch("api.views.members.OrganisationMemberInviteSerializer")
    @patch("api.views.members.OrganisationMemberInvite")
    @patch("api.views.members.user_has_permission", return_value=True)
    @patch("api.views.members.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.members.IsIPAllowed.has_permission", return_value=True)
    def test_list_invites_success(self, _ip, _throttle, _perm, mock_invite_model, mock_serializer):
        qs = MagicMock()
        qs.filter.return_value.order_by.return_value = [Mock(), Mock()]
        mock_invite_model.objects.select_related.return_value = qs
        mock_serializer.return_value.data = [{"id": "inv-1"}, {"id": "inv-2"}]

        request, _, _ = _build_request("get", "/public/v1/invites/", self.org)
        response = self.view(request)

        assert response.status_code == status.HTTP_200_OK
        assert len(response.data) == 2

    @patch("api.views.members.user_has_permission", return_value=False)
    @patch("api.views.members.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.members.IsIPAllowed.has_permission", return_value=True)
    def test_list_invites_no_permission_returns_403(self, _ip, _throttle, _perm):
        request, _, _ = _build_request("get", "/public/v1/invites/", self.org, role_name="Developer")
        response = self.view(request)
        assert response.status_code == status.HTTP_403_FORBIDDEN


# ════════════════════════════════════════════════════════════════════
# PublicInviteDetailView — Cancel
# ════════════════════════════════════════════════════════════════════


class TestPublicInviteDetailView:

    @pytest.fixture(autouse=True)
    def setup(self, settings):
        settings.DATABASES = {
            "default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}
        }
        self.view = PublicInviteDetailView.as_view()
        self.org = _make_org()

    @patch("api.views.members.log_audit_event")
    @patch("api.views.members.get_actor_info", return_value=("user", "uid", {}))
    @patch("api.views.members.get_resolver_request_meta", return_value=("127.0.0.1", "pytest"))
    @patch("api.views.members.OrganisationMemberInvite")
    @patch("api.views.members.user_has_permission", return_value=True)
    @patch("api.views.members.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.members.IsIPAllowed.has_permission", return_value=True)
    def test_cancel_invite_success(
        self, _ip, _throttle, _perm, mock_invite_model, _meta, _actor, _audit
    ):
        invite = Mock()
        invite.id = uuid.uuid4()
        invite.invitee_email = "pending@example.com"
        invite.role = _make_role("Developer")
        mock_invite_model.objects.select_related.return_value.get.return_value = invite

        request, _, _ = _build_request(
            "delete", f"/public/v1/invites/{invite.id}/", self.org,
        )
        response = self.view(request, invite_id=invite.id)

        assert response.status_code == status.HTTP_204_NO_CONTENT
        invite.delete.assert_called_once()

    @patch("api.views.members.OrganisationMemberInvite")
    @patch("api.views.members.user_has_permission", return_value=True)
    @patch("api.views.members.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.members.IsIPAllowed.has_permission", return_value=True)
    def test_cancel_invite_not_found_returns_404(self, _ip, _throttle, _perm, mock_invite_model):
        mock_invite_model.objects.select_related.return_value.get.side_effect = ObjectDoesNotExist

        request, _, _ = _build_request(
            "delete", f"/public/v1/invites/{uuid.uuid4()}/", self.org,
        )
        response = self.view(request, invite_id=uuid.uuid4())
        assert response.status_code == status.HTTP_404_NOT_FOUND

    @patch("api.views.members.user_has_permission", return_value=False)
    @patch("api.views.members.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch("api.views.members.IsIPAllowed.has_permission", return_value=True)
    def test_cancel_invite_no_permission_returns_403(self, _ip, _throttle, _perm):
        request, _, _ = _build_request(
            "delete", f"/public/v1/invites/{uuid.uuid4()}/", self.org,
            role_name="Developer",
        )
        response = self.view(request, invite_id=uuid.uuid4())
        assert response.status_code == status.HTTP_403_FORBIDDEN
