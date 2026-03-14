import pytest
from unittest.mock import MagicMock, patch
from graphql import GraphQLError


class TestCreateSecretMutationEnvAccess:
    """Tests that CreateSecretMutation checks environment access."""

    @patch("backend.graphene.mutations.environment.log_secret_event")
    @patch("backend.graphene.mutations.environment.OrganisationMember")
    @patch("backend.graphene.mutations.environment.Secret")
    @patch("backend.graphene.mutations.environment.SecretTag")
    @patch("backend.graphene.mutations.environment.SecretFolder")
    @patch("backend.graphene.mutations.environment.user_can_access_environment", return_value=False)
    @patch("backend.graphene.mutations.environment.user_has_permission", return_value=True)
    @patch("backend.graphene.mutations.environment.Environment")
    def test_rejects_user_without_environment_access(
        self, MockEnv, mock_perm, mock_env_access, MockFolder, MockTag, MockSecret, MockOrgMember, mock_log
    ):
        """User with Secrets permission but no environment access should be rejected."""
        from backend.graphene.mutations.environment import CreateSecretMutation

        mock_env = MagicMock()
        mock_env.id = "env-123"
        mock_env.app.organisation = MagicMock()
        MockEnv.objects.get.return_value = mock_env

        mock_info = MagicMock()
        mock_info.context.user.userId = "user-123"

        secret_data = MagicMock()
        secret_data.env_id = "env-123"
        secret_data.tags = []
        secret_data.path = "/"
        secret_data.key = "test"
        secret_data.key_digest = "digest"
        secret_data.value = "value"
        secret_data.comment = ""

        with pytest.raises(GraphQLError, match="You don't have access to this environment"):
            CreateSecretMutation.mutate(None, mock_info, secret_data)

        mock_env_access.assert_called_once_with("user-123", "env-123")

    @patch("backend.graphene.mutations.environment.log_secret_event")
    @patch("backend.graphene.mutations.environment.OrganisationMember")
    @patch("backend.graphene.mutations.environment.normalize_path_string", return_value="/")
    @patch("backend.graphene.mutations.environment.Secret")
    @patch("backend.graphene.mutations.environment.SecretTag")
    @patch("backend.graphene.mutations.environment.user_can_access_environment", return_value=True)
    @patch("backend.graphene.mutations.environment.user_has_permission", return_value=True)
    @patch("backend.graphene.mutations.environment.Environment")
    def test_allows_user_with_environment_access(
        self, MockEnv, mock_perm, mock_env_access, MockTag, MockSecret, mock_normalize, MockOrgMember, mock_log
    ):
        """User with both Secrets permission and environment access should succeed."""
        from backend.graphene.mutations.environment import CreateSecretMutation

        mock_env = MagicMock()
        mock_env.id = "env-123"
        mock_env.app.organisation = MagicMock()
        MockEnv.objects.get.return_value = mock_env

        mock_info = MagicMock()
        mock_info.context.user.userId = "user-123"

        secret_data = MagicMock()
        secret_data.env_id = "env-123"
        secret_data.tags = []
        secret_data.path = None
        secret_data.key = "test"
        secret_data.key_digest = "digest"
        secret_data.value = "value"
        secret_data.comment = ""

        MockTag.objects.filter.return_value = []

        # Should not raise
        result = CreateSecretMutation.mutate(None, mock_info, secret_data)
        assert result is not None


class TestDeleteSecretMutationEnvAccess:
    """Tests that DeleteSecretMutation checks environment access."""

    @patch("backend.graphene.mutations.environment.user_can_access_environment", return_value=False)
    @patch("backend.graphene.mutations.environment.user_has_permission", return_value=True)
    @patch("backend.graphene.mutations.environment.Secret")
    def test_rejects_user_without_environment_access(
        self, MockSecret, mock_perm, mock_env_access
    ):
        """User with delete Secrets permission but no environment access should be rejected."""
        from backend.graphene.mutations.environment import DeleteSecretMutation

        mock_secret = MagicMock()
        mock_env = MagicMock()
        mock_env.id = "env-456"
        mock_secret.environment = mock_env
        mock_secret.environment.app.organisation = MagicMock()
        MockSecret.objects.get.return_value = mock_secret

        mock_info = MagicMock()
        mock_info.context.user.userId = "user-123"

        with pytest.raises(GraphQLError, match="You don't have access to this environment"):
            DeleteSecretMutation.mutate(None, mock_info, "secret-id")

        mock_env_access.assert_called_once_with("user-123", "env-456")
