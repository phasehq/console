import pytest
from unittest.mock import patch, MagicMock
from api.tasks.syncing import (
    perform_gitlab_sync,
    sync_gitlab_secrets,
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


def _gitlab_sync(**options):
    env_sync = MagicMock()
    env_sync.authentication.id = "cred-1"
    env_sync.options = {
        "resource_id": "1",
        "resource_path": "phase/backend",
        "is_group": False,
        "masked": True,
        "protected": False,
        **options,
    }
    return env_sync


@patch("api.tasks.syncing.get_environment_scopes_of_other_syncs")
@patch("api.tasks.syncing.handle_sync_event")
def test_gitlab_sync_with_scope_manages_only_that_scope(mock_handle, mock_other_scopes):
    env_sync = _gitlab_sync(environment_scope="production")

    perform_gitlab_sync(env_sync)

    mock_other_scopes.assert_not_called()
    mock_handle.assert_called_once_with(
        env_sync,
        sync_gitlab_secrets,
        "cred-1",
        "1",
        False,
        True,
        False,
        "production",
        None,
    )


@patch("api.tasks.syncing.get_environment_scopes_of_other_syncs")
@patch("api.tasks.syncing.handle_sync_event")
def test_gitlab_sync_without_scope_excludes_scopes_of_other_syncs(
    mock_handle, mock_other_scopes
):
    """Syncs created before environment scopes have no scope in their options."""
    mock_other_scopes.return_value = {"production"}
    env_sync = _gitlab_sync()

    perform_gitlab_sync(env_sync)

    args = mock_handle.call_args.args
    assert args[:8] == (
        env_sync,
        sync_gitlab_secrets,
        "cred-1",
        "1",
        False,
        True,
        False,
        None,
    )
    # Looked up while the sync runs, so errors are reported on the sync
    mock_other_scopes.assert_not_called()
    assert args[8]() == {"production"}
    mock_other_scopes.assert_called_once_with(env_sync)


@patch("api.tasks.syncing.environment_is_locked", return_value=False)
@patch("api.tasks.syncing.organisation_is_locked", return_value=False)
@patch("api.tasks.syncing.apps.get_model")
@patch("api.tasks.syncing.resolve_gitlab_resource_id", return_value="42")
@patch("api.tasks.syncing.handle_sync_event")
def test_gitlab_sync_that_only_stored_the_path_stores_the_id(
    mock_handle, mock_resolve, mock_get_model, mock_is_locked, mock_env_is_locked
):
    """Syncs created before July 2024 only stored the project or group path."""
    env_sync = _gitlab_sync()
    del env_sync.options["resource_id"]

    perform_gitlab_sync(env_sync)

    mock_resolve.assert_called_once_with("cred-1", "phase/backend", False)
    assert env_sync.options["resource_id"] == "42"
    model = mock_get_model.return_value
    model.objects.filter.assert_called_once_with(id=env_sync.id)
    model.objects.filter.return_value.update.assert_called_once_with(
        options=env_sync.options
    )
    assert mock_handle.call_args.args[3] == "42"


@pytest.mark.parametrize("failure", [None, Exception("GitLab is down")])
@patch("api.tasks.syncing.organisation_is_locked", return_value=False)
@patch("api.tasks.syncing.apps.get_model")
@patch("api.tasks.syncing.resolve_gitlab_resource_id")
@patch("api.tasks.syncing.handle_sync_event")
def test_gitlab_sync_that_only_stored_the_path_still_syncs_without_the_id(
    mock_handle, mock_resolve, mock_get_model, mock_is_locked, failure
):
    if failure:
        mock_resolve.side_effect = failure
    else:
        mock_resolve.return_value = None
    env_sync = _gitlab_sync()
    del env_sync.options["resource_id"]

    perform_gitlab_sync(env_sync)

    mock_get_model.return_value.objects.filter.assert_not_called()
    assert "resource_id" not in env_sync.options
    assert mock_handle.call_args.args[3] == "phase/backend"


@patch("api.tasks.syncing.organisation_is_locked", return_value=True)
@patch("api.tasks.syncing.apps.get_model")
@patch("api.tasks.syncing.resolve_gitlab_resource_id")
@patch("api.tasks.syncing.handle_sync_event")
def test_gitlab_sync_that_only_stored_the_path_is_not_looked_up_while_the_org_is_locked(
    mock_handle, mock_resolve, mock_get_model, mock_is_locked
):
    """handle_sync_event pauses the sync, without calling GitLab."""
    env_sync = _gitlab_sync()
    del env_sync.options["resource_id"]

    perform_gitlab_sync(env_sync)

    mock_is_locked.assert_called_once_with(env_sync.environment.app.organisation_id)
    mock_resolve.assert_not_called()
    mock_get_model.return_value.objects.filter.assert_not_called()
    mock_handle.assert_called_once()
    assert mock_handle.call_args.args[3] == "phase/backend"


@patch("api.tasks.syncing.resolve_gitlab_resource_id")
@patch("api.tasks.syncing.handle_sync_event")
def test_gitlab_sync_with_id_does_not_look_it_up(mock_handle, mock_resolve):
    perform_gitlab_sync(_gitlab_sync())

    mock_resolve.assert_not_called()


# --- handle_sync_event: the job writes back only what it owns ---


def _run_job(sync_function, locked=False, env_sync=None, path_now="/", steps=None):
    """handle_sync_event on a sync as a worker holds it: the copy pickled when the job was queued.

    `path_now` is the path its row has by the time the job runs. `steps`, if given, collects what
    the job does around its read of the secrets, in order.
    """
    from api.tasks.syncing import handle_sync_event

    env_sync = env_sync or MagicMock()
    steps = [] if steps is None else steps
    with patch("api.tasks.syncing.apps.get_model") as mock_get_model, patch(
        "api.tasks.syncing.organisation_is_locked", return_value=locked
    ), patch("api.tasks.syncing.environment_is_locked", return_value=False), patch(
        "api.tasks.syncing.transaction"
    ) as transaction, patch(
        "api.tasks.syncing.get_environment_secrets",
        side_effect=lambda environment, path: steps.append(("read", path)) or [],
    ):
        objects = mock_get_model.return_value.objects
        objects.filter.return_value.order_by.return_value.first.return_value = MagicMock()
        transaction.atomic.return_value.__enter__.side_effect = lambda: steps.append("begin")
        transaction.atomic.return_value.__exit__.side_effect = lambda *exc: steps.append("commit")
        row = objects.select_for_update.return_value.values_list.return_value
        row.get.side_effect = lambda **kwargs: steps.append(("lock", kwargs)) or path_now
        handle_sync_event(env_sync, sync_function)
    return [call.kwargs for call in env_sync.save.call_args_list]


@pytest.mark.parametrize(
    "sync_function",
    [
        MagicMock(return_value=(True, {})),
        MagicMock(return_value=(False, {"message": "rejected"})),
        MagicMock(side_effect=Exception("provider down")),
    ],
    ids=["synced", "refused", "raised"],
)
def test_sync_job_saves_its_status_and_nothing_else(sync_function):
    """The folder a sync sends can be renamed while its job runs (the path is
    rewritten in place), and a sync can be paused or re-pointed: saving the
    job's whole stale copy would put the old values back."""
    saves = _run_job(sync_function)

    assert saves == [
        {"update_fields": ["status", "updated_at"]},
        {"update_fields": ["status", "updated_at", "last_sync"]},
    ]


def _queue(delay):
    """trigger_sync_tasks on a sync as the request that queues it holds it; returns its saves."""
    from api.services import ServiceConfig
    from api.tasks.syncing import trigger_sync_tasks

    env_sync = MagicMock(service=ServiceConfig.SUPABASE_EDGE_FUNCTIONS["id"])
    with patch("api.tasks.syncing.apps.get_model"), patch(
        "api.tasks.syncing.organisation_is_locked", return_value=False
    ), patch("api.tasks.syncing.environment_is_locked", return_value=False), patch(
        "api.tasks.syncing.cancel_sync_tasks"
    ), patch(
        "api.tasks.syncing.perform_supabase_sync"
    ) as job:
        job.delay.side_effect = delay
        trigger_sync_tasks(env_sync)
    return [call.kwargs for call in env_sync.save.call_args_list]


@pytest.mark.parametrize(
    "delay, saved",
    [(lambda env_sync: MagicMock(), 1), (Exception("queue down"), 2)],
    ids=["queued", "not queued"],
)
def test_queueing_a_sync_saves_its_status_and_nothing_else(delay, saved):
    """The request loaded the sync before queueing it. A folder renamed in between has its
    new path in the row: saving the whole stale copy would put the old one back, and the
    job reads the row's path."""
    saves = _queue(delay)

    assert saves == [{"update_fields": ["status", "updated_at"]}] * saved


def test_sync_job_paused_for_a_locked_org_saves_its_status_and_nothing_else():
    sync_function = MagicMock()

    saves = _run_job(sync_function, locked=True)

    assert saves == [{"update_fields": ["status", "updated_at"]}]
    sync_function.assert_not_called()


def test_sync_job_reads_the_path_its_sync_has_now_not_the_one_it_was_queued_with():
    """A job queued before its folder was renamed would find nothing at the old path, and
    most providers delete what the source no longer has."""
    queued = MagicMock(id="sync-1", path="/edge")
    steps = []
    sync_function = MagicMock(side_effect=lambda secrets: steps.append("push") or (True, {}))

    _run_job(sync_function, env_sync=queued, path_now="/functions", steps=steps)

    assert ("lock", {"id": "sync-1"}) in steps
    assert ("read", "/functions") in steps
    assert ("read", "/edge") not in steps


def test_sync_job_reads_path_and_secrets_as_one_then_lets_go_before_pushing():
    """The row lock holds a rename off between the two reads. The provider calls, which can
    take minutes, run after it is released."""
    steps = []
    sync_function = MagicMock(side_effect=lambda secrets: steps.append("push") or (True, {}))

    _run_job(sync_function, env_sync=MagicMock(id="sync-1"), path_now="/functions", steps=steps)

    assert steps == [
        "begin",
        ("lock", {"id": "sync-1"}),
        ("read", "/functions"),
        "commit",
        "push",
    ]


# --- several environments changed together (an app restore) ---


@patch("api.tasks.syncing.trigger_sync_tasks")
@patch("api.tasks.syncing.apps.get_model")
def test_one_pass_covers_every_changed_env(mock_get_model, mock_trigger_sync):
    """A candidate that references any of the changed envs is triggered, once."""
    changed_env = _make_changed_env()
    references_both = _sync("candidate-1")
    references_the_other = _sync("candidate-2")
    unrelated = _sync("candidate-3")
    mock_get_model.side_effect = _mock_models(
        [references_both, references_the_other, unrelated]
    )

    graph = {
        "candidate-1": {"changed-env-id", "other-changed-id"},
        "candidate-2": {"other-changed-id"},
        "candidate-3": {"somewhere-else"},
    }
    with _patch_refs(graph) as refs:
        trigger_syncs_for_referencing_envs(
            changed_env, also_changed=["other-changed-id"]
        )

    assert mock_trigger_sync.call_args_list == [
        ((references_both,),),
        ((references_the_other,),),
    ]
    # The graph was read once per environment, not once per changed env.
    assert sorted(c.args[0] for c in refs.call_args_list) == [
        "candidate-1",
        "candidate-2",
        "candidate-3",
        "somewhere-else",
    ]


@patch("api.tasks.syncing.trigger_sync_tasks")
@patch("api.tasks.syncing.apps.get_model")
def test_the_changed_envs_are_not_candidates(mock_get_model, mock_trigger_sync):
    """Their own syncs are resumed by the restore job."""
    changed_env = _make_changed_env()
    mock_get_model.side_effect = _mock_models([])

    with _patch_refs({}):
        trigger_syncs_for_referencing_envs(
            changed_env, also_changed=["other-changed-id"]
        )

    env_sync_model = mock_get_model("api", "EnvironmentSync")
    excluded = env_sync_model.objects.filter.return_value.exclude.call_args.kwargs
    assert excluded == {"environment_id__in": {"changed-env-id", "other-changed-id"}}


@patch("api.tasks.syncing.trigger_syncs_for_referencing_envs")
@patch("api.tasks.syncing.apps.get_model")
def test_batch_job_runs_one_pass(mock_get_model, mock_trigger):
    from api.tasks.syncing import detect_and_trigger_referencing_syncs_for

    first, second, third = (MagicMock(id=f"env-{n}") for n in (1, 2, 3))
    environment_model = MagicMock()
    lookup = environment_model.objects.select_related.return_value.filter
    lookup.return_value = [first, second, third]
    mock_get_model.return_value = environment_model

    detect_and_trigger_referencing_syncs_for(["env-1", "env-2", "env-3"])

    lookup.assert_called_once_with(id__in=["env-1", "env-2", "env-3"])
    mock_trigger.assert_called_once_with(first, also_changed=["env-2", "env-3"])


@patch("api.tasks.syncing.trigger_syncs_for_referencing_envs")
@patch("api.tasks.syncing.apps.get_model")
def test_batch_job_does_nothing_when_none_is_live(mock_get_model, mock_trigger):
    """Deleted again before the job ran: the default manager hides them."""
    from api.tasks.syncing import detect_and_trigger_referencing_syncs_for

    environment_model = MagicMock()
    environment_model.objects.select_related.return_value.filter.return_value = []
    mock_get_model.return_value = environment_model

    detect_and_trigger_referencing_syncs_for(["env-1"])

    mock_trigger.assert_not_called()
