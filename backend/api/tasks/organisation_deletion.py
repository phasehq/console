"""Background jobs for organisation deletion.

A deletion request locks the organisation (``Organisation.deleted_at``) and
enqueues ``handle_deletion_requested``. Rotations and syncs pause while it is
locked. An hourly sweep enqueues ``purge_organisation`` on the maintenance
queue once the grace period has ended. The purge revokes live provider credentials, stops background jobs
and billing, then deletes the organisation and everything under it, along with
the SCIM-managed accounts that belong to no other organisation.
"""

import hashlib
import logging
from contextlib import contextmanager
from datetime import timedelta

import django_rq
from django.apps import apps
from django.conf import settings
from django.db import connection, transaction
from django.db.models import Exists, OuterRef
from django.utils import timezone

from api.tasks.purge import (
    PurgeBlockedError,
    delete_environment_secret_events,
    delete_with_cascade,
    enqueue_purges,
    notify as _notify,
    owner_recipients as _owner_recipients,
    revoke_dynamic_secret_leases,
    revoke_rotating_secret_credentials,
    stop_syncs,
)
from api.utils.access.roles import OWNER_ROLE_KEY
from api.utils.organisation_deletion import GRACE_PERIOD, deletion_scheduled_for

logger = logging.getLogger(__name__)

# NOTE: rq 2.x forbids ":" in job ids.
SWEEP_JOB_ID = "organisation-deletion-sweep"
SWEEP_INTERVAL_SECONDS = 60 * 60
PURGE_JOB_TIMEOUT = 6 * 60 * 60


def _environments_of(organisation):
    return {"app__organisation": organisation}


def _is_cloud():
    return settings.APP_HOST == "cloud"


def _get_organisation(organisation_id):
    Organisation = apps.get_model("api", "Organisation")
    return Organisation.objects.filter(id=organisation_id).first()


def _label(organisation):
    return f"{organisation.name} ({organisation.id})"


def enqueue_deletion_requested(organisation_id):
    django_rq.get_queue("default").enqueue(handle_deletion_requested, organisation_id)


def enqueue_organisation_restored(organisation_id):
    django_rq.get_queue("default").enqueue(
        handle_organisation_restored, organisation_id
    )


@contextmanager
def _billing_lock(organisation_id):
    """Run an org's deletion and restore billing steps one at a time. Default
    workers run jobs in parallel, so a quick restore could otherwise read Stripe
    before the deletion job's cancellation lands, and miss it. Each step
    re-reads the org inside the lock, so the last one matches its final state."""
    digest = hashlib.sha256(f"org-deletion-billing:{organisation_id}".encode()).digest()
    with transaction.atomic():
        with connection.cursor() as cursor:
            # Held until the transaction ends.
            cursor.execute(
                "SELECT pg_advisory_xact_lock(%s)",
                [int.from_bytes(digest[:8], "big", signed=True)],
            )
        yield


def handle_deletion_requested(organisation_id):
    organisation = _get_organisation(organisation_id)
    if organisation is None or organisation.deleted_at is None:
        return  # restored before this job ran

    purge_after = deletion_scheduled_for(organisation)
    _notify(
        f"Organisation {_label(organisation)} is scheduled for deletion on "
        f"{purge_after:%Y-%m-%d %H:%M} UTC"
    )

    if _is_cloud():
        from ee.billing.stripe import cancel_paid_subscriptions_at_period_end

        with _billing_lock(organisation_id):
            organisation = _get_organisation(organisation_id)
            if organisation is None or organisation.deleted_at is None:
                return  # restored while this job ran

            try:
                cancel_paid_subscriptions_at_period_end(organisation)
            except Exception as e:
                _notify(
                    f"Failed to cancel Stripe subscriptions for organisation "
                    f"{_label(organisation)} pending deletion: {e}"
                )
                raise


def handle_organisation_restored(organisation_id):
    organisation = _get_organisation(organisation_id)
    if organisation is None or organisation.deleted_at is not None:
        return  # deleted again before this job ran

    _notify(f"Organisation {_label(organisation)} was restored")
    _resume_rotations(organisation)
    _resume_syncs(organisation)

    if _is_cloud():
        from ee.billing.stripe import resume_subscriptions_cancelled_for_deletion

        with _billing_lock(organisation_id):
            organisation = _get_organisation(organisation_id)
            if organisation is None or organisation.deleted_at is not None:
                return  # deleted again while this job ran

            try:
                ended = resume_subscriptions_cancelled_for_deletion(organisation)
            except Exception as e:
                _notify(
                    f"Failed to resume Stripe subscriptions for restored organisation "
                    f"{_label(organisation)}: {e}"
                )
                raise

            if ended:
                _notify(
                    f"Organisation {_label(organisation)} was restored, but its "
                    f"subscription ended while it was pending deletion "
                    f"({', '.join(ended)}). The owner needs to subscribe again."
                )


def _resume_rotations(organisation):
    """Re-arm rotations skipped while the org was locked. Paused secrets stay
    paused."""
    RotatingSecret = apps.get_model("api", "RotatingSecret")
    from ee.integrations.secrets.rotation.engine import reschedule

    for rotating_secret in RotatingSecret.objects.filter(
        environment__app__organisation=organisation,
        environment__deleted_at__isnull=True,
        environment__app__deleted_at__isnull=True,
        is_active=True,
        deleted_at__isnull=True,
    ):
        reschedule(rotating_secret)


def _resume_syncs(organisation):
    """Re-run the syncs skipped while the org was locked."""
    EnvironmentSync = apps.get_model("api", "EnvironmentSync")
    from api.tasks.syncing import trigger_sync_tasks

    for env_sync in EnvironmentSync.objects.filter(
        environment__app__organisation=organisation,
        environment__deleted_at__isnull=True,
        environment__app__deleted_at__isnull=True,
        is_active=True,
        deleted_at__isnull=True,
        status=EnvironmentSync.CANCELLED,
    ):
        trigger_sync_tasks(env_sync)


def init_organisation_deletion_sweeper():
    scheduler = django_rq.get_scheduler("scheduled-jobs")

    try:
        scheduler.cancel(SWEEP_JOB_ID)
    except Exception:
        logger.debug("No existing organisation deletion sweep to cancel", exc_info=True)

    scheduler.schedule(
        scheduled_time=timezone.now() + timedelta(seconds=30),
        func=sweep_organisation_deletions,
        interval=SWEEP_INTERVAL_SECONDS,
        repeat=None,
        # Never expire the job hash; see init_log_stream_sweeper.
        result_ttl=-1,
        id=SWEEP_JOB_ID,
    )
    logger.info(
        "Organisation deletion sweeper scheduled every %ss (job id %s)",
        SWEEP_INTERVAL_SECONDS,
        SWEEP_JOB_ID,
    )


def sweep_organisation_deletions():
    """Enqueue a purge for every organisation whose grace period has ended."""
    Organisation = apps.get_model("api", "Organisation")

    due = Organisation.objects.filter(
        deleted_at__lte=timezone.now() - GRACE_PERIOD
    ).values_list("id", flat=True)

    enqueue_purges(purge_organisation, "purge-organisation", due, PURGE_JOB_TIMEOUT)


def _purge_due(organisation):
    return (
        organisation.deleted_at is not None
        and organisation.deleted_at <= timezone.now() - GRACE_PERIOD
    )


def _revoke_dynamic_secret_leases(organisation):
    revoke_dynamic_secret_leases(_environments_of(organisation))


def _revoke_rotating_secret_credentials(organisation):
    revoke_rotating_secret_credentials(_environments_of(organisation))


def _stop_background_jobs(organisation):
    LogStream = apps.get_model("api", "LogStream")
    from ee.integrations.logs.streams.engine import cancel_ship_job

    stop_syncs(_environments_of(organisation))

    # Inactive streams are skipped by the sweeper, so no new ship jobs start.
    streams = LogStream.objects.filter(organisation=organisation)
    streams.update(is_active=False)
    for stream in streams:
        cancel_ship_job(stream)


def _delete_secret_events(organisation):
    return delete_environment_secret_events(_environments_of(organisation))


def _delete_organisation(organisation):
    delete_with_cascade(organisation)


def _scim_only_accounts(organisation):
    """Accounts SCIM manages in this org with no membership anywhere else, not
    even a removed one, so deleting them can't cascade into another org's data
    (its secret logs above all). The org's owners are kept: they asked for the
    deletion."""
    CustomUser = apps.get_model("api", "CustomUser")
    OrganisationMember = apps.get_model("api", "OrganisationMember")
    SCIMUser = apps.get_model("api", "SCIMUser")

    owners = OrganisationMember.objects.filter(
        organisation=organisation,
        role__is_default=True,
        role__managed_key=OWNER_ROLE_KEY,
        deleted_at=None,
    ).values("user_id")
    other_memberships = OrganisationMember.objects.filter(user=OuterRef("pk")).exclude(
        organisation=organisation
    )

    return list(
        CustomUser.objects.filter(
            pk__in=SCIMUser.objects.filter(
                organisation=organisation, user__isnull=False
            ).values("user_id"),
            is_staff=False,
            is_superuser=False,
        )
        .exclude(pk__in=owners)
        .exclude(Exists(other_memberships))
        .values_list("pk", flat=True)
    )


def _delete_accounts(user_ids):
    """Delete the accounts, except any that joined an org meanwhile. Runs after
    the org is gone, one transaction per account, so a failure can't undo or
    block the purge. Returns (deleted, failed)."""
    CustomUser = apps.get_model("api", "CustomUser")
    OrganisationMember = apps.get_model("api", "OrganisationMember")

    accounts = CustomUser.objects.filter(pk__in=user_ids).exclude(
        Exists(OrganisationMember.objects.filter(user=OuterRef("pk")))
    )
    deleted = failed = 0
    for account in accounts:
        try:
            with transaction.atomic():
                account.delete()
            deleted += 1
        except Exception:
            logger.exception("Failed to delete SCIM-managed account %s", account.pk)
            failed += 1
    return deleted, failed


def _claim_for_purge(organisation_id):
    """The steps after the revokes stop syncs, cancel billing and delete data.
    The owner can restore an org whose purge is blocked, so clear the block
    first, unless the org was restored meanwhile. Restore refuses an org past
    its grace period once the block is cleared."""
    Organisation = apps.get_model("api", "Organisation")
    return bool(
        Organisation.objects.filter(
            id=organisation_id, deleted_at__lte=timezone.now() - GRACE_PERIOD
        ).update(purge_blocked_at=None)
    )


def _email_owners_purge_blocked(organisation, recipients):
    """Tell the owners, once per deletion, that a credential that can't be
    revoked holds up the purge. Later sweeps retry without emailing again, and
    an org restored meanwhile isn't marked."""
    Organisation = apps.get_model("api", "Organisation")
    try:
        first = Organisation.objects.filter(
            id=organisation.id,
            deleted_at__lte=timezone.now() - GRACE_PERIOD,
            purge_blocked_at__isnull=True,
        ).update(purge_blocked_at=timezone.now())
    except Exception:
        logger.exception("Failed to record the blocked purge of %s", organisation.id)
        return
    if not first:
        return

    from api.emails import send_organisation_deletion_delayed_email

    for email, display_name in recipients:
        try:
            send_organisation_deletion_delayed_email(
                email, display_name, organisation.name
            )
        except Exception:
            logger.exception("Failed to send deletion delayed email to %s", email)


def purge_organisation(organisation_id):
    """Permanently delete an organisation whose grace period has ended."""
    organisation = _get_organisation(organisation_id)
    if organisation is None or not _purge_due(organisation):
        return  # already purged, restored, or not due yet

    label = _label(organisation)
    name = organisation.name
    recipients = _owner_recipients(organisation)

    try:
        _revoke_dynamic_secret_leases(organisation)
        _revoke_rotating_secret_credentials(organisation)
        if not _claim_for_purge(organisation_id):
            return  # restored while the credentials were being revoked
        scim_accounts = _scim_only_accounts(organisation)
        _stop_background_jobs(organisation)
        if _is_cloud():
            from ee.billing.stripe import cancel_all_subscriptions

            cancel_all_subscriptions(organisation)
    except Exception as e:
        _notify(
            f"Deletion of organisation {label} is blocked and will retry on the "
            f"next sweep: {e}"
        )
        if isinstance(e, PurgeBlockedError):
            _email_owners_purge_blocked(organisation, recipients)
        raise

    if not _delete_secret_events(organisation):
        logger.info(
            "Purge of organisation %s hit its time budget; the next sweep continues",
            label,
        )
        return

    Organisation = apps.get_model("api", "Organisation")
    with transaction.atomic():
        organisation = (
            Organisation.objects.select_for_update().filter(id=organisation_id).first()
        )
        if organisation is None or not _purge_due(organisation):
            return
        _delete_organisation(organisation)

    deleted_accounts, failed_accounts = _delete_accounts(scim_accounts)

    from backend.graphene.middleware import OrgSSOEnforcementMiddleware

    OrgSSOEnforcementMiddleware.invalidate_decision(organisation_id)

    message = f"Organisation {label} was permanently deleted"
    if deleted_accounts:
        message += f", with {deleted_accounts} SCIM-managed account(s)"
    if failed_accounts:
        message += f". {failed_accounts} SCIM-managed account(s) could not be deleted"
    _notify(message)

    from api.emails import send_organisation_deleted_email

    for email, display_name in recipients:
        try:
            send_organisation_deleted_email(email, display_name, name)
        except Exception:
            logger.exception("Failed to send organisation deleted email to %s", email)
