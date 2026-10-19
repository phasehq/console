"""An organisation pending deletion is locked: GraphQL, REST token auth, SCIM
and external identity auth all refuse it, except the owner's restore. Its
rotations and syncs pause."""

from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from django.utils import timezone
from rest_framework import exceptions
from rest_framework.test import APIRequestFactory

from backend.graphene.middleware import (
    OrgDeletionLockMiddleware,
    OrgPendingDeletionError,
)

MIDDLEWARE = "backend.graphene.middleware"


def _info(authenticated=True):
    info = MagicMock()
    info.context = SimpleNamespace(
        user=MagicMock(is_authenticated=authenticated), session={}
    )
    return info


def _next(root, info, **kwargs):
    return "resolved"


@pytest.fixture
def resolve_org():
    with patch(
        f"{MIDDLEWARE}.OrgSSOEnforcementMiddleware._resolve_org_id",
        return_value="org-1",
    ) as resolver:
        yield resolver


class TestOrgDeletionLockMiddleware:
    def test_locked_org_is_refused(self, resolve_org):
        with patch(f"{MIDDLEWARE}.organisation_is_locked", return_value=True):
            with pytest.raises(OrgPendingDeletionError) as error:
                OrgDeletionLockMiddleware().resolve(
                    _next, None, _info(), organisation_id="org-1"
                )

        assert error.value.extensions["code"] == "ORG_PENDING_DELETION"
        assert error.value.extensions["organisation_id"] == "org-1"

    def test_unlocked_org_resolves(self, resolve_org):
        with patch(f"{MIDDLEWARE}.organisation_is_locked", return_value=False):
            result = OrgDeletionLockMiddleware().resolve(
                _next, None, _info(), organisation_id="org-1"
            )

        assert result == "resolved"

    def test_restore_bypasses_the_lock(self, resolve_org):
        restore_type = type("Restore", (), {"bypass_org_deletion_lock": True})
        with patch(f"{MIDDLEWARE}.organisation_is_locked", return_value=True), patch(
            f"{MIDDLEWARE}._output_graphene_type", return_value=restore_type
        ):
            result = OrgDeletionLockMiddleware().resolve(
                _next, None, _info(), organisation_id="org-1"
            )

        assert result == "resolved"

    def test_resolvers_without_an_org_are_untouched(self, resolve_org):
        resolve_org.return_value = None
        with patch(f"{MIDDLEWARE}.organisation_is_locked") as is_locked:
            result = OrgDeletionLockMiddleware().resolve(_next, None, _info())

        assert result == "resolved"
        is_locked.assert_not_called()

    def test_anonymous_requests_are_untouched(self, resolve_org):
        with patch(f"{MIDDLEWARE}.organisation_is_locked") as is_locked:
            result = OrgDeletionLockMiddleware().resolve(
                _next, None, _info(authenticated=False), organisation_id="org-1"
            )

        assert result == "resolved"
        is_locked.assert_not_called()

    def test_lock_state_is_looked_up_once_per_request(self, resolve_org):
        info = _info()
        with patch(
            f"{MIDDLEWARE}.organisation_is_locked", return_value=False
        ) as is_locked:
            for _ in range(3):
                OrgDeletionLockMiddleware().resolve(
                    _next, None, info, organisation_id="org-1"
                )

        is_locked.assert_called_once_with("org-1")


class TestLockChecksEveryOrgARequestNames:
    """The shared resolver stops at the first org it finds. A bulk mutation can
    name a locked org's objects after another org's, or only by bare `id`s
    inside input objects."""

    def _resolve(self, first_org, locked="org-locked", **kwargs):
        with patch(
            f"{MIDDLEWARE}.OrgSSOEnforcementMiddleware._resolve_org_id",
            return_value=first_org,
        ), patch(
            f"{MIDDLEWARE}.organisation_is_locked",
            side_effect=lambda org_id: org_id == locked,
        ):
            return OrgDeletionLockMiddleware().resolve(_next, None, _info(), **kwargs)

    def test_every_id_in_a_list_is_checked(self):
        with patch(f"{MIDDLEWARE}._model_for_mutation", return_value="Secret"), patch(
            f"{MIDDLEWARE}.resolve_org_ids_via_model",
            return_value={"org-open", "org-locked"},
        ) as resolve:
            with pytest.raises(OrgPendingDeletionError) as error:
                self._resolve("org-open", ids=["secret-open", "secret-locked"])

        assert error.value.extensions["organisation_id"] == "org-locked"
        assert resolve.call_args[0][:2] == ("Secret", ["secret-open", "secret-locked"])

    def test_bare_ids_inside_input_objects_are_checked(self):
        with patch(f"{MIDDLEWARE}._model_for_mutation", return_value="Secret"), patch(
            f"{MIDDLEWARE}.resolve_via_model", return_value="org-locked"
        ) as resolve:
            with pytest.raises(OrgPendingDeletionError):
                self._resolve(None, secrets_data=[{"id": "secret-1", "key": "KEY"}])

        assert resolve.call_args[0][:2] == ("Secret", "secret-1")

    def test_every_item_of_an_input_list_is_checked(self):
        with patch(
            f"{MIDDLEWARE}.resolve_org_ids_via_model",
            return_value={"org-open", "org-locked"},
        ) as resolve:
            with pytest.raises(OrgPendingDeletionError):
                self._resolve(
                    "org-open",
                    secrets_data=[{"env_id": "env-open"}, {"env_id": "env-locked"}],
                )

        assert resolve.call_args[0][:2] == ("Environment", ["env-open", "env-locked"])

    def test_policy_inputs_are_checked(self):
        with patch(
            f"{MIDDLEWARE}._model_for_mutation", return_value="NetworkAccessPolicy"
        ), patch(f"{MIDDLEWARE}.resolve_via_model", return_value="org-locked"):
            with pytest.raises(OrgPendingDeletionError):
                self._resolve(None, policy_inputs=[{"id": "policy-1", "name": "VPN"}])

    def test_argument_names_the_shared_resolver_misses(self):
        with patch(
            f"{MIDDLEWARE}.resolve_via_model", return_value="org-locked"
        ) as resolve:
            with pytest.raises(OrgPendingDeletionError):
                self._resolve(None, folder_id="folder-1")

        assert resolve.call_args[0][:2] == ("SecretFolder", "folder-1")

    def test_an_id_the_shared_lookup_cannot_resolve_is_looked_up_again(self):
        # The shared lookup reaches a rotating secret's org through its root
        # credentials, which can be deleted.
        with patch(f"{MIDDLEWARE}.resolve_org_id", return_value=None), patch(
            f"{MIDDLEWARE}.resolve_org_ids_via_model", return_value={"org-locked"}
        ) as resolve:
            with pytest.raises(OrgPendingDeletionError):
                self._resolve(None, rotating_secret_id="rotating-1")

        assert resolve.call_args[0][:2] == ("RotatingSecret", ["rotating-1"])

    def test_requests_naming_only_unlocked_orgs_resolve(self):
        with patch(f"{MIDDLEWARE}._model_for_mutation", return_value="Secret"), patch(
            f"{MIDDLEWARE}.resolve_org_ids_via_model",
            return_value={"org-open", "org-other"},
        ):
            result = self._resolve("org-open", ids=["secret-1", "secret-2"])

        assert result == "resolved"


class TestTokenAuthentication:
    def test_tokens_of_a_locked_org_are_refused(self):
        from api.auth import PhaseTokenAuthentication

        request = APIRequestFactory().get(
            "/v1/secrets/", HTTP_AUTHORIZATION="Bearer User test-token"
        )
        locked_org = MagicMock(deleted_at=timezone.now())

        with patch("api.auth.get_token_type", return_value="User"), patch(
            "api.auth.token_is_expired_or_deleted", return_value=False
        ), patch("api.auth._resolve_caller_org", return_value=locked_org):
            with pytest.raises(
                exceptions.PermissionDenied, match="scheduled for deletion"
            ):
                PhaseTokenAuthentication().authenticate(request)


class TestLookupsSkipLockedOrgs:
    def test_external_identity_lookup_excludes_locked_orgs(self):
        from api.utils.identity.common import resolve_service_account

        with patch("api.models.ServiceAccount.objects") as objects:
            resolve_service_account("sa-1")

        objects.get.assert_called_once_with(
            id="sa-1", deleted_at=None, organisation__deleted_at__isnull=True
        )

    def test_scim_token_lookup_excludes_locked_orgs(self):
        from ee.authentication.scim.auth import SCIMTokenAuthentication

        request = MagicMock()
        request.headers = {"Authorization": "Bearer ph_scim:v1:abcd:token"}

        with patch("ee.authentication.scim.auth.SCIMToken") as token_model:
            token_model.DoesNotExist = type("DoesNotExist", (Exception,), {})
            token_model.objects.select_related.return_value.get.side_effect = (
                token_model.DoesNotExist
            )
            with pytest.raises(exceptions.AuthenticationFailed):
                SCIMTokenAuthentication().authenticate(request)

        lookup = token_model.objects.select_related.return_value.get.call_args.kwargs
        assert lookup["organisation__deleted_at__isnull"] is True


class TestRotationsPauseWhileLocked:
    @pytest.fixture
    def engine(self):
        from ee.integrations.secrets.rotation import engine

        model = MagicMock()
        model.objects.select_for_update.return_value.get.return_value = MagicMock(
            is_active=True
        )
        with patch.object(engine.apps, "get_model", return_value=model), patch.object(
            engine, "transaction"
        ), patch.object(engine, "_mint_once") as mint, patch.object(
            engine, "_retire_prior_credential"
        ), patch.object(
            engine, "record_event"
        ), patch.object(
            engine, "_set_health"
        ), patch.object(
            engine, "_schedule_next_rotation"
        ) as schedule:
            yield SimpleNamespace(module=engine, mint=mint, schedule=schedule)

    @pytest.mark.parametrize("locked", [True, False])
    def test_rotates_only_while_unlocked(self, engine, locked):
        with patch.object(engine.module, "organisation_is_locked", return_value=locked):
            engine.module.perform_rotation("rs-1")

        assert engine.mint.called is not locked
        assert engine.schedule.called is not locked

    @pytest.mark.parametrize(
        "next_in, expected_delay",
        [
            (timedelta(minutes=10), timedelta(minutes=10)),
            (-timedelta(days=2), timedelta(0)),
            (None, None),
        ],
        ids=["due-later", "overdue", "never-scheduled"],
    )
    def test_reschedule_keeps_the_stored_time_or_rotates_now(
        self, next_in, expected_delay
    ):
        from ee.integrations.secrets.rotation import engine

        now = timezone.now()
        rotating_secret = MagicMock(
            next_rotation_at=None if next_in is None else now + next_in
        )
        with patch.object(engine.timezone, "now", return_value=now), patch.object(
            engine, "_schedule_next_rotation"
        ) as schedule:
            engine.reschedule(rotating_secret)

        schedule.assert_called_once_with(rotating_secret, delay=expected_delay)

    def test_reschedule_rotates_now_when_a_blocked_purge_revoked_the_credential(
        self,
    ):
        from ee.integrations.secrets.rotation import engine

        now = timezone.now()
        rotating_secret = MagicMock(next_rotation_at=now + timedelta(days=20))
        rotating_secret.credentials.filter.return_value.exists.return_value = False
        with patch.object(engine.timezone, "now", return_value=now), patch.object(
            engine, "_schedule_next_rotation"
        ) as schedule:
            engine.reschedule(rotating_secret)

        rotating_secret.credentials.filter.assert_called_once_with(status="active")
        schedule.assert_called_once_with(rotating_secret, delay=timedelta(0))


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
        ):
            yield SimpleNamespace(module=syncing, event=event)

    def test_locked_org_skips_the_sync_job(self, syncing):
        env_sync, sync_function = MagicMock(), MagicMock()
        with patch.object(syncing.module, "organisation_is_locked", return_value=True):
            syncing.module.handle_sync_event(env_sync, sync_function)

        sync_function.assert_not_called()
        assert env_sync.status == "cancelled"
        assert syncing.event.status == "cancelled"

    def test_unlocked_org_runs_the_sync_job(self, syncing):
        env_sync, sync_function = MagicMock(), MagicMock(return_value=(True, {}))
        with patch.object(
            syncing.module, "organisation_is_locked", return_value=False
        ), patch.object(syncing.module, "get_environment_secrets", return_value=[]):
            syncing.module.handle_sync_event(env_sync, sync_function)

        sync_function.assert_called_once()
        assert env_sync.status == "completed"

    def test_locked_org_queues_no_sync(self, syncing):
        env_sync = MagicMock(service="hashicorp_vault")
        with patch.object(
            syncing.module, "organisation_is_locked", return_value=True
        ), patch.object(syncing.module, "cancel_sync_tasks") as cancel, patch.object(
            syncing.module, "perform_vault_sync"
        ) as vault_sync:
            syncing.module.trigger_sync_tasks(env_sync)

        vault_sync.delay.assert_not_called()
        cancel.assert_not_called()
        assert env_sync.status == "cancelled"
