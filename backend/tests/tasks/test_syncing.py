from unittest.mock import patch, MagicMock
from api.tasks.syncing import (
    trigger_syncs_for_referencing_envs,
    detect_and_trigger_referencing_syncs,
)


# --- Environment.save() dispatch wiring ---


@patch("api.models.detect_and_trigger_referencing_syncs")
@patch("api.models.transaction")
@patch("api.models.trigger_sync_tasks")
@patch("api.models.EnvironmentSync")
@patch("django.db.models.Model.save")
def test_environment_save_triggers_own_syncs_sync_and_referencing_on_commit(
    mock_super_save, mock_env_sync, mock_trigger, mock_txn, mock_detect
):
    """Environment.save() triggers its own active syncs synchronously, and
    dispatches the referencing-env detection via transaction.on_commit (so the
    worker can't race an open transaction) — not inline."""
    from api.models import Environment

    own_sync = MagicMock(is_active=True)
    mock_env_sync.objects.filter.return_value = [own_sync]

    env = Environment()
    env.id = "env-xyz"
    env.save()

    mock_super_save.assert_called_once()
    # Own syncs: triggered synchronously, inline.
    mock_trigger.assert_called_once_with(own_sync)
    # Referencing detection: deferred to on_commit, NOT dispatched inline.
    mock_detect.delay.assert_not_called()
    mock_txn.on_commit.assert_called_once()
    # The registered callback enqueues the job with the env id (passed by value).
    mock_txn.on_commit.call_args.args[0]()
    mock_detect.delay.assert_called_once_with("env-xyz")


# --- detect_and_trigger_referencing_syncs (async wrapper) tests ---


@patch("api.tasks.syncing.trigger_syncs_for_referencing_envs")
@patch("api.tasks.syncing.apps.get_model")
def test_detect_and_trigger_refetches_env_and_delegates(mock_get_model, mock_trigger):
    """The async job re-fetches the env by id and runs the detection."""
    env = MagicMock()
    MockEnvironment = MagicMock()
    MockEnvironment.objects.select_related.return_value.get.return_value = env
    MockEnvironment.DoesNotExist = type("DoesNotExist", (Exception,), {})
    mock_get_model.return_value = MockEnvironment

    detect_and_trigger_referencing_syncs("env-id")

    mock_trigger.assert_called_once_with(env)


@patch("api.tasks.syncing.trigger_syncs_for_referencing_envs")
@patch("api.tasks.syncing.apps.get_model")
def test_detect_and_trigger_missing_env_is_noop(mock_get_model, mock_trigger):
    """If the env was deleted before the job runs, it returns without error."""
    MockEnvironment = MagicMock()
    MockEnvironment.DoesNotExist = type("DoesNotExist", (Exception,), {})
    MockEnvironment.objects.select_related.return_value.get.side_effect = (
        MockEnvironment.DoesNotExist()
    )
    mock_get_model.return_value = MockEnvironment

    detect_and_trigger_referencing_syncs("missing-env")

    mock_trigger.assert_not_called()


# --- trigger_syncs_for_referencing_envs tests ---
#
# Reference resolution is stubbed via get_referenced_environment_ids so these
# tests exercise the graph-traversal / triggering logic directly. The stub maps
# an environment id to the set of environment ids it directly references; the
# function under test follows those edges (transitively) to the changed env.


def _make_changed_env():
    changed_env = MagicMock()
    changed_env.id = "changed-env-id"
    changed_env.name = "staging"
    changed_env.app.name = "my-app"
    changed_env.app_id = "app-1"
    changed_env.app.organisation = MagicMock()
    return changed_env


def _sync(env_id):
    s = MagicMock()
    s.environment_id = env_id
    s.environment = MagicMock()
    return s


def _mock_models(candidate_syncs):
    """get_model side_effect: EnvironmentSync yields the given candidate syncs;
    App/Environment lookups are empty (name resolution is stubbed elsewhere)."""
    MockEnvironmentSync = MagicMock()
    MockEnvironmentSync.objects.filter.return_value.exclude.return_value.select_related.return_value = (
        candidate_syncs
    )
    MockApp = MagicMock()
    MockApp.objects.filter.return_value = []
    MockEnvironment = MagicMock()
    MockEnvironment.objects.filter.return_value = []

    def get_model_side_effect(app_label, model_name):
        if model_name == "EnvironmentSync":
            return MockEnvironmentSync
        if model_name == "App":
            return MockApp
        if model_name == "Environment":
            return MockEnvironment
        return MagicMock()

    return get_model_side_effect


def _patch_refs(graph):
    return patch(
        "api.utils.secrets.get_referenced_environment_ids",
        side_effect=lambda env_id, name_ctx: graph.get(env_id, set()),
    )


@patch("api.tasks.syncing.trigger_sync_tasks")
@patch("api.tasks.syncing.apps.get_model")
def test_trigger_syncs_direct_reference(mock_get_model, mock_trigger_sync):
    """A candidate env that directly references the changed env is triggered."""
    changed_env = _make_changed_env()
    candidate_sync = _sync("candidate-env-id")
    mock_get_model.side_effect = _mock_models([candidate_sync])

    graph = {"candidate-env-id": {"changed-env-id"}}
    with _patch_refs(graph):
        trigger_syncs_for_referencing_envs(changed_env)

    mock_trigger_sync.assert_called_once_with(candidate_sync)


@patch("api.tasks.syncing.trigger_sync_tasks")
@patch("api.tasks.syncing.apps.get_model")
def test_trigger_syncs_transitive_reference(mock_get_model, mock_trigger_sync):
    """B -> A -> changed: changing 'changed' must trigger B's syncs (chained)."""
    changed_env = _make_changed_env()
    sync_b = _sync("env-B")
    mock_get_model.side_effect = _mock_models([sync_b])

    # env-B references env-A; env-A references the changed env.
    graph = {"env-B": {"env-A"}, "env-A": {"changed-env-id"}}
    with _patch_refs(graph):
        trigger_syncs_for_referencing_envs(changed_env)

    mock_trigger_sync.assert_called_once_with(sync_b)


@patch("api.tasks.syncing.trigger_sync_tasks")
@patch("api.tasks.syncing.apps.get_model")
def test_trigger_syncs_no_reference(mock_get_model, mock_trigger_sync):
    """No path from the candidate to the changed env => no trigger."""
    changed_env = _make_changed_env()
    candidate_sync = _sync("candidate-env-id")
    mock_get_model.side_effect = _mock_models([candidate_sync])

    graph = {"candidate-env-id": {"some-other-env"}, "some-other-env": set()}
    with _patch_refs(graph):
        trigger_syncs_for_referencing_envs(changed_env)

    mock_trigger_sync.assert_not_called()


@patch("api.tasks.syncing.trigger_sync_tasks")
@patch("api.tasks.syncing.apps.get_model")
def test_trigger_syncs_reference_cycle_is_safe(mock_get_model, mock_trigger_sync):
    """A reference cycle that never reaches the changed env terminates safely."""
    changed_env = _make_changed_env()
    sync_b = _sync("env-B")
    mock_get_model.side_effect = _mock_models([sync_b])

    graph = {"env-B": {"env-A"}, "env-A": {"env-B"}}  # cycle, no path to changed
    with _patch_refs(graph):
        trigger_syncs_for_referencing_envs(changed_env)

    mock_trigger_sync.assert_not_called()


@patch("api.tasks.syncing.trigger_sync_tasks")
@patch("api.tasks.syncing.apps.get_model")
def test_trigger_syncs_no_candidate_syncs(mock_get_model, mock_trigger_sync):
    """Early return when no other active syncs exist in the org."""
    changed_env = _make_changed_env()
    mock_get_model.side_effect = _mock_models([])

    trigger_syncs_for_referencing_envs(changed_env)

    mock_trigger_sync.assert_not_called()


@patch("api.tasks.syncing.trigger_sync_tasks")
@patch("api.tasks.syncing.apps.get_model")
def test_trigger_syncs_only_matching_envs_triggered(mock_get_model, mock_trigger_sync):
    """Only candidates that reach the changed env (directly or transitively) fire."""
    changed_env = _make_changed_env()
    sync_with_ref = _sync("env-with-ref")
    sync_without_ref = _sync("env-without-ref")
    mock_get_model.side_effect = _mock_models([sync_with_ref, sync_without_ref])

    graph = {
        "env-with-ref": {"changed-env-id"},
        "env-without-ref": {"unrelated-env"},
        "unrelated-env": set(),
    }
    with _patch_refs(graph):
        trigger_syncs_for_referencing_envs(changed_env)

    mock_trigger_sync.assert_called_once_with(sync_with_ref)
