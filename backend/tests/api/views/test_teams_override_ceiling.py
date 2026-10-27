"""Grant ceiling for team role overrides on POST /teams/ and PUT
/teams/<id>/: an override must be within the caller's own permissions
(global-access callers exempt). Re-saving or clearing an override is never
checked. Mirrors the member and service account ceilings.
"""

import uuid
from unittest.mock import Mock, MagicMock, patch

import pytest
from rest_framework import status
from rest_framework.test import APIRequestFactory, force_authenticate

from api.views.teams import PublicTeamsView, PublicTeamDetailView

TEAMS = "api.views.teams"


# ────────────────────────────────────────────────────────────────────
# Helpers (same shapes as test_members_api.py)
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
    role.is_default = name.lower() in {
        "owner", "admin", "manager", "developer", "service"
    }
    role.managed_key = name.lower() if role.is_default else None
    return role


def _make_custom_role(name, permissions, org=None):
    role = _make_role(name)
    role.is_default = False
    role.managed_key = None
    role.organisation = org
    role.permissions = permissions
    return role


def _make_user(email="actor@example.com"):
    user = Mock()
    user.userId = uuid.uuid4()
    user.id = user.userId
    user.email = email
    user.is_authenticated = True
    user.is_active = True
    return user


def _make_org_member(org, role_name="Owner", email="actor@example.com"):
    member = Mock()
    member.id = uuid.uuid4()
    member.user = _make_user(email)
    member.organisation = org
    member.deleted_at = None
    member.role = _make_role(role_name)
    return member


def _make_sa(org, role_name="Manager"):
    sa = Mock()
    sa.id = uuid.uuid4()
    sa.name = "deploy-bot"
    sa.organisation = org
    sa.organisation_id = org.id
    sa.role = _make_role(role_name)
    return sa


def _make_team(org, member_role=None, service_account_role=None, is_scim_managed=False):
    team = Mock()
    team.id = uuid.uuid4()
    team.name = "platform"
    team.description = ""
    team.organisation = org
    team.is_scim_managed = is_scim_managed
    team.member_role = member_role
    team.member_role_id = member_role.id if member_role else None
    team.service_account_role = service_account_role
    team.service_account_role_id = (
        service_account_role.id if service_account_role else None
    )
    return team


def _build_request(
    method, url, org, data=None, auth_type="User", role_name="Owner", sa_role_name="Manager",
):
    factory = APIRequestFactory()
    request = getattr(factory, method)(url, data=data or {}, format="json")
    acting_member = _make_org_member(org, role_name=role_name)
    sa = _make_sa(org, role_name=sa_role_name) if auth_type == "ServiceAccount" else None
    auth = {
        "token": "Bearer test_token",
        "auth_type": auth_type,
        "app": None,
        "environment": None,
        "org_member": acting_member if auth_type == "User" else None,
        "service_account": sa,
        "service_account_token": None,
        "organisation": org,
        "org_only": True,
    }
    force_authenticate(request, user=acting_member.user, token=auth)
    return request


@pytest.fixture(autouse=True)
def _bypass_gates():
    with patch(f"{TEAMS}.transaction"), patch(
        f"{TEAMS}.IsIPAllowed.has_permission", return_value=True
    ), patch(
        f"{TEAMS}.PlanBasedRateThrottle.allow_request", return_value=True
    ), patch(f"{TEAMS}.user_has_permission", return_value=True), patch(
        f"{TEAMS}.can_use_teams", return_value=True
    ), patch(f"{TEAMS}._is_team_member", return_value=True), patch(
        f"{TEAMS}._serialize_team", return_value={}
    ), patch(f"{TEAMS}.log_audit_event"), patch(
        f"{TEAMS}.get_actor_info", return_value=("user", "uid", {})
    ), patch(
        f"{TEAMS}.get_resolver_request_meta", return_value=("127.0.0.1", "pytest")
    ):
        yield


class _Roles:
    def __init__(self, org):
        self.owner = _make_role("Owner")
        self.manager = _make_role("Manager")
        self.developer = _make_role("Developer")
        # No global access or SA-token create, so only the ceiling can reject it
        self.sso_admin = _make_custom_role(
            "SSO Admin",
            {"permissions": {"SSO": ["create"]}, "app_permissions": {}},
            org=org,
        )
        # Admin holds only Organisation read/update, so this is above its own ceiling
        self.org_deleter = _make_custom_role(
            "Org Deleter",
            {"permissions": {"Organisation": ["delete"]}, "app_permissions": {}},
            org=org,
        )
        self.by_id = {
            str(r.id): r
            for r in (
                self.owner, self.manager, self.developer, self.sso_admin, self.org_deleter
            )
        }

    def lookup(self, id, organisation):
        return self.by_id[str(id)]


# ════════════════════════════════════════════════════════════════════
# POST /teams/
# ════════════════════════════════════════════════════════════════════


class TestCreateTeamOverrideCeiling:
    @pytest.fixture(autouse=True)
    def setup(self):
        self.view = PublicTeamsView.as_view()
        self.org = _make_org()
        self.roles = _Roles(self.org)

    def _post(self, data, **request_kwargs):
        request = _build_request("post", "/public/v1/teams/", self.org, data=data, **request_kwargs)
        with patch(f"{TEAMS}.Role") as mock_role_model, patch(
            f"{TEAMS}.Team"
        ) as mock_team_model, patch(f"{TEAMS}.TeamMembership"), patch(
            f"{TEAMS}.OrganisationMember"
        ):
            mock_role_model.objects.get.side_effect = self.roles.lookup
            response = self.view(request)
        return response, mock_team_model

    def test_rejects_owner_member_override_above_manager(self):
        response, mock_team_model = self._post(
            {"name": "platform", "member_role_id": str(self.roles.owner.id)},
            role_name="Manager",
        )

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert "You cannot assign the 'Owner' role" in response.data["error"]
        assert "global_access" in response.data["error"]
        mock_team_model.objects.create.assert_not_called()

    def test_rejects_custom_member_override_above_manager(self):
        response, mock_team_model = self._post(
            {"name": "platform", "member_role_id": str(self.roles.sso_admin.id)},
            role_name="Manager",
        )

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert "You cannot assign the 'SSO Admin' role" in response.data["error"]
        assert "permissions:SSO:create" in response.data["error"]
        mock_team_model.objects.create.assert_not_called()

    def test_accepts_member_override_within_manager_ceiling(self):
        response, mock_team_model = self._post(
            {"name": "platform", "member_role_id": str(self.roles.manager.id)},
            role_name="Manager",
        )

        assert response.status_code == status.HTTP_201_CREATED
        mock_team_model.objects.create.assert_called_once()
        assert (
            mock_team_model.objects.create.call_args.kwargs["member_role"]
            is self.roles.manager
        )

    def test_global_access_caller_exempt_from_ceiling(self):
        """Admin lacks Owner's permissions itself, but global access is the
        delegation escape hatch."""
        response, mock_team_model = self._post(
            {
                "name": "platform",
                "member_role_id": str(self.roles.owner.id),
                "service_account_role_id": str(self.roles.org_deleter.id),
            },
            role_name="Admin",
        )

        assert response.status_code == status.HTTP_201_CREATED
        mock_team_model.objects.create.assert_called_once()

    def test_rejects_owner_service_account_override_above_manager(self):
        response, mock_team_model = self._post(
            {"name": "platform", "service_account_role_id": str(self.roles.owner.id)},
            role_name="Manager",
        )

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert "You cannot assign the 'Owner' role" in response.data["error"]
        assert "global_access" in response.data["error"]
        mock_team_model.objects.create.assert_not_called()

    def test_sa_caller_bounded_by_its_own_role(self):
        response, mock_team_model = self._post(
            {"name": "platform", "member_role_id": str(self.roles.manager.id)},
            auth_type="ServiceAccount",
            sa_role_name="Developer",
        )

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert "You cannot assign the 'Manager' role" in response.data["error"]
        mock_team_model.objects.create.assert_not_called()

    def test_sa_caller_within_own_role_succeeds(self):
        response, mock_team_model = self._post(
            {"name": "platform", "member_role_id": str(self.roles.developer.id)},
            auth_type="ServiceAccount",
            sa_role_name="Manager",
        )

        assert response.status_code == status.HTTP_201_CREATED
        mock_team_model.objects.create.assert_called_once()


# ════════════════════════════════════════════════════════════════════
# PUT /teams/<id>/
# ════════════════════════════════════════════════════════════════════


class TestUpdateTeamOverrideCeiling:
    @pytest.fixture(autouse=True)
    def setup(self):
        self.view = PublicTeamDetailView.as_view()
        self.org = _make_org()
        self.roles = _Roles(self.org)

    def _put(self, team, data, **request_kwargs):
        request = _build_request(
            "put", f"/public/v1/teams/{team.id}/", self.org, data=data, **request_kwargs
        )
        with patch(f"{TEAMS}.Role") as mock_role_model, patch(
            f"{TEAMS}.Team"
        ) as mock_team_model:
            mock_role_model.objects.get.side_effect = self.roles.lookup
            mock_team_model.objects.select_related.return_value.get.return_value = team
            return self.view(request, team_id=team.id)

    def test_resubmitting_grandfathered_override_skips_ceiling(self):
        team = _make_team(
            self.org, member_role=self.roles.owner, service_account_role=self.roles.owner
        )

        with patch(f"{TEAMS}.role_assignment_error") as mock_ceiling:
            response = self._put(
                team,
                {
                    "name": "renamed",
                    "member_role_id": str(self.roles.owner.id),
                    "service_account_role_id": str(self.roles.owner.id),
                },
                role_name="Manager",
            )

        assert response.status_code == status.HTTP_200_OK
        mock_ceiling.assert_not_called()
        team.save.assert_called_once()
        assert team.name == "renamed"
        assert team.member_role is self.roles.owner

    def test_clearing_override_skips_ceiling(self):
        team = _make_team(
            self.org, member_role=self.roles.owner, service_account_role=self.roles.owner
        )

        with patch(f"{TEAMS}.role_assignment_error") as mock_ceiling:
            response = self._put(
                team,
                {"member_role_id": "", "service_account_role_id": ""},
                role_name="Manager",
            )

        assert response.status_code == status.HTTP_200_OK
        mock_ceiling.assert_not_called()
        team.save.assert_called_once()
        assert team.member_role is None
        assert team.service_account_role is None

    def test_rejects_member_override_change_above_manager(self):
        team = _make_team(self.org, member_role=self.roles.manager)

        response = self._put(
            team, {"member_role_id": str(self.roles.owner.id)}, role_name="Manager"
        )

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert "You cannot assign the 'Owner' role" in response.data["error"]
        assert "global_access" in response.data["error"]
        team.save.assert_not_called()

    def test_rejects_service_account_override_change_above_manager(self):
        team = _make_team(self.org, service_account_role=self.roles.developer)

        response = self._put(
            team,
            {"service_account_role_id": str(self.roles.sso_admin.id)},
            role_name="Manager",
        )

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert "You cannot assign the 'SSO Admin' role" in response.data["error"]
        assert "permissions:SSO:create" in response.data["error"]
        team.save.assert_not_called()

    def test_accepts_override_change_within_manager_ceiling(self):
        team = _make_team(self.org, member_role=self.roles.developer)

        response = self._put(
            team, {"member_role_id": str(self.roles.manager.id)}, role_name="Manager"
        )

        assert response.status_code == status.HTTP_200_OK
        team.save.assert_called_once()
        assert team.member_role is self.roles.manager

    def test_global_access_caller_exempt_from_ceiling(self):
        team = _make_team(self.org)

        response = self._put(
            team, {"member_role_id": str(self.roles.org_deleter.id)}, role_name="Admin"
        )

        assert response.status_code == status.HTTP_200_OK
        team.save.assert_called_once()
        assert team.member_role is self.roles.org_deleter

    def test_sa_caller_bounded_by_its_own_role(self):
        team = _make_team(self.org)

        response = self._put(
            team,
            {"member_role_id": str(self.roles.manager.id)},
            auth_type="ServiceAccount",
            sa_role_name="Developer",
        )

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert "You cannot assign the 'Manager' role" in response.data["error"]
        team.save.assert_not_called()

    def test_scim_team_refused_before_ceiling(self):
        team = _make_team(self.org, is_scim_managed=True)

        with patch(f"{TEAMS}.role_assignment_error") as mock_ceiling:
            response = self._put(
                team, {"member_role_id": str(self.roles.owner.id)}, role_name="Manager"
            )

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert "managed by SCIM" in response.data["error"]
        mock_ceiling.assert_not_called()
        team.save.assert_not_called()
