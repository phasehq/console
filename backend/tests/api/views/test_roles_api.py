import uuid
import pytest
from unittest.mock import Mock, MagicMock, patch, PropertyMock
from rest_framework.test import APIRequestFactory, force_authenticate
from rest_framework import status
from django.core.exceptions import ObjectDoesNotExist

from api.views.roles import PublicRolesView, PublicRoleDetailView


# ────────────────────────────────────────────────────────────────────
# Auto-patch IsIPAllowed for all tests in this module
# ────────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def _bypass_ip_check():
    with patch("api.views.roles.IsIPAllowed.has_permission", return_value=True):
        yield


@pytest.fixture(autouse=True)
def _no_db_transaction():
    # PUT locks the role row; these tests have no DB.
    with patch("api.views.roles.transaction") as mock_transaction:
        yield mock_transaction


# ────────────────────────────────────────────────────────────────────
# Shared test helpers
# ────────────────────────────────────────────────────────────────────

FREE_PLAN = "FR"
PRO_PLAN = "PR"


def _make_org(plan=PRO_PLAN, org_id=None):
    org = Mock()
    org.id = org_id or uuid.uuid4()
    org.plan = plan
    org.FREE_PLAN = FREE_PLAN
    return org


def _make_role(name="Developer", role_id=None, org=None, is_default=True, permissions=None):
    role = Mock()
    role.id = role_id or str(uuid.uuid4())
    role.name = name
    role.description = f"Default {name} role"
    role.color = "#000000"
    role.is_default = is_default
    role.managed_key = name.lower() if is_default else None
    role.organisation = org
    role.permissions = permissions or {}
    role.created_at = "2024-01-01T00:00:00Z"
    role.save = Mock()
    role.delete = Mock()
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
    # Realistic default-role shape so the grant ceiling resolves the
    # managed template (default roles store empty permissions JSON)
    member.role = Mock()
    member.role.name = role_name
    member.role.is_default = True
    member.role.managed_key = role_name.lower()
    member.role.permissions = {}
    return member


def _make_auth(org, auth_type="User", org_member=None, service_account=None):
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


def _build_request(method, url, org, data=None, auth_type="User", role_name="Owner"):
    factory = APIRequestFactory()
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

    org_member = _make_org_member(org, role_name=role_name)
    user = org_member.user
    auth = _make_auth(org, auth_type=auth_type, org_member=org_member)
    force_authenticate(request, user=user, token=auth)
    return request


# ────────────────────────────────────────────────────────────────────
# PublicRolesView tests
# ────────────────────────────────────────────────────────────────────


@patch("api.views.roles.user_has_permission", return_value=True)
@patch("api.views.roles.Role")
def test_list_roles_200(mock_role_cls, mock_perm):
    org = _make_org()
    roles = [
        _make_role("Owner", org=org),
        _make_role("Admin", org=org),
        _make_role("Developer", org=org),
    ]
    mock_role_cls.objects.filter.return_value.order_by.return_value = roles

    request = _build_request("get", "/public/v1/roles/", org)
    view = PublicRolesView.as_view()
    response = view(request)

    assert response.status_code == status.HTTP_200_OK
    assert len(response.data["data"]) == 3


@patch("api.views.roles.user_has_permission", return_value=False)
def test_list_roles_permission_denied(mock_perm):
    org = _make_org()
    request = _build_request("get", "/public/v1/roles/", org)
    view = PublicRolesView.as_view()
    response = view(request)

    assert response.status_code == status.HTTP_403_FORBIDDEN


@patch("api.views.roles.user_has_permission", return_value=True)
@patch("api.views.roles.Organisation")
@patch("api.views.roles.Role")
def test_create_role_201(mock_role_cls, mock_org_cls, mock_perm):
    org = _make_org()
    mock_org_cls.FREE_PLAN = FREE_PLAN

    permissions = {
        "permissions": {"Apps": ["read"]},
        "app_permissions": {"Secrets": ["read"]},
    }

    created_role = _make_role(
        "CustomRole",
        org=org,
        is_default=False,
        permissions=permissions,
    )
    mock_role_cls.objects.filter.return_value.exists.return_value = False
    mock_role_cls.objects.create.return_value = created_role

    request = _build_request(
        "post",
        "/public/v1/roles/",
        org,
        data={
            "name": "CustomRole",
            "permissions": permissions,
            "description": "A custom role",
            "color": "#FF0000",
        },
    )
    view = PublicRolesView.as_view()
    response = view(request)

    assert response.status_code == status.HTTP_201_CREATED
    mock_role_cls.objects.create.assert_called_once()


@patch("api.views.roles.user_has_permission", return_value=True)
@patch("api.views.roles.Organisation")
@patch("api.views.roles.Role")
def test_create_role_missing_name_400(mock_role_cls, mock_org_cls, mock_perm):
    org = _make_org()
    mock_org_cls.FREE_PLAN = FREE_PLAN

    request = _build_request(
        "post",
        "/public/v1/roles/",
        org,
        data={"permissions": {"permissions": {}}},
    )
    view = PublicRolesView.as_view()
    response = view(request)

    assert response.status_code == status.HTTP_400_BAD_REQUEST


@patch("api.views.roles.user_has_permission", return_value=True)
@patch("api.views.roles.Organisation")
@patch("api.views.roles.Role")
def test_create_role_missing_permissions_400(mock_role_cls, mock_org_cls, mock_perm):
    org = _make_org()
    mock_org_cls.FREE_PLAN = FREE_PLAN
    mock_role_cls.objects.filter.return_value.exists.return_value = False

    request = _build_request(
        "post",
        "/public/v1/roles/",
        org,
        data={"name": "TestRole"},
    )
    view = PublicRolesView.as_view()
    response = view(request)

    assert response.status_code == status.HTTP_400_BAD_REQUEST


@patch("api.views.roles.user_has_permission", return_value=True)
@patch("api.views.roles.Organisation")
@patch("api.views.roles.Role")
def test_create_role_duplicate_name_409(mock_role_cls, mock_org_cls, mock_perm):
    org = _make_org()
    mock_org_cls.FREE_PLAN = FREE_PLAN

    mock_role_cls.objects.filter.return_value.exists.return_value = True

    request = _build_request(
        "post",
        "/public/v1/roles/",
        org,
        data={"name": "Owner", "permissions": {"permissions": {}}},
    )
    view = PublicRolesView.as_view()
    response = view(request)

    assert response.status_code == status.HTTP_409_CONFLICT


@patch("api.views.roles.user_has_permission", return_value=True)
@patch("api.views.roles.Organisation")
def test_create_role_free_plan_403(mock_org_cls, mock_perm):
    org = _make_org(plan=FREE_PLAN)
    mock_org_cls.FREE_PLAN = FREE_PLAN

    request = _build_request(
        "post",
        "/public/v1/roles/",
        org,
        data={"name": "Custom", "permissions": {"permissions": {}}},
    )
    view = PublicRolesView.as_view()
    response = view(request)

    assert response.status_code == status.HTTP_403_FORBIDDEN


@patch("api.views.roles.user_has_permission", return_value=True)
@patch("api.views.roles.Organisation")
@patch("api.views.roles.Role")
def test_create_role_name_too_long_400(mock_role_cls, mock_org_cls, mock_perm):
    org = _make_org()
    mock_org_cls.FREE_PLAN = FREE_PLAN

    request = _build_request(
        "post",
        "/public/v1/roles/",
        org,
        data={"name": "x" * 65, "permissions": {"permissions": {}}},
    )
    view = PublicRolesView.as_view()
    response = view(request)

    assert response.status_code == status.HTTP_400_BAD_REQUEST


# ────────────────────────────────────────────────────────────────────
# PublicRoleDetailView tests
# ────────────────────────────────────────────────────────────────────


@patch("api.views.roles.user_has_permission", return_value=True)
@patch("api.views.roles.Role")
def test_get_role_200(mock_role_cls, mock_perm):
    org = _make_org()
    role = _make_role("Owner", org=org)
    mock_role_cls.objects.get.return_value = role

    request = _build_request("get", f"/public/v1/roles/{role.id}/", org)
    view = PublicRoleDetailView.as_view()
    response = view(request, role_id=role.id)

    assert response.status_code == status.HTTP_200_OK
    assert response.data["name"] == "Owner"
    assert "permissions" in response.data


@patch("api.views.roles.user_has_permission", return_value=True)
@patch("api.views.roles.Role")
def test_get_role_not_found_404(mock_role_cls, mock_perm):
    org = _make_org()
    mock_role_cls.objects.get.side_effect = ObjectDoesNotExist

    request = _build_request("get", "/public/v1/roles/nonexistent/", org)
    view = PublicRoleDetailView.as_view()
    response = view(request, role_id="nonexistent")

    assert response.status_code == status.HTTP_404_NOT_FOUND


@patch("api.views.roles.user_has_permission", return_value=True)
@patch("api.views.roles.Organisation")
@patch("api.views.roles.Role")
def test_update_role_200(mock_role_cls, mock_org_cls, mock_perm):
    org = _make_org()
    mock_org_cls.FREE_PLAN = FREE_PLAN
    role = _make_role("CustomRole", org=org, is_default=False)
    mock_role_cls.objects.select_for_update.return_value.get.return_value = role
    mock_role_cls.objects.filter.return_value.exclude.return_value.exists.return_value = False

    request = _build_request(
        "put",
        f"/public/v1/roles/{role.id}/",
        org,
        data={"name": "UpdatedRole"},
    )
    view = PublicRoleDetailView.as_view()
    response = view(request, role_id=role.id)

    assert response.status_code == status.HTTP_200_OK
    role.save.assert_called_once()


@patch("api.views.roles.user_has_permission", return_value=True)
@patch("api.views.roles.Organisation")
@patch("api.views.roles.Role")
def test_update_default_role_403(mock_role_cls, mock_org_cls, mock_perm):
    org = _make_org()
    mock_org_cls.FREE_PLAN = FREE_PLAN
    role = _make_role("Owner", org=org, is_default=True)
    mock_role_cls.objects.select_for_update.return_value.get.return_value = role

    request = _build_request(
        "put",
        f"/public/v1/roles/{role.id}/",
        org,
        data={"name": "NewOwner"},
    )
    view = PublicRoleDetailView.as_view()
    response = view(request, role_id=role.id)

    assert response.status_code == status.HTTP_403_FORBIDDEN


@patch("api.views.roles.user_has_permission", return_value=True)
@patch("api.views.roles.Organisation")
@patch("api.views.roles.Role")
def test_update_role_no_fields_400(mock_role_cls, mock_org_cls, mock_perm):
    org = _make_org()
    mock_org_cls.FREE_PLAN = FREE_PLAN
    role = _make_role("CustomRole", org=org, is_default=False)
    mock_role_cls.objects.select_for_update.return_value.get.return_value = role

    request = _build_request(
        "put",
        f"/public/v1/roles/{role.id}/",
        org,
        data={},
    )
    view = PublicRoleDetailView.as_view()
    response = view(request, role_id=role.id)

    assert response.status_code == status.HTTP_400_BAD_REQUEST


@patch("api.views.roles.user_has_permission", return_value=True)
@patch("api.views.roles.Organisation")
@patch("api.views.roles.Role")
def test_update_role_blank_name_400(mock_role_cls, mock_org_cls, mock_perm):
    org = _make_org()
    mock_org_cls.FREE_PLAN = FREE_PLAN
    role = _make_role("CustomRole", org=org, is_default=False)
    mock_role_cls.objects.select_for_update.return_value.get.return_value = role

    request = _build_request(
        "put",
        f"/public/v1/roles/{role.id}/",
        org,
        data={"name": "  "},
    )
    view = PublicRoleDetailView.as_view()
    response = view(request, role_id=role.id)

    assert response.status_code == status.HTTP_400_BAD_REQUEST


@patch("api.views.roles.user_has_permission", return_value=True)
@patch("api.views.roles.Organisation")
@patch("api.views.roles.Role")
def test_update_role_duplicate_name_409(mock_role_cls, mock_org_cls, mock_perm):
    org = _make_org()
    mock_org_cls.FREE_PLAN = FREE_PLAN
    role = _make_role("CustomRole", org=org, is_default=False)
    mock_role_cls.objects.select_for_update.return_value.get.return_value = role
    mock_role_cls.objects.filter.return_value.exclude.return_value.exists.return_value = True

    request = _build_request(
        "put",
        f"/public/v1/roles/{role.id}/",
        org,
        data={"name": "ExistingRole"},
    )
    view = PublicRoleDetailView.as_view()
    response = view(request, role_id=role.id)

    assert response.status_code == status.HTTP_409_CONFLICT


@patch("api.views.roles.user_has_permission", return_value=True)
@patch("api.views.roles.OrganisationMemberInvite")
@patch("api.views.roles.ServiceAccount")
@patch("api.views.roles.OrganisationMember")
@patch("api.views.roles.Role")
def test_delete_role_204(
    mock_role_cls, mock_member_cls, mock_sa_cls, mock_invite_cls, mock_perm
):
    org = _make_org()
    role = _make_role("CustomRole", org=org, is_default=False)
    mock_role_cls.objects.get.return_value = role
    mock_member_cls.objects.filter.return_value.exists.return_value = False
    mock_sa_cls.objects.filter.return_value.exists.return_value = False
    mock_invite_cls.objects.filter.return_value.exists.return_value = False

    request = _build_request("delete", f"/public/v1/roles/{role.id}/", org)
    view = PublicRoleDetailView.as_view()
    response = view(request, role_id=role.id)

    assert response.status_code == status.HTTP_204_NO_CONTENT
    role.delete.assert_called_once()


@patch("api.views.roles.user_has_permission", return_value=True)
@patch("api.views.roles.Role")
def test_delete_default_role_403(mock_role_cls, mock_perm):
    org = _make_org()
    role = _make_role("Owner", org=org, is_default=True)
    mock_role_cls.objects.get.return_value = role

    request = _build_request("delete", f"/public/v1/roles/{role.id}/", org)
    view = PublicRoleDetailView.as_view()
    response = view(request, role_id=role.id)

    assert response.status_code == status.HTTP_403_FORBIDDEN


@patch("api.views.roles.user_has_permission", return_value=True)
@patch("api.views.roles.Role")
def test_delete_role_not_found_404(mock_role_cls, mock_perm):
    org = _make_org()
    mock_role_cls.objects.get.side_effect = ObjectDoesNotExist

    request = _build_request("delete", "/public/v1/roles/nonexistent/", org)
    view = PublicRoleDetailView.as_view()
    response = view(request, role_id="nonexistent")

    assert response.status_code == status.HTTP_404_NOT_FOUND


@patch("api.views.roles.user_has_permission", return_value=True)
@patch("api.views.roles.ServiceAccount")
@patch("api.views.roles.OrganisationMember")
@patch("api.views.roles.Role")
def test_delete_role_with_members_409(mock_role_cls, mock_member_cls, mock_sa_cls, mock_perm):
    org = _make_org()
    role = _make_role("CustomRole", org=org, is_default=False)
    mock_role_cls.objects.get.return_value = role
    mock_member_cls.objects.filter.return_value.exists.return_value = True

    request = _build_request("delete", f"/public/v1/roles/{role.id}/", org)
    view = PublicRoleDetailView.as_view()
    response = view(request, role_id=role.id)

    assert response.status_code == status.HTTP_409_CONFLICT


@patch("api.views.roles.user_has_permission", return_value=True)
@patch("api.views.roles.OrganisationMemberInvite")
@patch("api.views.roles.ServiceAccount")
@patch("api.views.roles.OrganisationMember")
@patch("api.views.roles.Role")
def test_delete_role_with_service_accounts_409(
    mock_role_cls, mock_member_cls, mock_sa_cls, mock_invite_cls, mock_perm
):
    org = _make_org()
    role = _make_role("CustomRole", org=org, is_default=False)
    mock_role_cls.objects.get.return_value = role
    mock_member_cls.objects.filter.return_value.exists.return_value = False
    mock_sa_cls.objects.filter.return_value.exists.return_value = True
    mock_invite_cls.objects.filter.return_value.exists.return_value = False

    request = _build_request("delete", f"/public/v1/roles/{role.id}/", org)
    view = PublicRoleDetailView.as_view()
    response = view(request, role_id=role.id)

    assert response.status_code == status.HTTP_409_CONFLICT


@patch("api.views.roles.user_has_permission", return_value=True)
@patch("api.views.roles.OrganisationMemberInvite")
@patch("api.views.roles.ServiceAccount")
@patch("api.views.roles.OrganisationMember")
@patch("api.views.roles.Role")
def test_delete_role_with_pending_invites_409(
    mock_role_cls, mock_member_cls, mock_sa_cls, mock_invite_cls, mock_perm
):
    # F-015: deleting a role still referenced by a pending invite must
    # 409, otherwise the invite is orphaned with role=null and any
    # subsequent cancel via DELETE /v1/members/invites/<id>/ 500s.
    org = _make_org()
    role = _make_role("CustomRole", org=org, is_default=False)
    mock_role_cls.objects.get.return_value = role
    mock_member_cls.objects.filter.return_value.exists.return_value = False
    mock_sa_cls.objects.filter.return_value.exists.return_value = False
    mock_invite_cls.objects.filter.return_value.exists.return_value = True

    request = _build_request("delete", f"/public/v1/roles/{role.id}/", org)
    view = PublicRoleDetailView.as_view()
    response = view(request, role_id=role.id)

    assert response.status_code == status.HTTP_409_CONFLICT


# ════════════════════════════════════════════════════════════════════
# global_access is not part of the custom-role API contract — any
# attempt to set it on POST or PUT must be rejected as an unknown key,
# regardless of value. The flag is hardcoded on Owner / Admin in
# api/utils/access/roles.py and shouldn't be reachable from API input.
# ════════════════════════════════════════════════════════════════════


@patch("api.views.roles.user_has_permission", return_value=True)
@patch("api.views.roles.Organisation")
@patch("api.views.roles.Role")
def test_create_role_rejects_global_access_key(
    mock_role_cls, mock_org_cls, mock_perm
):
    org = _make_org()
    mock_org_cls.FREE_PLAN = FREE_PLAN
    mock_role_cls.objects.filter.return_value.exists.return_value = False

    request = _build_request(
        "post",
        "/public/v1/roles/",
        org,
        data={
            "name": "ShadowAdmin",
            "permissions": {
                "permissions": {"Apps": ["read"]},
                "app_permissions": {"Secrets": ["read"]},
                "global_access": True,
            },
        },
    )
    response = PublicRolesView.as_view()(request)

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "global_access" in response.data["error"]
    mock_role_cls.objects.create.assert_not_called()


@patch("api.views.roles.user_has_permission", return_value=True)
@patch("api.views.roles.Organisation")
@patch("api.views.roles.Role")
def test_create_role_rejects_global_access_camelcase(
    mock_role_cls, mock_org_cls, mock_perm
):
    """Camel-case `globalAccess` is rejected too — the key isn't normalised."""
    org = _make_org()
    mock_org_cls.FREE_PLAN = FREE_PLAN
    mock_role_cls.objects.filter.return_value.exists.return_value = False

    request = _build_request(
        "post",
        "/public/v1/roles/",
        org,
        data={
            "name": "ShadowAdmin2",
            "permissions": {
                "permissions": {"Apps": ["read"]},
                "appPermissions": {"Secrets": ["read"]},
                "globalAccess": True,
            },
        },
    )
    response = PublicRolesView.as_view()(request)

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "globalAccess" in response.data["error"]
    mock_role_cls.objects.create.assert_not_called()


@patch("api.views.roles.user_has_permission", return_value=True)
@patch("api.views.roles.Organisation")
@patch("api.views.roles.Role")
def test_update_role_rejects_global_access_key(
    mock_role_cls, mock_org_cls, mock_perm
):
    org = _make_org()
    mock_org_cls.FREE_PLAN = FREE_PLAN
    role = _make_role(
        "CustomRole",
        org=org,
        is_default=False,
        permissions={
            "permissions": {"Apps": ["read"]},
            "app_permissions": {"Secrets": ["read"]},
        },
    )
    mock_role_cls.objects.select_for_update.return_value.get.return_value = role
    mock_role_cls.objects.filter.return_value.exclude.return_value.exists.return_value = False

    request = _build_request(
        "put",
        f"/public/v1/roles/{role.id}/",
        org,
        data={
            "permissions": {
                "permissions": {"Apps": ["read"]},
                "app_permissions": {"Secrets": ["read"]},
                "global_access": True,
            },
        },
    )
    response = PublicRoleDetailView.as_view()(request, role_id=role.id)

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "global_access" in response.data["error"]
    role.save.assert_not_called()


# ────────────────────────────────────────────────────────────────────
# Grant ceiling (escalation prevention) + legacy Service token writes
# ────────────────────────────────────────────────────────────────────


def _build_service_token_request(method, url, org, data=None):
    factory = APIRequestFactory()
    if method == "get":
        request = factory.get(url)
    elif method == "post":
        request = factory.post(url, data=data, format="json")
    elif method == "put":
        request = factory.put(url, data=data, format="json")
    else:
        request = factory.delete(url)

    auth = _make_auth(org, auth_type="Service", org_member=None)
    force_authenticate(request, user=_make_user(), token=auth)
    return request


def _build_sa_request(method, url, org, data=None, sa_role=None):
    factory = APIRequestFactory()
    request = (
        factory.post(url, data=data, format="json")
        if method == "post"
        else factory.put(url, data=data, format="json")
    )
    service_account = Mock()
    service_account.role = sa_role
    auth = _make_auth(
        org, auth_type="ServiceAccount", service_account=service_account
    )
    force_authenticate(request, user=_make_user(), token=auth)
    return request


@patch("api.views.roles.user_has_permission", return_value=True)
@patch("api.views.roles.Organisation")
@patch("api.views.roles.Role")
def test_create_role_above_actor_ceiling_403(mock_role_cls, mock_org_cls, mock_perm):
    org = _make_org()
    mock_org_cls.FREE_PLAN = FREE_PLAN
    mock_role_cls.objects.filter.return_value.exists.return_value = False

    # Manager's template has SSO: []
    request = _build_request(
        "post",
        "/public/v1/roles/",
        org,
        data={
            "name": "Escalator",
            "permissions": {"permissions": {"SSO": ["create"]}, "app_permissions": {}},
        },
        role_name="Manager",
    )
    response = PublicRolesView.as_view()(request)

    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert "permissions:SSO:create" in response.data["error"]
    mock_role_cls.objects.create.assert_not_called()


@patch("api.views.roles.user_has_permission", return_value=True)
@patch("api.views.roles.Organisation")
@patch("api.views.roles.Role")
def test_create_role_within_actor_ceiling_201(mock_role_cls, mock_org_cls, mock_perm):
    org = _make_org()
    mock_org_cls.FREE_PLAN = FREE_PLAN

    permissions = {
        "permissions": {"Members": ["read"]},
        "app_permissions": {"Secrets": ["read"]},
    }
    created_role = _make_role("TeamLead", org=org, is_default=False, permissions=permissions)
    mock_role_cls.objects.filter.return_value.exists.return_value = False
    mock_role_cls.objects.create.return_value = created_role

    request = _build_request(
        "post",
        "/public/v1/roles/",
        org,
        data={"name": "TeamLead", "permissions": permissions},
        role_name="Manager",
    )
    response = PublicRolesView.as_view()(request)

    assert response.status_code == status.HTTP_201_CREATED
    mock_role_cls.objects.create.assert_called_once()


@patch("api.views.roles.user_has_permission", return_value=True)
@patch("api.views.roles.Organisation")
@patch("api.views.roles.Role")
def test_global_access_actor_exempt_from_ceiling(mock_role_cls, mock_org_cls, mock_perm):
    org = _make_org()
    mock_org_cls.FREE_PLAN = FREE_PLAN

    # Admin lacks Organisation:delete in its own template but has
    # global_access — the delegation escape hatch
    permissions = {"permissions": {"Organisation": ["delete"]}, "app_permissions": {}}
    created_role = _make_role("OrgManager", org=org, is_default=False, permissions=permissions)
    mock_role_cls.objects.filter.return_value.exists.return_value = False
    mock_role_cls.objects.create.return_value = created_role

    request = _build_request(
        "post",
        "/public/v1/roles/",
        org,
        data={"name": "OrgManager", "permissions": permissions},
        role_name="Admin",
    )
    response = PublicRolesView.as_view()(request)

    assert response.status_code == status.HTTP_201_CREATED
    mock_role_cls.objects.create.assert_called_once()


@patch("api.views.roles.user_has_permission", return_value=True)
@patch("api.views.roles.Organisation")
@patch("api.views.roles.Role")
def test_update_role_above_actor_ceiling_403(mock_role_cls, mock_org_cls, mock_perm):
    org = _make_org()
    mock_org_cls.FREE_PLAN = FREE_PLAN
    role = _make_role("CustomRole", org=org, is_default=False)
    mock_role_cls.objects.select_for_update.return_value.get.return_value = role
    mock_role_cls.objects.filter.return_value.exclude.return_value.exists.return_value = False

    # Manager's template has SCIM: []
    request = _build_request(
        "put",
        f"/public/v1/roles/{role.id}/",
        org,
        data={"permissions": {"permissions": {"SCIM": ["read"]}, "app_permissions": {}}},
        role_name="Manager",
    )
    response = PublicRoleDetailView.as_view()(request, role_id=role.id)

    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert "permissions:SCIM:read" in response.data["error"]
    role.save.assert_not_called()


@patch("api.views.roles.user_has_permission", return_value=True)
@patch("api.views.roles.Organisation")
@patch("api.views.roles.Role")
def test_sa_actor_ceiling_uses_stored_role_json(mock_role_cls, mock_org_cls, mock_perm):
    org = _make_org()
    mock_org_cls.FREE_PLAN = FREE_PLAN
    mock_role_cls.objects.filter.return_value.exists.return_value = False

    sa_role = _make_role(
        "RoleBot",
        org=org,
        is_default=False,
        permissions={"permissions": {"Roles": ["create", "read"]}, "app_permissions": {}},
    )
    request = _build_sa_request(
        "post",
        "/public/v1/roles/",
        org,
        data={
            "name": "Escalator",
            "permissions": {"permissions": {"Members": ["read"]}, "app_permissions": {}},
        },
        sa_role=sa_role,
    )
    response = PublicRolesView.as_view()(request)

    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert "permissions:Members:read" in response.data["error"]
    mock_role_cls.objects.create.assert_not_called()


@patch("api.views.roles.Role")
def test_service_token_cannot_create_roles(mock_role_cls):
    org = _make_org()
    request = _build_service_token_request(
        "post",
        "/public/v1/roles/",
        org,
        data={
            "name": "Escalator",
            "permissions": {"permissions": {"Members": ["read"]}, "app_permissions": {}},
        },
    )
    response = PublicRolesView.as_view()(request)

    assert response.status_code == status.HTTP_403_FORBIDDEN
    mock_role_cls.objects.create.assert_not_called()


@patch("api.views.roles.Role")
def test_service_token_cannot_update_or_delete_roles(mock_role_cls):
    org = _make_org()
    role = _make_role("CustomRole", org=org, is_default=False)
    mock_role_cls.objects.get.return_value = role

    put_request = _build_service_token_request(
        "put",
        f"/public/v1/roles/{role.id}/",
        org,
        data={"name": "Renamed"},
    )
    put_response = PublicRoleDetailView.as_view()(put_request, role_id=role.id)
    assert put_response.status_code == status.HTTP_403_FORBIDDEN
    role.save.assert_not_called()

    delete_request = _build_service_token_request(
        "delete", f"/public/v1/roles/{role.id}/", org
    )
    delete_response = PublicRoleDetailView.as_view()(delete_request, role_id=role.id)
    assert delete_response.status_code == status.HTTP_403_FORBIDDEN
    role.delete.assert_not_called()


@patch("api.views.roles.Role")
def test_service_token_can_still_list_roles(mock_role_cls):
    org = _make_org()
    mock_role_cls.objects.filter.return_value.order_by.return_value = []

    request = _build_service_token_request("get", "/public/v1/roles/", org)
    response = PublicRolesView.as_view()(request)

    assert response.status_code == status.HTTP_200_OK


@patch("api.views.roles.user_has_permission", return_value=True)
@patch("api.views.roles.Organisation")
@patch("api.views.roles.Role")
def test_update_role_de_escalation_above_ceiling_200(mock_role_cls, mock_org_cls, mock_perm):
    from api.utils.access.permissions import role_grant_violations

    org = _make_org()
    mock_org_cls.FREE_PLAN = FREE_PLAN
    # Only additions are ceilinged, so a Manager can strip permissions
    # they don't hold from a grandfathered role
    above_ceiling = {"permissions": {"SSO": ["create"]}, "app_permissions": {}}
    assert role_grant_violations(_make_org_member(org, role_name="Manager").role, above_ceiling)
    role = _make_role("SSO Admin", org=org, is_default=False, permissions=above_ceiling)
    mock_role_cls.objects.select_for_update.return_value.get.return_value = role

    within_ceiling = {"permissions": {"Members": ["read"]}, "app_permissions": {}}
    request = _build_request(
        "put",
        f"/public/v1/roles/{role.id}/",
        org,
        data={"permissions": within_ceiling},
        role_name="Manager",
    )
    response = PublicRoleDetailView.as_view()(request, role_id=role.id)

    assert response.status_code == status.HTTP_200_OK
    assert role.permissions == within_ceiling
    role.save.assert_called_once()


@patch("api.views.roles.user_has_permission", return_value=True)
@patch("api.views.roles.Organisation")
@patch("api.views.roles.Role")
def test_update_role_global_access_actor_exempt_200(mock_role_cls, mock_org_cls, mock_perm):
    org = _make_org()
    mock_org_cls.FREE_PLAN = FREE_PLAN
    role = _make_role("CustomRole", org=org, is_default=False)
    mock_role_cls.objects.select_for_update.return_value.get.return_value = role

    # Admin lacks Organisation:delete in its own template but has global_access
    org_delete = {"permissions": {"Organisation": ["delete"]}, "app_permissions": {}}
    request = _build_request(
        "put",
        f"/public/v1/roles/{role.id}/",
        org,
        data={"permissions": org_delete},
        role_name="Admin",
    )
    response = PublicRoleDetailView.as_view()(request, role_id=role.id)

    assert response.status_code == status.HTTP_200_OK
    assert role.permissions == org_delete
    role.save.assert_called_once()


SSO_CREATE = {"permissions": {"SSO": ["create"]}, "app_permissions": {}}


@patch("api.views.roles.user_has_permission", return_value=True)
@patch("api.views.roles.Organisation")
@patch("api.views.roles.Role")
def test_update_role_rename_keeps_grandfathered_permissions_200(
    mock_role_cls, mock_org_cls, mock_perm, _no_db_transaction
):
    org = _make_org()
    mock_org_cls.FREE_PLAN = FREE_PLAN
    # Manager below the role's ceiling renames it, resubmitting the policy verbatim
    role = _make_role("SSO Admin", org=org, is_default=False, permissions=SSO_CREATE)
    mock_role_cls.objects.select_for_update.return_value.get.return_value = role
    mock_role_cls.objects.filter.return_value.exclude.return_value.exists.return_value = False

    request = _build_request(
        "put",
        f"/public/v1/roles/{role.id}/",
        org,
        data={"name": "SSO Owner", "permissions": SSO_CREATE},
        role_name="Manager",
    )
    response = PublicRoleDetailView.as_view()(request, role_id=role.id)

    assert response.status_code == status.HTTP_200_OK
    assert role.name == "SSO Owner"
    assert role.permissions == SSO_CREATE
    role.save.assert_called_once()
    # Fetched under a row lock inside a transaction
    _no_db_transaction.atomic.assert_called_once()
    mock_role_cls.objects.select_for_update.assert_called_once()


@patch("api.views.roles.user_has_permission", return_value=True)
@patch("api.views.roles.Organisation")
@patch("api.views.roles.Role")
def test_update_role_partial_de_escalation_200(mock_role_cls, mock_org_cls, mock_perm):
    org = _make_org()
    mock_org_cls.FREE_PLAN = FREE_PLAN
    role = _make_role(
        "SSO Admin",
        org=org,
        is_default=False,
        permissions={"permissions": {"SSO": ["create", "delete"]}, "app_permissions": {}},
    )
    mock_role_cls.objects.select_for_update.return_value.get.return_value = role

    request = _build_request(
        "put",
        f"/public/v1/roles/{role.id}/",
        org,
        data={"permissions": SSO_CREATE},
        role_name="Manager",
    )
    response = PublicRoleDetailView.as_view()(request, role_id=role.id)

    assert response.status_code == status.HTTP_200_OK
    assert role.permissions == SSO_CREATE
    role.save.assert_called_once()


@patch("api.views.roles.user_has_permission", return_value=True)
@patch("api.views.roles.Organisation")
@patch("api.views.roles.Role")
def test_update_role_rejects_only_new_over_ceiling_permissions_403(
    mock_role_cls, mock_org_cls, mock_perm
):
    org = _make_org()
    mock_org_cls.FREE_PLAN = FREE_PLAN
    role = _make_role("SSO Admin", org=org, is_default=False, permissions=SSO_CREATE)
    mock_role_cls.objects.select_for_update.return_value.get.return_value = role

    request = _build_request(
        "put",
        f"/public/v1/roles/{role.id}/",
        org,
        data={
            "permissions": {
                "permissions": {"SSO": ["create"], "SCIM": ["read"]},
                "app_permissions": {},
            }
        },
        role_name="Manager",
    )
    response = PublicRoleDetailView.as_view()(request, role_id=role.id)

    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert "permissions:SCIM:read" in response.data["error"]
    assert "SSO:create" not in response.data["error"]
    assert role.permissions == SSO_CREATE
    role.save.assert_not_called()
