import pytest
from unittest.mock import MagicMock, patch
from api.utils.access.permissions import (
    role_has_permission,
    user_has_permission,
    role_has_global_access,
)
from api.utils.access.roles import ADMIN_ROLE_KEY, DEVELOPER_ROLE_KEY


class TestRoleHasPermission:
    def test_role_is_none(self):
        assert role_has_permission(None, "read", "Users") is False

    def test_default_role_permission(self):
        role = MagicMock()
        role.is_default = True
        role.name = "Renamed administrator"
        role.managed_key = ADMIN_ROLE_KEY

        # Admin has broad access
        assert role_has_permission(role, "create", "Apps") is True
        assert role_has_permission(role, "delete", "Members") is True
        assert role_has_permission(role, "unknown", "Apps") is False

    def test_default_role_app_permission(self):
        role = MagicMock()
        role.is_default = True
        role.name = "admin"
        role.managed_key = ADMIN_ROLE_KEY

        assert (
            role_has_permission(role, "create", "Secrets", is_app_resource=True) is True
        )
        assert (
            role_has_permission(role, "delete", "Secrets", is_app_resource=True) is True
        )

    def test_developer_role_restrictions(self):
        role = MagicMock()
        role.is_default = True
        role.name = "developer"
        role.managed_key = DEVELOPER_ROLE_KEY

        # Developer can read apps but not create/delete
        assert role_has_permission(role, "read", "Apps") is True
        assert role_has_permission(role, "create", "Apps") is False
        assert role_has_permission(role, "delete", "Apps") is False

        # Developer can create secrets
        assert (
            role_has_permission(role, "create", "Secrets", is_app_resource=True) is True
        )

    def test_custom_role_permission(self):
        role = MagicMock()
        role.is_default = False
        role.permissions = {
            "permissions": {
                "Users": ["read"],
            },
            "app_permissions": {
                "Secrets": ["read"],
            },
        }

        assert role_has_permission(role, "read", "Users") is True
        assert role_has_permission(role, "create", "Users") is False

    def test_custom_role_app_permission(self):
        role = MagicMock()
        role.is_default = False
        role.permissions = {
            "permissions": {},
            "app_permissions": {
                "Secrets": ["read"],
            },
        }

        assert (
            role_has_permission(role, "read", "Secrets", is_app_resource=True) is True
        )
        assert (
            role_has_permission(role, "create", "Secrets", is_app_resource=True)
            is False
        )


class TestUserHasPermission:
    @patch("api.utils.access.permissions.apps.get_model")
    def test_user_has_permission_success(self, mock_get_model):
        # Setup mocks
        MockOrganisationMember = MagicMock()
        mock_get_model.return_value = MockOrganisationMember

        mock_user = MagicMock()
        mock_org = MagicMock()

        mock_member = MagicMock()
        mock_member.role.is_default = True
        mock_member.role.name = "admin"
        mock_member.role.managed_key = ADMIN_ROLE_KEY

        MockOrganisationMember.objects.get.return_value = mock_member

        # Test
        assert user_has_permission(mock_user, "create", "Apps", mock_org) is True

        # Verify call
        MockOrganisationMember.objects.get.assert_called_with(
            user=mock_user, organisation=mock_org, deleted_at=None
        )

    @patch("api.utils.access.permissions.apps.get_model")
    def test_user_not_member(self, mock_get_model):
        # Setup mocks
        MockOrganisationMember = MagicMock()
        mock_get_model.return_value = MockOrganisationMember

        # Simulate DoesNotExist
        MockOrganisationMember.DoesNotExist = Exception
        MockOrganisationMember.objects.get.side_effect = (
            MockOrganisationMember.DoesNotExist
        )

        assert user_has_permission(MagicMock(), "read", "Users", MagicMock()) is False

    @patch("api.utils.access.permissions.apps.get_model")
    def test_service_account_permission(self, mock_get_model):
        # Mock OrganisationMember
        MockOrganisationMember = MagicMock()
        mock_get_model.return_value = MockOrganisationMember

        # For service account, the account passed is the org_member (or behaves like one)
        mock_sa_member = MagicMock()
        mock_sa_member.role.is_default = True
        mock_sa_member.role.name = "developer"
        mock_sa_member.role.managed_key = DEVELOPER_ROLE_KEY

        assert (
            user_has_permission(
                mock_sa_member, "read", "Apps", MagicMock(), is_service_account=True
            )
            is True
        )
        assert (
            user_has_permission(
                mock_sa_member, "create", "Apps", MagicMock(), is_service_account=True
            )
            is False
        )


@patch("api.utils.access.permissions.apps.get_model")
class TestRoleHasGlobalAccess:
    def test_default_role_global_access(self, mock_get_model):
        MockRole = MagicMock()
        MockRole.DoesNotExist = Exception
        mock_get_model.return_value = MockRole

        role = MagicMock()
        role.is_default = True
        role.name = "admin"
        role.managed_key = ADMIN_ROLE_KEY
        assert role_has_global_access(role) is True

        role.name = "developer"
        role.managed_key = DEVELOPER_ROLE_KEY
        assert role_has_global_access(role) is False

    def test_custom_role_global_access(self, mock_get_model):
        MockRole = MagicMock()
        MockRole.DoesNotExist = Exception
        mock_get_model.return_value = MockRole

        role = MagicMock()
        role.is_default = False
        role.permissions = {"global_access": True}
        assert role_has_global_access(role) is False

        role.permissions = {"global_access": False}
        assert role_has_global_access(role) is False

    def test_custom_role_named_admin_has_no_global_access(self, mock_get_model):
        role = MagicMock()
        role.is_default = False
        role.name = "Admin"
        role.managed_key = None
        role.permissions = {"global_access": True}

        assert role_has_global_access(role) is False

    def test_invalid_default_role_state_fails_closed(self, mock_get_model):
        role = MagicMock()
        role.is_default = True
        role.name = "Owner"
        role.managed_key = None

        assert role_has_global_access(role) is False
        assert role_has_permission(role, "delete", "Roles") is False
