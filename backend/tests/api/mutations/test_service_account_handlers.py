import pytest
from unittest.mock import MagicMock, patch
from graphql import GraphQLError


class TestUpdateServiceAccountHandlersMutationPermission:
    """Tests that UpdateServiceAccountHandlersMutation checks proper permissions."""

    @patch("backend.graphene.mutations.service_accounts.ServiceAccountHandler")
    @patch("backend.graphene.mutations.service_accounts.ServiceAccount")
    @patch("backend.graphene.mutations.service_accounts.user_has_permission", return_value=False)
    @patch("backend.graphene.mutations.service_accounts.Organisation")
    def test_rejects_user_without_service_account_permission(
        self, MockOrg, mock_perm, MockSA, MockHandler
    ):
        """A user without ServiceAccounts update permission should be rejected."""
        from backend.graphene.mutations.service_accounts import (
            UpdateServiceAccountHandlersMutation,
        )

        mock_org = MagicMock()
        MockOrg.objects.get.return_value = mock_org

        mock_info = MagicMock()
        mock_info.context.user.userId = "user-123"

        with pytest.raises(
            GraphQLError,
            match="You don't have the permissions required to update Service Accounts",
        ):
            UpdateServiceAccountHandlersMutation.mutate(
                None, mock_info, "org-123", []
            )

        mock_perm.assert_called_once_with(
            mock_info.context.user, "update", "ServiceAccounts", mock_org
        )

    @patch("backend.graphene.mutations.service_accounts.ServiceAccountHandler")
    @patch("backend.graphene.mutations.service_accounts.ServiceAccount")
    @patch("backend.graphene.mutations.service_accounts.user_has_permission", return_value=True)
    @patch("backend.graphene.mutations.service_accounts.Organisation")
    def test_allows_user_with_service_account_permission(
        self, MockOrg, mock_perm, MockSA, MockHandler
    ):
        """A user with ServiceAccounts update permission should be allowed."""
        from backend.graphene.mutations.service_accounts import (
            UpdateServiceAccountHandlersMutation,
        )

        mock_org = MagicMock()
        MockOrg.objects.get.return_value = mock_org

        mock_info = MagicMock()

        MockHandler.objects.filter.return_value = MockHandler.objects
        MockHandler.objects.delete.return_value = None

        result = UpdateServiceAccountHandlersMutation.mutate(
            None, mock_info, "org-123", []
        )

        assert result.ok is True
