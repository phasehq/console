"""Tests for the app and environment deletion jobs: the sweep, the purges and
the restore handlers."""

from contextlib import contextmanager
from datetime import timedelta
from unittest.mock import MagicMock, call, patch

import pytest
from django.utils import timezone
from rq.exceptions import NoSuchJobError
from rq.job import Job

from api.models import App, Environment, Organisation
from api.tasks import purge
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
    """The purge's steps, in the order they are called."""
    order = MagicMock()
    order.events.return_value = True
    order.claim.return_value = 1
    order.block.return_value = 1
    order.delete.side_effect = _clear_primary_key

    def conditional_update(purge_blocked_at):
        if purge_blocked_at is None:
            return order.claim()
        return order.block(purge_blocked_at)

    # Named, so its calls stay out of `order`.
    ready = MagicMock(name="ready_for_purge")
    ready.return_value.update.side_effect = conditional_update

    with patch.object(
        jobs, "revoke_dynamic_secret_leases", order.leases
    ), patch.object(
        jobs, "revoke_rotating_secret_credentials", order.rotating
    ), patch.object(
        jobs, "ready_for_purge", ready
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
        order.notify = notify
        order.ready = ready
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

        assert _called(steps)[:6] == [
            "leases",
            "rotating",
            "claim",
            "syncs",
            "events",
            "delete",
        ]
        steps.delete.assert_called_once_with(app)

    def test_a_deletion_asked_for_at_once_can_be_blocked_like_any_other(self, steps):
        steps.leases.side_effect = purge.PurgeBlockedError("could not revoke 1")

        with _models(App=_model(_app(**IMMEDIATE))), pytest.raises(
            purge.PurgeBlockedError
        ):
            jobs.purge_app("app-1")

        # Nothing is deleted; the block makes it restorable.
        assert _called(steps) == [
            "leases",
            "block",
            "email_app_delayed",
            "email_app_delayed",
        ]

    def test_deletes_the_app_after_releasing_what_it_holds(self, steps):
        app = _app()
        model = _model(app)
        environment_model = MagicMock()
        environments = [MagicMock(), MagicMock()]
        environment_model.all_objects.filter.return_value = environments

        with _models(App=model, Environment=environment_model):
            jobs.purge_app("app-1")

        scope = {"app": app}
        assert _called(steps) == [
            "leases",
            "rotating",
            "claim",
            "syncs",
            "events",
            "delete",
            "cascade_audit",
            "audit",
            "email_app",
            "email_app",
        ]
        steps.leases.assert_called_once_with(scope)
        steps.rotating.assert_called_once_with(scope)
        steps.syncs.assert_called_once_with(scope)
        steps.events.assert_called_once_with(scope)
        steps.delete.assert_called_once_with(app)

        # The claim is conditional on this one row still being due.
        model.all_objects.filter.assert_called_with(id="app-1")
        steps.ready.assert_called_once_with(model.all_objects.filter.return_value)

        # all_objects: its environments are hidden from Environment.objects.
        environment_model.all_objects.filter.assert_called_once_with(app=app)
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

    def test_unrevoked_credentials_block_the_purge(self, steps):
        steps.rotating.side_effect = purge.PurgeBlockedError("could not revoke 1")
        model = _model(_app())

        with _models(App=model), pytest.raises(purge.PurgeBlockedError):
            jobs.purge_app("app-1")

        # Nothing is stopped or deleted while a credential is still live.
        assert _called(steps) == [
            "leases",
            "rotating",
            "block",
            "email_app_delayed",
            "email_app_delayed",
        ]
        message = steps.notify.call_args.args[0]
        assert "is blocked and will retry on the next sweep" in message
        assert "Billing" in message

        # Restoring becomes possible again, and those concerned are told.
        pending = model.all_objects.filter.return_value
        pending.filter.assert_called_once_with(purge_blocked_at__isnull=True)
        steps.ready.assert_called_once_with(pending.filter.return_value)
        blocked_at = steps.block.call_args.args[0]
        assert timezone.now() - blocked_at < timedelta(seconds=5)
        assert steps.email_app_delayed.call_args_list == [
            call("owner@acme.test", "Owner", "Billing", "Acme"),
            call("dev@acme.test", "Dev", "Billing", "Acme"),
        ]

    def test_a_purge_that_stays_blocked_is_emailed_about_once(self, steps):
        steps.leases.side_effect = purge.PurgeBlockedError("could not revoke 1")
        steps.block.return_value = 0  # an earlier run recorded the block

        with _models(App=_model(_app())), pytest.raises(purge.PurgeBlockedError):
            jobs.purge_app("app-1")

        steps.email_app_delayed.assert_not_called()

    def test_any_other_failure_retries_without_allowing_a_restore(self, steps):
        steps.leases.side_effect = RuntimeError("database is down")

        with _models(App=_model(_app())), pytest.raises(RuntimeError):
            jobs.purge_app("app-1")

        assert _called(steps) == ["leases"]
        steps.notify.assert_called_once()

    def test_restored_while_its_credentials_were_revoked(self, steps):
        # A blocked purge can be restored: the claim finds nothing left to do.
        steps.claim.return_value = 0

        with _models(App=_model(_app())):
            jobs.purge_app("app-1")

        assert _called(steps) == ["leases", "rotating", "claim"]

    def test_stops_at_the_time_budget_and_leaves_the_app_locked(self, steps):
        steps.events.return_value = False

        with _models(App=_model(_app())):
            jobs.purge_app("app-1")

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

    @pytest.mark.parametrize(
        "locked",
        [None, _app(deleted_ago=None), _app(organisation_deleted_ago=timedelta(1))],
        ids=["gone", "restored", "organisation-pending-too"],
    )
    def test_rechecks_under_the_row_lock_before_deleting(self, locked, steps):
        model = _model(_app(), locked=locked)

        with _models(App=model):
            jobs.purge_app("app-1")

        # The organisation row stays unlocked.
        pending = model.all_objects.filter.return_value
        pending.select_for_update.assert_called_once_with(of=("self",))
        steps.delete.assert_not_called()
        steps.audit.assert_not_called()
        steps.email_app.assert_not_called()


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

        assert _called(steps)[:6] == [
            "leases",
            "rotating",
            "claim",
            "syncs",
            "events",
            "delete",
        ]
        steps.delete.assert_called_once_with(environment)

    def test_deletes_the_environment_after_releasing_what_it_holds(self, steps):
        environment = _environment()
        model = _model(environment)

        with _models(Environment=model):
            jobs.purge_environment("env-1")

        scope = {"id": "env-1"}
        assert _called(steps) == [
            "leases",
            "rotating",
            "claim",
            "syncs",
            "events",
            "delete",
            "audit",
            "email_environment",
            "email_environment",
        ]
        steps.leases.assert_called_once_with(scope)
        steps.events.assert_called_once_with(scope)
        steps.delete.assert_called_once_with(environment)
        # The app row stays unlocked.
        pending = model.all_objects.filter.return_value
        pending.select_for_update.assert_called_once_with(of=("self",))

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

    def test_unrevoked_credentials_block_the_purge(self, steps):
        steps.leases.side_effect = purge.PurgeBlockedError("could not revoke 1")

        with _models(Environment=_model(_environment())), pytest.raises(
            purge.PurgeBlockedError
        ):
            jobs.purge_environment("env-1")

        assert _called(steps) == [
            "leases",
            "block",
            "email_environment_delayed",
            "email_environment_delayed",
        ]
        assert steps.email_environment_delayed.call_args_list[0] == call(
            "owner@acme.test", "Owner", "Staging", "Billing", "Acme"
        )

    def test_stops_at_the_time_budget_and_leaves_the_environment_locked(self, steps):
        steps.events.return_value = False

        with _models(Environment=_model(_environment())):
            jobs.purge_environment("env-1")

        steps.delete.assert_not_called()

    def test_restored_while_releasing_is_not_deleted(self, steps):
        model = _model(_environment(), locked=_environment(deleted_ago=None))

        with _models(Environment=model):
            jobs.purge_environment("env-1")

        steps.delete.assert_not_called()
        steps.audit.assert_not_called()


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
            "send_app_deletion_delayed_email", "Billing", "Acme"
        )

        assert subject == "Deletion of Billing is delayed"
        assert recipients == ["owner@acme.test"]
        assert "the app <b>Billing</b> in <b>Acme</b>" in text
        assert "won\u2019t be deleted until they are revoked" in text
        assert "restore the app from the Apps page" in text

    def test_environment_deletion_delayed_email(self):
        subject, recipients, text = self._sent(
            "send_environment_deletion_delayed_email", "Staging", "Billing", "Acme"
        )

        assert subject == "Deletion of Staging in Billing is delayed"
        assert recipients == ["owner@acme.test"]
        assert "the environment <b>Staging</b> of the app <b>Billing</b>" in text
        assert "<b>Acme</b>" in text
        assert "restore the environment from the app\u2019s page" in text


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
