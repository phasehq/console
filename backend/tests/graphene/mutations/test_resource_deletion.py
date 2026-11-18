"""Deleting an app or an environment schedules it for a background purge
instead of deleting it in the request; restoring cancels that. A deletion can
also be asked for at once, when it is made or later."""

from contextlib import ExitStack
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest
from graphql import GraphQLError

from api.utils.resource_deletion import (
    NAME_IN_USE,
    NAME_PENDING_DELETION,
    ResourceDeletionError,
)

APP = "backend.graphene.mutations.app"
ENV = "backend.graphene.mutations.environment"
SCHEDULED_FOR = datetime(2026, 1, 2, 3, 4, tzinfo=timezone.utc)


def _info():
    info = MagicMock()
    info.context.user.userId = "user-1"
    return info


def _schedules(resource, immediately=False):
    # As the real helpers do: the row records whether to skip the grace period.
    resource.skip_grace_period = immediately
    return resource


def _common(stack, module):
    m = MagicMock()
    m.audit = stack.enter_context(patch(f"{module}.log_audit_event"))
    m.permission = stack.enter_context(
        patch(f"{module}.user_has_permission", return_value=True)
    )
    m.transaction = stack.enter_context(patch(f"{module}.transaction"))
    stack.enter_context(
        patch(
            f"{module}.get_actor_info_from_graphql",
            return_value=("user", "member-1", {}),
        )
    )
    stack.enter_context(
        patch(f"{module}.get_resolver_request_meta", return_value=("1.2.3.4", "UA"))
    )
    stack.enter_context(
        patch(f"{module}.deletion_scheduled_for", return_value=SCHEDULED_FOR)
    )
    return m


@pytest.fixture
def app_mocks():
    with ExitStack() as stack:
        m = _common(stack, APP)
        m.App = stack.enter_context(patch(f"{APP}.App"))
        m.access = stack.enter_context(
            patch(f"{APP}.user_can_access_app", return_value=True)
        )
        m.schedule = stack.enter_context(
            patch(f"{APP}.schedule_app_deletion", side_effect=_schedules)
        )
        m.delete_now = stack.enter_context(patch(f"{APP}.delete_app_now"))
        m.restore = stack.enter_context(patch(f"{APP}.restore_app"))
        m.enqueue_restored = stack.enter_context(patch(f"{APP}.enqueue_app_restored"))
        m.enqueue_purge = stack.enter_context(patch(f"{APP}.enqueue_app_purge"))
        m.app = MagicMock(id="app-1", skip_grace_period=False)
        m.app.name = "Billing"
        m.App.objects.get.return_value = m.app
        m.App.all_objects.get.return_value = m.app
        m.restore.return_value = m.app
        m.delete_now.side_effect = lambda app_id: _schedules(m.app, True)
        yield m


@pytest.fixture
def env_mocks():
    with ExitStack() as stack:
        m = _common(stack, ENV)
        m.Environment = stack.enter_context(patch(f"{ENV}.Environment"))
        m.RotatingSecret = stack.enter_context(patch(f"{ENV}.RotatingSecret"))
        m.RotatingSecret.objects.filter.return_value.exists.return_value = False
        stack.enter_context(patch(f"{ENV}.can_use_custom_envs", return_value=True))
        m.access = stack.enter_context(
            patch(f"{ENV}.user_can_access_environment", return_value=True)
        )
        m.schedule = stack.enter_context(
            patch(f"{ENV}.schedule_environment_deletion", side_effect=_schedules)
        )
        m.delete_now = stack.enter_context(patch(f"{ENV}.delete_environment_now"))
        m.restore = stack.enter_context(patch(f"{ENV}.restore_environment"))
        m.enqueue_restored = stack.enter_context(
            patch(f"{ENV}.enqueue_environment_restored")
        )
        m.enqueue_purge = stack.enter_context(
            patch(f"{ENV}.enqueue_environment_purge")
        )
        m.conflict = stack.enter_context(
            patch(f"{ENV}.environment_name_conflict", return_value=None)
        )
        m.env = MagicMock(id="env-1", skip_grace_period=False)
        m.env.name = "Staging"
        m.Environment.objects.get.return_value = m.env
        m.Environment.all_objects.select_related.return_value.get.return_value = m.env
        m.restore.return_value = m.env
        m.delete_now.side_effect = lambda environment_id: _schedules(m.env, True)
        yield m


def _delete_app(**kwargs):
    from backend.graphene.mutations.app import DeleteAppMutation

    return DeleteAppMutation.mutate(None, _info(), id="app-1", **kwargs)


def _delete_app_now():
    from backend.graphene.mutations.app import DeleteAppNowMutation

    return DeleteAppNowMutation.mutate(None, _info(), id="app-1")


def _restore_app():
    from backend.graphene.mutations.app import RestoreAppMutation

    return RestoreAppMutation.mutate(None, _info(), id="app-1")


def _delete_env(**kwargs):
    from backend.graphene.mutations.environment import DeleteEnvironmentMutation

    return DeleteEnvironmentMutation.mutate(
        None, _info(), environment_id="env-1", **kwargs
    )


def _delete_env_now():
    from backend.graphene.mutations.environment import DeleteEnvironmentNowMutation

    return DeleteEnvironmentNowMutation.mutate(None, _info(), environment_id="env-1")


def _restore_env():
    from backend.graphene.mutations.environment import RestoreEnvironmentMutation

    return RestoreEnvironmentMutation.mutate(None, _info(), environment_id="env-1")


class TestDeleteApp:
    def test_schedules_the_deletion_instead_of_deleting(self, app_mocks):
        result = _delete_app()

        assert result.ok is True
        assert result.app is app_mocks.app
        app_mocks.schedule.assert_called_once_with(app_mocks.app, immediately=False)
        # The cascade is the purge job's work: it outlasted the request.
        app_mocks.app.delete.assert_not_called()
        # The hourly sweep enqueues the purge once the grace period has ended.
        app_mocks.transaction.on_commit.assert_not_called()

        audit = app_mocks.audit.call_args.kwargs
        assert audit["event_type"] == "D"
        assert audit["resource_type"] == "app"
        assert audit["description"] == (
            "Scheduled app 'Billing' for deletion on 2026-01-02 03:04 UTC"
        )
        # One event, and none claiming the environments are gone already.
        app_mocks.audit.assert_called_once()

    def test_deletes_immediately_when_asked(self, app_mocks):
        result = _delete_app(immediately=True)

        assert result.ok is True
        app_mocks.schedule.assert_called_once_with(app_mocks.app, immediately=True)
        # Still the purge job's work, queued at once instead of by the sweep.
        app_mocks.app.delete.assert_not_called()
        app_mocks.enqueue_purge.assert_not_called()
        app_mocks.transaction.on_commit.call_args.args[0]()
        app_mocks.enqueue_purge.assert_called_once_with("app-1")

        audit = app_mocks.audit.call_args.kwargs
        assert audit["event_type"] == "D"
        assert audit["description"] == "Requested immediate deletion of app 'Billing'"

    def test_requires_access_to_the_app(self, app_mocks):
        app_mocks.access.return_value = False

        with pytest.raises(GraphQLError, match="don't have access"):
            _delete_app()

        app_mocks.schedule.assert_not_called()

    def test_requires_permission_to_delete_apps(self, app_mocks):
        app_mocks.permission.return_value = False

        with pytest.raises(GraphQLError, match="permission to delete"):
            _delete_app()

        app_mocks.schedule.assert_not_called()

    def test_reports_an_app_already_scheduled(self, app_mocks):
        app_mocks.schedule.side_effect = ResourceDeletionError("already scheduled")

        with pytest.raises(GraphQLError, match="already scheduled"):
            _delete_app(immediately=True)

        app_mocks.audit.assert_not_called()
        app_mocks.transaction.on_commit.assert_not_called()


class TestDeleteAppNow:
    """For an app already scheduled for deletion."""

    def test_skips_the_rest_of_the_grace_period(self, app_mocks):
        result = _delete_app_now()

        assert result.app is app_mocks.app
        # all_objects: App.objects hides an app pending deletion.
        app_mocks.App.all_objects.get.assert_called_once_with(id="app-1")
        app_mocks.access.assert_called_once_with(
            "user-1", "app-1", include_deleted=True
        )
        app_mocks.delete_now.assert_called_once_with("app-1")

        # A delete event, so the purge is logged as this actor's.
        audit = app_mocks.audit.call_args.kwargs
        assert audit["event_type"] == "D"
        assert audit["description"] == "Requested immediate deletion of app 'Billing'"

        app_mocks.enqueue_purge.assert_not_called()
        app_mocks.transaction.on_commit.call_args.args[0]()
        app_mocks.enqueue_purge.assert_called_once_with("app-1")

    def test_requires_the_permission_that_deleting_needs(self, app_mocks):
        app_mocks.permission.return_value = False

        with pytest.raises(GraphQLError, match="permission to delete"):
            _delete_app_now()

        assert app_mocks.permission.call_args.args[1:3] == ("delete", "Apps")
        app_mocks.delete_now.assert_not_called()

    def test_requires_access_to_the_app(self, app_mocks):
        app_mocks.access.return_value = False

        with pytest.raises(GraphQLError, match="don't have access"):
            _delete_app_now()

        app_mocks.delete_now.assert_not_called()

    @pytest.mark.parametrize(
        "reason", ["not scheduled for deletion", "is already under way"]
    )
    def test_reports_why_it_cannot_be_deleted_now(self, app_mocks, reason):
        app_mocks.delete_now.side_effect = ResourceDeletionError(reason)

        with pytest.raises(GraphQLError, match=reason):
            _delete_app_now()

        app_mocks.audit.assert_not_called()
        app_mocks.transaction.on_commit.assert_not_called()


class TestRestoreApp:
    def test_restores_and_resumes_in_the_background(self, app_mocks):
        result = _restore_app()

        assert result.app is app_mocks.app
        # all_objects: App.objects hides an app pending deletion.
        app_mocks.App.all_objects.get.assert_called_once_with(id="app-1")
        app_mocks.access.assert_called_once_with(
            "user-1", "app-1", include_deleted=True
        )
        app_mocks.restore.assert_called_once_with("app-1")

        audit = app_mocks.audit.call_args.kwargs
        assert audit["event_type"] == "U"
        assert audit["description"] == "Restored app 'Billing'"

        app_mocks.enqueue_restored.assert_not_called()
        app_mocks.transaction.on_commit.call_args.args[0]()
        app_mocks.enqueue_restored.assert_called_once_with("app-1")

    def test_requires_the_permission_that_deleting_needs(self, app_mocks):
        app_mocks.permission.return_value = False

        with pytest.raises(GraphQLError, match="permission to restore"):
            _restore_app()

        assert app_mocks.permission.call_args.args[1:3] == ("delete", "Apps")
        app_mocks.restore.assert_not_called()

    def test_requires_access_to_the_app(self, app_mocks):
        app_mocks.access.return_value = False

        with pytest.raises(GraphQLError, match="don't have access"):
            _restore_app()

        app_mocks.restore.assert_not_called()

    @pytest.mark.parametrize(
        "reason", ["This app can no longer be restored.", "limit of apps"]
    )
    def test_reports_why_it_cannot_be_restored(self, app_mocks, reason):
        app_mocks.restore.side_effect = ResourceDeletionError(reason)

        with pytest.raises(GraphQLError, match=reason):
            _restore_app()

        app_mocks.audit.assert_not_called()
        app_mocks.transaction.on_commit.assert_not_called()


class TestDeleteEnvironment:
    def test_schedules_the_deletion_instead_of_deleting(self, env_mocks):
        result = _delete_env()

        assert result.ok is True
        assert result.environment is env_mocks.env
        env_mocks.schedule.assert_called_once_with(env_mocks.env, immediately=False)
        env_mocks.env.delete.assert_not_called()
        env_mocks.transaction.on_commit.assert_not_called()

        audit = env_mocks.audit.call_args.kwargs
        assert audit["event_type"] == "D"
        assert audit["resource_type"] == "env"
        assert audit["description"] == (
            "Scheduled environment 'Staging' for deletion on 2026-01-02 03:04 UTC"
        )

    def test_deletes_immediately_when_asked(self, env_mocks):
        result = _delete_env(immediately=True)

        assert result.ok is True
        env_mocks.schedule.assert_called_once_with(env_mocks.env, immediately=True)
        env_mocks.env.delete.assert_not_called()
        env_mocks.transaction.on_commit.call_args.args[0]()
        env_mocks.enqueue_purge.assert_called_once_with("env-1")

        audit = env_mocks.audit.call_args.kwargs
        assert audit["event_type"] == "D"
        assert audit["description"] == (
            "Requested immediate deletion of environment 'Staging'"
        )

    def test_reports_an_environment_already_scheduled(self, env_mocks):
        env_mocks.schedule.side_effect = ResourceDeletionError("already scheduled")

        with pytest.raises(GraphQLError, match="already scheduled"):
            _delete_env(immediately=True)

        env_mocks.audit.assert_not_called()
        env_mocks.transaction.on_commit.assert_not_called()


class TestDeleteEnvironmentNow:
    """For an environment already scheduled for deletion."""

    def test_skips_the_rest_of_the_grace_period(self, env_mocks):
        result = _delete_env_now()

        assert result.environment is env_mocks.env
        # all_objects: Environment.objects hides it.
        env_mocks.Environment.objects.get.assert_not_called()
        env_mocks.access.assert_called_once_with(
            "user-1", "env-1", include_deleted=True
        )
        env_mocks.delete_now.assert_called_once_with("env-1")

        audit = env_mocks.audit.call_args.kwargs
        assert audit["event_type"] == "D"
        assert audit["description"] == (
            "Requested immediate deletion of environment 'Staging'"
        )

        env_mocks.enqueue_purge.assert_not_called()
        env_mocks.transaction.on_commit.call_args.args[0]()
        env_mocks.enqueue_purge.assert_called_once_with("env-1")

    def test_requires_the_permission_that_deleting_needs(self, env_mocks):
        env_mocks.permission.return_value = False

        with pytest.raises(GraphQLError, match="permission to delete environments"):
            _delete_env_now()

        call = env_mocks.permission.call_args
        assert call.args[1:3] == ("delete", "Environments")
        # A team may reach the app only through this pending environment.
        assert call.kwargs["include_deleted"] is True
        env_mocks.delete_now.assert_not_called()

    def test_requires_a_key_for_the_environment(self, env_mocks):
        env_mocks.access.return_value = False

        with pytest.raises(GraphQLError, match="don't have access"):
            _delete_env_now()

        env_mocks.delete_now.assert_not_called()

    def test_requires_permission_to_delete_its_rotating_secrets(self, env_mocks):
        # As deleting does: the purge revokes and removes them.
        env_mocks.RotatingSecret.objects.filter.return_value.exists.return_value = True
        env_mocks.permission.side_effect = (
            lambda user, action, resource, *args, **kwargs: resource
            != "RotatingSecrets"
        )

        with pytest.raises(GraphQLError, match="contains rotating secrets"):
            _delete_env_now()

        env_mocks.delete_now.assert_not_called()

    def test_reports_why_it_cannot_be_deleted_now(self, env_mocks):
        env_mocks.delete_now.side_effect = ResourceDeletionError(
            "It is deleted with the app."
        )

        with pytest.raises(GraphQLError, match="deleted with the app"):
            _delete_env_now()

        env_mocks.audit.assert_not_called()
        env_mocks.transaction.on_commit.assert_not_called()


class TestRestoreEnvironment:
    def test_restores_and_resumes_in_the_background(self, env_mocks):
        result = _restore_env()

        assert result.environment is env_mocks.env
        env_mocks.Environment.objects.get.assert_not_called()
        env_mocks.access.assert_called_once_with(
            "user-1", "env-1", include_deleted=True
        )
        env_mocks.restore.assert_called_once_with("env-1")

        audit = env_mocks.audit.call_args.kwargs
        assert audit["event_type"] == "U"
        assert audit["description"] == "Restored environment 'Staging'"

        env_mocks.transaction.on_commit.call_args.args[0]()
        env_mocks.enqueue_restored.assert_called_once_with("env-1")

    def test_requires_the_permission_that_deleting_needs(self, env_mocks):
        env_mocks.permission.return_value = False

        with pytest.raises(GraphQLError, match="permission to restore"):
            _restore_env()

        assert env_mocks.permission.call_args.args[1:3] == ("delete", "Environments")
        env_mocks.restore.assert_not_called()

    def test_requires_a_key_for_the_environment(self, env_mocks):
        env_mocks.access.return_value = False

        with pytest.raises(GraphQLError, match="don't have access"):
            _restore_env()

        env_mocks.restore.assert_not_called()

    def test_reports_why_it_cannot_be_restored(self, env_mocks):
        env_mocks.restore.side_effect = ResourceDeletionError("Restore the app first.")

        with pytest.raises(GraphQLError, match="Restore the app first"):
            _restore_env()

        env_mocks.audit.assert_not_called()
        env_mocks.transaction.on_commit.assert_not_called()


class TestEnvironmentNamesStayReserved:
    """An environment pending deletion keeps its name, so restoring it can't
    collide with one created or renamed meanwhile."""

    def _rename(self):
        from backend.graphene.mutations.environment import RenameEnvironmentMutation

        return RenameEnvironmentMutation.mutate(
            None, _info(), environment_id="env-1", name="Production"
        )

    @pytest.mark.parametrize(
        "conflict, message",
        [
            (NAME_IN_USE, "already exists"),
            (NAME_PENDING_DELETION, "scheduled for deletion.*delete it now"),
        ],
    )
    def test_rename_refuses_a_taken_name(self, env_mocks, conflict, message):
        env_mocks.conflict.return_value = conflict

        with pytest.raises(GraphQLError, match=message):
            self._rename()

        env_mocks.env.save.assert_not_called()

    def test_rename_ignores_the_environment_itself(self, env_mocks):
        self._rename()

        env_mocks.conflict.assert_called_once_with(
            env_mocks.env.app, "Production", "env-1"
        )
        env_mocks.env.save.assert_called_once()

    @pytest.mark.parametrize(
        "conflict, message",
        [
            (NAME_IN_USE, "already exists"),
            (NAME_PENDING_DELETION, "scheduled for deletion.*delete it now"),
        ],
    )
    def test_create_refuses_a_taken_name(self, env_mocks, conflict, message):
        from backend.graphene.mutations.environment import CreateEnvironmentMutation

        env_mocks.conflict.return_value = conflict
        data = MagicMock(app_id="app-1", env_type="custom")
        data.name = "Staging"

        with patch(f"{ENV}.user_can_access_app", return_value=True), patch(
            f"{ENV}.App"
        ), pytest.raises(GraphQLError, match=message):
            CreateEnvironmentMutation.mutate(None, _info(), data, [])

        env_mocks.Environment.objects.create.assert_not_called()
