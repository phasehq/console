"""DeleteEnvironment requires access to the environment itself: Environments:delete
is granted app-wide, but deleting cascades to every secret and dynamic secret in it."""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from graphql import GraphQLError

from backend.graphene.mutations import environment as env_mutations


def _make_info(user_id="actor-1"):
    return SimpleNamespace(
        context=SimpleNamespace(user=SimpleNamespace(userId=user_id))
    )


@pytest.fixture
def delete_mocks(monkeypatch):
    org = SimpleNamespace(id="org-1")
    app = SimpleNamespace(id="app-1", organisation=org)
    environment = MagicMock(id="env-prod", env_type="custom", app=app)
    environment.name = "prod"

    mock_env_model = MagicMock()
    mock_env_model.objects.get.return_value = environment
    monkeypatch.setattr(env_mutations, "Environment", mock_env_model)

    mock_rotating_model = MagicMock()
    mock_rotating_model.objects.filter.return_value.exists.return_value = False
    monkeypatch.setattr(env_mutations, "RotatingSecret", mock_rotating_model)

    mock_permission = MagicMock(return_value=True)
    monkeypatch.setattr(env_mutations, "user_has_permission", mock_permission)
    mock_env_access = MagicMock(return_value=True)
    monkeypatch.setattr(env_mutations, "user_can_access_environment", mock_env_access)

    monkeypatch.setattr(
        env_mutations, "can_use_custom_envs", MagicMock(return_value=True)
    )
    monkeypatch.setattr(
        env_mutations,
        "get_actor_info_from_graphql",
        MagicMock(return_value=("user", "actor-1", {})),
    )
    monkeypatch.setattr(
        env_mutations, "get_resolver_request_meta", MagicMock(return_value=(None, None))
    )
    mock_audit = MagicMock()
    monkeypatch.setattr(env_mutations, "log_audit_event", mock_audit)

    return SimpleNamespace(
        environment=environment,
        rotating_model=mock_rotating_model,
        permission=mock_permission,
        env_access=mock_env_access,
        audit=mock_audit,
    )


def _delete():
    return env_mutations.DeleteEnvironmentMutation.mutate(
        None, _make_info(), environment_id="env-prod"
    )


def test_delete_refuses_without_environment_access(delete_mocks):
    delete_mocks.env_access.return_value = False

    with pytest.raises(GraphQLError, match="access to this environment"):
        _delete()

    delete_mocks.env_access.assert_called_once_with("actor-1", "env-prod")
    delete_mocks.environment.delete.assert_not_called()
    delete_mocks.rotating_model.objects.filter.assert_not_called()
    delete_mocks.audit.assert_not_called()


def test_delete_proceeds_with_environment_access(delete_mocks):
    _delete()

    delete_mocks.environment.delete.assert_called_once()


def test_permission_is_checked_before_environment_access(delete_mocks):
    delete_mocks.permission.return_value = False

    with pytest.raises(GraphQLError, match="permission to delete environments"):
        _delete()

    delete_mocks.env_access.assert_not_called()
    delete_mocks.environment.delete.assert_not_called()


def test_rotating_secret_gate_still_applies(delete_mocks):
    delete_mocks.rotating_model.objects.filter.return_value.exists.return_value = True
    delete_mocks.permission.side_effect = (
        lambda user, action, resource, *args, **kwargs: resource != "RotatingSecrets"
    )

    with pytest.raises(GraphQLError, match="contains rotating secrets"):
        _delete()

    delete_mocks.environment.delete.assert_not_called()
