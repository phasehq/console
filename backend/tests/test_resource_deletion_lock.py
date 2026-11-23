"""An app or environment pending deletion is locked: it is hidden, its secrets
can't be reached, and its syncs and rotations pause."""

from contextlib import contextmanager
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from django.utils import timezone
from graphql import GraphQLError

from api.utils.access import permissions
from backend.graphene import types


def _info(user_id="user-1"):
    info = MagicMock()
    info.context.user.userId = user_id
    return info


def _environment_state_lookups(lookup):
    """The filter keys that would drop a scope row for its environment's state."""
    return [key for key in lookup if "environment__deleted_at" in key]


@contextmanager
def _permission_models(**models):
    real_get_model = permissions.apps.get_model

    def get_model(app_label, name):
        return models[name] if name in models else real_get_model(app_label, name)

    with patch.object(permissions.apps, "get_model", side_effect=get_model):
        yield


class TestAccessChecks:
    """Every resolver and REST view goes through these, so a locked app or
    environment fails closed."""

    def _app_models(self):
        app_model, member_model = MagicMock(), MagicMock()
        membership_model = MagicMock()
        app_model.DoesNotExist = member_model.DoesNotExist = LookupError
        return app_model, member_model, membership_model

    def test_app_access_looks_the_app_up_among_live_apps(self):
        app_model, member_model, membership_model = self._app_models()
        app_model.objects.get.side_effect = app_model.DoesNotExist

        with _permission_models(
            App=app_model,
            OrganisationMember=member_model,
            TeamMembership=membership_model,
        ):
            assert permissions.user_can_access_app("user-1", "app-1") is False

        app_model.objects.get.assert_called_once_with(id="app-1")
        app_model.all_objects.get.assert_not_called()

    def test_restoring_reaches_an_app_pending_deletion(self):
        app_model, member_model, membership_model = self._app_models()
        app = app_model.all_objects.get.return_value
        member = member_model.objects.get.return_value
        app.members.all.return_value = [member]

        with _permission_models(
            App=app_model,
            OrganisationMember=member_model,
            TeamMembership=membership_model,
        ):
            assert permissions.user_can_access_app(
                "user-1", "app-1", include_deleted=True
            )

        app_model.all_objects.get.assert_called_once_with(id="app-1")
        app_model.objects.get.assert_not_called()

    @pytest.mark.parametrize("helper", ["user", "service_account"])
    def test_a_team_reaches_an_app_through_an_environment_pending_deletion(
        self, helper
    ):
        # Its members open the app to find that environment and restore it.
        app_model, member_model, membership_model = self._app_models()
        app = app_model.objects.get.return_value
        app.members.all.return_value = []
        app.service_accounts.filter.return_value.exists.return_value = False
        membership_model.objects.filter.return_value.exists.return_value = False

        with _permission_models(
            App=app_model,
            OrganisationMember=member_model,
            ServiceAccount=member_model,
            TeamMembership=membership_model,
        ):
            if helper == "user":
                permissions.user_can_access_app("user-1", "app-1")
            else:
                permissions.service_account_can_access_app("sa-1", "app-1")

        lookup = membership_model.objects.filter.call_args.kwargs
        assert lookup["team__app_environments__app"] is app
        assert _environment_state_lookups(lookup) == []

    def test_team_permissions_count_an_environment_pending_deletion(self):
        # A team may reach the app only through the environment it deleted,
        # and its role for the app decides who may restore it.
        team_model = MagicMock()
        team_model.objects.filter.return_value.distinct.return_value = []
        account, app = MagicMock(), MagicMock()
        app.members.all.return_value = []

        with _permission_models(Team=team_model):
            permissions._check_app_permission(account, "delete", "Environments", app)

        lookup = team_model.objects.filter.call_args.kwargs
        assert lookup["app_environments__app"] is app
        assert _environment_state_lookups(lookup) == []

    def test_environment_access_looks_it_up_among_live_environments(self):
        environment_model, member_model = MagicMock(), MagicMock()
        key_model = MagicMock()
        environment_model.DoesNotExist = member_model.DoesNotExist = LookupError
        environment_model.objects.get.side_effect = environment_model.DoesNotExist

        with _permission_models(
            Environment=environment_model,
            OrganisationMember=member_model,
            EnvironmentKey=key_model,
        ):
            assert permissions.user_can_access_environment("user-1", "env-1") is False

        # Holding a key is not enough while the environment is locked.
        key_model.objects.filter.assert_not_called()

    def test_restoring_reaches_an_environment_pending_deletion(self):
        environment_model, member_model = MagicMock(), MagicMock()
        key_model = MagicMock()
        key_model.objects.filter.return_value.exists.return_value = True

        with _permission_models(
            Environment=environment_model,
            OrganisationMember=member_model,
            EnvironmentKey=key_model,
        ):
            assert permissions.user_can_access_environment(
                "user-1", "env-1", include_deleted=True
            )

        environment_model.all_objects.get.assert_called_once_with(id="env-1")
        environment_model.objects.get.assert_not_called()

    def test_org_resolution_still_finds_the_org_of_a_locked_row(self):
        # SSO enforcement and the org lock must not skip a restore mutation.
        from api.utils.access import org_resolution

        model = MagicMock()
        model._base_manager.filter.return_value.values_list.return_value.first.return_value = (
            "org-1"
        )
        with patch.object(org_resolution.apps, "get_model", return_value=model):
            assert org_resolution._resolve_via_model("App", "app-1") == "org-1"

        model.objects.filter.assert_not_called()


class TestEnvironmentTypeKeepsItsKeys:
    """EnvironmentType trusts whichever query returned the environment."""

    def _environment(self, deleted=False, app_deleted=False):
        now = timezone.now()
        app = SimpleNamespace(
            organisation=MagicMock(), deleted_at=now if app_deleted else None
        )
        return SimpleNamespace(
            id="env-1", app=app, app_id="app-1", deleted_at=now if deleted else None
        )

    @pytest.mark.parametrize(
        "state", [{"deleted": True}, {"app_deleted": True}], ids=["own", "its-app"]
    )
    @pytest.mark.parametrize("field", ["wrapped_seed", "wrapped_salt"])
    def test_gives_out_no_key_material_while_pending_deletion(self, state, field):
        environment = self._environment(**state)
        resolver = getattr(types.EnvironmentType, f"resolve_{field}")

        with patch.object(types, "EnvironmentKey") as key_model, patch.object(
            types, "OrganisationMember"
        ):
            assert resolver(environment, _info()) is None

        key_model.objects.get.assert_not_called()

    def test_gives_out_the_callers_key_otherwise(self):
        with patch.object(types, "EnvironmentKey") as key_model, patch.object(
            types, "OrganisationMember"
        ):
            key_model.objects.get.return_value.wrapped_seed = "wrapped"
            seed = types.EnvironmentType.resolve_wrapped_seed(
                self._environment(), _info()
            )

        assert seed == "wrapped"

    def test_lists_nothing_else_while_pending_deletion(self):
        environment = self._environment(deleted=True)

        resolvers = types.EnvironmentType
        with patch.object(types, "EnvironmentKey") as key_model, patch.object(
            types, "Secret"
        ) as secret_model, patch.object(types, "SecretFolder") as folder_model:
            assert resolvers.resolve_members(environment, _info()) == []
            assert resolvers.resolve_secret_count(environment, _info()) is None
            assert resolvers.resolve_folder_count(environment, _info()) is None

        key_model.objects.filter.assert_not_called()
        secret_model.objects.filter.assert_not_called()
        folder_model.objects.filter.assert_not_called()


class TestPendingDeletionTypes:
    def _resources(self, **state):
        from api.models import App, Environment

        return [
            (types.DeletedAppType, App(**state)),
            (types.DeletedEnvironmentType, Environment(**state)),
        ]

    def test_say_when_the_purge_is_due_and_whether_restore_is_open(self):
        from api.utils.resource_deletion import GRACE_PERIOD

        deleted_at = timezone.now() - timedelta(hours=1)
        for graphene_type, pending in self._resources(deleted_at=deleted_at):
            scheduled_for = graphene_type.resolve_deletion_scheduled_for(pending, None)
            assert scheduled_for == deleted_at + GRACE_PERIOD
            assert graphene_type.resolve_can_restore(pending, None) is True
            assert graphene_type.resolve_deletion_delayed(pending, None) is False

        for graphene_type, due in self._resources(
            deleted_at=timezone.now() - GRACE_PERIOD
        ):
            assert graphene_type.resolve_can_restore(due, None) is False
            assert graphene_type.resolve_deletion_delayed(due, None) is False

    def test_a_blocked_purge_is_delayed_and_can_still_be_restored(self):
        for graphene_type, blocked in self._resources(
            deleted_at=timezone.now() - timedelta(days=3),
            purge_blocked_at=timezone.now() - timedelta(days=1),
        ):
            assert graphene_type.resolve_deletion_delayed(blocked, None) is True
            assert graphene_type.resolve_can_restore(blocked, None) is True

    def test_expose_nothing_of_the_contents(self):
        for graphene_type in (types.DeletedAppType, types.DeletedEnvironmentType):
            fields = set(graphene_type._meta.fields)
            assert fields <= {
                "id",
                "name",
                "env_type",
                "index",
                "deleted_at",
                "deletion_scheduled_for",
                "deletion_delayed",
                "can_restore",
                "viewer_can_delete",
            }

    def test_an_environment_says_where_it_stood_among_the_apps_environments(self):
        """The secrets grid keeps a column for it in that place."""
        import graphene
        from api.models import Environment

        class Query(graphene.ObjectType):
            pending = graphene.Field(types.DeletedEnvironmentType)

            def resolve_pending(root, info):
                return Environment(
                    id="env-1", name="Staging", index=2, deleted_at=timezone.now()
                )

        result = graphene.Schema(query=Query).execute("{ pending { id name index } }")

        assert result.errors is None
        assert result.data["pending"] == {"id": "env-1", "name": "Staging", "index": 2}
        # Apps are listed by name: there is no place to keep
        assert "index" not in types.DeletedAppType._meta.fields

    @pytest.mark.parametrize("allowed", [True, False])
    def test_an_app_says_whether_the_caller_may_restore_it_or_delete_it_now(
        self, allowed
    ):
        # Worked out for each app, as the mutations do: the role can come
        # from a team, which the caller's organisation role doesn't show.
        info, app = _info(), MagicMock()
        with patch.object(
            types, "user_can_delete_app", return_value=allowed
        ) as may_delete:
            assert types.DeletedAppType.resolve_viewer_can_delete(app, info) is allowed

        may_delete.assert_called_once_with(info.context.user, app)


class TestPendingDeletionQueries:
    @pytest.fixture
    def schema(self):
        from backend import schema

        with patch.object(schema, "App") as app_model, patch.object(
            schema, "Environment"
        ) as environment_model, patch.object(
            schema, "EnvironmentKey"
        ) as key_model, patch.object(
            schema, "OrganisationMember"
        ) as member_model, patch.object(
            schema, "TeamAppEnvironment"
        ) as scope_model, patch.object(
            schema, "user_has_permission", return_value=True
        ) as permission, patch.object(
            schema, "user_can_access_app", return_value=True
        ) as access:
            yield SimpleNamespace(
                module=schema,
                App=app_model,
                Environment=environment_model,
                EnvironmentKey=key_model,
                OrganisationMember=member_model,
                TeamAppEnvironment=scope_model,
                permission=permission,
                access=access,
            )

    def test_deleted_apps_lists_those_the_caller_could_access(self, schema):
        pending = schema.App.all_objects.filter.return_value
        member = schema.OrganisationMember.objects.get.return_value

        result = schema.module.Query.resolve_deleted_apps(None, _info(), "org-1")

        schema.App.all_objects.filter.assert_called_once_with(organisation_id="org-1")
        # Not the apps soft-deleted by releases before 2024.
        pending.filter.assert_called_once_with(
            deleted_at__isnull=False, is_deleted=False
        )
        scheduled = pending.filter.return_value
        accessible = str(scheduled.filter.call_args.args[0])
        assert "members" in accessible and "id__in" in accessible
        accessible_apps = scheduled.filter.return_value
        # Each app's viewerCanDelete reads its organisation.
        accessible_apps.select_related.assert_called_once_with("organisation")
        listed = accessible_apps.select_related.return_value.distinct.return_value
        assert result is listed.order_by.return_value
        schema.TeamAppEnvironment.objects.filter.assert_called_once_with(
            team__memberships__org_member=member, team__deleted_at__isnull=True
        )

    def test_deleted_apps_needs_permission_to_read_apps(self, schema):
        schema.permission.return_value = False

        assert schema.module.Query.resolve_deleted_apps(None, _info(), "org-1") == []

        schema.App.all_objects.filter.assert_not_called()

    def test_deleted_environments_lists_those_the_caller_holds_a_key_for(self, schema):
        app = schema.App.objects.get.return_value
        keys = schema.EnvironmentKey.objects.filter.return_value
        key_ids = keys.values_list.return_value

        schema.module.Query.resolve_deleted_environments(None, _info(), "app-1")

        # The app itself must be live: App.objects, not all_objects.
        schema.App.objects.get.assert_called_once_with(id="app-1")
        lookup = schema.EnvironmentKey.objects.filter.call_args.kwargs
        assert lookup["user__user_id"] == "user-1"
        assert lookup["deleted_at__isnull"] is True
        in_app = schema.Environment.all_objects.filter
        in_app.assert_called_once_with(app=app, id__in=key_ids)
        in_app.return_value.filter.assert_called_once_with(
            deleted_at__isnull=False, is_deleted=False
        )

    def test_deleted_environments_needs_access_to_the_app(self, schema):
        schema.access.return_value = False

        with pytest.raises(GraphQLError, match="don't have access"):
            schema.module.Query.resolve_deleted_environments(None, _info(), "app-1")

        schema.Environment.all_objects.filter.assert_not_called()

    def test_deleted_environments_needs_permission_to_read_environments(self, schema):
        schema.permission.return_value = False

        result = schema.module.Query.resolve_deleted_environments(
            None, _info(), "app-1"
        )

        assert result == []
        schema.Environment.all_objects.filter.assert_not_called()


class TestQueriesLeaveOutLockedEnvironments:
    """A live app's child rows still exist for an environment pending deletion."""

    def test_environment_keys(self):
        from backend import schema

        with patch.object(schema, "App"), patch.object(
            schema, "EnvironmentKey"
        ) as key_model, patch.object(schema, "OrganisationMember"), patch.object(
            schema, "user_can_access_app", return_value=True
        ):
            schema.Query.resolve_environment_keys(
                None, _info(), app_id="app-1", environment_id="env-pending"
            )

        lookup = key_model.objects.filter.call_args.kwargs
        assert lookup["environment__deleted_at"] is None
        assert lookup["environment_id"] == "env-pending"

    def test_app_syncs(self):
        from backend.graphene.queries import syncing

        with patch.object(syncing, "App"), patch.object(
            syncing, "EnvironmentSync"
        ) as sync_model, patch.object(
            syncing, "user_has_permission", return_value=True
        ), patch.object(
            syncing, "user_can_access_app", return_value=True
        ):
            syncing.resolve_syncs(None, _info(), app_id="app-1")

        lookup = sync_model.objects.filter.call_args.kwargs
        assert lookup["environment__deleted_at"] is None

    def test_team_scope(self):
        team = MagicMock()
        team.app_environments.values_list.return_value.distinct.return_value = ["app-1"]

        with patch.object(types, "user_can_access_app", return_value=True):
            types.TeamType.resolve_app_environments(team, _info())

        scope = team.app_environments.select_related.return_value.filter
        assert scope.call_args.kwargs["environment__deleted_at__isnull"] is True

    def test_team_apps_include_one_reached_through_a_pending_environment(self):
        # The console reads the team's role for the app from this list.
        team = MagicMock()

        with patch.object(types, "App") as app_model, patch.object(
            types, "user_can_access_app", return_value=True
        ):
            types.TeamType.resolve_apps(team, _info())

        team.app_environments.filter.assert_not_called()
        app_ids = team.app_environments.values_list.return_value.distinct.return_value
        assert app_model.objects.filter.call_args.kwargs["id__in"] is app_ids

    def test_apps_include_one_reached_through_a_pending_environment(self):
        from backend import schema

        with patch.object(schema, "App"), patch.object(
            schema, "OrganisationMember"
        ) as member_model, patch.object(
            schema, "TeamAppEnvironment"
        ) as scope_model, patch.object(
            schema, "user_has_permission", return_value=True
        ):
            schema.Query.resolve_apps(
                None, _info(), organisation_id="org-1", app_id=None
            )

        lookup = scope_model.objects.filter.call_args.kwargs
        member = member_model.objects.get.return_value
        assert lookup["team__memberships__org_member"] is member
        assert _environment_state_lookups(lookup) == []

    @pytest.mark.parametrize(
        "scope",
        [
            {"org_id": "org-1"},
            {"app_id": "app-1"},
            {"secret_id": "ds-1", "org_id": "org-1"},
            {"app_id": "app-1", "env_id": "env-1"},
        ],
        ids=["organisation", "app", "secret", "environment"],
    )
    def test_dynamic_secrets(self, scope):
        from ee.integrations.secrets.dynamic.graphene import queries

        with patch.object(queries, "App"), patch.object(
            queries, "Environment"
        ), patch.object(queries, "Organisation"), patch.object(
            queries, "DynamicSecret"
        ) as secret_model, patch.object(
            queries, "user_has_permission", return_value=True
        ), patch.object(
            queries, "user_can_access_app", return_value=True
        ), patch.object(
            queries, "user_can_access_environment", return_value=True
        ):
            secret_model.objects.filter.return_value = []
            queries.resolve_dynamic_secrets(None, _info(), **scope)

        lookup = secret_model.objects.filter.call_args.kwargs
        assert lookup["environment__deleted_at"] is None
        assert lookup["environment__app__deleted_at"] is None


class TestSyncsPauseWhileLocked:
    @pytest.fixture
    def syncing(self):
        from api.tasks import syncing

        sync_model = MagicMock(
            CANCELLED="cancelled", IN_PROGRESS="in_progress", COMPLETED="completed"
        )
        event_model = MagicMock()
        event = MagicMock()
        event_model.objects.filter.return_value.order_by.return_value.first.return_value = (
            event
        )
        models = {"EnvironmentSync": sync_model, "EnvironmentSyncEvent": event_model}
        with patch.object(
            syncing.apps, "get_model", side_effect=lambda app, name: models[name]
        ), patch.object(syncing, "organisation_is_locked", return_value=False):
            yield SimpleNamespace(module=syncing, event=event)

    def test_locked_environment_skips_the_sync_job(self, syncing):
        env_sync, sync_function = MagicMock(environment_id="env-1"), MagicMock()
        with patch.object(
            syncing.module, "environment_is_locked", return_value=True
        ) as locked:
            syncing.module.handle_sync_event(env_sync, sync_function)

        # Asked by ID: the job may hold a copy from before the deletion.
        locked.assert_called_once_with("env-1")
        sync_function.assert_not_called()
        assert env_sync.status == "cancelled"
        assert syncing.event.status == "cancelled"
        assert "scheduled for deletion" in syncing.event.meta["message"]

    @pytest.mark.parametrize("locked", [True, False])
    def test_only_an_unlocked_environment_queues_a_sync(self, locked, syncing):
        from api.services import ServiceConfig

        env_sync = MagicMock(service=ServiceConfig.GITHUB_ACTIONS["id"])
        with patch.object(
            syncing.module, "environment_is_locked", return_value=locked
        ), patch.object(syncing.module, "cancel_sync_tasks") as cancel, patch.object(
            syncing.module, "perform_github_actions_sync"
        ) as sync_job:
            syncing.module.trigger_sync_tasks(env_sync)

        if locked:
            # Left cancelled. A restore runs it again.
            assert env_sync.status == "cancelled"
            cancel.assert_not_called()
            sync_job.delay.assert_not_called()
        else:
            sync_job.delay.assert_called_once_with(env_sync)

    def test_unlocked_environment_runs_the_sync_job(self, syncing):
        env_sync, sync_function = MagicMock(), MagicMock(return_value=(True, {}))
        # The job reads the sync's path under a row lock, in a transaction
        with patch.object(
            syncing.module, "environment_is_locked", return_value=False
        ), patch.object(
            syncing.module, "get_environment_secrets", return_value=[]
        ), patch.object(syncing.module, "transaction"):
            syncing.module.handle_sync_event(env_sync, sync_function)

        sync_function.assert_called_once()
        assert env_sync.status == "completed"


class TestRotationsPauseWhileLocked:
    @pytest.mark.parametrize("locked", [True, False])
    def test_rotates_only_while_unlocked(self, locked):
        from ee.integrations.secrets.rotation import engine

        model = MagicMock()
        rotating_secret = MagicMock(is_active=True, environment_id="env-1")
        model.objects.select_for_update.return_value.get.return_value = rotating_secret
        with patch.object(engine.apps, "get_model", return_value=model), patch.object(
            engine, "organisation_is_locked", return_value=False
        ), patch.object(
            engine, "environment_is_locked", return_value=locked
        ) as is_locked, patch.object(
            engine, "transaction"
        ), patch.object(
            engine, "_mint_once"
        ) as mint, patch.object(
            engine, "_retire_prior_credential"
        ), patch.object(
            engine, "record_event"
        ), patch.object(
            engine, "_set_health"
        ), patch.object(
            engine, "_schedule_next_rotation"
        ) as schedule:
            engine.perform_rotation("rs-1")

        is_locked.assert_called_once_with("env-1")
        assert mint.called is not locked
        # Not re-armed while locked: a restore reschedules it.
        assert schedule.called is not locked

    def _schedule(self, **options):
        from ee.integrations.secrets.rotation import engine

        rotating_secret = MagicMock(pk="rs-1", rotation_job_id="old-job")
        model = MagicMock()
        with patch.object(engine, "_cancel_job") as cancel, patch.object(
            engine, "_scheduler"
        ) as scheduler, patch.object(engine.apps, "get_model", return_value=model):
            scheduler.return_value.enqueue_at.return_value.id = "new-job"
            engine._schedule_next_rotation(
                rotating_secret, delay=timedelta(minutes=10), **options
            )
        cancel.assert_called_once_with("old-job")
        return rotating_secret, model

    def test_scheduling_a_rotation_saves_the_secret_and_so_runs_the_syncs(self):
        # RotatingSecret.save() saves the environment, which runs its syncs.
        rotating_secret, model = self._schedule()

        rotating_secret.save.assert_called_once_with(
            update_fields=["rotation_job_id", "next_rotation_at", "updated_at"]
        )
        model.objects.filter.assert_not_called()

    def test_a_restore_rearms_a_rotation_without_running_the_syncs(self):
        # It re-arms every rotating secret under what was restored, then runs
        # the syncs once itself.
        before = timezone.now()
        rotating_secret, model = self._schedule(trigger_syncs=False)

        rotating_secret.save.assert_not_called()
        model.objects.filter.assert_called_once_with(pk="rs-1")
        written = model.objects.filter.return_value.update.call_args
        assert written.kwargs["rotation_job_id"] == "new-job"
        assert written.kwargs["next_rotation_at"] >= before + timedelta(minutes=10)
        # update() sets no auto_now field by itself.
        assert written.kwargs["updated_at"] >= before
        assert set(written.kwargs) == {
            "rotation_job_id",
            "next_rotation_at",
            "updated_at",
        }
        # The copy in hand matches what was written.
        assert rotating_secret.rotation_job_id == "new-job"
        assert rotating_secret.next_rotation_at == written.kwargs["next_rotation_at"]

    def test_reschedule_passes_the_choice_on(self):
        from ee.integrations.secrets.rotation import engine

        rotating_secret = MagicMock(next_rotation_at=None)
        with patch.object(engine, "_schedule_next_rotation") as schedule:
            engine.reschedule(rotating_secret, trigger_syncs=False)

        schedule.assert_called_once_with(
            rotating_secret, delay=None, trigger_syncs=False
        )


class TestLockedResourcesAreLeftAlone:
    def test_sse_cannot_be_enabled_past_an_environment_pending_deletion(self):
        # Restored later, it would be in an SSE app with no server key.
        from backend.graphene.mutations import syncing as mutations

        with patch.object(mutations, "App"), patch.object(
            mutations, "Environment"
        ) as environment_model, patch.object(
            mutations, "ServerEnvironmentKey"
        ) as key_model, patch.object(
            mutations, "user_can_access_app", return_value=True
        ), patch.object(
            mutations, "user_can_access_environment", return_value=True
        ), patch.object(
            mutations, "user_has_permission", return_value=True
        ):
            environment_model.objects.filter.return_value = [MagicMock(id="env-1")]
            environment_model.all_objects.filter.return_value.exists.return_value = True

            with pytest.raises(
                GraphQLError, match="scheduled for deletion.*delete it now"
            ):
                mutations.InitEnvSync.mutate(None, _info(), app_id="app-1", env_keys=[])

        key_model.objects.filter.assert_not_called()

    def test_first_login_key_provisioning_skips_apps_pending_deletion(self):
        from api.utils import keys

        app_model, membership_model, scope_model = MagicMock(), MagicMock(), MagicMock()
        membership = MagicMock()
        membership_model.objects.filter.return_value.select_related.return_value = [
            membership
        ]
        live_app = MagicMock()
        app_model.objects.filter.return_value = [live_app]
        models = {
            "App": app_model,
            "TeamMembership": membership_model,
            "TeamAppEnvironment": scope_model,
        }
        with patch.object(
            keys.apps, "get_model", side_effect=lambda app, name: models[name]
        ), patch.object(keys, "provision_team_environment_keys") as provision:
            keys.provision_pending_team_keys(MagicMock())

        # A filter over the live apps: a get() per ID raised on a locked one
        # and left the member without keys for every app after it.
        app_model.objects.get.assert_not_called()
        provision.assert_called_once_with(
            membership.team, live_app, members=[membership]
        )
