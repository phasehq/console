"""DeleteSecretMutation: the env-access check at the end of the
permission stack must fire. A copy-paste regression had previously
dropped it on this mutation while every sibling (Edit / BulkEdit /
BulkDelete / ReadSecret) kept it, allowing a user with team-granted
delete on env A to delete secrets in env B of the same multi-env app.
"""

from unittest.mock import MagicMock, patch

import pytest


_M = "backend.graphene.mutations.environment"


def _info(user):
    info = MagicMock()
    info.context.user = user
    info.context.user.userId = "user-1"
    info.context.META = {}
    return info


@patch(f"{_M}.user_can_access_environment", return_value=False)
@patch(f"{_M}.user_has_permission", return_value=True)
@patch(f"{_M}.Secret")
def test_delete_secret_refuses_when_user_lacks_env_access(
    MockSecret, mock_perm, mock_env_access
):
    """User has Secrets.delete on the app via a team that grants env A;
    target secret lives in env B. The Secrets.delete check passes (app-scoped),
    the env-access check must refuse — otherwise cross-env destructive write."""
    from backend.graphene.mutations.environment import DeleteSecretMutation
    from graphql import GraphQLError

    secret = MagicMock()
    secret.environment.id = "env-B"
    secret.environment.app.organisation = MagicMock()
    MockSecret.objects.get.return_value = secret

    with pytest.raises(GraphQLError, match="don't have access to this environment"):
        DeleteSecretMutation.mutate(None, _info(MagicMock()), id="secret-in-env-B")

    # Defensive: the destructive writes must not have run.
    assert secret.save.called is False
    mock_env_access.assert_called_once_with("user-1", "env-B")


@patch(f"{_M}.log_secret_event")
@patch(f"{_M}.OrganisationMember")
@patch(f"{_M}.user_can_access_environment", return_value=True)
@patch(f"{_M}.user_has_permission", return_value=True)
@patch(f"{_M}.Secret")
def test_delete_secret_proceeds_when_env_access_granted(
    MockSecret, mock_perm, mock_env_access, MockOM, mock_log,
):
    """The happy path: user has both Secrets.delete on the app and access
    to the secret's environment — the delete proceeds."""
    from backend.graphene.mutations.environment import DeleteSecretMutation

    secret = MagicMock()
    secret.environment.id = "env-A"
    secret.environment.app.organisation = MagicMock()
    MockSecret.objects.get.return_value = secret
    MockOM.objects.get.return_value = MagicMock()

    result = DeleteSecretMutation.mutate(None, _info(MagicMock()), id="secret-in-env-A")

    secret.save.assert_called_once()
    assert result.secret is secret
