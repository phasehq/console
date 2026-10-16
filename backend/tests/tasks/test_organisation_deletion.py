"""Tests for the organisation deletion jobs: request and restore handlers, the
sweep, and the purge."""

from datetime import timedelta
from unittest.mock import MagicMock, patch

import pytest
from django.utils import timezone
from rq.exceptions import NoSuchJobError

from api.tasks import organisation_deletion as jobs
from api.utils.organisation_deletion import GRACE_PERIOD


def _org(deleted_ago=None):
    org = MagicMock()
    org.id = "org-1"
    org.name = "Acme"
    org.deleted_at = None if deleted_ago is None else timezone.now() - deleted_ago
    return org


def _models(**models):
    real_get_model = jobs.apps.get_model

    def get_model(app_label, name):
        if name in models:
            return models[name]
        return real_get_model(app_label, name)

    return patch.object(jobs.apps, "get_model", side_effect=get_model)


@pytest.fixture
def notify():
    with patch.object(jobs, "_notify") as notify:
        yield notify


# ---------------------------------------------------------------------------
# Request / restore handlers
# ---------------------------------------------------------------------------


class TestDeletionRequested:
    def test_skips_an_org_restored_before_the_job_ran(self, notify):
        with patch.object(jobs, "_get_organisation", return_value=_org()), patch(
            "ee.billing.stripe.cancel_paid_subscriptions_at_period_end"
        ) as cancel:
            jobs.handle_deletion_requested("org-1")

        notify.assert_not_called()
        cancel.assert_not_called()

    def test_cancels_paid_subscriptions_at_period_end_on_cloud(self, notify):
        org = _org(deleted_ago=timedelta(minutes=1))
        with patch.object(jobs, "_get_organisation", return_value=org), patch.object(
            jobs, "_is_cloud", return_value=True
        ), patch("ee.billing.stripe.cancel_paid_subscriptions_at_period_end") as cancel:
            jobs.handle_deletion_requested("org-1")

        cancel.assert_called_once_with(org)
        assert "scheduled for deletion" in notify.call_args[0][0]

    def test_self_hosted_has_no_billing_step(self, notify):
        org = _org(deleted_ago=timedelta(minutes=1))
        with patch.object(jobs, "_get_organisation", return_value=org), patch.object(
            jobs, "_is_cloud", return_value=False
        ), patch("ee.billing.stripe.cancel_paid_subscriptions_at_period_end") as cancel:
            jobs.handle_deletion_requested("org-1")

        cancel.assert_not_called()

    def test_stripe_failure_alerts_and_raises(self, notify):
        org = _org(deleted_ago=timedelta(minutes=1))
        with patch.object(jobs, "_get_organisation", return_value=org), patch.object(
            jobs, "_is_cloud", return_value=True
        ), patch(
            "ee.billing.stripe.cancel_paid_subscriptions_at_period_end",
            side_effect=RuntimeError("stripe down"),
        ):
            with pytest.raises(RuntimeError):
                jobs.handle_deletion_requested("org-1")

        assert "stripe down" in notify.call_args[0][0]


@pytest.fixture
def resume_work():
    with patch.object(jobs, "_resume_rotations") as rotations, patch.object(
        jobs, "_resume_syncs"
    ) as syncs:
        yield MagicMock(rotations=rotations, syncs=syncs)


class TestOrganisationRestored:
    def test_resumes_subscriptions_on_cloud(self, notify, resume_work):
        org = _org()
        with patch.object(jobs, "_get_organisation", return_value=org), patch.object(
            jobs, "_is_cloud", return_value=True
        ), patch(
            "ee.billing.stripe.resume_subscriptions_cancelled_for_deletion"
        ) as resume:
            jobs.handle_organisation_restored("org-1")

        resume.assert_called_once_with(org)
        assert "restored" in notify.call_args[0][0]

    def test_resumes_rotations_and_syncs(self, notify, resume_work):
        org = _org()
        with patch.object(jobs, "_get_organisation", return_value=org), patch.object(
            jobs, "_is_cloud", return_value=False
        ):
            jobs.handle_organisation_restored("org-1")

        resume_work.rotations.assert_called_once_with(org)
        resume_work.syncs.assert_called_once_with(org)

    def test_skips_an_org_deleted_again_before_the_job_ran(self, notify, resume_work):
        org = _org(deleted_ago=timedelta(minutes=1))
        with patch.object(jobs, "_get_organisation", return_value=org), patch(
            "ee.billing.stripe.resume_subscriptions_cancelled_for_deletion"
        ) as resume:
            jobs.handle_organisation_restored("org-1")

        resume.assert_not_called()
        notify.assert_not_called()
        resume_work.rotations.assert_not_called()


class TestResumeAfterRestore:
    def test_rearms_active_rotating_secrets(self):
        model = MagicMock()
        model.objects.filter.return_value = [MagicMock(), MagicMock()]
        with _models(RotatingSecret=model), patch(
            "ee.integrations.secrets.rotation.engine.reschedule"
        ) as reschedule:
            jobs._resume_rotations(_org())

        assert reschedule.call_count == 2
        assert model.objects.filter.call_args.kwargs["is_active"] is True

    def test_reruns_syncs_skipped_while_locked(self):
        model = MagicMock(CANCELLED="cancelled")
        skipped = MagicMock()
        model.objects.filter.return_value = [skipped]
        with _models(EnvironmentSync=model), patch(
            "api.tasks.syncing.trigger_sync_tasks"
        ) as trigger:
            jobs._resume_syncs(_org())

        trigger.assert_called_once_with(skipped)
        assert model.objects.filter.call_args.kwargs["status"] == "cancelled"


# ---------------------------------------------------------------------------
# Sweep
# ---------------------------------------------------------------------------


class TestSweep:
    def test_enqueues_a_purge_for_each_due_org_once(self):
        organisation = MagicMock()
        organisation.objects.filter.return_value.values_list.return_value = [
            "org-due",
            "org-running",
        ]
        queue = MagicMock()
        running_job = MagicMock(is_queued=False, is_started=True)

        def fetch(job_id, connection):
            if job_id == "purge-organisation-org-running":
                return running_job
            raise NoSuchJobError()

        with _models(Organisation=organisation), patch.object(
            jobs.django_rq, "get_queue", return_value=queue
        ), patch.object(jobs.Job, "fetch", side_effect=fetch):
            jobs.sweep_organisation_deletions()

        cutoff = organisation.objects.filter.call_args.kwargs["deleted_at__lte"]
        assert abs(cutoff - (timezone.now() - GRACE_PERIOD)) < timedelta(seconds=5)

        queue.enqueue.assert_called_once_with(
            jobs.purge_organisation,
            "org-due",
            job_id="purge-organisation-org-due",
            job_timeout=jobs.PURGE_JOB_TIMEOUT,
        )


# ---------------------------------------------------------------------------
# Purge
# ---------------------------------------------------------------------------

DUE = GRACE_PERIOD + timedelta(hours=1)


@pytest.fixture
def purge_steps():
    with patch.object(jobs, "_revoke_dynamic_secret_leases") as leases, patch.object(
        jobs, "_revoke_rotating_secret_credentials"
    ) as rotating, patch.object(jobs, "_stop_background_jobs") as stop, patch.object(
        jobs, "_delete_secret_events"
    ) as events, patch.object(
        jobs, "_owner_recipients", return_value=[("owner@acme.test", "Owner")]
    ), patch.object(
        jobs, "_count_unrevokable_credentials", return_value=0
    ) as unrevokable, patch.object(
        jobs, "_scim_only_accounts", return_value=["user-1"]
    ) as scim_accounts, patch.object(
        jobs, "_revoke_account_leases"
    ) as account_leases, patch.object(
        jobs, "_delete_accounts", return_value=(1, 0)
    ) as delete_accounts, patch.object(
        jobs, "transaction"
    ), patch(
        "ee.billing.stripe.cancel_all_subscriptions"
    ) as cancel_billing, patch(
        "api.emails.send_organisation_deleted_email"
    ) as email, patch(
        "backend.graphene.middleware.OrgSSOEnforcementMiddleware.invalidate_decision"
    ):
        yield MagicMock(
            leases=leases,
            rotating=rotating,
            stop=stop,
            events=events,
            unrevokable=unrevokable,
            scim_accounts=scim_accounts,
            account_leases=account_leases,
            delete_accounts=delete_accounts,
            cancel_billing=cancel_billing,
            email=email,
        )


def _locked_refetch(org):
    organisation = MagicMock()
    organisation.objects.select_for_update.return_value.filter.return_value.first.return_value = (
        org
    )
    return _models(Organisation=organisation)


class TestPurge:
    @pytest.mark.parametrize(
        "org",
        [None, _org(), _org(deleted_ago=timedelta(days=3))],
        ids=["already-purged", "restored", "not-due"],
    )
    def test_does_nothing_unless_due(self, org, purge_steps, notify):
        with patch.object(jobs, "_get_organisation", return_value=org):
            jobs.purge_organisation("org-1")

        purge_steps.leases.assert_not_called()
        purge_steps.events.assert_not_called()
        notify.assert_not_called()

    def test_deletes_the_org_after_external_cleanup(self, purge_steps, notify):
        org = _org(deleted_ago=DUE)
        with patch.object(jobs, "_get_organisation", return_value=org), patch.object(
            jobs, "_is_cloud", return_value=True
        ), _locked_refetch(org):
            jobs.purge_organisation("org-1")

        purge_steps.leases.assert_called_once_with(org)
        purge_steps.rotating.assert_called_once_with(org)
        purge_steps.stop.assert_called_once_with(org)
        purge_steps.cancel_billing.assert_called_once_with(org)
        purge_steps.events.assert_called_once_with(org)
        org.delete.assert_called_once()
        purge_steps.account_leases.assert_called_once_with(["user-1"])
        purge_steps.delete_accounts.assert_called_once_with(["user-1"])

        assert "permanently deleted" in notify.call_args[0][0]
        assert "1 SCIM-managed account(s)" in notify.call_args[0][0]
        purge_steps.email.assert_called_once_with("owner@acme.test", "Owner", "Acme")

    def test_reports_accounts_that_could_not_be_deleted(self, purge_steps, notify):
        org = _org(deleted_ago=DUE)
        purge_steps.delete_accounts.return_value = (1, 2)
        with patch.object(jobs, "_get_organisation", return_value=org), patch.object(
            jobs, "_is_cloud", return_value=False
        ), _locked_refetch(org):
            jobs.purge_organisation("org-1")

        org.delete.assert_called_once()
        assert (
            "2 SCIM-managed account(s) could not be deleted" in notify.call_args[0][0]
        )

    def test_self_hosted_purge_skips_billing(self, purge_steps, notify):
        org = _org(deleted_ago=DUE)
        with patch.object(jobs, "_get_organisation", return_value=org), patch.object(
            jobs, "_is_cloud", return_value=False
        ), _locked_refetch(org):
            jobs.purge_organisation("org-1")

        purge_steps.cancel_billing.assert_not_called()
        org.delete.assert_called_once()

    def test_unrevoked_credentials_block_the_purge(self, purge_steps, notify):
        org = _org(deleted_ago=DUE)
        purge_steps.leases.side_effect = jobs.PurgeBlockedError(
            "could not revoke 1 dynamic secret lease(s)"
        )
        with patch.object(jobs, "_get_organisation", return_value=org):
            with pytest.raises(jobs.PurgeBlockedError):
                jobs.purge_organisation("org-1")

        assert "blocked" in notify.call_args[0][0]
        purge_steps.events.assert_not_called()
        org.delete.assert_not_called()
        purge_steps.delete_accounts.assert_not_called()
        purge_steps.email.assert_not_called()

    def test_reports_credentials_that_already_failed_to_revoke(
        self, purge_steps, notify
    ):
        org = _org(deleted_ago=DUE)
        purge_steps.unrevokable.return_value = 2
        with patch.object(jobs, "_get_organisation", return_value=org), patch.object(
            jobs, "_is_cloud", return_value=False
        ), _locked_refetch(org):
            jobs.purge_organisation("org-1")

        assert "2 rotating secret credential(s)" in notify.call_args[0][0]

    def test_restored_between_cleanup_and_delete_is_not_deleted(
        self, purge_steps, notify
    ):
        org = _org(deleted_ago=DUE)
        with patch.object(jobs, "_get_organisation", return_value=org), patch.object(
            jobs, "_is_cloud", return_value=False
        ), _locked_refetch(_org()):
            jobs.purge_organisation("org-1")

        org.delete.assert_not_called()
        purge_steps.delete_accounts.assert_not_called()
        purge_steps.email.assert_not_called()


# ---------------------------------------------------------------------------
# Purge steps
# ---------------------------------------------------------------------------


class TestRevokeDynamicSecretLeases:
    def test_revokes_every_active_lease_and_blocks_on_failure(self):
        lease_model = MagicMock()
        leases = [MagicMock(id="lease-1"), MagicMock(id="lease-2")]
        lease_model.objects.filter.return_value.select_related.return_value = leases

        with _models(DynamicSecretLease=lease_model), patch(
            "ee.integrations.secrets.dynamic.utils.revoke_lease_now",
            side_effect=[None, RuntimeError("aws down")],
        ) as revoke:
            with pytest.raises(jobs.PurgeBlockedError, match="1 dynamic secret"):
                jobs._revoke_dynamic_secret_leases(_org())

        assert revoke.call_count == 2
        assert lease_model.objects.filter.call_args.kwargs["status"] == (
            lease_model.ACTIVE
        )


class TestScimManagedAccounts:
    def test_revokes_leases_from_the_accounts_other_memberships(self):
        lease_model = MagicMock()
        lease_model.objects.filter.return_value.select_related.return_value = [
            MagicMock(id="lease-1")
        ]
        with _models(DynamicSecretLease=lease_model), patch(
            "ee.integrations.secrets.dynamic.utils.revoke_lease_now"
        ) as revoke:
            jobs._revoke_account_leases(["user-1"])

        revoke.assert_called_once()
        lookup = lease_model.objects.filter.call_args.kwargs
        assert lookup["organisation_member__user_id__in"] == ["user-1"]

    def test_one_failed_account_does_not_stop_the_others(self):
        user_model = MagicMock()
        stuck = MagicMock(pk="user-2")
        stuck.delete.side_effect = RuntimeError("protected")
        accounts = [MagicMock(pk="user-1"), stuck, MagicMock(pk="user-3")]
        user_model.objects.filter.return_value.exclude.return_value = accounts
        with _models(
            CustomUser=user_model, OrganisationMember=MagicMock()
        ), patch.object(jobs, "transaction"):
            assert jobs._delete_accounts(["user-1", "user-2", "user-3"]) == (2, 1)

        assert user_model.objects.filter.call_args.kwargs["pk__in"] == [
            "user-1",
            "user-2",
            "user-3",
        ]


class TestRevokeRotatingSecretCredentials:
    def _run(self, remaining):
        rotating_secret_model = MagicMock()
        rotating_secret_model.objects.filter.return_value = [MagicMock(), MagicMock()]
        credential_model = MagicMock()
        live = credential_model.objects.filter.return_value
        live.values_list.return_value = ["cred-1", "cred-2"]
        live.count.return_value = remaining

        with _models(
            RotatingSecret=rotating_secret_model,
            RotatingSecretCredential=credential_model,
        ), patch(
            "ee.integrations.secrets.rotation.engine.cancel_rotation_jobs"
        ) as cancel, patch(
            "ee.integrations.secrets.rotation.engine.revoke_credential"
        ) as revoke:
            jobs._revoke_rotating_secret_credentials(_org())

        assert cancel.call_count == 2
        revoke.assert_any_call("cred-1", immediate=True)
        revoke.assert_any_call("cred-2", immediate=True)

    def test_revokes_live_credentials(self):
        self._run(remaining=0)

    def test_blocks_while_any_credential_is_still_live(self):
        with pytest.raises(jobs.PurgeBlockedError, match="1 rotating secret"):
            self._run(remaining=1)


class TestDeleteSecretEvents:
    def test_deletes_events_and_tag_links_in_batches(self):
        environment_model = MagicMock()
        environment_model.objects.filter.return_value.values_list.return_value = [
            "env-1"
        ]
        secret_event_model = MagicMock()
        id_query = (
            secret_event_model.objects.filter.return_value.values_list.return_value
        )
        id_query.__getitem__.side_effect = [["event-1", "event-2"], []]
        tags_through = secret_event_model.tags.through

        with _models(Environment=environment_model, SecretEvent=secret_event_model):
            jobs._delete_secret_events(_org())

        tags_through.objects.filter.assert_called_once_with(
            secretevent_id__in=["event-1", "event-2"]
        )
        tags_through.objects.filter.return_value._raw_delete.assert_called_once_with(
            "default"
        )
        secret_event_model.objects.filter.assert_any_call(id__in=["event-1", "event-2"])
