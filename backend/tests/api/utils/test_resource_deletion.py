"""Tests for scheduling and restoring app and environment deletion."""

from contextlib import contextmanager
from datetime import timedelta
from unittest.mock import MagicMock, patch

import pytest
from django.utils import timezone

from api.models import App, Environment
from api.utils import resource_deletion as deletion
from api.utils.resource_deletion import (
    GRACE_PERIOD,
    NAME_IN_USE,
    NAME_PENDING_DELETION,
    ResourceDeletionError,
)


def _resource(deleted_ago=None, **attrs):
    resource = MagicMock(**attrs)
    resource.deleted_at = None if deleted_ago is None else timezone.now() - deleted_ago
    return resource


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
    def test_due_once_the_grace_period_has_ended(self):
        assert deletion.purge_due(_resource()) is False
        assert deletion.purge_due(_resource(deleted_ago=GRACE_PERIOD / 2)) is False
        assert deletion.purge_due(_resource(deleted_ago=GRACE_PERIOD)) is True

    def test_scheduled_for_the_end_of_the_grace_period(self):
        resource = _resource(deleted_ago=timedelta(hours=1))

        assert deletion.deletion_scheduled_for(_resource()) is None
        assert deletion.deletion_scheduled_for(resource) == (
            resource.deleted_at + GRACE_PERIOD
        )

    def test_the_grace_period_is_24_hours(self):
        assert GRACE_PERIOD == timedelta(hours=24)


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
        assert in_use == "An environment named 'Staging' already exists in this app."


class TestScheduleAppDeletion:
    def test_locks_the_app(self):
        model = MagicMock()
        model.all_objects.filter.return_value.update.return_value = 1
        app = _resource(id="app-1")

        with _models(App=model):
            assert deletion.schedule_app_deletion(app) is app

        # Only if it isn't scheduled already, so two requests can't both win.
        model.all_objects.filter.assert_called_once_with(
            id="app-1", deleted_at__isnull=True
        )
        update = model.all_objects.filter.return_value.update.call_args.kwargs
        assert update["is_deleted"] is True
        assert timezone.now() - update["deleted_at"] < timedelta(seconds=5)
        assert app.deleted_at == update["deleted_at"]
        app.delete.assert_not_called()

    def test_refuses_an_app_already_scheduled(self):
        model = MagicMock()
        model.all_objects.filter.return_value.update.return_value = 0

        with _models(App=model), pytest.raises(
            ResourceDeletionError, match="already scheduled"
        ):
            deletion.schedule_app_deletion(_resource(id="app-1"))


class TestRestoreApp:
    def _run(self, app, can_add=True):
        model = MagicMock()
        locked = model.all_objects.select_for_update.return_value
        locked.select_related.return_value.get.return_value = app
        with _models(App=model), patch(
            "backend.quotas.can_add_app", return_value=can_add
        ):
            return deletion.restore_app("app-1"), model

    def test_lifts_the_lock(self):
        app = _resource(deleted_ago=timedelta(hours=1))

        restored, model = self._run(app)

        assert restored is app
        assert app.deleted_at is None
        assert app.is_deleted is False
        app.save.assert_called_once_with(
            update_fields=["deleted_at", "is_deleted", "updated_at"]
        )
        # The organisation row stays unlocked.
        model.all_objects.select_for_update.assert_called_once_with(of=("self",))

    def test_refuses_an_app_that_is_not_scheduled(self):
        with pytest.raises(ResourceDeletionError, match="not scheduled"):
            self._run(_resource())

    def test_refuses_once_the_purge_is_due(self):
        # The purge may already be deleting its secret events.
        app = _resource(deleted_ago=GRACE_PERIOD + timedelta(minutes=1))

        with pytest.raises(ResourceDeletionError, match="no longer be restored"):
            self._run(app)

        app.save.assert_not_called()

    def test_refuses_when_the_plan_has_no_room_left(self):
        # Apps pending deletion don't count towards the limit, so the slot
        # may have been taken since.
        app = _resource(deleted_ago=timedelta(hours=1))

        with pytest.raises(ResourceDeletionError, match="limit of apps"):
            self._run(app, can_add=False)

        app.save.assert_not_called()


class TestScheduleEnvironmentDeletion:
    def test_locks_the_environment_without_saving_it(self):
        model = MagicMock()
        model.all_objects.filter.return_value.update.return_value = 1
        environment = _resource(id="env-1")

        with _models(Environment=model):
            deletion.schedule_environment_deletion(environment)

        model.all_objects.filter.assert_called_once_with(
            id="env-1", deleted_at__isnull=True
        )
        assert environment.deleted_at is not None
        # Environment.save() would trigger the environment's syncs.
        environment.save.assert_not_called()
        environment.delete.assert_not_called()

    def test_refuses_an_environment_already_scheduled(self):
        model = MagicMock()
        model.all_objects.filter.return_value.update.return_value = 0

        with _models(Environment=model), pytest.raises(
            ResourceDeletionError, match="already scheduled"
        ):
            deletion.schedule_environment_deletion(_resource(id="env-1"))


class TestRestoreEnvironment:
    def _run(self, environment, can_add=True, conflict=None):
        model = MagicMock()
        locked = model.all_objects.select_for_update.return_value
        locked.select_related.return_value.get.return_value = environment
        with _models(Environment=model), patch(
            "backend.quotas.can_add_environment", return_value=can_add
        ), patch.object(
            deletion, "environment_name_conflict", return_value=conflict
        ):
            return deletion.restore_environment("env-1"), model

    def _environment(self, deleted_ago=timedelta(hours=1), app_deleted_ago=None):
        environment = _resource(deleted_ago=deleted_ago, id="env-1")
        environment.name = "Staging"
        environment.app = _resource(deleted_ago=app_deleted_ago)
        return environment

    def test_lifts_the_lock_without_saving_it(self):
        environment = self._environment()

        restored, model = self._run(environment)

        assert restored is environment
        assert environment.deleted_at is None
        model.all_objects.filter.assert_called_once_with(id="env-1")
        update = model.all_objects.filter.return_value.update.call_args.kwargs
        assert update["deleted_at"] is None
        assert update["is_deleted"] is False
        # Environment.save() would trigger syncs inside the transaction.
        environment.save.assert_not_called()

    def test_refuses_an_environment_that_is_not_scheduled(self):
        with pytest.raises(ResourceDeletionError, match="not scheduled"):
            self._run(self._environment(deleted_ago=None))

    def test_refuses_while_its_app_is_pending_deletion(self):
        environment = self._environment(app_deleted_ago=timedelta(minutes=5))

        with pytest.raises(ResourceDeletionError, match="Restore the app first"):
            self._run(environment)

    def test_refuses_once_the_purge_is_due(self):
        environment = self._environment(deleted_ago=GRACE_PERIOD + timedelta(minutes=1))

        with pytest.raises(ResourceDeletionError, match="no longer be restored"):
            self._run(environment)

    def test_refuses_when_the_plan_has_no_room_left(self):
        with pytest.raises(ResourceDeletionError, match="limit of environments"):
            self._run(self._environment(), can_add=False)

    def test_refuses_when_a_live_environment_took_the_name(self):
        with pytest.raises(ResourceDeletionError, match="now named 'Staging'"):
            self._run(self._environment(), conflict=NAME_IN_USE)

    @pytest.mark.parametrize(
        "refusal",
        [
            {"can_add": False},
            {"conflict": NAME_IN_USE},
        ],
    )
    def test_a_refusal_changes_nothing(self, refusal):
        model = None
        environment = self._environment()
        try:
            _, model = self._run(environment, **refusal)
        except ResourceDeletionError:
            pass

        assert model is None
        assert environment.deleted_at is not None
