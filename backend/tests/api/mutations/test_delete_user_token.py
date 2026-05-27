import pytest
from unittest.mock import MagicMock, patch
from graphql import GraphQLError


class TestDeleteUserTokenMutationOwnership:
    """Tests that DeleteUserTokenMutation enforces token ownership."""

    @patch("backend.graphene.mutations.environment.UserToken")
    def test_rejects_deletion_of_another_users_token(self, MockUserToken):
        """A user should not be able to delete another user's token."""
        from backend.graphene.mutations.environment import DeleteUserTokenMutation

        requesting_user = MagicMock()
        requesting_user.userId = "user-A"

        token_owner = MagicMock()
        # token.user is an OrgMember, token.user.user is the actual User
        mock_token = MagicMock()
        mock_token.user.user = token_owner  # Different user object

        MockUserToken.objects.get.return_value = mock_token

        mock_info = MagicMock()
        mock_info.context.user = requesting_user

        with pytest.raises(GraphQLError, match="You don't have permission to delete this token"):
            DeleteUserTokenMutation.mutate(None, mock_info, "token-123")

        # Token should not have been modified
        mock_token.save.assert_not_called()

    @patch("backend.graphene.mutations.environment.UserToken")
    def test_allows_deletion_of_own_token(self, MockUserToken):
        """A user should be able to delete their own token."""
        from backend.graphene.mutations.environment import DeleteUserTokenMutation

        the_user = MagicMock()

        mock_token = MagicMock()
        mock_token.user.user = the_user  # Same user object

        MockUserToken.objects.get.return_value = mock_token

        mock_info = MagicMock()
        mock_info.context.user = the_user  # Same user

        result = DeleteUserTokenMutation.mutate(None, mock_info, "token-123")

        assert result.ok is True
        mock_token.save.assert_called_once()
        assert mock_token.deleted_at is not None
