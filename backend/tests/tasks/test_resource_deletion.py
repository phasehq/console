"""Tests for the app and environment deletion jobs: the sweep, the purges and
the restore handlers."""

from contextlib import contextmanager
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock, call, patch

import pytest
from django.utils import timezone
from rq.exceptions import NoSuchJobError
from rq.job import Job

from api.models import App, Environment, Organisation
from api.tasks import purge
from api.tasks import recurring
from api.tasks import resource_deletion as jobs
from api.utils.resource_deletion import GRACE_PERIOD, PURGE_MARGIN

DUE = GRACE_PERIOD + timedelta(hours=1)
# Deleted a moment ago, with the grace period skipped.
IMMEDIATE = {"deleted_ago": timedelta(seconds=1), "skip_grace_period": True}
RECIPIENTS = [("owner@acme.test", "Owner"), ("dev@acme.test", "Dev")]


def _ago(ago):
    return None if ago is None else timezone.now() - ago


def _app(deleted_ago=DUE, organisation_deleted_ago=None, **attrs):
    """A real, unsaved App: the purge reads its real state."""
    organisation = Organisation(
        id="org-1", name="Acme", deleted_at=_ago(organisation_deleted_ago)
    )
    return App(
        id="app-1",
        name="Billing",
        organisation=organisation,
        deleted_at=_ago(deleted_ago),
        **attrs,
    )


def _environment(deleted_ago=DUE, app=None, **attrs):
    return Environment(
        id="env-1",
        name="Staging",
        app=app or _app(deleted_ago=None),
        deleted_at=_ago(deleted_ago),
        **attrs,
    )


def _where(queryset):
    """A queryset's conditions, as {(table, column, lookup): value}. A group
    of alternatives is under "or", in the same form."""

    def conditions(node):
        described = {}
        for child in node.children:
            if hasattr(child, "children"):
                assert child.connector == "OR"
                described["or"] = conditions(child)
            else:
                key = (child.lhs.alias, child.lhs.target.column, child.lookup_name)
                described[key] = child.rhs
        return described

    return conditions(queryset.query.where)


@contextmanager
def _models(**models):
    real_get_model = jobs.apps.get_model

    def get_model(app_label, name):
        return models[name] if name in models else real_get_model(app_label, name)

    with patch.object(jobs.apps, "get_model", side_effect=get_model):
        yield


def _model(first, locked="same"):
    """A model whose first read returns `first` and whose locked re-read,
    inside the final transaction, returns `locked`."""
    model = MagicMock()
    pending = model.all_objects.filter.return_value
    pending.select_related.return_value.first.return_value = first
    relocked = pending.select_for_update.return_value.select_related.return_value
    relocked.first.return_value = first if locked == "same" else locked
    return model


def _clear_primary_key(instance):
    # As Django's cascade does to what it deleted.
    instance.id = None


@pytest.fixture
def steps():
    """The purge's steps, in the order they are called. "commit" is the end
    of the final transaction."""
    order = MagicMock()
    order.events.return_value = True
    order.claim.return_value = 1
    order.start.return_value = 1
    order.block.return_value = 1
    order.minted.return_value = False
    order.late_events.return_value = True
    order.delete.side_effect = _clear_primary_key

    def conditional_update(**values):
        if "purge_started_at" in values:
            return order.start()  # the point of no return
        if "purge_blocked_at" in values:
            return order.block(values["purge_blocked_at"])
        return order.claim()  # the run taking the row

    def commit(*exc_info):
        order.commit()
        return False

    # Named, so its calls stay out of `order`.
    ready = MagicMock(name="ready_for_purge")
    ready.return_value.update.side_effect = conditional_update

    # What the app purge's cascade found; `data` is for a test to fill.
    cascade = MagicMock(name="cascade")
    cascade.data = {}

    def collect(instance):
        cascade.delete.side_effect = lambda: order.delete(instance)
        return cascade

    # One call for the plain replacements: Python allows 20 nested blocks.
    with patch.multiple(
        jobs,
        revoke_dynamic_secret_leases=order.leases,
        revoke_rotating_secret_credentials=order.rotating,
        ready_for_purge=ready,
        stop_syncs=order.syncs,
        delete_environment_secret_events=order.events,
        lock_secrets=order.lock_secrets,
        lock_environments=order.lock_environments,
        live_credentials_remain=order.minted,
        delete_late_secret_events=order.late_events,
        delete_with_cascade=order.delete,
        collect_cascade=collect,
        audit_app_cascade_envs=order.cascade_audit,
        record_audit_event=order.audit,
    ), patch.object(jobs, "transaction") as transaction, patch.object(
        jobs, "deletion_actor", return_value=("user", "member-1", {"email": "a@b.c"})
    ), patch.object(
        jobs, "_recipients", return_value=RECIPIENTS
    ), patch(
        "api.emails.send_app_deleted_email", order.email_app
    ), patch(
        "api.emails.send_environment_deleted_email", order.email_environment
    ), patch(
        "api.emails.send_app_deletion_delayed_email", order.email_app_delayed
    ), patch(
        "api.emails.send_environment_deletion_delayed_email",
        order.email_environment_delayed,
    ), patch.object(
        jobs, "notify"
    ) as notify:
        transaction.atomic.return_value.__exit__.side_effect = commit
        order.notify = notify
        order.ready = ready
        order.cascade = cascade
        yield order


def _called(steps):
    return [step[0] for step in steps.mock_calls]


# ---------------------------------------------------------------------------
# Sweep
# ---------------------------------------------------------------------------


class TestSweep:
    """Runs on the real models, so the lookups are real."""

    def _sweep(self):
        earliest = timezone.now() - GRACE_PERIOD - PURGE_MARGIN
        with patch.object(jobs, "enqueue_purges") as enqueue:
            jobs.sweep_resource_deletions()
        latest = timezone.now() - GRACE_PERIOD - PURGE_MARGIN

        apps, environments = (enqueued.args for enqueued in enqueue.call_args_list)
        return apps, environments, (earliest, latest)

    def test_enqueues_a_purge_for_due_apps_and_environments(self):
        apps, environments, _ = self._sweep()

        assert (apps[0], apps[1], apps[3]) == (
            jobs.purge_app,
            "purge-app",
            jobs.PURGE_JOB_TIMEOUT,
        )
        assert (environments[0], environments[1], environments[3]) == (
            jobs.purge_environment,
            "purge-environment",
            jobs.PURGE_JOB_TIMEOUT,
        )
        for _, _, ids, _ in (apps, environments):
            assert ids.query.values_select == ("id",)

    def test_apps_are_due_once_the_grace_period_and_the_margin_have_passed(self):
        apps, _, (earliest, latest) = self._sweep()

        where = _where(apps[2])
        cutoff = where["or"].pop(("api_app", "deleted_at", "lte"))
        assert earliest <= cutoff <= latest
        assert where == {
            ("api_app", "deleted_at", "isnull"): False,
            # Apps soft-deleted by releases before 2024 are never purged.
            ("api_app", "is_deleted", "exact"): False,
            # An organisation pending deletion takes its apps with it.
            ("api_organisation", "deleted_at", "isnull"): True,
            # Or at once, when the grace period was skipped: the sweep retries
            # a purge that was enqueued straight away and did not finish.
            "or": {("api_app", "skip_grace_period", "exact"): True},
        }

    def test_an_environment_whose_app_is_pending_too_is_left_to_the_app(self):
        _, environments, (earliest, latest) = self._sweep()

        where = _where(environments[2])
        cutoff = where["or"].pop(("api_environment", "deleted_at", "lte"))
        assert earliest <= cutoff <= latest
        assert where == {
            ("api_environment", "deleted_at", "isnull"): False,
            ("api_environment", "is_deleted", "exact"): False,
            ("api_app", "deleted_at", "isnull"): True,
            ("api_organisation", "deleted_at", "isnull"): True,
            "or": {("api_environment", "skip_grace_period", "exact"): True},
        }

    @pytest.mark.parametrize(
        "enqueue, purge_job, prefix",
        [
            ("enqueue_app_purge", "purge_app", "purge-app"),
            ("enqueue_environment_purge", "purge_environment", "purge-environment"),
        ],
    )
    def test_a_deletion_asked_for_at_once_does_not_wait_for_the_sweep(
        self, enqueue, purge_job, prefix
    ):
        with patch.object(jobs, "enqueue_purges") as enqueue_purges:
            getattr(jobs, enqueue)("id-1")

        # The sweep's job id: the two can't run the same purge twice at once.
        enqueue_purges.assert_called_once_with(
            getattr(jobs, purge_job), prefix, ["id-1"], jobs.PURGE_JOB_TIMEOUT
        )

    def test_the_sweep_is_scheduled_hourly(self):
        scheduler = MagicMock()
        scheduler.__contains__.return_value = False
        with patch.object(
            recurring.django_rq, "get_scheduler", return_value=scheduler
        ):
            jobs.init_resource_deletion_sweeper()

        schedule = scheduler.schedule.call_args.kwargs
        assert schedule["func"] is jobs.sweep_resource_deletions
        assert schedule["interval"] == jobs.SWEEP_INTERVAL_SECONDS == 60 * 60
        assert schedule["id"] == jobs.SWEEP_JOB_ID
        assert schedule["queue_name"] == "scheduled-jobs"

    def test_a_sweep_that_is_already_scheduled_keeps_its_time(self):
        # Each worker start registers it: its next run must not move every
        # time.
        scheduler = MagicMock()
        scheduler.__contains__.return_value = True
        # As the release before this one stored it.
        scheduler.job_class.fetch.return_value = MagicMock(
            func_name="api.tasks.resource_deletion.sweep_resource_deletions",
            meta={"interval": 60 * 60},
            origin="scheduled-jobs",
        )
        with patch.object(
            recurring.django_rq, "get_scheduler", return_value=scheduler
        ):
            jobs.init_resource_deletion_sweeper()

        scheduler.schedule.assert_not_called()
        scheduler.cancel.assert_not_called()


class TestEnqueuePurges:
    def _enqueue(self, resource_ids, fetch):
        queue = MagicMock()
        with patch.object(
            purge.django_rq, "get_queue", return_value=queue
        ) as get_queue, patch.object(purge.Job, "fetch", side_effect=fetch):
            purge.enqueue_purges(jobs.purge_app, "purge-app", resource_ids, 60)
        return queue, get_queue

    def test_enqueues_one_purge_per_resource(self):
        queue, get_queue = self._enqueue(["app-1", "app-2"], fetch=NoSuchJobError)

        # Slow, database-heavy work: not on the queue user actions wait on.
        get_queue.assert_called_once_with("maintenance")
        assert queue.enqueue.call_args_list == [
            call(jobs.purge_app, "app-1", job_id="purge-app-app-1", job_timeout=60),
            call(jobs.purge_app, "app-2", job_id="purge-app-app-2", job_timeout=60),
        ]

    @pytest.mark.parametrize("state", ["is_queued", "is_started"])
    def test_does_not_enqueue_a_purge_that_is_already_underway(self, state):
        running = MagicMock(is_queued=False, is_started=False)
        setattr(running, state, True)

        queue, _ = self._enqueue(["app-1"], fetch=lambda *a, **kw: running)

        queue.enqueue.assert_not_called()

    def test_enqueues_again_after_a_purge_that_stopped_early(self):
        # One that hit its time budget, or was blocked: the job has finished.
        finished = MagicMock(is_queued=False, is_started=False)

        queue, _ = self._enqueue(["app-1"], fetch=lambda *a, **kw: finished)

        queue.enqueue.assert_called_once()

    def test_one_failing_row_does_not_hold_up_the_rest(self):
        fetched = iter([RuntimeError("redis hiccup"), NoSuchJobError()])

        def fetch(*args, **kwargs):
            raise next(fetched)

        queue, _ = self._enqueue(["app-1", "app-2"], fetch=fetch)

        assert [enqueued.args[1] for enqueued in queue.enqueue.call_args_list] == [
            "app-2"
        ]

    @pytest.mark.parametrize(
        "resource_id",
        ["8b6f6d0e-9f43-4f0a-9d0c-2f1f0d1c7a11", "a:b", "::", "caf\u00e9: 100%/x"],
    )
    def test_rq_accepts_the_job_id_whatever_the_resource_id(self, resource_id):
        # A client can choose an app's id, and rq refuses ":" in a job id.
        job = Job(connection=MagicMock())

        job.set_id(purge.purge_job_id("purge-app", resource_id))

    def test_a_plain_id_stays_readable(self):
        assert purge.purge_job_id("purge-app", "app-1") == "purge-app-app-1"

    def test_distinct_resources_get_distinct_job_ids(self):
        ids = ["a:b", "a%3Ab", "a_b", "a b", "a%20b"]

        assert len({purge.purge_job_id("purge-app", i) for i in ids}) == len(ids)


# ---------------------------------------------------------------------------
# Purge
# ---------------------------------------------------------------------------


RELEASED = [
    "claim",
    "leases",
    "rotating",
    "start",
    "syncs",
    "events",
]
# The final transaction, up to the cascade.
CHECKED = ["lock_secrets", "lock_environments", "minted"]
# Then what a request wrote meanwhile, and the cascade.
DELETED = ["late_events", "delete"]
BLOCKED_AGO = {"purge_blocked_at": timezone.now() - timedelta(hours=3)}
CLAIMED_AGO = {"purge_claimed_at": timezone.now() - timedelta(hours=2)}
STARTED_AGO = {"purge_started_at": timezone.now() - timedelta(hours=2)}


def _handed_back(model):
    """Whether the run released its claim on the row, and nothing else."""
    pending = model.all_objects.filter.return_value
    return pending.filter.call_args_list[-1] == call(
        purge_started_at__isnull=True
    ) and pending.filter.return_value.update.call_args_list == [
        call(purge_claimed_at=None)
    ]


def _claim_touched(model):
    """Whether anything was written to the row outside the purge's own
    conditional updates, as releasing a claim is."""
    pending = model.all_objects.filter.return_value
    return pending.filter.return_value.update.called or pending.update.called


class TestPurgeApp:
    @pytest.mark.parametrize(
        "app",
        [
            None,
            _app(deleted_ago=None),
            _app(deleted_ago=GRACE_PERIOD / 2),
            _app(deleted_ago=GRACE_PERIOD + timedelta(minutes=1)),
            _app(deleted_ago=timedelta(days=900), is_deleted=True),
            _app(organisation_deleted_ago=timedelta(hours=1)),
            _app(organisation_deleted_ago=timedelta(hours=1), **IMMEDIATE),
            _app(deleted_ago=None, skip_grace_period=True),
        ],
        ids=[
            "already-purged",
            "restored",
            "not-due",
            "within-the-margin",
            "soft-deleted-by-an-old-release",
            "organisation-pending-too",
            "asked-for-at-once-but-organisation-pending-too",
            "live-with-a-stray-flag",
        ],
    )
    def test_does_nothing_unless_due(self, app, steps):
        with _models(App=_model(app)):
            jobs.purge_app("app-1")

        assert steps.mock_calls == []

    def test_a_deletion_asked_for_at_once_is_not_held_for_the_grace_period(
        self, steps
    ):
        app = _app(**IMMEDIATE)

        with _models(App=_model(app), Environment=MagicMock()):
            jobs.purge_app("app-1")

        assert _called(steps)[:11] == [*RELEASED, *CHECKED, *DELETED]
        steps.delete.assert_called_once_with(app)

    def test_a_deletion_asked_for_at_once_can_be_blocked_like_any_other(self, steps):
        steps.leases.side_effect = purge.PurgeBlockedError("could not revoke 1")
        model = _model(_app(**IMMEDIATE))

        with _models(App=model), pytest.raises(purge.PurgeBlockedError):
            jobs.purge_app("app-1")

        # Nothing is deleted; the block makes it restorable.
        assert _called(steps) == [
            "claim",
            "leases",
            "block",
            "email_app_delayed",
            "email_app_delayed",
        ]
        assert _handed_back(model)

    def test_deletes_the_app_after_releasing_what_it_holds(self, steps):
        app = _app()
        model = _model(app)
        environment_model = MagicMock()
        environments = [MagicMock(), MagicMock()]
        deleted_when_listed = []

        def list_environments(**lookup):
            deleted_when_listed.append(steps.delete.called)
            return environments

        environment_model.all_objects.filter.side_effect = list_environments
        steps.cascade.data = {
            environment_model: [
                SimpleNamespace(pk="env-1"),
                SimpleNamespace(pk="env-2"),
            ]
        }

        with _models(App=model, Environment=environment_model):
            jobs.purge_app("app-1")

        scope = {"app": app}
        assert _called(steps) == [
            *RELEASED,
            *CHECKED,
            *DELETED,
            # Recorded before the commit: the deletion and its audit rows are
            # one transaction.
            "cascade_audit",
            "audit",
            "commit",
            "email_app",
            "email_app",
        ]
        steps.leases.assert_called_once_with(scope)
        steps.rotating.assert_called_once_with(scope)
        steps.syncs.assert_called_once_with(scope)
        steps.events.assert_called_once_with(scope)
        steps.lock_secrets.assert_called_once_with(scope)
        steps.lock_environments.assert_called_once_with(scope)
        steps.minted.assert_called_once_with(scope)
        steps.late_events.assert_called_once_with(scope)
        steps.delete.assert_called_once_with(app)

        # Claimed before anything is revoked, while the purge has not started.
        # Both the claim and the point of no return are conditional on this
        # one row still being due.
        pending = model.all_objects.filter.return_value
        model.all_objects.filter.assert_called_with(id="app-1")
        pending.filter.assert_called_once_with(purge_started_at__isnull=True)
        assert steps.ready.call_args_list == [
            call(pending.filter.return_value),
            call(pending),
        ]
        claimed, started = (
            update.kwargs for update in steps.ready.return_value.update.call_args_list
        )
        assert timezone.now() - claimed["purge_claimed_at"] < timedelta(seconds=5)
        assert started["purge_claimed_at"] is None
        assert started["purge_blocked_at"] is None
        # Keeps the time of the run that first got this far.
        assert started["purge_started_at"].get_source_expressions()[0].name == (
            "purge_started_at"
        )
        # It went through: the claim is not handed back.
        pending.filter.return_value.update.assert_not_called()

        # The environments the cascade found, not those of a query of its
        # own: one created meanwhile would be deleted with no record. Read
        # before the delete. all_objects: they are hidden from the default.
        environment_model.all_objects.filter.assert_called_once_with(
            id__in=["env-1", "env-2"]
        )
        assert deleted_when_listed == [False]
        audited_app, audited_environments = steps.cascade_audit.call_args.args[:2]
        assert audited_environments == environments
        # The cascade cleared the primary key; the audit still names the app.
        assert audited_app.id == "app-1"

        audit = steps.audit.call_args.kwargs
        assert audit["event_type"] == "D"
        assert audit["resource_type"] == "app"
        assert audit["resource_id"] == "app-1"
        # Logged as the action of whoever asked for the deletion.
        assert audit["actor_id"] == "member-1"
        assert audit["description"] == "Permanently deleted app 'Billing'"

        # Nobody waited on the request that finished it, so they are emailed.
        assert steps.email_app.call_args_list == [
            call("owner@acme.test", "Owner", "Billing", "Acme", "a@b.c"),
            call("dev@acme.test", "Dev", "Billing", "Acme", "a@b.c"),
        ]

    @pytest.mark.parametrize("state", [{}, BLOCKED_AGO], ids=["first-run", "retry"])
    def test_revokes_nothing_once_the_app_was_restored(self, state, steps):
        # Also when its organisation's restore gave it a new grace period.
        steps.claim.return_value = 0

        with _models(App=_model(_app(**state))):
            jobs.purge_app("app-1")

        assert _called(steps) == ["claim"]

    def test_unrevoked_credentials_block_the_purge(self, steps):
        steps.rotating.side_effect = purge.PurgeBlockedError("could not revoke 1")
        model = _model(_app())

        with _models(App=model), pytest.raises(purge.PurgeBlockedError):
            jobs.purge_app("app-1")

        # Nothing is stopped or deleted while a credential is still live.
        assert _called(steps) == [
            "claim",
            "leases",
            "rotating",
            "block",
            "email_app_delayed",
            "email_app_delayed",
        ]
        message = steps.notify.call_args.args[0]
        assert "is blocked and will retry on the next sweep" in message
        assert "Billing" in message

        # Marked blocked once, then handed back: it can be restored again, and
        # those concerned are told so.
        pending = model.all_objects.filter.return_value
        assert pending.filter.call_args_list[1] == call(purge_blocked_at__isnull=True)
        blocked_at = steps.block.call_args.args[0]
        assert timezone.now() - blocked_at < timedelta(seconds=5)
        assert _handed_back(model)
        assert steps.email_app_delayed.call_args_list == [
            call("owner@acme.test", "Owner", "Billing", "Acme", True),
            call("dev@acme.test", "Dev", "Billing", "Acme", True),
        ]

    def test_a_block_recorded_by_another_run_is_not_emailed_about_again(self, steps):
        steps.leases.side_effect = purge.PurgeBlockedError("could not revoke 1")
        steps.block.return_value = 0  # recorded since this run read the row

        with _models(App=_model(_app())), pytest.raises(purge.PurgeBlockedError):
            jobs.purge_app("app-1")

        steps.email_app_delayed.assert_not_called()

    def test_any_other_failure_hands_the_row_back_unblocked(self, steps):
        steps.leases.side_effect = RuntimeError("database is down")
        model = _model(_app())

        with _models(App=model), pytest.raises(RuntimeError):
            jobs.purge_app("app-1")

        # Not marked blocked, so a restore stays refused: it retries.
        assert _called(steps) == ["claim", "leases"]
        assert _handed_back(model)
        steps.notify.assert_called_once()

    def test_stops_if_the_app_is_gone_once_its_credentials_were_revoked(self, steps):
        # Deleted with its organisation meanwhile.
        steps.start.return_value = 0

        with _models(App=_model(_app())):
            jobs.purge_app("app-1")

        assert _called(steps) == ["claim", "leases", "rotating", "start"]

    def test_stops_at_the_time_budget_and_leaves_the_app_locked(self, steps):
        steps.events.return_value = False

        with _models(App=_model(_app())):
            jobs.purge_app("app-1")

        # Marked started: the next sweep carries on, and it can't be restored.
        assert _called(steps) == RELEASED
        steps.delete.assert_not_called()
        steps.audit.assert_not_called()
        steps.email_app.assert_not_called()

    def test_a_failed_email_does_not_fail_the_purge(self, steps):
        # The delete has committed; the next recipient still gets theirs.
        steps.email_app.side_effect = [RuntimeError("smtp down"), None]

        with _models(App=_model(_app()), Environment=MagicMock()):
            jobs.purge_app("app-1")

        steps.delete.assert_called_once()
        assert steps.email_app.call_count == 2

    def test_a_failed_delete_leaves_no_audit_trail(self, steps):
        steps.delete.side_effect = RuntimeError("fk violation")

        with _models(App=_model(_app()), Environment=MagicMock()), pytest.raises(
            RuntimeError
        ):
            jobs.purge_app("app-1")

        steps.cascade_audit.assert_not_called()
        steps.audit.assert_not_called()
        steps.email_app.assert_not_called()

    def test_a_failed_audit_write_fails_the_delete(self, steps):
        # Raised, not swallowed: inside the transaction a swallowed database
        # error would roll the delete back and report it as done.
        steps.audit.side_effect = RuntimeError("audit table unavailable")

        with _models(App=_model(_app()), Environment=MagicMock()), pytest.raises(
            RuntimeError
        ):
            jobs.purge_app("app-1")

        steps.email_app.assert_not_called()

    @pytest.mark.parametrize(
        "locked",
        [None, _app(deleted_ago=None), _app(organisation_deleted_ago=timedelta(1))],
        ids=["gone", "restored", "organisation-pending-too"],
    )
    def test_rechecks_under_the_row_lock_before_deleting(self, locked, steps):
        model = _model(_app(), locked=locked)

        with _models(App=model):
            jobs.purge_app("app-1")

        # The organisation row stays unlocked. no_key: a request already
        # under way that holds an environment row can still commit.
        pending = model.all_objects.filter.return_value
        pending.select_for_update.assert_called_once_with(no_key=True, of=("self",))
        steps.lock_environments.assert_not_called()
        steps.delete.assert_not_called()
        steps.audit.assert_not_called()
        steps.email_app.assert_not_called()

    # -- a blocked purge is retried ------------------------------------------

    def test_a_retry_claims_the_row_like_a_first_run(self, steps):
        # Blocked means restorable: a restore must not land while the
        # credentials of what would be a live app are being revoked.
        model = _model(_app(**BLOCKED_AGO))

        with _models(App=model, Environment=MagicMock()):
            jobs.purge_app("app-1")

        assert _called(steps)[:6] == RELEASED
        steps.delete.assert_called_once()

    @pytest.mark.parametrize(
        "failure, steps_taken",
        [
            (
                purge.PurgeBlockedError("could not revoke 1"),
                ["claim", "leases", "rotating", "block"],
            ),
            (RuntimeError("redis down"), ["claim", "leases", "rotating"]),
        ],
        ids=["blocked-again", "any-other-failure"],
    )
    def test_a_retry_that_fails_hands_the_row_back(self, failure, steps_taken, steps):
        steps.rotating.side_effect = failure
        steps.block.return_value = 0  # already marked blocked
        model = _model(_app(**BLOCKED_AGO))

        with _models(App=model), pytest.raises(type(failure)):
            jobs.purge_app("app-1")

        # Restorable again, and no second email about the same block.
        assert _called(steps) == steps_taken
        assert _handed_back(model)
        steps.email_app_delayed.assert_not_called()

    def test_a_claim_left_by_a_run_that_died_is_taken_over(self, steps):
        # One purge job runs per row at a time, so nobody else holds it.
        steps.leases.side_effect = purge.PurgeBlockedError("could not revoke 1")
        steps.block.return_value = 0
        model = _model(_app(**BLOCKED_AGO, **CLAIMED_AGO))

        with _models(App=model), pytest.raises(purge.PurgeBlockedError):
            jobs.purge_app("app-1")

        assert _called(steps) == ["claim", "leases", "block"]
        assert _handed_back(model)

    # -- a purge that has started --------------------------------------------

    def test_a_started_purge_goes_on_without_claiming(self, steps):
        # An earlier run stopped at its time budget.
        model = _model(_app(**STARTED_AGO))

        with _models(App=model, Environment=MagicMock()):
            jobs.purge_app("app-1")

        assert _called(steps)[:5] == ["leases", "rotating", "start", "syncs", "events"]
        steps.claim.assert_not_called()
        steps.delete.assert_called_once()

    def test_a_started_purge_that_is_blocked_is_delayed_but_not_restorable(
        self, steps
    ):
        # An earlier run stopped part way: logs are gone, syncs are stopped.
        steps.leases.side_effect = purge.PurgeBlockedError("could not revoke 1")
        model = _model(_app(**STARTED_AGO))

        with _models(App=model), pytest.raises(purge.PurgeBlockedError):
            jobs.purge_app("app-1")

        # The delay is recorded and those concerned are told, without the
        # offer to restore. Nothing is handed back.
        assert _called(steps) == [
            "leases",
            "block",
            "email_app_delayed",
            "email_app_delayed",
        ]
        assert not _handed_back(model) and not _claim_touched(model)
        assert steps.email_app_delayed.call_args_list[0] == call(
            "owner@acme.test", "Owner", "Billing", "Acme", False
        )
        steps.notify.assert_called_once()

    # -- credentials minted while the purge ran ------------------------------

    def test_revokes_what_was_minted_meanwhile_then_deletes(self, steps):
        # A lease whose request began before the deletion was asked for.
        steps.minted.side_effect = [True, False]

        with _models(App=_model(_app()), Environment=MagicMock()):
            jobs.purge_app("app-1")

        assert _called(steps)[6:17] == [
            *CHECKED,
            "commit",
            "leases",
            "rotating",
            *CHECKED,
            *DELETED,
        ]
        steps.delete.assert_called_once()

    def test_what_was_minted_meanwhile_and_cant_be_revoked_delays_the_purge(
        self, steps
    ):
        steps.minted.return_value = True
        steps.leases.side_effect = [None, purge.PurgeBlockedError("could not revoke 1")]
        model = _model(_app())

        with _models(App=model), pytest.raises(purge.PurgeBlockedError):
            jobs.purge_app("app-1")

        # Past the point of no return: recorded and emailed, never restorable.
        assert _called(steps)[6:] == [
            *CHECKED,
            "commit",
            "leases",
            "block",
            "email_app_delayed",
            "email_app_delayed",
        ]
        assert steps.email_app_delayed.call_args_list[0] == call(
            "owner@acme.test", "Owner", "Billing", "Acme", False
        )
        assert not _handed_back(model) and not _claim_touched(model)
        steps.delete.assert_not_called()

    def test_leaves_it_to_the_next_sweep_if_credentials_keep_appearing(self, steps):
        steps.minted.return_value = True

        with _models(App=_model(_app())):
            jobs.purge_app("app-1")

        assert steps.minted.call_count == jobs.FINAL_DELETE_ATTEMPTS
        steps.delete.assert_not_called()
        steps.audit.assert_not_called()
        steps.email_app.assert_not_called()

    def test_leaves_it_to_the_next_sweep_if_a_late_event_is_held(self, steps):
        # Another transaction holds a secret event that was written meanwhile.
        # The cleanup skips it and says so. The cascade would fail on it and
        # roll back, so it is not started.
        steps.late_events.return_value = False
        model = _model(_app())

        with _models(App=model, Environment=MagicMock()):
            jobs.purge_app("app-1")

        assert _called(steps)[6:] == [*CHECKED, "late_events", "commit"]
        steps.delete.assert_not_called()
        steps.audit.assert_not_called()
        steps.email_app.assert_not_called()
        # Past the point of no return: the row stays as it is for the next run.
        assert not _handed_back(model)

    def test_looks_for_live_credentials_with_every_row_above_them_locked(self, steps):
        # The secrets first: a rotation in flight holds its rotating secret,
        # then updates the environment, so the other order could deadlock with
        # it. The environments last: that waits for a request that is still
        # adding a secret, and stops anything more being added.
        model = _model(_app())
        locked = []
        steps.lock_secrets.side_effect = lambda scope: locked.append("secrets")
        relocked = model.all_objects.filter.return_value.select_for_update
        relocked.side_effect = lambda **kw: locked.append("app") or relocked.return_value
        steps.lock_environments.side_effect = lambda scope: locked.append(
            "environments"
        )
        steps.minted.side_effect = lambda scope: locked.append("look") and False

        with _models(App=model, Environment=MagicMock()):
            jobs.purge_app("app-1")

        assert locked == ["secrets", "app", "environments", "look"]
        steps.delete.assert_called_once()


class TestPurgeEnvironment:
    @pytest.mark.parametrize(
        "environment",
        [
            None,
            _environment(deleted_ago=None),
            _environment(deleted_ago=GRACE_PERIOD / 2),
            _environment(deleted_ago=GRACE_PERIOD + timedelta(minutes=1)),
            _environment(deleted_ago=timedelta(days=900), is_deleted=True),
            _environment(app=_app(deleted_ago=timedelta(minutes=5))),
            _environment(
                app=_app(deleted_ago=None, organisation_deleted_ago=timedelta(1))
            ),
            _environment(app=_app(deleted_ago=timedelta(minutes=5)), **IMMEDIATE),
            _environment(
                app=_app(deleted_ago=None, organisation_deleted_ago=timedelta(1)),
                **IMMEDIATE,
            ),
            # Started, but its app was deleted since: it waits for the app.
            _environment(app=_app(deleted_ago=timedelta(minutes=5)), **STARTED_AGO),
        ],
        ids=[
            "already-purged",
            "restored",
            "not-due",
            "within-the-margin",
            "soft-deleted",
            "app-pending-too",
            "organisation-pending-too",
            "asked-for-at-once-but-app-pending-too",
            "asked-for-at-once-but-organisation-pending-too",
            "started-but-app-pending-too",
        ],
    )
    def test_does_nothing_unless_due(self, environment, steps):
        with _models(Environment=_model(environment)):
            jobs.purge_environment("env-1")

        assert steps.mock_calls == []

    def test_a_deletion_asked_for_at_once_is_not_held_for_the_grace_period(
        self, steps
    ):
        environment = _environment(**IMMEDIATE)

        with _models(Environment=_model(environment)):
            jobs.purge_environment("env-1")

        assert _called(steps)[:11] == [*RELEASED, *CHECKED, *DELETED]
        steps.delete.assert_called_once_with(environment)

    def test_deletes_the_environment_after_releasing_what_it_holds(self, steps):
        environment = _environment()
        model = _model(environment)

        with _models(Environment=model):
            jobs.purge_environment("env-1")

        scope = {"id": "env-1"}
        assert _called(steps) == [
            *RELEASED,
            *CHECKED,
            *DELETED,
            "audit",
            "commit",
            "email_environment",
            "email_environment",
        ]
        steps.leases.assert_called_once_with(scope)
        steps.events.assert_called_once_with(scope)
        steps.lock_secrets.assert_called_once_with(scope)
        steps.lock_environments.assert_called_once_with(scope)
        steps.minted.assert_called_once_with(scope)
        steps.delete.assert_called_once_with(environment)
        # The app row stays unlocked.
        pending = model.all_objects.filter.return_value
        pending.select_for_update.assert_called_once_with(of=("self",))
        pending.filter.assert_called_once_with(purge_started_at__isnull=True)

        audit = steps.audit.call_args.kwargs
        assert audit["resource_type"] == "env"
        assert audit["resource_id"] == "env-1"
        assert audit["actor_id"] == "member-1"
        assert audit["resource_metadata"]["app_id"] == "app-1"
        assert audit["description"] == (
            "Permanently deleted environment 'Staging' from app 'Billing'"
        )

        assert steps.email_environment.call_args_list[0] == call(
            "owner@acme.test", "Owner", "Staging", "Billing", "Acme", "a@b.c"
        )

    def test_revokes_nothing_once_the_environment_was_restored(self, steps):
        # Also when its app's restore gave it a new grace period.
        steps.claim.return_value = 0

        with _models(Environment=_model(_environment())):
            jobs.purge_environment("env-1")

        assert _called(steps) == ["claim"]

    def test_unrevoked_credentials_block_the_purge(self, steps):
        steps.leases.side_effect = purge.PurgeBlockedError("could not revoke 1")
        model = _model(_environment())

        with _models(Environment=model), pytest.raises(purge.PurgeBlockedError):
            jobs.purge_environment("env-1")

        assert _called(steps) == [
            "claim",
            "leases",
            "block",
            "email_environment_delayed",
            "email_environment_delayed",
        ]
        assert _handed_back(model)
        assert steps.email_environment_delayed.call_args_list[0] == call(
            "owner@acme.test", "Owner", "Staging", "Billing", "Acme", True
        )

    def test_a_retry_claims_the_row_and_hands_it_back_if_blocked_again(self, steps):
        steps.leases.side_effect = purge.PurgeBlockedError("could not revoke 1")
        steps.block.return_value = 0  # already marked blocked
        model = _model(_environment(**BLOCKED_AGO))

        with _models(Environment=model), pytest.raises(purge.PurgeBlockedError):
            jobs.purge_environment("env-1")

        assert _called(steps) == ["claim", "leases", "block"]
        assert _handed_back(model)
        steps.email_environment_delayed.assert_not_called()

    def test_a_started_purge_that_is_blocked_is_delayed_but_not_restorable(
        self, steps
    ):
        steps.rotating.side_effect = purge.PurgeBlockedError("could not revoke 1")
        model = _model(_environment(**STARTED_AGO))

        with _models(Environment=model), pytest.raises(purge.PurgeBlockedError):
            jobs.purge_environment("env-1")

        assert _called(steps) == [
            "leases",
            "rotating",
            "block",
            "email_environment_delayed",
            "email_environment_delayed",
        ]
        assert not _handed_back(model) and not _claim_touched(model)
        assert steps.email_environment_delayed.call_args_list[0] == call(
            "owner@acme.test", "Owner", "Staging", "Billing", "Acme", False
        )

    def test_what_was_minted_meanwhile_and_cant_be_revoked_delays_the_purge(
        self, steps
    ):
        steps.minted.return_value = True
        steps.rotating.side_effect = [
            None,
            purge.PurgeBlockedError("could not revoke 1"),
        ]

        with _models(Environment=_model(_environment())), pytest.raises(
            purge.PurgeBlockedError
        ):
            jobs.purge_environment("env-1")

        assert _called(steps)[-3:] == [
            "block",
            "email_environment_delayed",
            "email_environment_delayed",
        ]
        assert steps.email_environment_delayed.call_args_list[0].args[-1] is False
        steps.delete.assert_not_called()

    def test_stops_at_the_time_budget_and_leaves_the_environment_locked(self, steps):
        steps.events.return_value = False

        with _models(Environment=_model(_environment())):
            jobs.purge_environment("env-1")

        steps.delete.assert_not_called()

    def test_leaves_it_to_the_next_sweep_if_a_late_event_is_held(self, steps):
        steps.late_events.return_value = False

        with _models(Environment=_model(_environment())):
            jobs.purge_environment("env-1")

        assert _called(steps)[6:] == [*CHECKED, "late_events", "commit"]
        steps.late_events.assert_called_once_with({"id": "env-1"})
        steps.delete.assert_not_called()
        steps.audit.assert_not_called()
        steps.email_environment.assert_not_called()

    def test_restored_while_releasing_is_not_deleted(self, steps):
        model = _model(_environment(), locked=_environment(deleted_ago=None))

        with _models(Environment=model):
            jobs.purge_environment("env-1")

        steps.lock_environments.assert_not_called()
        steps.delete.assert_not_called()
        steps.audit.assert_not_called()

    def test_a_failed_delete_leaves_no_audit_trail(self, steps):
        steps.delete.side_effect = RuntimeError("fk violation")

        with _models(Environment=_model(_environment())), pytest.raises(RuntimeError):
            jobs.purge_environment("env-1")

        steps.audit.assert_not_called()
        steps.email_environment.assert_not_called()


class TestDeletionEmails:
    def _recipients(self, actor, requester="same-as-default"):
        member_model = MagicMock()
        lookup = member_model.objects.filter.return_value.select_related.return_value
        if requester == "same-as-default":
            requester = MagicMock()
            requester.user.email = "dev@acme.test"
        lookup.first.return_value = requester
        with _models(OrganisationMember=member_model), patch.object(
            jobs, "owner_recipients", return_value=[("owner@acme.test", "Owner")]
        ), patch("api.emails.get_user_display_name", return_value="Dev"):
            return jobs._recipients("org", actor), member_model

    def test_owners_and_the_member_who_scheduled_the_deletion(self):
        recipients, member_model = self._recipients(("user", "member-1", {}))

        assert recipients == [("owner@acme.test", "Owner"), ("dev@acme.test", "Dev")]
        # Only while they are still a member of this organisation.
        member_model.objects.filter.assert_called_once_with(
            id="member-1", organisation="org", deleted_at=None
        )

    def test_an_owner_who_scheduled_it_is_emailed_once(self):
        owner = MagicMock()
        owner.user.email = "owner@acme.test"

        recipients, _ = self._recipients(("user", "member-1", {}), requester=owner)

        assert recipients == [("owner@acme.test", "Owner")]

    @pytest.mark.parametrize(
        "actor",
        [("sa", "sa-1", {"name": "ci"}), ("user", "", {})],
        ids=["service-account", "unknown"],
    )
    def test_only_owners_when_no_member_scheduled_it(self, actor):
        recipients, member_model = self._recipients(actor)

        assert recipients == [("owner@acme.test", "Owner")]
        member_model.objects.filter.assert_not_called()

    def test_only_owners_when_the_member_has_since_left(self):
        recipients, _ = self._recipients(("user", "member-1", {}), requester=None)

        assert recipients == [("owner@acme.test", "Owner")]

    @pytest.mark.parametrize(
        "actor, expected",
        [
            (("user", "member-1", {"email": "dev@acme.test"}), "dev@acme.test"),
            (("sa", "sa-1", {"name": "ci"}), "the service account ci"),
            (("user", "", {}), None),
        ],
        ids=["member", "service-account", "unknown"],
    )
    def test_names_who_scheduled_the_deletion(self, actor, expected):
        assert jobs._requested_by(actor) == expected

    def test_a_failed_lookup_emails_nobody_and_does_not_raise(self):
        send = MagicMock()
        with patch.object(jobs, "_recipients", side_effect=RuntimeError("db down")):
            jobs._email("org", ("user", "member-1", {}), send)

        send.assert_not_called()

    def _sent(self, send, *args):
        from api import emails

        with patch.object(emails, "send_mail") as send_mail:
            getattr(emails, send)("owner@acme.test", "Ada", *args)

        subject, _, _, recipients = send_mail.call_args[0]
        text = " ".join(send_mail.call_args.kwargs["html_message"].split())
        return subject, recipients, text

    def test_app_deleted_email(self):
        subject, recipients, text = self._sent(
            "send_app_deleted_email", "Billing", "Acme", "dev@acme.test"
        )

        assert subject == "Billing has been deleted"
        assert recipients == ["owner@acme.test"]
        assert "Hi Ada" in text
        assert "The app <b>Billing</b> in your Phase organisation <b>Acme</b>" in text
        assert "permanently deleted" in text
        # True of a scheduled deletion and of one asked for at once.
        assert "It was deleted by <b>dev@acme.test</b>" in text

    def test_environment_deleted_email(self):
        subject, recipients, text = self._sent(
            "send_environment_deleted_email", "Staging", "Billing", "Acme", None
        )

        assert subject == "Staging in Billing has been deleted"
        assert recipients == ["owner@acme.test"]
        assert "The environment <b>Staging</b> of the app <b>Billing</b>" in text
        assert "<b>Acme</b>" in text
        # Left out when nobody is known to have asked for it.
        assert "It was deleted by" not in text

    def test_app_deletion_delayed_email(self):
        subject, recipients, text = self._sent(
            "send_app_deletion_delayed_email", "Billing", "Acme", True
        )

        assert subject == "Deletion of Billing is delayed"
        assert recipients == ["owner@acme.test"]
        assert "the app <b>Billing</b> in <b>Acme</b>" in text
        assert "won\u2019t be deleted until they are revoked" in text
        assert "restore the app from the Apps page" in text
        assert "can no longer be restored" not in text

    def test_environment_deletion_delayed_email(self):
        subject, recipients, text = self._sent(
            "send_environment_deletion_delayed_email",
            "Staging",
            "Billing",
            "Acme",
            True,
        )

        assert subject == "Deletion of Staging in Billing is delayed"
        assert recipients == ["owner@acme.test"]
        assert "the environment <b>Staging</b> of the app <b>Billing</b>" in text
        assert "<b>Acme</b>" in text
        assert "restore the environment from the app\u2019s page" in text
        assert "can no longer be restored" not in text

    @pytest.mark.parametrize(
        "send, args, what",
        [
            ("send_app_deletion_delayed_email", ("Billing", "Acme"), "app"),
            (
                "send_environment_deletion_delayed_email",
                ("Staging", "Billing", "Acme"),
                "environment",
            ),
        ],
    )
    def test_a_delay_after_the_purge_started_offers_no_restore(self, send, args, what):
        _, _, text = self._sent(send, *args, False)

        assert "won\u2019t be deleted until they are revoked" in text
        assert f"so the {what} can no longer be restored" in text
        assert "give it access again" in text
        assert "you can still restore" not in text


# ---------------------------------------------------------------------------
# Restore
# ---------------------------------------------------------------------------


@pytest.fixture
def restore_steps():
    order = MagicMock()
    with patch.object(jobs, "_rearm_rotations", order.rotations), patch.object(
        jobs, "_resync_referencing_environments", order.resync
    ), patch.object(jobs, "_run_syncs", order.syncs), patch.object(
        jobs, "_provision_team_keys", order.keys
    ):
        yield order


def _restored(model, row, related=False):
    """Make `row` what the restore job reads for `model`."""
    locked = model.all_objects.filter.return_value
    if related:
        locked = locked.select_related.return_value
    locked.select_for_update.return_value.first.return_value = row
    return locked


class TestRestoreHandlers:
    def test_restored_app_resumes_everything_under_it(self, restore_steps):
        app = MagicMock(id="app-1", deleted_at=None)
        model = MagicMock()
        _restored(model, app)

        with _models(App=model), patch.object(jobs, "transaction"):
            jobs.handle_app_restored("app-1")

        restore_steps.rotations.assert_called_once_with({"app": app})
        restore_steps.syncs.assert_called_once_with({"app": app})
        # One scan for all of its environments.
        app.environments.values_list.assert_called_once_with("id", flat=True)
        restore_steps.resync.assert_called_once_with(
            app.environments.values_list.return_value
        )
        # The syncs last, with nothing after them that can fail: a retry then
        # runs no sync a second time. The team keys are a job of their own.
        assert _called(restore_steps) == ["rotations", "resync", "syncs"]

    def test_restored_environment_resumes(self, restore_steps):
        environment = MagicMock(id="env-1", deleted_at=None)
        environment.app.deleted_at = None
        model = MagicMock()
        _restored(model, environment, related=True)

        with _models(Environment=model), patch.object(jobs, "transaction"):
            jobs.handle_environment_restored("env-1")

        model.all_objects.filter.return_value.select_related.assert_called_once_with(
            "app"
        )
        restore_steps.rotations.assert_called_once_with({"id": "env-1"})
        restore_steps.syncs.assert_called_once_with({"id": "env-1"})
        restore_steps.resync.assert_called_once_with(["env-1"])
        assert _called(restore_steps) == ["rotations", "resync", "syncs"]

    @pytest.mark.parametrize(
        "failing, ran",
        [("rotations", ["rotations"]), ("resync", ["rotations", "resync"])],
    )
    def test_a_step_that_fails_is_retried_before_any_sync_has_run(
        self, failing, ran, restore_steps
    ):
        # The job is retried as a whole. A sync that ran once more would
        # write its secrets again, unchanged: a new version at some targets.
        getattr(restore_steps, failing).side_effect = RuntimeError("redis is gone")
        model = MagicMock()
        _restored(model, MagicMock(id="app-1", deleted_at=None))

        with _models(App=model), patch.object(jobs, "transaction"), pytest.raises(
            RuntimeError
        ):
            jobs.handle_app_restored("app-1")

        assert _called(restore_steps) == ran

    def test_the_team_keys_of_a_restored_app_are_a_job_of_their_own(
        self, restore_steps
    ):
        # With its own retries: a team whose keys can't be provisioned fails
        # this job only, and the syncs and the scan are not run again.
        app = MagicMock(id="app-1", deleted_at=None)
        model = MagicMock()
        locked = _restored(model, app)

        with _models(App=model), patch.object(jobs, "transaction"):
            jobs.provision_team_keys_for_restored_app("app-1")

        # It waits for the restore as the other job does.
        model.all_objects.filter.assert_called_once_with(id="app-1")
        locked.select_for_update.assert_called_once_with(no_key=True, of=("self",))
        restore_steps.keys.assert_called_once_with(app)
        assert _called(restore_steps) == ["keys"]

    def test_the_team_keys_of_a_restored_environment_are_a_job_of_their_own(
        self, restore_steps
    ):
        environment = MagicMock(id="env-1", deleted_at=None)
        environment.app.deleted_at = None
        model = MagicMock()
        _restored(model, environment, related=True)

        with _models(Environment=model), patch.object(jobs, "transaction"):
            jobs.provision_team_keys_for_restored_environment("env-1")

        model.all_objects.filter.assert_called_once_with(id="env-1")
        restore_steps.keys.assert_called_once_with(environment.app)
        assert _called(restore_steps) == ["keys"]

    def test_a_team_key_job_that_fails_is_left_to_its_retries(self, restore_steps):
        restore_steps.keys.side_effect = RuntimeError("boom")
        model = MagicMock()
        _restored(model, MagicMock(id="app-1", deleted_at=None))

        with _models(App=model), patch.object(jobs, "transaction"), pytest.raises(
            RuntimeError, match="boom"
        ):
            jobs.provision_team_keys_for_restored_app("app-1")

    def test_waits_for_the_restore_to_commit_however_long_it_takes(
        self, restore_steps
    ):
        # Queued inside the restore's transaction, so it can start first. The
        # restore holds the row locked until it ends: a locking read waits
        # for it, where a plain read would see the app still hidden.
        app = MagicMock(id="app-1", deleted_at=None)
        model = MagicMock()
        locked = _restored(model, app)
        events = []

        def read():
            events.append("read")
            return app

        def end(*exc):
            events.append("end")
            return False

        locked.select_for_update.return_value.first.side_effect = read
        restore_steps.rotations.side_effect = lambda scope: events.append("resume")

        with _models(App=model), patch.object(jobs, "transaction") as transaction:
            transaction.atomic.return_value.__enter__.side_effect = (
                lambda: events.append("begin")
            )
            transaction.atomic.return_value.__exit__.side_effect = end
            jobs.handle_app_restored("app-1")

        # all_objects: the default manager hides it until the restore commits.
        model.objects.filter.assert_not_called()
        model.all_objects.filter.assert_called_once_with(id="app-1")
        # no_key: enough to wait for the restore's lock.
        locked.select_for_update.assert_called_once_with(no_key=True, of=("self",))
        # The lock is given up before the work starts.
        assert events == ["begin", "read", "end", "resume"]

    @pytest.mark.parametrize(
        "row",
        [None, MagicMock(deleted_at=timezone.now())],
        ids=["gone", "still-pending"],
    )
    def test_does_nothing_for_an_app_that_is_not_live(self, row, restore_steps):
        # The restore was rolled back, or the app was deleted again.
        model = MagicMock()
        _restored(model, row)

        with _models(App=model), patch.object(jobs, "transaction"):
            jobs.handle_app_restored("app-1")
            jobs.provision_team_keys_for_restored_app("app-1")

        assert _called(restore_steps) == []

    @pytest.mark.parametrize(
        "deleted_at, app_deleted_at",
        [(timezone.now(), None), (None, timezone.now())],
        ids=["still-pending", "its-app-is-pending"],
    )
    def test_does_nothing_for_an_environment_that_is_not_live(
        self, deleted_at, app_deleted_at, restore_steps
    ):
        environment = MagicMock(id="env-1", deleted_at=deleted_at)
        environment.app.deleted_at = app_deleted_at
        model = MagicMock()
        _restored(model, environment, related=True)

        with _models(Environment=model), patch.object(jobs, "transaction"):
            jobs.handle_environment_restored("env-1")
            jobs.provision_team_keys_for_restored_environment("env-1")
            _restored(model, None, related=True)
            jobs.handle_environment_restored("env-1")
            jobs.provision_team_keys_for_restored_environment("env-1")

        assert _called(restore_steps) == []

    def test_a_restore_queues_two_jobs_on_the_default_queue(self):
        queue = MagicMock()
        with patch.object(jobs.django_rq, "get_queue", return_value=queue) as get_queue:
            jobs.enqueue_app_restored("app-1")
            jobs.enqueue_environment_restored("env-1")

        assert get_queue.call_args_list == [call("default"), call("default")]
        # The team keys apart from the rest: each job is retried on its own.
        for_app, for_environment = (
            enqueued.args[0] for enqueued in queue.enqueue_many.call_args_list
        )
        assert [(job.func, job.args) for job in for_app] == [
            (jobs.handle_app_restored, ("app-1",)),
            (jobs.provision_team_keys_for_restored_app, ("app-1",)),
        ]
        assert [(job.func, job.args) for job in for_environment] == [
            (jobs.handle_environment_restored, ("env-1",)),
            (jobs.provision_team_keys_for_restored_environment, ("env-1",)),
        ]

    @pytest.mark.parametrize(
        "enqueue", [jobs.enqueue_app_restored, jobs.enqueue_environment_restored]
    )
    def test_the_jobs_of_a_restore_are_queued_together_or_not_at_all(self, enqueue):
        # One call, which rq sends as one Redis transaction. Queued one by
        # one, a failure in between rolls the restore back with the first
        # job left behind: it then runs next to the jobs of the retry.
        queue = MagicMock()
        with patch.object(jobs.django_rq, "get_queue", return_value=queue):
            enqueue("id-1")

        queue.enqueue_many.assert_called_once()
        assert len(queue.enqueue_many.call_args.args[0]) == 2
        # No pipeline of our own: rq opens one, and sends it once.
        assert queue.enqueue_many.call_args.kwargs == {}
        queue.enqueue.assert_not_called()
        queue.enqueue_call.assert_not_called()

    @pytest.mark.parametrize(
        "enqueue", [jobs.enqueue_app_restored, jobs.enqueue_environment_restored]
    )
    def test_a_job_that_fails_or_dies_is_run_again(self, enqueue):
        # A restore can't be asked for twice, so nothing else would finish it.
        # rq's defaults are no retry, and 180 s for the job.
        queue = MagicMock()
        with patch.object(jobs.django_rq, "get_queue", return_value=queue):
            enqueue("id-1")

        prepared = queue.enqueue_many.call_args.args[0]
        assert len(prepared) == 2
        for job in prepared:
            assert job.timeout == 60 * 60
            assert job.retry.max == 3
            assert job.retry.intervals == [10, 30, 60]

    def test_one_reference_scan_covers_every_restored_environment(self):
        with patch(
            "api.tasks.syncing.detect_and_trigger_referencing_syncs_for"
        ) as scan:
            jobs._resync_referencing_environments(["env-1", "env-2"])
            jobs._resync_referencing_environments([])

        scan.delay.assert_called_once_with(["env-1", "env-2"])


class TestResume:
    def _run(self, environments):
        rotating_model, sync_model = MagicMock(), MagicMock(CANCELLED="cancelled")
        rotating_secrets = [MagicMock(), MagicMock()]
        syncs = [MagicMock(), MagicMock()]
        rotating_model.objects.filter.return_value = rotating_secrets
        sync_model.objects.filter.return_value = syncs
        with _models(RotatingSecret=rotating_model, EnvironmentSync=sync_model), patch(
            "ee.integrations.secrets.rotation.engine.reschedule"
        ) as reschedule, patch("api.tasks.syncing.trigger_sync_tasks") as trigger:
            jobs._rearm_rotations(environments)
            jobs._run_syncs(environments)
        return rotating_model, sync_model, reschedule, trigger, rotating_secrets, syncs

    def test_rearms_the_rotations_and_runs_the_syncs_again(self):
        app = MagicMock()

        rotating_model, sync_model, reschedule, trigger, rotating_secrets, syncs = (
            self._run({"app": app})
        )

        # Without the syncs that saving a rotating secret sets off: with ten
        # rotating secrets, each sync would run ten times, with ten scans of
        # the organisation's references.
        assert reschedule.call_args_list == [
            call(rs, trigger_syncs=False) for rs in rotating_secrets
        ]
        # They run once each instead.
        assert trigger.call_args_list == [call(sync) for sync in syncs]

        rotations = rotating_model.objects.filter.call_args.kwargs
        assert rotations["environment__app"] is app
        # Paused secrets stay paused.
        assert rotations["is_active"] is True
        assert rotations["deleted_at__isnull"] is True

        lookup = sync_model.objects.filter.call_args.kwargs
        assert lookup["environment__app"] is app
        # Paused syncs stay paused.
        assert lookup["is_active"] is True
        assert lookup["deleted_at__isnull"] is True

    def test_runs_the_syncs_that_were_not_cancelled_too(self):
        # A sync can be out of date without having been cancelled. A secret
        # it references changed while it was locked, in another app or just
        # before the deletion: the scan that would have run it skipped it.
        _, sync_model, *_ = self._run({"id": "env-1"})

        lookup = sync_model.objects.filter.call_args.kwargs
        assert "status" not in lookup
        assert lookup["environment__id"] == "env-1"

    def test_an_environment_still_pending_deletion_stays_locked(self):
        # A restored app may hold an environment that was deleted on its own.
        rotating_model, sync_model, *_ = self._run({"app": MagicMock()})

        for model in (rotating_model, sync_model):
            lookup = model.objects.filter.call_args.kwargs
            assert lookup["environment__deleted_at__isnull"] is True
            assert lookup["environment__app__deleted_at__isnull"] is True


class TestProvisionTeamKeys:
    def _run(self, app, teams):
        team_model = MagicMock()
        team_model.objects.filter.return_value.distinct.return_value = teams
        with _models(Team=team_model), patch(
            "api.utils.keys.provision_team_environment_keys"
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

    def test_one_failing_team_does_not_stop_the_others_but_fails_the_job(self):
        # Raised once every team was tried, so the job's retry covers it.
        app = MagicMock(sse_enabled=True)
        team_model = MagicMock()
        team_model.objects.filter.return_value.distinct.return_value = [
            MagicMock(),
            MagicMock(),
        ]

        with _models(Team=team_model), patch(
            "api.utils.keys.provision_team_environment_keys",
            side_effect=[RuntimeError("boom"), None],
        ) as provision_keys, pytest.raises(RuntimeError, match="boom"):
            jobs._provision_team_keys(app)

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

    def test_the_secrets_are_locked_for_the_scope_only(self):
        # With its secret locked, no lease or credential can be added to it
        # before the cascade commits.
        secret_model, rotating_model = MagicMock(), MagicMock()

        with self._purge_models(
            DynamicSecret=secret_model, RotatingSecret=rotating_model
        ):
            purge.lock_secrets({"id": "env-1"})

        for model in (secret_model, rotating_model):
            # of=self: not the environments the filter joins.
            model.objects.select_for_update.assert_called_once_with(of=("self",))
            locked = model.objects.select_for_update.return_value
            locked.filter.assert_called_once_with(environment__id="env-1")
            # Evaluated: a queryset that is never read takes no lock.
            locked.filter.return_value.only.return_value.__iter__.assert_called_once()

    def test_the_environments_are_locked_though_pending_deletion(self):
        environment_model = MagicMock()
        app = MagicMock()

        with self._purge_models(Environment=environment_model):
            purge.lock_environments({"app": app})

        # all_objects: the ones pending deletion are the ones being purged.
        environment_model.objects.select_for_update.assert_not_called()
        environment_model.all_objects.select_for_update.assert_called_once_with(
            of=("self",)
        )
        locked = environment_model.all_objects.select_for_update.return_value
        locked.filter.assert_called_once_with(app=app)
        locked.filter.return_value.only.return_value.__iter__.assert_called_once()

    def _live_credentials(self, active_lease=False, unrevoked_credential=False):
        lease_model, credential_model = MagicMock(), MagicMock()
        lease_model.objects.filter.return_value.exists.return_value = active_lease
        credential_model.objects.filter.return_value.exists.return_value = (
            unrevoked_credential
        )
        with self._purge_models(
            DynamicSecretLease=lease_model, RotatingSecretCredential=credential_model
        ):
            remain = purge.live_credentials_remain({"id": "env-1"})
        return remain, lease_model, credential_model

    def test_looks_for_live_credentials_in_the_scope_only(self):
        remain, leases, credentials = self._live_credentials()

        assert remain is False
        leases.objects.filter.assert_called_once_with(
            status=leases.ACTIVE, secret__environment__id="env-1"
        )
        lookup = credentials.objects.filter.call_args.kwargs
        assert lookup["rotating_secret__environment__id"] == "env-1"
        # REVOKE_FAILED included: it may still be live at the provider.
        assert credentials.REVOKE_FAILED in lookup["status__in"]
        assert credentials.ACTIVE in lookup["status__in"]

    @pytest.mark.parametrize(
        "found",
        [{"active_lease": True}, {"unrevoked_credential": True}],
        ids=["a-lease-minted-meanwhile", "a-credential-minted-meanwhile"],
    )
    def test_reports_a_credential_minted_while_the_purge_ran(self, found):
        remain, *_ = self._live_credentials(**found)

        assert remain is True

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

    def test_owner_recipients_are_the_active_owners_with_an_email(self):
        member_model = MagicMock()
        owner, no_email = MagicMock(), MagicMock()
        owner.user.email = "owner@acme.test"
        no_email.user.email = ""
        member_model.objects.filter.return_value.select_related.return_value = [
            owner,
            no_email,
        ]

        with self._purge_models(OrganisationMember=member_model), patch(
            "api.emails.get_user_display_name", return_value="Owner"
        ):
            recipients = purge.owner_recipients("org")

        assert recipients == [("owner@acme.test", "Owner")]
        lookup = member_model.objects.filter.call_args.kwargs
        assert lookup["organisation"] == "org"
        assert lookup["role__managed_key"] == "owner"
        assert lookup["deleted_at"] is None

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

    def test_late_events_are_deleted_at_once_for_the_scope_only(self):
        environment_model, event_model = MagicMock(), MagicMock()
        environment_model.all_objects.filter.return_value.values_list.return_value = [
            "env-1",
            "env-2",
        ]

        with self._purge_models(
            Environment=environment_model, SecretEvent=event_model
        ), patch.object(
            purge, "delete_secret_events", return_value=(1, True)
        ) as delete:
            assert purge.delete_late_secret_events({"app": "app-1"}) is True

        # all_objects: an environment pending deletion has events too.
        environment_model.all_objects.filter.assert_called_once_with(app="app-1")
        assert event_model.objects.filter.call_args_list == [
            call(environment_id="env-1"),
            call(environment_id="env-2"),
        ]
        # Inside the final transaction, with its locks held: no pause between
        # batches, and no time budget that could leave one behind.
        for deleted in delete.call_args_list:
            assert deleted.args == (event_model.objects.filter.return_value,)
            assert deleted.kwargs == {"batch_size": 10_000, "sleep_ms": 0}

    def test_a_late_event_another_transaction_holds_is_reported(self):
        # The batched delete skips a locked row and says it has not finished.
        # The cascade must then not start: it would fail on that row.
        environment_model, event_model = MagicMock(), MagicMock()
        environment_model.all_objects.filter.return_value.values_list.return_value = [
            "env-1",
            "env-2",
        ]

        with self._purge_models(
            Environment=environment_model, SecretEvent=event_model
        ), patch.object(
            purge, "delete_secret_events", side_effect=[(2, True), (0, False)]
        ):
            assert purge.delete_late_secret_events({"app": "app-1"}) is False

    def test_the_cascade_can_be_looked_at_before_it_deletes(self):
        app = App(id="app-1")

        with patch.object(purge, "EventlessCollector") as collector_class:
            cascade = purge.collect_cascade(app)

        collector = collector_class.return_value
        assert cascade is collector
        collector_class.assert_called_once_with(using=app._state.db, origin=app)
        collector.collect.assert_called_once_with([app])
        collector.delete.assert_not_called()

    def test_delete_with_cascade_deletes_what_it_collected(self):
        app = App(id="app-1")

        with patch.object(purge, "EventlessCollector") as collector_class:
            purge.delete_with_cascade(app)

        collector = collector_class.return_value
        assert [step[0] for step in collector.mock_calls] == ["collect", "delete"]
