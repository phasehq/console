"""GitLab CI syncs: environment scope validation, and the checks that keep two syncs
from overwriting each other when a sync is created or its credentials change."""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from graphql import GraphQLError

from api.utils.syncing.gitlab import main as gitlab_main
from backend.graphene.mutations import syncing as mutations

GITLAB_HOST = "https://gitlab.example.com"
OTHER_GITLAB_HOST = "https://gitlab.other.example.com"


def _make_info(user_id="actor-1"):
    info = MagicMock()
    info.context.user.userId = user_id
    return info


class FakeQuerySet(list):
    def select_related(self, *args):
        return self

    def exclude(self, id=None, id__in=None):
        excluded = set(id__in or []) | ({id} if id else set())
        return FakeQuerySet(s for s in self if s.id not in excluded)


def _credential(credential_id, host, organisation):
    return SimpleNamespace(
        id=credential_id,
        provider="gitlab",
        organisation=organisation,
        organisation_id=organisation.id,
        credentials={"gitlab_host": host},
    )


@pytest.fixture
def sync_mocks(monkeypatch):
    org = MagicMock(id="org-1")
    app = SimpleNamespace(
        id="app-1", name="backend", organisation=org, sse_enabled=True
    )

    env = MagicMock(id="env-1")
    env.app = app
    mock_env_model = MagicMock()
    mock_env_model.objects.get.return_value = env
    monkeypatch.setattr(mutations, "Environment", mock_env_model)

    credentials = {
        "cred-1": _credential("cred-1", GITLAB_HOST, organisation=org),
        "cred-2": _credential("cred-2", OTHER_GITLAB_HOST, organisation=org),
        "cred-3": _credential("cred-3", GITLAB_HOST, organisation=org),
    }
    mock_creds_model = MagicMock()
    mock_creds_model.objects.get.side_effect = lambda id: credentials[id]
    monkeypatch.setattr(mutations, "ProviderCredentials", mock_creds_model)

    # Stored credentials are encrypted; the tests store the host in the clear
    def get_gitlab_host(stored_credentials):
        return stored_credentials["gitlab_host"]

    monkeypatch.setattr(mutations, "get_gitlab_host", get_gitlab_host)
    monkeypatch.setattr(gitlab_main, "get_gitlab_host", get_gitlab_host)

    syncs = []

    def filter_syncs(**kwargs):
        matching = [s for s in syncs if s.deleted_at is None]
        if "authentication" in kwargs:
            matching = [
                s for s in matching if s.authentication is kwargs["authentication"]
            ]
        if "environment__app_id" in kwargs:
            matching = [
                s
                for s in matching
                if s.environment.app_id == kwargs["environment__app_id"]
            ]
        if "service" in kwargs:
            matching = [s for s in matching if s.service == kwargs["service"]]
        return FakeQuerySet(matching)

    mock_sync_model = MagicMock()
    mock_sync_model.objects.filter.side_effect = filter_syncs
    mock_sync_model.objects.get.side_effect = lambda id: next(
        s for s in syncs if s.id == id
    )
    monkeypatch.setattr(mutations, "EnvironmentSync", mock_sync_model)

    for check in (
        "user_can_access_app",
        "user_can_access_environment",
        "user_has_permission",
    ):
        monkeypatch.setattr(mutations, check, MagicMock(return_value=True))
    monkeypatch.setattr(mutations, "validate_credential_values", MagicMock())

    trigger = MagicMock()
    monkeypatch.setattr(mutations, "trigger_sync_tasks", trigger)

    def add_sync(sync_id, credential_id="cred-1", app_id="app-1", **options):
        sync = SimpleNamespace(
            id=sync_id,
            service="gitlab_ci",
            deleted_at=None,
            authentication=credentials[credential_id] if credential_id else None,
            authentication_id=credential_id,
            environment=SimpleNamespace(
                id=f"env-{sync_id}",
                app_id=app_id,
                name="Production",
                app=SimpleNamespace(id=app_id, name="backend", organisation=org),
            ),
            options={
                "resource_path": "phase/backend",
                "resource_id": "1",
                "is_group": False,
                "masked": False,
                "protected": False,
                **options,
            },
            save=MagicMock(),
        )
        syncs.append(sync)
        return sync

    return SimpleNamespace(
        sync_model=mock_sync_model,
        trigger=trigger,
        credentials=credentials,
        add_sync=add_sync,
    )


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


# ---- CreateGitLabCISync ----------------------------------------------------------


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
    sync_mocks.add_sync("existing", **existing_options)

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
    sync_mocks.add_sync("existing", **existing_options)

    _create(environment_scope, **overrides)

    sync_mocks.sync_model.objects.create.assert_called_once()


def test_create_gitlab_sync_allows_same_ids_on_another_gitlab_instance(sync_mocks):
    sync_mocks.add_sync(
        "existing", credential_id="cred-2", environment_scope="production"
    )

    _create("production")

    sync_mocks.sync_model.objects.create.assert_called_once()


def test_create_gitlab_sync_treats_sync_without_credentials_as_duplicate(sync_mocks):
    sync_mocks.add_sync("existing", credential_id=None, environment_scope="production")

    with pytest.raises(GraphQLError, match="already exists"):
        _create("production")

    sync_mocks.sync_model.objects.create.assert_not_called()


def test_create_gitlab_sync_ignores_syncs_of_other_apps(sync_mocks):
    sync_mocks.add_sync("existing", app_id="app-2", environment_scope="production")
    sync_mocks.add_sync("legacy", app_id="app-2")

    _create("production")

    sync_mocks.sync_model.objects.create.assert_called_once()


@pytest.mark.parametrize("environment_scope", [None, "*", "production"])
def test_create_gitlab_sync_requires_recreating_sync_without_scope_first(
    sync_mocks, environment_scope
):
    """Syncs created before environment scopes have no stored scope and also update
    variables moved to other scopes, so they can't be combined with scoped syncs."""

    sync_mocks.add_sync("legacy")

    with pytest.raises(GraphQLError, match="created before environment scopes"):
        _create(environment_scope)

    sync_mocks.sync_model.objects.create.assert_not_called()


@pytest.mark.parametrize(
    ("legacy_options", "overrides"),
    [
        ({"resource_path": "phase/backend"}, {}),
        # GitLab paths are case-insensitive
        ({"resource_path": "Phase/Backend"}, {}),
        # Before June 2024, group syncs stored the group's path, not its full path,
        # which is the same for top-level groups
        (
            {"resource_path": "phase", "is_group": True},
            {"resource_path": "phase", "is_group": True},
        ),
    ],
)
def test_create_gitlab_sync_detects_sync_that_only_stored_the_path(
    sync_mocks, legacy_options, overrides
):
    """Syncs created before July 2024 only stored the project or group path."""

    legacy = sync_mocks.add_sync("legacy", **legacy_options)
    del legacy.options["resource_id"]

    with pytest.raises(GraphQLError, match="created before environment scopes"):
        _create("production", **overrides)

    sync_mocks.sync_model.objects.create.assert_not_called()


def test_create_gitlab_sync_allows_sync_that_only_stored_another_path(sync_mocks):
    legacy = sync_mocks.add_sync("legacy", resource_path="phase/frontend")
    del legacy.options["resource_id"]

    _create("production")

    sync_mocks.sync_model.objects.create.assert_called_once()


def test_create_gitlab_sync_allows_sync_without_scope_on_another_destination(
    sync_mocks,
):
    sync_mocks.add_sync("legacy-other-project", resource_id="2")
    sync_mocks.add_sync("legacy-other-instance", credential_id="cred-2")

    _create("production")

    sync_mocks.sync_model.objects.create.assert_called_once()


# ---- UpdateSyncAuthentication ----------------------------------------------------


def _update_authentication(sync_id, credential_id):
    return mutations.UpdateSyncAuthentication.mutate(
        None, _make_info(), sync_id=sync_id, credential_id=credential_id
    )


@pytest.mark.parametrize(
    ("moved_options", "other_options", "error"),
    [
        (
            {"environment_scope": "production"},
            {"environment_scope": "production"},
            "already exists",
        ),
        ({"environment_scope": "production"}, {}, "created before environment scopes"),
        ({}, {"environment_scope": "production"}, "This sync was created before"),
    ],
)
def test_update_sync_authentication_rejects_conflict_on_new_gitlab_instance(
    sync_mocks, moved_options, other_options, error
):
    moved = sync_mocks.add_sync("moved", credential_id="cred-2", **moved_options)
    sync_mocks.add_sync("other", credential_id="cred-1", **other_options)

    with pytest.raises(GraphQLError, match=error):
        _update_authentication("moved", "cred-1")

    moved.save.assert_not_called()
    assert moved.authentication_id == "cred-2"


@pytest.mark.parametrize(
    ("moved_options", "other_options"),
    [
        ({"environment_scope": "production"}, {"environment_scope": "staging"}),
        (
            {"environment_scope": "production"},
            {"environment_scope": "production", "resource_id": "2"},
        ),
        # Two syncs without a scope could always be combined
        ({}, {}),
    ],
)
def test_update_sync_authentication_allows_moving_without_conflict(
    sync_mocks, moved_options, other_options
):
    moved = sync_mocks.add_sync("moved", credential_id="cred-2", **moved_options)
    sync_mocks.add_sync("other", credential_id="cred-1", **other_options)

    _update_authentication("moved", "cred-1")

    moved.save.assert_called_once()
    assert moved.authentication_id == "cred-1"


def test_update_sync_authentication_allows_new_token_for_same_gitlab_instance(
    sync_mocks,
):
    """Rotating the token must keep working, even for syncs created before this
    check that would conflict now."""

    moved = sync_mocks.add_sync(
        "moved", credential_id="cred-1", environment_scope="production"
    )
    sync_mocks.add_sync("other", credential_id="cred-1", environment_scope="production")
    sync_mocks.add_sync("legacy", credential_id="cred-1")

    _update_authentication("moved", "cred-3")

    moved.save.assert_called_once()
    assert moved.authentication_id == "cred-3"


# ---- UpdateProviderCredentials -----------------------------------------------------


def _update_credential(credential_id, host):
    return mutations.UpdateProviderCredentials.mutate(
        None,
        _make_info(),
        credential_id=credential_id,
        name="GitLab",
        credentials={"gitlab_host": host, "gitlab_token": "glpat-new"},
    )


def test_update_credentials_rejects_host_change_that_causes_conflict(sync_mocks):
    sync_mocks.add_sync("moved", credential_id="cred-2", environment_scope="production")
    sync_mocks.add_sync("other", credential_id="cred-1", environment_scope="production")
    credential = sync_mocks.credentials["cred-2"]

    with pytest.raises(GraphQLError, match="already exists"):
        _update_credential("cred-2", GITLAB_HOST)

    assert credential.credentials == {"gitlab_host": OTHER_GITLAB_HOST}


def test_update_credentials_allows_host_change_without_conflict(sync_mocks):
    sync_mocks.add_sync("moved", credential_id="cred-2", environment_scope="production")
    sync_mocks.add_sync("other", credential_id="cred-1", environment_scope="staging")
    credential = sync_mocks.credentials["cred-2"]
    credential.save = MagicMock()

    _update_credential("cred-2", GITLAB_HOST)

    credential.save.assert_called_once()
    assert credential.credentials["gitlab_host"] == GITLAB_HOST


def test_update_credentials_allows_new_token_for_same_host(sync_mocks):
    sync_mocks.add_sync("a", credential_id="cred-1", environment_scope="production")
    sync_mocks.add_sync("b", credential_id="cred-3", environment_scope="production")
    credential = sync_mocks.credentials["cred-1"]
    credential.save = MagicMock()

    _update_credential("cred-1", GITLAB_HOST)

    credential.save.assert_called_once()
