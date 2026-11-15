"""Tests for the app and environment deletion jobs: the sweep, the purges and
the restore handlers."""

from contextlib import contextmanager
from datetime import timedelta
from unittest.mock import MagicMock, call, patch

import pytest
from django.utils import timezone
from rq.exceptions import NoSuchJobError

from api.tasks import purge
from api.tasks import resource_deletion as jobs
from api.utils.resource_deletion import GRACE_PERIOD

DUE = GRACE_PERIOD + timedelta(hours=1)


def _deleted(ago):
    return None if ago is None else timezone.now() - ago


def _app(deleted_ago=DUE):
    app = MagicMock(id="app-1")
    app.name = "Billing"
    app.organisation.name = "Acme"
    app.deleted_at = _deleted(deleted_ago)
    return app


def _environment(deleted_ago=DUE, app_deleted_ago=None):
    environment = MagicMock(id="env-1")
    environment.name = "Staging"
    environment.deleted_at = _deleted(deleted_ago)
    environment.app = _app(deleted_ago=app_deleted_ago)
    return environment


@contextmanager
def _models(**models):
    real_get_model = jobs.apps.get_model

    def get_model(app_label, name):
        return models[name] if name in models else real_get_model(app_label, name)

    with patch.object(jobs.apps, "get_model", side_effect=get_model):
        yield


def _app_model(first, locked="same"):
    """An App model whose first lookup returns `first` and whose locked
    re-read, inside the final transaction, returns `locked`."""
    model = MagicMock()
    model.all_objects.filter.return_value.select_related.return_value.first.return_value = (
        first
    )
    refetch = model.all_objects.select_for_update.return_value.filter.return_value
    refetch.select_related.return_value.first.return_value = (
        first if locked == "same" else locked
    )
    return model


def _environment_model(first, locked="same"):
    model = MagicMock()
    model.all_objects.filter.return_value.select_related.return_value.first.return_value = (
        first
    )
    refetch = model.all_objects.select_for_update.return_value.filter.return_value
    refetch.select_related.return_value.first.return_value = (
        first if locked == "same" else locked
    )
    return model


@pytest.fixture
def steps():
    """The purge's steps, in the order they are called."""
    order = MagicMock()
    with patch.object(
        jobs, "revoke_dynamic_secret_leases", order.leases
    ), patch.object(
        jobs, "revoke_rotating_secret_credentials", order.rotating
    ), patch.object(
        jobs, "stop_syncs", order.syncs
    ), patch.object(
        jobs, "delete_environment_secret_events", order.events
    ), patch.object(
        jobs, "delete_with_cascade", order.delete
    ), patch.object(
        jobs, "transaction"
    ), patch.object(
        jobs, "deletion_actor", return_value=("user", "member-1", {"email": "a@b.c"})
    ), patch.object(
        jobs, "audit_app_cascade_envs", order.cascade_audit
    ), patch.object(
        jobs, "log_audit_event", order.audit
    ), patch.object(
        jobs, "notify"
    ) as notify:
        order.events.return_value = True
        order.notify = notify
        yield order


# ---------------------------------------------------------------------------
# Sweep
# ---------------------------------------------------------------------------


class TestSweep:
    def _sweep(self, app_ids, environment_ids, fetch):
        app_model, environment_model = MagicMock(), MagicMock()
        app_model.all_objects.filter.return_value.values_list.return_value = app_ids
        environment_model.all_objects.filter.return_value.values_list.return_value = (
            environment_ids
        )
        queue = MagicMock()
        with _models(App=app_model, Environment=environment_model), patch.object(
            jobs.django_rq, "get_queue", return_value=queue
        ) as get_queue, patch.object(jobs.Job, "fetch", side_effect=fetch):
            jobs.sweep_resource_deletions()
        return queue, get_queue, app_model, environment_model

    def test_enqueues_a_purge_for_each_due_app_and_environment(self):
        queue, get_queue, app_model, environment_model = self._sweep(
            ["app-1"], ["env-1"], fetch=NoSuchJobError
        )

        # Slow, database-heavy work: not on the queue user actions wait on.
        get_queue.assert_called_once_with("maintenance")
        assert queue.enqueue.call_args_list == [
            call(
                jobs.purge_app,
                "app-1",
                job_id="purge-app-app-1",
                job_timeout=jobs.PURGE_JOB_TIMEOUT,
            ),
            call(
                jobs.purge_environment,
                "env-1",
                job_id="purge-environment-env-1",
                job_timeout=jobs.PURGE_JOB_TIMEOUT,
            ),
        ]

        due = app_model.all_objects.filter.call_args.kwargs["deleted_at__lte"]
        assert timezone.now() - GRACE_PERIOD - due < timedelta(seconds=5)

    def test_an_environment_whose_app_is_pending_too_is_left_to_the_app(self):
        _, _, _, environment_model = self._sweep([], [], fetch=NoSuchJobError)

        lookup = environment_model.all_objects.filter.call_args.kwargs
        assert lookup["app__deleted_at__isnull"] is True

    @pytest.mark.parametrize("state", ["is_queued", "is_started"])
    def test_does_not_enqueue_a_purge_that_is_already_underway(self, state):
        running = MagicMock(is_queued=False, is_started=False)
        setattr(running, state, True)

        queue, _, _, _ = self._sweep(["app-1"], [], fetch=lambda *a, **kw: running)

        queue.enqueue.assert_not_called()

    def test_enqueues_again_after_a_purge_that_stopped_early(self):
        # One that hit its time budget, or was blocked: the job has finished.
        finished = MagicMock(is_queued=False, is_started=False)

        queue, _, _, _ = self._sweep(["app-1"], [], fetch=lambda *a, **kw: finished)

        queue.enqueue.assert_called_once()

    def test_registration_replaces_the_schedule(self):
        scheduler = MagicMock()
        with patch.object(jobs.django_rq, "get_scheduler", return_value=scheduler):
            jobs.init_resource_deletion_sweeper()

        scheduler.cancel.assert_called_once_with(jobs.SWEEP_JOB_ID)
        schedule = scheduler.schedule.call_args.kwargs
        assert schedule["func"] is jobs.sweep_resource_deletions
        assert schedule["interval"] == jobs.SWEEP_INTERVAL_SECONDS
        assert schedule["id"] == jobs.SWEEP_JOB_ID
        assert schedule["repeat"] is None


# ---------------------------------------------------------------------------
# Purge
# ---------------------------------------------------------------------------


class TestPurgeApp:
    @pytest.mark.parametrize(
        "app",
        [None, _app(deleted_ago=None), _app(deleted_ago=GRACE_PERIOD / 2)],
        ids=["already-purged", "restored", "not-due"],
    )
    def test_does_nothing_unless_due(self, app, steps):
        with _models(App=_app_model(app)):
            jobs.purge_app("app-1")

        assert steps.mock_calls == []

    def test_deletes_the_app_after_releasing_what_it_holds(self, steps):
        app = _app()
        environment_model = MagicMock()
        environments = [MagicMock(), MagicMock()]
        environment_model.all_objects.filter.return_value = environments

        with _models(App=_app_model(app), Environment=environment_model):
            jobs.purge_app("app-1")

        scope = {"app": app}
        assert [step[0] for step in steps.mock_calls] == [
            "leases",
            "rotating",
            "syncs",
            "events",
            "delete",
            "cascade_audit",
            "audit",
        ]
        steps.leases.assert_called_once_with(scope)
        steps.rotating.assert_called_once_with(scope)
        steps.syncs.assert_called_once_with(scope)
        steps.events.assert_called_once_with(scope)
        steps.delete.assert_called_once_with(app)

        # all_objects: its environments are hidden from Environment.objects.
        environment_model.all_objects.filter.assert_called_once_with(app=app)
        assert steps.cascade_audit.call_args.args[:2] == (app, environments)

        audit = steps.audit.call_args.kwargs
        assert audit["event_type"] == "D"
        assert audit["resource_type"] == "app"
        assert audit["resource_id"] == "app-1"
        # Logged as the action of whoever scheduled the deletion.
        assert audit["actor_id"] == "member-1"
        assert audit["description"] == "Permanently deleted app 'Billing'"

    def test_unrevoked_credentials_block_the_purge(self, steps):
        steps.rotating.side_effect = purge.PurgeBlockedError("could not revoke 1")

        with _models(App=_app_model(_app())), pytest.raises(purge.PurgeBlockedError):
            jobs.purge_app("app-1")

        # Nothing is deleted while a credential is still live at its provider.
        steps.events.assert_not_called()
        steps.delete.assert_not_called()
        steps.audit.assert_not_called()
        message = steps.notify.call_args.args[0]
        assert "is blocked and will retry on the next sweep" in message
        assert "Billing" in message

    def test_stops_at_the_time_budget_and_leaves_the_app_locked(self, steps):
        steps.events.return_value = False

        with _models(App=_app_model(_app())):
            jobs.purge_app("app-1")

        steps.delete.assert_not_called()
        steps.audit.assert_not_called()

    def test_a_failed_delete_leaves_no_audit_trail(self, steps):
        steps.delete.side_effect = RuntimeError("fk violation")

        with _models(App=_app_model(_app()), Environment=MagicMock()), pytest.raises(
            RuntimeError
        ):
            jobs.purge_app("app-1")

        steps.cascade_audit.assert_not_called()
        steps.audit.assert_not_called()

    @pytest.mark.parametrize(
        "locked", [None, _app(deleted_ago=None)], ids=["gone", "restored"]
    )
    def test_rechecks_under_the_row_lock_before_deleting(self, locked, steps):
        model = _app_model(_app(), locked=locked)

        with _models(App=model):
            jobs.purge_app("app-1")

        model.all_objects.select_for_update.assert_called_once_with(of=("self",))
        steps.delete.assert_not_called()
        steps.audit.assert_not_called()


class TestPurgeEnvironment:
    @pytest.mark.parametrize(
        "environment",
        [
            None,
            _environment(deleted_ago=None),
            _environment(deleted_ago=GRACE_PERIOD / 2),
            _environment(app_deleted_ago=timedelta(minutes=5)),
        ],
        ids=["already-purged", "restored", "not-due", "app-pending-too"],
    )
    def test_does_nothing_unless_due(self, environment, steps):
        with _models(Environment=_environment_model(environment)):
            jobs.purge_environment("env-1")

        assert steps.mock_calls == []

    def test_deletes_the_environment_after_releasing_what_it_holds(self, steps):
        environment = _environment()
        model = _environment_model(environment)

        with _models(Environment=model):
            jobs.purge_environment("env-1")

        scope = {"id": "env-1"}
        assert [step[0] for step in steps.mock_calls] == [
            "leases",
            "rotating",
            "syncs",
            "events",
            "delete",
            "audit",
        ]
        steps.events.assert_called_once_with(scope)
        steps.delete.assert_called_once_with(environment)
        # The app row stays unlocked.
        model.all_objects.select_for_update.assert_called_once_with(of=("self",))

        audit = steps.audit.call_args.kwargs
        assert audit["resource_type"] == "env"
        assert audit["resource_id"] == "env-1"
        assert audit["actor_id"] == "member-1"
        assert audit["description"] == (
            "Permanently deleted environment 'Staging' from app 'Billing'"
        )

    def test_stops_at_the_time_budget_and_leaves_the_environment_locked(self, steps):
        steps.events.return_value = False

        with _models(Environment=_environment_model(_environment())):
            jobs.purge_environment("env-1")

        steps.delete.assert_not_called()

    def test_restored_while_releasing_is_not_deleted(self, steps):
        model = _environment_model(
            _environment(), locked=_environment(deleted_ago=None)
        )

        with _models(Environment=model):
            jobs.purge_environment("env-1")

        steps.delete.assert_not_called()
        steps.audit.assert_not_called()


# ---------------------------------------------------------------------------
# Restore
# ---------------------------------------------------------------------------


@pytest.fixture
def restore_steps():
    with patch.object(jobs, "_resume") as resume, patch.object(
        jobs, "_provision_team_keys"
    ) as keys, patch.object(jobs, "_resync_referencing_environments") as resync:
        yield MagicMock(resume=resume, keys=keys, resync=resync)


class TestRestoreHandlers:
    def test_restored_app_resumes_everything_under_it(self, restore_steps):
        app = MagicMock(id="app-1")
        app.environments.values_list.return_value = ["env-1", "env-2"]
        model = MagicMock()
        model.objects.filter.return_value.first.return_value = app

        with _models(App=model):
            jobs.handle_app_restored("app-1")

        restore_steps.resume.assert_called_once_with({"app": app})
        restore_steps.keys.assert_called_once_with(app)
        assert restore_steps.resync.call_args_list == [call("env-1"), call("env-2")]

    def test_restored_environment_resumes(self, restore_steps):
        environment = MagicMock(id="env-1")
        model = MagicMock()
        model.objects.filter.return_value.select_related.return_value.first.return_value = (
            environment
        )

        with _models(Environment=model):
            jobs.handle_environment_restored("env-1")

        restore_steps.resume.assert_called_once_with({"id": "env-1"})
        restore_steps.keys.assert_called_once_with(environment.app)
        restore_steps.resync.assert_called_once_with("env-1")

    def test_skips_what_was_deleted_again_before_the_job_ran(self, restore_steps):
        # The default managers no longer see it.
        app_model, environment_model = MagicMock(), MagicMock()
        app_model.objects.filter.return_value.first.return_value = None
        environment_model.objects.filter.return_value.select_related.return_value.first.return_value = (
            None
        )

        with _models(App=app_model, Environment=environment_model):
            jobs.handle_app_restored("app-1")
            jobs.handle_environment_restored("env-1")

        restore_steps.resume.assert_not_called()
        restore_steps.keys.assert_not_called()

    def test_the_handlers_run_on_the_default_queue(self):
        queue = MagicMock()
        with patch.object(jobs.django_rq, "get_queue", return_value=queue) as get_queue:
            jobs.enqueue_app_restored("app-1")
            jobs.enqueue_environment_restored("env-1")

        assert get_queue.call_args_list == [call("default"), call("default")]
        assert queue.enqueue.call_args_list == [
            call(jobs.handle_app_restored, "app-1"),
            call(jobs.handle_environment_restored, "env-1"),
        ]


class TestResume:
    def _run(self, environments):
        rotating_model, sync_model = MagicMock(), MagicMock(CANCELLED="cancelled")
        rotating_secrets = [MagicMock(), MagicMock()]
        syncs = [MagicMock()]
        rotating_model.objects.filter.return_value = rotating_secrets
        sync_model.objects.filter.return_value = syncs
        with _models(RotatingSecret=rotating_model, EnvironmentSync=sync_model), patch(
            "ee.integrations.secrets.rotation.engine.reschedule"
        ) as reschedule, patch("api.tasks.syncing.trigger_sync_tasks") as trigger:
            jobs._resume(environments)
        return rotating_model, sync_model, reschedule, trigger, rotating_secrets, syncs

    def test_rearms_rotations_and_reruns_the_syncs_skipped_while_locked(self):
        app = MagicMock()

        rotating_model, sync_model, reschedule, trigger, rotating_secrets, syncs = (
            self._run({"app": app})
        )

        assert reschedule.call_args_list == [call(rs) for rs in rotating_secrets]
        trigger.assert_called_once_with(syncs[0])

        rotations = rotating_model.objects.filter.call_args.kwargs
        assert rotations["environment__app"] is app
        # Paused secrets stay paused.
        assert rotations["is_active"] is True
        assert rotations["deleted_at__isnull"] is True

        lookup = sync_model.objects.filter.call_args.kwargs
        assert lookup["environment__app"] is app
        assert lookup["status"] == "cancelled"
        assert lookup["is_active"] is True

    def test_an_environment_still_pending_deletion_stays_locked(self):
        # A restored app may hold an environment that was deleted on its own.
        rotating_model, sync_model, *_ = self._run({"app": MagicMock()})

        for model in (rotating_model, sync_model):
            lookup = model.objects.filter.call_args.kwargs
            assert lookup["environment__deleted_at__isnull"] is True
            assert lookup["environment__app__deleted_at__isnull"] is True


class TestProvisionTeamKeys:
    def _run(self, app, teams, provision=None):
        team_model = MagicMock()
        team_model.objects.filter.return_value.distinct.return_value = teams
        with _models(Team=team_model), patch(
            "api.utils.keys.provision_team_environment_keys", side_effect=provision
        ) as provision_keys:
            jobs._provision_team_keys(app)
        return team_model, provision_keys

    def test_gives_keys_to_members_who_joined_a_team_while_it_was_locked(self):
        app = MagicMock(sse_enabled=True)
        teams = [MagicMock(), MagicMock()]

        team_model, provision_keys = self._run(app, teams)

        team_model.objects.filter.assert_called_once_with(
            app_environments__app=app, deleted_at__isnull=True
        )
        assert provision_keys.call_args_list == [call(team, app) for team in teams]

    def test_one_failing_team_does_not_stop_the_others(self):
        app = MagicMock(sse_enabled=True)

        _, provision_keys = self._run(
            app, [MagicMock(), MagicMock()], provision=[RuntimeError("boom"), None]
        )

        assert provision_keys.call_count == 2

    def test_e2ee_apps_have_no_server_wrapped_team_keys(self):
        team_model, provision_keys = self._run(MagicMock(sse_enabled=False), [])

        team_model.objects.filter.assert_not_called()
        provision_keys.assert_not_called()


# ---------------------------------------------------------------------------
# Shared purge steps, scoped to an app or an environment
# ---------------------------------------------------------------------------


class TestScopedPurgeSteps:
    @contextmanager
    def _purge_models(self, **models):
        real_get_model = purge.apps.get_model

        def get_model(app_label, name):
            return models[name] if name in models else real_get_model(app_label, name)

        with patch.object(purge.apps, "get_model", side_effect=get_model):
            yield

    def test_leases_are_revoked_for_the_scope_only(self):
        lease_model = MagicMock()
        lease_model.objects.filter.return_value.select_related.return_value = []
        app = MagicMock()

        with self._purge_models(DynamicSecretLease=lease_model):
            purge.revoke_dynamic_secret_leases({"app": app})

        lease_model.objects.filter.assert_called_once_with(
            status=lease_model.ACTIVE, secret__environment__app=app
        )

    def test_rotating_credentials_are_revoked_for_the_scope_only(self):
        rotating_model, credential_model = MagicMock(), MagicMock()
        rotating_model.objects.filter.return_value = []
        unrevoked = credential_model.objects.filter.return_value
        unrevoked.values_list.return_value = []
        unrevoked.count.return_value = 0

        with self._purge_models(
            RotatingSecret=rotating_model, RotatingSecretCredential=credential_model
        ):
            purge.revoke_rotating_secret_credentials({"id": "env-1"})

        rotating_model.objects.filter.assert_called_once_with(environment__id="env-1")
        lookup = credential_model.objects.filter.call_args.kwargs
        assert lookup["rotating_secret__environment__id"] == "env-1"

    def test_syncs_are_stopped_for_the_scope_only(self):
        sync_model = MagicMock()
        syncs = sync_model.objects.filter.return_value
        syncs.__iter__.return_value = iter([MagicMock(), MagicMock()])

        with self._purge_models(EnvironmentSync=sync_model), patch(
            "api.tasks.syncing.cancel_sync_tasks"
        ) as cancel:
            purge.stop_syncs({"id": "env-1"})

        sync_model.objects.filter.assert_called_once_with(environment__id="env-1")
        syncs.update.assert_called_once_with(is_active=False)
        assert cancel.call_count == 2

    def test_events_are_deleted_in_throttled_batches(self):
        environment_model, event_model = MagicMock(), MagicMock()
        environment_model.all_objects.filter.return_value.values_list.return_value = [
            "env-1"
        ]

        with self._purge_models(
            Environment=environment_model, SecretEvent=event_model
        ), patch.object(
            purge, "delete_secret_events", return_value=(10, True)
        ) as delete:
            assert purge.delete_environment_secret_events({"id": "env-1"}) is True

        environment_model.all_objects.filter.assert_called_once_with(id="env-1")
        options = delete.call_args.kwargs
        assert options["batch_size"] == 10_000
        assert options["sleep_ms"] == 500
        assert options["deadline"] is not None
