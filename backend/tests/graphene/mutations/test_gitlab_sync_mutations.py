"""GitLab CI sync creation: environment scope validation and duplicate detection."""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from graphql import GraphQLError

from backend.graphene.mutations import syncing as mutations

GITLAB_HOST = "https://gitlab.example.com"


def _make_info(user_id="actor-1"):
    info = MagicMock()
    info.context.user.userId = user_id
    return info


@pytest.fixture
def sync_mocks(monkeypatch):
    org = MagicMock(id="org-1")

    env = MagicMock(id="env-1")
    env.app.id = "app-1"
    env.app.organisation = org
    env.app.sse_enabled = True

    mock_env_model = MagicMock()
    mock_env_model.objects.get.return_value = env
    monkeypatch.setattr(mutations, "Environment", mock_env_model)

    mock_creds_model = MagicMock()
    mock_creds_model.objects.get.return_value = MagicMock(
        id="cred-1", organisation=org, credentials={"gitlab_host": GITLAB_HOST}
    )
    monkeypatch.setattr(mutations, "ProviderCredentials", mock_creds_model)

    # Stored credentials are encrypted; the tests store the host in the clear
    monkeypatch.setattr(
        mutations, "get_gitlab_host", lambda credentials: credentials["gitlab_host"]
    )

    mock_sync_model = MagicMock()
    mock_sync_model.objects.filter.return_value = []
    monkeypatch.setattr(mutations, "EnvironmentSync", mock_sync_model)

    for check in (
        "user_can_access_app",
        "user_can_access_environment",
        "user_has_permission",
    ):
        monkeypatch.setattr(mutations, check, MagicMock(return_value=True))

    trigger = MagicMock()
    monkeypatch.setattr(mutations, "trigger_sync_tasks", trigger)

    return SimpleNamespace(sync_model=mock_sync_model, trigger=trigger)


def _create(environment_scope=None, **overrides):
    kwargs = {
        "env_id": "env-1",
        "path": "/",
        "credential_id": "cred-1",
        "resource_path": "phase/backend",
        "resource_id": "1",
        "is_group": False,
        "masked": False,
        "protected": False,
        **overrides,
    }
    if environment_scope is not None:
        kwargs["environment_scope"] = environment_scope
    return mutations.CreateGitLabCISync.mutate(None, _make_info(), **kwargs)


def _existing_sync(gitlab_host=GITLAB_HOST, **options):
    return SimpleNamespace(
        authentication=SimpleNamespace(credentials={"gitlab_host": gitlab_host}),
        options={
            "resource_path": "phase/backend",
            "resource_id": "1",
            "is_group": False,
            "masked": False,
            "protected": False,
            **options,
        },
    )


@pytest.mark.parametrize(
    ("environment_scope", "stored_scope"),
    [
        (None, "*"),
        ("", "*"),
        ("*", "*"),
        ("production", "production"),
        (" review/* ", "review/*"),
    ],
)
def test_create_gitlab_sync_stores_normalized_environment_scope(
    sync_mocks, environment_scope, stored_scope
):
    _create(environment_scope)

    sync_mocks.sync_model.objects.create.assert_called_once()
    options = sync_mocks.sync_model.objects.create.call_args.kwargs["options"]
    assert options == {
        "resource_path": "phase/backend",
        "resource_id": "1",
        "is_group": False,
        "masked": False,
        "protected": False,
        "environment_scope": stored_scope,
    }
    sync_mocks.trigger.assert_called_once()


@pytest.mark.parametrize("environment_scope", ["prod;uction", "a" * 256])
def test_create_gitlab_sync_rejects_invalid_environment_scope(
    sync_mocks, environment_scope
):
    with pytest.raises(GraphQLError, match="Environment scope"):
        _create(environment_scope)

    sync_mocks.sync_model.objects.create.assert_not_called()


@pytest.mark.parametrize(
    ("existing_options", "environment_scope"),
    [
        ({"environment_scope": "production"}, "production"),
        # Masked and protected settings don't make a sync to the same scope distinct
        ({"environment_scope": "production", "masked": True}, "production"),
        ({"environment_scope": "staging", "resource_path": "phase/renamed"}, "staging"),
    ],
)
def test_create_gitlab_sync_rejects_duplicate_destination_and_scope(
    sync_mocks, existing_options, environment_scope
):
    sync_mocks.sync_model.objects.filter.return_value = [
        _existing_sync(**existing_options)
    ]

    with pytest.raises(GraphQLError, match="already exists"):
        _create(environment_scope)

    sync_mocks.sync_model.objects.create.assert_not_called()


@pytest.mark.parametrize(
    ("existing_options", "overrides", "environment_scope"),
    [
        ({"environment_scope": "production"}, {}, "staging"),
        ({"environment_scope": "production"}, {}, "*"),
        ({"environment_scope": "production"}, {"resource_id": "2"}, "production"),
        ({"environment_scope": "production"}, {"is_group": True}, "production"),
    ],
)
def test_create_gitlab_sync_allows_other_scopes_and_destinations(
    sync_mocks, existing_options, overrides, environment_scope
):
    sync_mocks.sync_model.objects.filter.return_value = [
        _existing_sync(**existing_options)
    ]

    _create(environment_scope, **overrides)

    sync_mocks.sync_model.objects.create.assert_called_once()


def test_create_gitlab_sync_allows_same_ids_on_another_gitlab_instance(sync_mocks):
    sync_mocks.sync_model.objects.filter.return_value = [
        _existing_sync(
            gitlab_host="https://gitlab.other.example.com",
            environment_scope="production",
        )
    ]

    _create("production")

    sync_mocks.sync_model.objects.create.assert_called_once()


def test_create_gitlab_sync_treats_sync_without_credentials_as_duplicate(sync_mocks):
    existing = _existing_sync(environment_scope="production")
    existing.authentication = None
    sync_mocks.sync_model.objects.filter.return_value = [existing]

    with pytest.raises(GraphQLError, match="already exists"):
        _create("production")

    sync_mocks.sync_model.objects.create.assert_not_called()


@pytest.mark.parametrize("environment_scope", [None, "*", "production"])
def test_create_gitlab_sync_requires_recreating_sync_without_scope_first(
    sync_mocks, environment_scope
):
    """Syncs created before environment scopes have no stored scope and also update
    variables moved to other scopes, so they can't be combined with scoped syncs."""

    sync_mocks.sync_model.objects.filter.return_value = [_existing_sync()]

    with pytest.raises(GraphQLError, match="created before environment scopes"):
        _create(environment_scope)

    sync_mocks.sync_model.objects.create.assert_not_called()


def test_create_gitlab_sync_allows_sync_without_scope_on_another_destination(
    sync_mocks,
):
    sync_mocks.sync_model.objects.filter.return_value = [
        _existing_sync(resource_id="2"),
        _existing_sync(gitlab_host="https://gitlab.other.example.com"),
    ]

    _create("production")

    sync_mocks.sync_model.objects.create.assert_called_once()
