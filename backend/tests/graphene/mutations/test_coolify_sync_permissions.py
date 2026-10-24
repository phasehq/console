"""Authorization checks on the Coolify sync create mutation: source
environment access and the app-level Integrations permission."""

from unittest.mock import MagicMock

import pytest
from graphql import GraphQLError

from backend.graphene.mutations import syncing as mutations


SYNC_KWARGS = {
    "env_id": "env-1",
    "path": "/",
    "credential_id": "cred-1",
    "application_uuid": "abcd1234efgh5678ijkl9012",
    "application_name": "my-app",
}


def _make_info(user_id="actor-1"):
    info = MagicMock()
    info.context.user.userId = user_id
    return info


def _patch_mutations(monkeypatch, *, env_access=True, permission=True):
    org = MagicMock(id="org-1")

    env = MagicMock(id="env-1")
    env.app.id = "app-1"
    env.app.organisation = org
    env.app.sse_enabled = True

    mock_env_model = MagicMock()
    mock_env_model.objects.get.return_value = env
    monkeypatch.setattr(mutations, "Environment", mock_env_model)

    credential = MagicMock(id="cred-1", organisation=org)
    mock_creds_model = MagicMock()
    mock_creds_model.objects.get.return_value = credential
    monkeypatch.setattr(mutations, "ProviderCredentials", mock_creds_model)

    mock_sync_model = MagicMock()
    mock_sync_model.objects.filter.return_value = []
    monkeypatch.setattr(mutations, "EnvironmentSync", mock_sync_model)

    monkeypatch.setattr(mutations, "user_can_access_app", MagicMock(return_value=True))
    monkeypatch.setattr(
        mutations, "user_can_access_environment", MagicMock(return_value=env_access)
    )
    monkeypatch.setattr(
        mutations, "user_has_permission", MagicMock(return_value=permission)
    )
    monkeypatch.setattr(mutations, "trigger_sync_tasks", MagicMock())

    return mock_sync_model


def test_create_coolify_sync_rejects_without_environment_access(monkeypatch):
    sync_model = _patch_mutations(monkeypatch, env_access=False)

    with pytest.raises(GraphQLError, match="access to this environment"):
        mutations.CreateCoolifySync.mutate(None, _make_info(), **SYNC_KWARGS)

    sync_model.objects.create.assert_not_called()


def test_create_coolify_sync_rejects_without_integrations_create_permission(
    monkeypatch,
):
    sync_model = _patch_mutations(monkeypatch, permission=False)

    with pytest.raises(GraphQLError, match="permission to create Integrations"):
        mutations.CreateCoolifySync.mutate(None, _make_info(), **SYNC_KWARGS)

    sync_model.objects.create.assert_not_called()


def test_create_coolify_sync_succeeds_with_access_and_permission(monkeypatch):
    sync_model = _patch_mutations(monkeypatch)

    mutations.CreateCoolifySync.mutate(None, _make_info(), **SYNC_KWARGS)

    sync_model.objects.create.assert_called_once()


def test_create_coolify_sync_rejects_duplicate_application(monkeypatch):
    sync_model = _patch_mutations(monkeypatch)
    existing = MagicMock()
    existing.options = {
        "application_uuid": SYNC_KWARGS["application_uuid"],
        "application_name": "renamed-app",
    }
    sync_model.objects.filter.return_value = [existing]

    with pytest.raises(GraphQLError, match="already exists for this Coolify"):
        mutations.CreateCoolifySync.mutate(None, _make_info(), **SYNC_KWARGS)

    sync_model.objects.create.assert_not_called()
