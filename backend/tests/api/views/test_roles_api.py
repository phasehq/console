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
    member.role = Mock()
    member.role.name = role_name
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
    assert len(response.data) == 3


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
        "global_access": False,
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
    mock_role_cls.objects.get.return_value = role
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
    mock_role_cls.objects.get.return_value = role

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
    mock_role_cls.objects.get.return_value = role

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
    mock_role_cls.objects.get.return_value = role

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
    mock_role_cls.objects.get.return_value = role
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
@patch("api.views.roles.ServiceAccount")
@patch("api.views.roles.OrganisationMember")
@patch("api.views.roles.Role")
def test_delete_role_204(mock_role_cls, mock_member_cls, mock_sa_cls, mock_perm):
    org = _make_org()
    role = _make_role("CustomRole", org=org, is_default=False)
    mock_role_cls.objects.get.return_value = role
    mock_member_cls.objects.filter.return_value.exists.return_value = False
    mock_sa_cls.objects.filter.return_value.exists.return_value = False

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
@patch("api.views.roles.ServiceAccount")
@patch("api.views.roles.OrganisationMember")
@patch("api.views.roles.Role")
def test_delete_role_with_service_accounts_409(mock_role_cls, mock_member_cls, mock_sa_cls, mock_perm):
    org = _make_org()
    role = _make_role("CustomRole", org=org, is_default=False)
    mock_role_cls.objects.get.return_value = role
    mock_member_cls.objects.filter.return_value.exists.return_value = False
    mock_sa_cls.objects.filter.return_value.exists.return_value = True

    request = _build_request("delete", f"/public/v1/roles/{role.id}/", org)
    view = PublicRoleDetailView.as_view()
    response = view(request, role_id=role.id)

    assert response.status_code == status.HTTP_409_CONFLICT
