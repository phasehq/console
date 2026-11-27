"""Tests for scheduling and restoring app and environment deletion."""

from contextlib import contextmanager
from datetime import timedelta
from unittest.mock import MagicMock, patch

import pytest
from django.utils import timezone

from api.models import App, Environment, Organisation
from api.utils import resource_deletion as deletion
from api.utils.resource_deletion import (
    GRACE_PERIOD,
    NAME_IN_USE,
    NAME_PENDING_DELETION,
    PURGE_MARGIN,
    ResourceDeletionError,
)

PAST_GRACE = GRACE_PERIOD + timedelta(minutes=1)


def _ago(ago):
    return None if ago is None else timezone.now() - ago


def _resource(deleted_ago=None, **attrs):
    resource = MagicMock(**attrs)
    resource.deleted_at = _ago(deleted_ago)
    return resource


def _app(deleted_ago=None, blocked_ago=None, **attrs):
    """A real, unsaved App: the state checks read its real defaults."""
    attrs.setdefault("organisation", Organisation(id="org-1", name="Acme"))
    return App(
        id="app-1",
        name="Billing",
        deleted_at=_ago(deleted_ago),
        purge_blocked_at=_ago(blocked_ago),
        **attrs,
    )


def _environment(deleted_ago=None, blocked_ago=None, app=None, **attrs):
    return Environment(
        id="env-1",
        name="Staging",
        app=app or _app(),
        deleted_at=_ago(deleted_ago),
        purge_blocked_at=_ago(blocked_ago),
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
    real_get_model = deletion.apps.get_model

    def get_model(app_label, name):
        return models[name] if name in models else real_get_model(app_label, name)

    with patch.object(deletion.apps, "get_model", side_effect=get_model), patch.object(
        deletion, "transaction"
    ):
        yield


class TestManagers:
    """Apps and environments pending deletion are hidden unless asked for."""

    def test_app_objects_leaves_out_apps_pending_deletion(self):
        assert '"api_app"."deleted_at" IS NULL' in str(App.objects.all().query)
        assert "WHERE" not in str(App.all_objects.all().query)

    def test_environment_objects_leaves_out_its_own_and_its_apps_deletion(self):
        sql = str(Environment.objects.all().query)

        assert '"api_environment"."deleted_at" IS NULL' in sql
        assert '"api_app"."deleted_at" IS NULL' in sql
        assert "WHERE" not in str(Environment.all_objects.all().query)

    @pytest.mark.parametrize("model", [App, Environment])
    def test_the_filtering_manager_is_the_default_one(self, model):
        # Reverse relations (org.apps, app.environments, member.apps) use it.
        assert model._default_manager is model.objects

    @pytest.mark.parametrize("model", [App, Environment])
    def test_the_base_manager_is_unfiltered(self, model):
        # The cascade and forward relations (secret.environment) use it.
        assert "WHERE" not in str(model._base_manager.all().query)


class TestSaveKeepsTheLock:
    """save() writes every column, so a copy read before a deletion was
    scheduled, e.g. by a secret write that finishes later, would undo it."""

    def _existing(self, model):
        instance = model(id="id-1")
        instance._state.adding = False
        return instance

    @pytest.mark.parametrize("model", [App, Environment])
    def test_a_plain_save_leaves_the_lock_columns_out(self, model):
        from api.models import _without_deletion_lock

        fields = _without_deletion_lock(self._existing(model), None)

        assert "deleted_at" not in fields
        assert "is_deleted" not in fields
        assert "purge_blocked_at" not in fields
        assert "purge_claimed_at" not in fields
        assert "purge_started_at" not in fields
        assert "skip_grace_period" not in fields
        assert {"name", "updated_at"} <= set(fields)
        assert "id" not in fields

    def test_fields_asked_for_by_name_are_saved(self):
        from api.models import _without_deletion_lock

        fields = ["deleted_at", "is_deleted", "updated_at"]

        assert _without_deletion_lock(self._existing(App), fields) == fields

    def test_a_new_row_is_inserted_whole(self):
        from api.models import _without_deletion_lock

        assert _without_deletion_lock(App(), None) is None

    def test_deferred_fields_stay_unsaved(self):
        from api.models import _without_deletion_lock

        app = self._existing(App)
        del app.__dict__["description"]

        fields = _without_deletion_lock(app, None)

        assert "description" not in fields
        assert "name" in fields

    def test_app_save_uses_it(self):
        with patch("django.db.models.Model.save") as save:
            self._existing(App).save()

        assert "deleted_at" not in save.call_args.kwargs["update_fields"]

    def test_environment_save_uses_it(self):
        with patch("django.db.models.Model.save") as save, patch(
            "api.models.EnvironmentSync"
        ), patch("api.models.transaction"):
            self._existing(Environment).save()

        assert "deleted_at" not in save.call_args.kwargs["update_fields"]


class TestSchedule:
    def test_the_grace_period_is_24_hours(self):
        assert GRACE_PERIOD == timedelta(hours=24)

    @pytest.mark.parametrize("model", [App, Environment])
    def test_the_flag_has_a_database_default(self, model):
        # During a rolling deploy, a backend from before the column still
        # inserts apps and environments without it.
        assert model._meta.get_field("skip_grace_period").db_default is False

    @pytest.mark.parametrize("resource", [_app, _environment])
    def test_due_once_the_grace_period_has_ended(self, resource):
        assert deletion.purge_due(resource()) is False
        assert deletion.purge_due(resource(deleted_ago=GRACE_PERIOD / 2)) is False
        assert deletion.purge_due(resource(deleted_ago=GRACE_PERIOD)) is True

    def test_scheduled_for_the_end_of_the_grace_period(self):
        app = _app(deleted_ago=timedelta(hours=1))

        assert deletion.deletion_scheduled_for(_app()) is None
        assert deletion.deletion_scheduled_for(app) == app.deleted_at + GRACE_PERIOD

    def test_the_purge_waits_out_a_margin_after_restoring_stops(self):
        # A restore still committing, or a worker clock running ahead, must
        # not overlap the purge.
        just_due = _app(deleted_ago=PAST_GRACE)

        assert deletion.can_restore(just_due) is False
        assert deletion.is_ready_for_purge(just_due) is False
        assert deletion.is_ready_for_purge(
            _app(deleted_ago=GRACE_PERIOD + PURGE_MARGIN)
        )

    def test_restorable_until_the_grace_period_ends(self):
        assert deletion.can_restore(_app()) is False
        assert deletion.can_restore(_app(deleted_ago=timedelta(hours=1))) is True
        assert deletion.can_restore(_app(deleted_ago=PAST_GRACE)) is False

    def test_restorable_later_while_the_purge_is_blocked(self):
        blocked = _environment(deleted_ago=timedelta(days=3), blocked_ago=timedelta(1))

        assert deletion.can_restore(blocked) is True

    @pytest.mark.parametrize(
        "state",
        [
            {"deleted_ago": timedelta(days=3)},
            # A credential minted meanwhile holds up what is left of it.
            {"deleted_ago": timedelta(days=3), "blocked_ago": timedelta(days=1)},
            # Its app or organisation was restored since: a fresh deleted_at.
            {"deleted_ago": timedelta(minutes=1)},
        ],
        ids=["started", "started-then-blocked", "grace-period-restarted"],
    )
    def test_never_restorable_once_the_purge_has_started(self, state):
        started = _app(purge_started_at=timezone.now() - timedelta(hours=1), **state)

        assert deletion.can_restore(started) is False

    @pytest.mark.parametrize(
        "state",
        [
            {"deleted_ago": timedelta(days=3)},
            {"deleted_ago": timedelta(days=3), "blocked_ago": timedelta(days=1)},
            # Not even if something gave it a fresh deleted_at.
            {"deleted_ago": timedelta(minutes=1)},
        ],
        ids=["first-run", "retry-of-a-blocked-purge", "not-due"],
    )
    def test_not_restorable_while_a_purge_run_has_claimed_it(self, state):
        # The run is revoking its credentials.
        claimed = _environment(purge_claimed_at=timezone.now(), **state)

        assert deletion.can_restore(claimed) is False

    @pytest.mark.parametrize("resource", [_app, _environment])
    def test_a_deletion_asked_for_at_once_has_no_grace_period(self, resource):
        immediate = resource(deleted_ago=timedelta(seconds=1), skip_grace_period=True)

        assert deletion.purge_due(immediate) is True
        assert deletion.can_restore(immediate) is False
        # No margin either: no restore can race the purge.
        assert deletion.is_ready_for_purge(immediate) is True
        assert deletion.deletion_scheduled_for(immediate) == immediate.deleted_at

    def test_a_deletion_asked_for_at_once_is_restorable_only_while_blocked(self):
        blocked = _app(
            deleted_ago=timedelta(hours=2),
            blocked_ago=timedelta(hours=1),
            skip_grace_period=True,
        )

        assert deletion.can_restore(blocked) is True

    def test_skipping_the_grace_period_means_nothing_unless_pending(self):
        assert deletion.purge_due(_app(skip_grace_period=True)) is False
        assert deletion.is_ready_for_purge(_app(skip_grace_period=True)) is False

    def test_an_app_soft_deleted_by_an_old_release_is_not_pending(self):
        # Releases before 2024 set both columns and kept the row for good.
        legacy = _app(deleted_ago=timedelta(days=900), is_deleted=True)

        assert deletion.is_pending_deletion(legacy) is False
        assert deletion.deletion_scheduled_for(legacy) is None
        assert deletion.purge_due(legacy) is False
        assert deletion.is_ready_for_purge(legacy) is False
        assert deletion.can_restore(legacy) is False


class TestPendingQuerysets:
    """Built on the real models, so the lookups are real."""

    @pytest.mark.parametrize(
        "model, table", [(App, "api_app"), (Environment, "api_environment")]
    )
    def test_pending_leaves_out_rows_soft_deleted_by_old_releases(self, model, table):
        assert _where(deletion.pending_deletion(model.all_objects.all())) == {
            (table, "deleted_at", "isnull"): False,
            (table, "is_deleted", "exact"): False,
        }

    @pytest.mark.parametrize(
        "model, table", [(App, "api_app"), (Environment, "api_environment")]
    )
    def test_ready_once_the_grace_period_and_the_margin_have_passed(self, model, table):
        earliest = timezone.now() - GRACE_PERIOD - PURGE_MARGIN

        where = _where(deletion.ready_for_purge(model.all_objects.filter(id="id-1")))

        cutoff = where["or"].pop((table, "deleted_at", "lte"))
        assert earliest <= cutoff <= timezone.now() - GRACE_PERIOD - PURGE_MARGIN
        # One table, so the purge's conditional updates re-check the row they
        # waited for.
        assert where == {
            (table, "id", "exact"): "id-1",
            (table, "deleted_at", "isnull"): False,
            (table, "is_deleted", "exact"): False,
            # Or at once, when the grace period was skipped.
            "or": {(table, "skip_grace_period", "exact"): True},
        }


class TestEnvironmentIsLocked:
    def test_reads_the_database_for_its_own_or_its_apps_deletion(self):
        model = MagicMock()
        locked = model.all_objects.filter.return_value.filter.return_value.exists
        locked.return_value = True

        with _models(Environment=model):
            assert deletion.environment_is_locked("env-1") is True

        # all_objects: Environment.objects can't see a locked environment.
        model.all_objects.filter.assert_called_once_with(id="env-1")
        condition = str(model.all_objects.filter.return_value.filter.call_args.args[0])
        assert "deleted_at__isnull" in condition
        assert "app__deleted_at__isnull" in condition


class TestEnvironmentNameConflict:
    def _run(self, deleted, exclude_id=None):
        model = MagicMock()
        taken = model.all_objects.filter.return_value
        taken.exclude.return_value = taken
        taken.values_list.return_value = deleted
        with _models(Environment=model):
            result = deletion.environment_name_conflict("app", "Staging", exclude_id)
        return result, model, taken

    def test_free_name(self):
        result, model, _ = self._run([])

        assert result is None
        model.all_objects.filter.assert_called_once_with(
            app="app", name__iexact="Staging"
        )

    def test_name_of_a_live_environment(self):
        assert self._run([None])[0] == NAME_IN_USE

    def test_name_of_an_environment_pending_deletion_stays_reserved(self):
        # Restoring it would otherwise collide with the new one.
        assert self._run([timezone.now()])[0] == NAME_PENDING_DELETION

    def test_a_live_environment_wins_over_one_pending_deletion(self):
        assert self._run([timezone.now(), None])[0] == NAME_IN_USE

    def test_renaming_ignores_the_environment_itself(self):
        _, _, taken = self._run([], exclude_id="env-1")

        taken.exclude.assert_called_once_with(id="env-1")

    def test_messages(self):
        pending = deletion.environment_name_conflict_message(
            NAME_PENDING_DELETION, "Staging"
        )
        in_use = deletion.environment_name_conflict_message(NAME_IN_USE, "Staging")

        assert "scheduled for deletion" in pending and "Restore it" in pending
        # The way to free the name without waiting.
        assert "delete it now" in pending
        assert in_use == "An environment named 'Staging' already exists in this app."


class TestScheduleAppDeletion:
    def test_locks_the_app(self):
        model = MagicMock()
        model.all_objects.filter.return_value.update.return_value = 1
        app = _app(blocked_ago=timedelta(days=1))

        with _models(App=model), patch.object(App, "delete") as delete:
            assert deletion.schedule_app_deletion(app) is app

        # Only if it isn't scheduled already, so two requests can't both win.
        model.all_objects.filter.assert_called_once_with(
            id="app-1", deleted_at__isnull=True
        )
        update = model.all_objects.filter.return_value.update.call_args.kwargs
        assert timezone.now() - update["deleted_at"] < timedelta(seconds=5)
        # Pending, not a row soft-deleted by an old release.
        assert update["is_deleted"] is False
        assert update["purge_blocked_at"] is None
        assert update["purge_claimed_at"] is None
        assert update["purge_started_at"] is None
        assert update["skip_grace_period"] is False
        assert app.deleted_at == update["deleted_at"]
        assert app.purge_blocked_at is None
        assert deletion.is_pending_deletion(app)
        assert deletion.can_restore(app)
        delete.assert_not_called()

    def test_skips_the_grace_period_when_asked(self):
        model = MagicMock()
        model.all_objects.filter.return_value.update.return_value = 1
        app = _app()

        with _models(App=model):
            deletion.schedule_app_deletion(app, immediately=True)

        update = model.all_objects.filter.return_value.update.call_args.kwargs
        assert update["skip_grace_period"] is True
        assert app.skip_grace_period is True
        assert deletion.is_ready_for_purge(app)
        assert not deletion.can_restore(app)

    def test_refuses_an_app_already_scheduled(self):
        model = MagicMock()
        model.all_objects.filter.return_value.update.return_value = 0

        with _models(App=model), pytest.raises(
            ResourceDeletionError, match="already scheduled"
        ):
            deletion.schedule_app_deletion(_app())


class TestRestoreApp:
    def _run(self, app, can_add=True):
        model, environment_model = MagicMock(), MagicMock()
        self.organisation_model = MagicMock()
        self.locks = []
        model.all_objects.values_list.return_value.get.return_value = "org-1"
        self.organisation_model.objects.select_for_update.side_effect = (
            lambda **kw: self.locks.append(("organisation", kw)) or MagicMock()
        )
        locked = model.all_objects.select_for_update.return_value
        locked.select_related.return_value.get.return_value = app
        model.all_objects.select_for_update.side_effect = (
            lambda **kw: self.locks.append(("app", kw)) or locked
        )
        with _models(
            App=model, Environment=environment_model, Organisation=self.organisation_model
        ), patch("backend.quotas.can_add_app", return_value=can_add), patch.object(
            App, "save"
        ) as save:
            try:
                restored = deletion.restore_app("app-1")
            finally:
                self.save = save
        return restored, model, environment_model

    def test_lifts_the_lock(self):
        app = _app(deleted_ago=timedelta(hours=1))

        restored, model, _ = self._run(app)

        assert restored is app
        assert app.deleted_at is None
        self.save.assert_called_once_with(
            update_fields=[
                "deleted_at",
                "purge_blocked_at",
                "skip_grace_period",
                "updated_at",
            ]
        )
        model.all_objects.values_list.assert_called_once_with(
            "organisation_id", flat=True
        )
        # The organisation first, so two restores can't both pass the plan's
        # limit. no_key: its other rows can still be inserted meanwhile.
        assert self.locks == [
            ("organisation", {"no_key": True}),
            ("app", {"of": ("self",)}),
        ]

    def test_refuses_an_app_that_is_not_scheduled(self):
        with pytest.raises(ResourceDeletionError, match="not scheduled"):
            self._run(_app())

    def test_refuses_an_app_soft_deleted_by_an_old_release(self):
        legacy = _app(deleted_ago=timedelta(days=900), is_deleted=True)

        with pytest.raises(ResourceDeletionError, match="not scheduled"):
            self._run(legacy)

        self.save.assert_not_called()

    def test_refuses_once_the_purge_is_due(self):
        # The purge may already be deleting its secret events.
        app = _app(deleted_ago=PAST_GRACE)

        with pytest.raises(ResourceDeletionError, match="no longer be restored"):
            self._run(app)

        self.save.assert_not_called()

    def test_restores_past_the_grace_period_while_the_purge_is_blocked(self):
        app = _app(deleted_ago=timedelta(days=3), blocked_ago=timedelta(days=1))

        self._run(app)

        assert app.deleted_at is None
        assert app.purge_blocked_at is None

    def test_refuses_a_deletion_asked_for_at_once(self):
        app = _app(deleted_ago=timedelta(seconds=5), skip_grace_period=True)

        with pytest.raises(ResourceDeletionError, match="no longer be restored"):
            self._run(app)

        self.save.assert_not_called()

    def test_refuses_once_the_purge_has_started(self):
        # Part of it may be gone, whatever its deleted_at now says.
        app = _app(
            deleted_ago=timedelta(minutes=1),
            purge_started_at=timezone.now() - timedelta(hours=1),
        )

        with pytest.raises(ResourceDeletionError, match="no longer be restored"):
            self._run(app)

        self.save.assert_not_called()

    def test_says_to_try_again_while_a_blocked_purge_is_being_retried(self):
        # The retry hands it back if it is blocked again.
        app = _app(
            deleted_ago=timedelta(days=3),
            blocked_ago=timedelta(days=1),
            purge_claimed_at=timezone.now(),
        )

        with pytest.raises(ResourceDeletionError, match="being retried. Try again"):
            self._run(app)

        self.save.assert_not_called()

    def test_refuses_while_the_first_purge_run_has_claimed_it(self):
        # Whatever its deleted_at says: the run is revoking its credentials.
        app = _app(deleted_ago=timedelta(minutes=1), purge_claimed_at=timezone.now())

        with pytest.raises(ResourceDeletionError, match="no longer be restored"):
            self._run(app)

        self.save.assert_not_called()

    def test_refuses_a_started_purge_that_is_blocked(self):
        # Delayed, but part of it is gone.
        app = _app(
            deleted_ago=timedelta(days=3),
            blocked_ago=timedelta(hours=1),
            purge_started_at=timezone.now() - timedelta(hours=2),
        )

        with pytest.raises(ResourceDeletionError, match="no longer be restored"):
            self._run(app)

        self.save.assert_not_called()

    def test_a_restore_while_blocked_brings_the_grace_period_back(self):
        # Deleted again later, it is scheduled as usual unless asked otherwise.
        app = _app(
            deleted_ago=timedelta(hours=2),
            blocked_ago=timedelta(hours=1),
            skip_grace_period=True,
        )

        self._run(app)

        assert app.skip_grace_period is False

    def test_refuses_when_the_plan_has_no_room_left(self):
        # Apps pending deletion don't count towards the limit, so the slot
        # may have been taken since.
        app = _app(deleted_ago=timedelta(hours=1))

        with pytest.raises(ResourceDeletionError, match="limit of apps"):
            self._run(app, can_add=False)

        self.save.assert_not_called()

    def test_its_pending_environments_get_the_whole_grace_period_again(self):
        # They could be neither purged nor restored while the app was locked.
        app = _app(deleted_ago=timedelta(hours=20))

        _, _, environment_model = self._run(app)

        environment_model.all_objects.filter.assert_called_once_with(app=app)
        pending = environment_model.all_objects.filter.return_value.filter
        pending.assert_called_once_with(deleted_at__isnull=False, is_deleted=False)
        # Not one a purge run has claimed or started on: its credentials are
        # being revoked, or part of it is gone.
        untouched = pending.return_value.filter
        untouched.assert_called_once_with(
            purge_claimed_at__isnull=True, purge_started_at__isnull=True
        )
        restarted = untouched.return_value.update.call_args.kwargs
        assert timezone.now() - restarted["deleted_at"] < timedelta(seconds=5)
        assert restarted["purge_blocked_at"] is None


class TestScheduleEnvironmentDeletion:
    def test_locks_the_environment_without_saving_it(self):
        model = MagicMock()
        model.all_objects.filter.return_value.update.return_value = 1
        environment = _environment()

        with _models(Environment=model), patch.object(
            Environment, "save"
        ) as save, patch.object(Environment, "delete") as delete:
            deletion.schedule_environment_deletion(environment)

        model.all_objects.filter.assert_called_once_with(
            id="env-1", deleted_at__isnull=True
        )
        update = model.all_objects.filter.return_value.update.call_args.kwargs
        assert update["is_deleted"] is False
        assert update["purge_blocked_at"] is None
        assert update["skip_grace_period"] is False
        assert deletion.is_pending_deletion(environment)
        # Environment.save() would trigger the environment's syncs.
        save.assert_not_called()
        delete.assert_not_called()

    def test_a_primary_environment_stops_being_one(self):
        """Another environment can take its place meanwhile, and a restore
        brings it back as an ordinary one."""
        model = MagicMock()
        model.all_objects.filter.return_value.update.return_value = 1
        environment = _environment()
        environment.is_primary = True

        with _models(Environment=model):
            deletion.schedule_environment_deletion(environment)

        update = model.all_objects.filter.return_value.update.call_args.kwargs
        assert update["is_primary"] is False
        assert environment.is_primary is False

    def test_skips_the_grace_period_when_asked(self):
        model = MagicMock()
        model.all_objects.filter.return_value.update.return_value = 1
        environment = _environment()

        with _models(Environment=model):
            deletion.schedule_environment_deletion(environment, immediately=True)

        update = model.all_objects.filter.return_value.update.call_args.kwargs
        assert update["skip_grace_period"] is True
        assert deletion.is_ready_for_purge(environment)
        assert not deletion.can_restore(environment)

    def test_refuses_an_environment_already_scheduled(self):
        model = MagicMock()
        model.all_objects.filter.return_value.update.return_value = 0

        with _models(Environment=model), pytest.raises(
            ResourceDeletionError, match="already scheduled"
        ):
            deletion.schedule_environment_deletion(_environment())


class TestRestoreEnvironment:
    def _run(self, environment, can_add=True, conflict=None, taken_index=False):
        model, self.app_model = MagicMock(), MagicMock()
        self.locks = []
        model.all_objects.values_list.return_value.get.return_value = "app-1"
        self.app_model.all_objects.select_for_update.side_effect = (
            lambda **kw: self.locks.append(("app", kw)) or MagicMock()
        )
        locked = model.all_objects.select_for_update.return_value
        locked.select_related.return_value.get.return_value = environment
        model.all_objects.select_for_update.side_effect = (
            lambda **kw: self.locks.append(("environment", kw)) or locked
        )
        siblings = model.objects.filter.return_value
        siblings.filter.return_value.exists.return_value = taken_index
        siblings.aggregate.return_value = {"index__max": 4}
        with _models(Environment=model, App=self.app_model), patch(
            "backend.quotas.can_add_environment", return_value=can_add
        ), patch.object(
            deletion, "environment_name_conflict", return_value=conflict
        ), patch.object(
            Environment, "save"
        ) as save:
            try:
                restored = deletion.restore_environment("env-1")
            finally:
                self.save = save
        return restored, model

    def _pending(self, deleted_ago=timedelta(hours=1), app_deleted_ago=None, **attrs):
        return _environment(
            deleted_ago=deleted_ago, app=_app(deleted_ago=app_deleted_ago), **attrs
        )

    def test_lifts_the_lock_without_saving_it(self):
        environment = self._pending(index=2)

        restored, model = self._run(environment)

        assert restored is environment
        assert environment.deleted_at is None
        model.all_objects.filter.assert_called_once_with(id="env-1")
        update = model.all_objects.filter.return_value.update.call_args.kwargs
        assert update["deleted_at"] is None
        assert update["purge_blocked_at"] is None
        assert update["skip_grace_period"] is False
        assert update["index"] == 2
        # Environment.save() would trigger syncs inside the transaction.
        self.save.assert_not_called()
        # The app first, so two restores can't both pass the plan's limit.
        model.all_objects.values_list.assert_called_once_with("app_id", flat=True)
        assert self.locks == [
            ("app", {"no_key": True, "of": ("self",)}),
            ("environment", {"of": ("self",)}),
        ]

    def test_goes_last_when_its_place_in_the_order_was_taken(self):
        environment = self._pending(index=2)

        _, model = self._run(environment, taken_index=True)

        model.objects.filter.assert_called_once_with(app=environment.app)
        model.objects.filter.return_value.filter.assert_called_once_with(index=2)
        update = model.all_objects.filter.return_value.update.call_args.kwargs
        assert update["index"] == 5
        assert environment.index == 5

    def test_refuses_an_environment_that_is_not_scheduled(self):
        with pytest.raises(ResourceDeletionError, match="not scheduled"):
            self._run(self._pending(deleted_ago=None))

    def test_refuses_while_its_app_is_pending_deletion(self):
        environment = self._pending(app_deleted_ago=timedelta(minutes=5))

        with pytest.raises(ResourceDeletionError, match="Restore the app first"):
            self._run(environment)

    def test_refuses_once_the_purge_is_due(self):
        with pytest.raises(ResourceDeletionError, match="no longer be restored"):
            self._run(self._pending(deleted_ago=PAST_GRACE))

    def test_refuses_once_the_purge_has_started(self):
        started = self._pending(
            deleted_ago=timedelta(minutes=1),
            purge_started_at=timezone.now() - timedelta(hours=1),
        )

        with pytest.raises(ResourceDeletionError, match="no longer be restored"):
            self._run(started)

    def test_says_to_try_again_while_a_blocked_purge_is_being_retried(self):
        retried = self._pending(
            deleted_ago=timedelta(days=3),
            blocked_ago=timedelta(days=1),
            purge_claimed_at=timezone.now(),
        )

        with pytest.raises(ResourceDeletionError, match="being retried. Try again"):
            self._run(retried)

    def test_refuses_while_the_first_purge_run_has_claimed_it(self):
        # Its app's restore can't give it a new grace period meanwhile.
        claimed = self._pending(
            deleted_ago=timedelta(minutes=1), purge_claimed_at=timezone.now()
        )

        with pytest.raises(ResourceDeletionError, match="no longer be restored"):
            self._run(claimed)

    def test_restores_past_the_grace_period_while_the_purge_is_blocked(self):
        environment = self._pending(
            deleted_ago=timedelta(days=3), blocked_ago=timedelta(days=1)
        )

        self._run(environment)

        assert environment.deleted_at is None
        assert environment.purge_blocked_at is None

    def test_refuses_when_the_plan_has_no_room_left(self):
        with pytest.raises(ResourceDeletionError, match="limit of environments"):
            self._run(self._pending(), can_add=False)

    def test_refuses_when_a_live_environment_took_the_name(self):
        with pytest.raises(ResourceDeletionError, match="now named 'Staging'"):
            self._run(self._pending(), conflict=NAME_IN_USE)

    @pytest.mark.parametrize(
        "refusal",
        [
            {"can_add": False},
            {"conflict": NAME_IN_USE},
        ],
    )
    def test_a_refusal_changes_nothing(self, refusal):
        model = None
        environment = self._pending()
        try:
            _, model = self._run(environment, **refusal)
        except ResourceDeletionError:
            pass

        assert model is None
        assert environment.deleted_at is not None


class TestRestartGracePeriods:
    def test_restoring_an_organisation_restarts_what_is_pending_in_it(self):
        # Purging and restoring both stopped while the organisation was locked.
        app_model, environment_model = MagicMock(), MagicMock()

        with _models(App=app_model, Environment=environment_model):
            deletion.restart_grace_periods("org")

        app_model.all_objects.filter.assert_called_once_with(organisation="org")
        environment_model.all_objects.filter.assert_called_once_with(
            app__organisation="org"
        )
        for model in (app_model, environment_model):
            pending = model.all_objects.filter.return_value.filter
            # Not the apps soft-deleted by old releases.
            pending.assert_called_once_with(deleted_at__isnull=False, is_deleted=False)
            # Nor what a purge run has claimed or started on: that stays due.
            untouched = pending.return_value.filter
            untouched.assert_called_once_with(
                purge_claimed_at__isnull=True, purge_started_at__isnull=True
            )
            restarted = untouched.return_value.update.call_args.kwargs
            assert timezone.now() - restarted["deleted_at"] < timedelta(seconds=5)
            assert restarted["purge_blocked_at"] is None


class TestDeleteNow:
    """Skipping the rest of the grace period of something already scheduled."""

    def _app_now(self, app):
        model = MagicMock()
        locked = model.all_objects.select_for_update.return_value
        locked.select_related.return_value.get.return_value = app
        with _models(App=model):
            return deletion.delete_app_now("app-1"), model

    def _environment_now(self, environment):
        model = MagicMock()
        locked = model.all_objects.select_for_update.return_value
        locked.select_related.return_value.get.return_value = environment
        with _models(Environment=model), patch.object(Environment, "save") as save:
            try:
                return deletion.delete_environment_now("env-1"), model
            finally:
                self.save = save

    def test_an_app_loses_the_rest_of_its_grace_period(self):
        app = _app(deleted_ago=timedelta(hours=3))

        deleted, model = self._app_now(app)

        assert deleted is app
        # The organisation row stays unlocked.
        model.all_objects.select_for_update.assert_called_once_with(of=("self",))
        model.all_objects.filter.assert_called_once_with(id="app-1")
        update = model.all_objects.filter.return_value.update.call_args.kwargs
        assert update["skip_grace_period"] is True
        # The request the purge now acts on.
        assert timezone.now() - update["deleted_at"] < timedelta(seconds=5)
        assert app.skip_grace_period is True
        assert deletion.is_ready_for_purge(app)
        assert not deletion.can_restore(app)

    def test_an_environment_loses_the_rest_of_its_grace_period(self):
        environment = _environment(deleted_ago=timedelta(hours=3))

        deleted, model = self._environment_now(environment)

        assert deleted is environment
        # The app row stays unlocked.
        model.all_objects.select_for_update.assert_called_once_with(of=("self",))
        update = model.all_objects.filter.return_value.update.call_args.kwargs
        assert update["skip_grace_period"] is True
        assert deletion.is_ready_for_purge(environment)
        # Environment.save() would trigger the environment's syncs.
        self.save.assert_not_called()

    @pytest.mark.parametrize(
        "app, reason",
        [
            (_app(), "not scheduled for deletion"),
            (
                _app(deleted_ago=timedelta(days=900), is_deleted=True),
                "not scheduled for deletion",
            ),
            (_app(deleted_ago=PAST_GRACE), "already under way"),
            (
                _app(deleted_ago=timedelta(seconds=5), skip_grace_period=True),
                "already under way",
            ),
            (
                _app(deleted_ago=timedelta(days=3), blocked_ago=timedelta(days=1)),
                "already under way",
            ),
        ],
        ids=["live", "soft-deleted-by-an-old-release", "due", "asked-already", "blocked"],
    )
    def test_refuses_what_has_no_grace_period_left_to_skip(self, app, reason):
        before = app.deleted_at

        with pytest.raises(ResourceDeletionError, match=reason):
            self._app_now(app)

        assert app.deleted_at == before

    def test_an_environment_whose_app_is_pending_goes_with_the_app(self):
        environment = _environment(
            deleted_ago=timedelta(hours=3), app=_app(deleted_ago=timedelta(hours=1))
        )

        with pytest.raises(ResourceDeletionError, match="deleted with the app"):
            self._environment_now(environment)

        assert environment.skip_grace_period is False
