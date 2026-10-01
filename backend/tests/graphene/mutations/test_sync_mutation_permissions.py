"""Authorization checks on sync create/manage mutations: source-environment
access, Integrations permissions, and credential org binding."""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from graphql import GraphQLError

from backend.graphene.mutations import syncing as mutations


def _make_info(user_id="actor-1"):
    info = MagicMock()
    info.context.user.userId = user_id
    return info


def _patch_sync_mutations(
    monkeypatch, *, app_access=True, env_access=True, permission=True, org=None
):
    org = org or MagicMock(id="org-1")

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

    monkeypatch.setattr(
        mutations, "user_can_access_app", MagicMock(return_value=app_access)
    )
    monkeypatch.setattr(
        mutations, "user_can_access_environment", MagicMock(return_value=env_access)
    )
    mock_permission = MagicMock(return_value=permission)
    monkeypatch.setattr(mutations, "user_has_permission", mock_permission)
    monkeypatch.setattr(mutations, "trigger_sync_tasks", MagicMock())

    return SimpleNamespace(
        env=env,
        credential=credential,
        sync_model=mock_sync_model,
        permission=mock_permission,
    )


CREATE_MUTATION_CASES = [
    (
        "CreateCloudflareWorkersSync",
        {
            "env_id": "env-1",
            "path": "/",
            "credential_id": "cred-1",
            "worker_name": "my-worker",
        },
    ),
    (
        "CreateRailwaySync",
        {
            "env_id": "env-1",
            "path": "/",
            "credential_id": "cred-1",
            "railway_project": SimpleNamespace(id="rp-1", name="proj"),
            "railway_environment": SimpleNamespace(id="re-1", name="production"),
        },
    ),
    (
        "CreateGitHubDependabotSync",
        {
            "env_id": "env-1",
            "path": "/",
            "credential_id": "cred-1",
            "repo_name": "demo-repo",
            "owner": "demo-owner",
        },
    ),
]


@pytest.mark.parametrize(("mutation_name", "kwargs"), CREATE_MUTATION_CASES)
def test_create_sync_rejects_without_environment_access(
    monkeypatch, mutation_name, kwargs
):
    mocks = _patch_sync_mutations(monkeypatch, env_access=False)
    mutation = getattr(mutations, mutation_name)

    with pytest.raises(GraphQLError, match="access to this environment"):
        mutation.mutate(None, _make_info(), **kwargs)

    mocks.sync_model.objects.create.assert_not_called()


@pytest.mark.parametrize(("mutation_name", "kwargs"), CREATE_MUTATION_CASES)
def test_create_sync_rejects_without_integrations_create_permission(
    monkeypatch, mutation_name, kwargs
):
    mocks = _patch_sync_mutations(monkeypatch, permission=False)
    mutation = getattr(mutations, mutation_name)

    with pytest.raises(GraphQLError, match="permission to create Integrations"):
        mutation.mutate(None, _make_info(), **kwargs)

    mocks.permission.assert_called_once()
    args, mutation_kwargs = mocks.permission.call_args
    assert args[1:] == ("create", "Integrations", mocks.env.app.organisation, True)
    assert mutation_kwargs == {"app": mocks.env.app}
    mocks.sync_model.objects.create.assert_not_called()


@pytest.mark.parametrize(("mutation_name", "kwargs"), CREATE_MUTATION_CASES)
def test_create_sync_succeeds_with_access_and_permission(
    monkeypatch, mutation_name, kwargs
):
    mocks = _patch_sync_mutations(monkeypatch)
    mutation = getattr(mutations, mutation_name)

    mutation.mutate(None, _make_info(), **kwargs)

    mocks.sync_model.objects.create.assert_called_once()


def _patch_manage_mutations(monkeypatch, *, env_access=True, permission=True):
    org = MagicMock(id="org-1")

    env_sync = MagicMock(id="sync-1")
    env_sync.environment.id = "env-1"
    env_sync.environment.app.organisation = org

    mock_sync_model = MagicMock()
    mock_sync_model.objects.get.return_value = env_sync
    monkeypatch.setattr(mutations, "EnvironmentSync", mock_sync_model)

    credential = MagicMock(id="cred-2", organisation=org)
    mock_creds_model = MagicMock()
    mock_creds_model.objects.get.return_value = credential
    monkeypatch.setattr(mutations, "ProviderCredentials", mock_creds_model)

    monkeypatch.setattr(
        mutations, "user_can_access_environment", MagicMock(return_value=env_access)
    )
    monkeypatch.setattr(
        mutations, "user_has_permission", MagicMock(return_value=permission)
    )
    monkeypatch.setattr(mutations, "trigger_sync_tasks", MagicMock())

    return SimpleNamespace(env_sync=env_sync, credential=credential, org=org)


@pytest.mark.parametrize(
    ("mutation_name", "error_match", "call_kwargs"),
    [
        ("DeleteSync", "permission to delete Integrations", {"sync_id": "sync-1"}),
        (
            "ToggleSyncActive",
            "permission to update Integrations",
            {"sync_id": "sync-1"},
        ),
        ("TriggerSync", "permission to trigger syncs", {"sync_id": "sync-1"}),
        (
            "UpdateSyncAuthentication",
            "permission to update Integrations",
            {"sync_id": "sync-1", "credential_id": "cred-2"},
        ),
    ],
)
def test_manage_sync_rejects_without_integrations_permission(
    monkeypatch, mutation_name, error_match, call_kwargs
):
    mocks = _patch_manage_mutations(monkeypatch, permission=False)
    mutation = getattr(mutations, mutation_name)

    with pytest.raises(GraphQLError, match=error_match):
        mutation.mutate(None, _make_info(), **call_kwargs)

    mocks.env_sync.delete.assert_not_called()
    mocks.env_sync.save.assert_not_called()


def test_trigger_sync_allows_create_only_permission(monkeypatch):
    _patch_manage_mutations(monkeypatch)
    permission = MagicMock(side_effect=lambda user, action, *a, **kw: action == "create")
    monkeypatch.setattr(mutations, "user_has_permission", permission)
    mock_trigger = MagicMock()
    monkeypatch.setattr(mutations, "trigger_sync_tasks", mock_trigger)

    mutations.TriggerSync.mutate(None, _make_info(), sync_id="sync-1")

    mock_trigger.assert_called_once()


def test_create_github_dependabot_sync_rejects_cross_org_credential(monkeypatch):
    mocks = _patch_sync_mutations(monkeypatch)
    mocks.credential.organisation = MagicMock(id="other-org")

    with pytest.raises(GraphQLError, match="does not belong to this organization"):
        mutations.CreateGitHubDependabotSync.mutate(
            None,
            _make_info(),
            env_id="env-1",
            path="/",
            credential_id="cred-1",
            repo_name="demo-repo",
            owner="demo-owner",
        )

    mocks.sync_model.objects.create.assert_not_called()


def test_update_sync_authentication_rejects_cross_org_credential(monkeypatch):
    mocks = _patch_manage_mutations(monkeypatch)
    mocks.credential.organisation = MagicMock(id="other-org")

    with pytest.raises(GraphQLError, match="does not belong to this organization"):
        mutations.UpdateSyncAuthentication.mutate(
            None, _make_info(), sync_id="sync-1", credential_id="cred-2"
        )

    mocks.env_sync.save.assert_not_called()


def test_update_sync_authentication_accepts_same_org_credential(monkeypatch):
    mocks = _patch_manage_mutations(monkeypatch)

    mutations.UpdateSyncAuthentication.mutate(
        None, _make_info(), sync_id="sync-1", credential_id="cred-2"
    )

    assert mocks.env_sync.authentication_id == "cred-2"
    mocks.env_sync.save.assert_called_once()
