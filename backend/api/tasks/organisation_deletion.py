"""Background jobs for organisation deletion.

A deletion request locks the organisation (``Organisation.deleted_at``) and
enqueues ``handle_deletion_requested``. Rotations and syncs pause while it is
locked. An hourly sweep enqueues ``purge_organisation`` once the grace period
has ended. The purge revokes live provider credentials, stops background jobs
and billing, then deletes the organisation and everything under it, along with
the SCIM-managed accounts that belong to no other organisation.
"""

import logging
from datetime import timedelta

import django_rq
from django.apps import apps
from django.conf import settings
from django.db import transaction
from django.db.models import Exists, OuterRef
from django.utils import timezone
from rq.exceptions import NoSuchJobError
from rq.job import Job

from api.utils.access.roles import OWNER_ROLE_KEY
from api.utils.organisation_deletion import GRACE_PERIOD, deletion_scheduled_for

logger = logging.getLogger(__name__)

# NOTE: rq 2.x forbids ":" in job ids.
SWEEP_JOB_ID = "organisation-deletion-sweep"
SWEEP_INTERVAL_SECONDS = 60 * 60
PURGE_JOB_TIMEOUT = 6 * 60 * 60
SECRET_EVENT_BATCH_SIZE = 5000


class PurgeBlockedError(Exception):
    """A live provider credential could not be revoked. The purge is retried on
    the next sweep rather than orphaning the credential."""


def _is_cloud():
    return settings.APP_HOST == "cloud"


def _notify(message):
    logger.info(message)
    if not _is_cloud():
        return

    from backend.api.notifier import notify_slack

    try:
        notify_slack(message)
    except Exception:
        logger.exception("Failed to send Slack notification")


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

        try:
            resume_subscriptions_cancelled_for_deletion(organisation)
        except Exception as e:
            _notify(
                f"Failed to resume Stripe subscriptions for restored organisation "
                f"{_label(organisation)}: {e}"
            )
            raise


def _resume_rotations(organisation):
    """Re-arm rotations skipped while the org was locked. Paused secrets stay
    paused."""
    RotatingSecret = apps.get_model("api", "RotatingSecret")
    from ee.integrations.secrets.rotation.engine import reschedule

    for rotating_secret in RotatingSecret.objects.filter(
        environment__app__organisation=organisation,
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


def sweep_organisation_deletions():
    """Enqueue a purge for every organisation whose grace period has ended."""
    Organisation = apps.get_model("api", "Organisation")
    queue = django_rq.get_queue("default")

    due = Organisation.objects.filter(
        deleted_at__lte=timezone.now() - GRACE_PERIOD
    ).values_list("id", flat=True)

    for organisation_id in due:
        job_id = f"purge-organisation-{organisation_id}"
        try:
            job = Job.fetch(job_id, connection=queue.connection)
            if job.is_queued or job.is_started:
                continue
        except NoSuchJobError:
            pass

        queue.enqueue(
            purge_organisation,
            organisation_id,
            job_id=job_id,
            job_timeout=PURGE_JOB_TIMEOUT,
        )


def _purge_due(organisation):
    return (
        organisation.deleted_at is not None
        and organisation.deleted_at <= timezone.now() - GRACE_PERIOD
    )


def _owner_recipients(organisation):
    OrganisationMember = apps.get_model("api", "OrganisationMember")
    from api.emails import get_user_display_name

    owners = OrganisationMember.objects.filter(
        organisation=organisation,
        role__is_default=True,
        role__managed_key=OWNER_ROLE_KEY,
        deleted_at=None,
    ).select_related("user")

    return [
        (member.user.email, get_user_display_name(member.user))
        for member in owners
        if member.user.email
    ]


def _revoke_dynamic_secret_leases(organisation):
    DynamicSecretLease = apps.get_model("api", "DynamicSecretLease")
    _revoke_leases(
        DynamicSecretLease.objects.filter(
            secret__environment__app__organisation=organisation,
            status=DynamicSecretLease.ACTIVE,
        )
    )


def _revoke_account_leases(user_ids):
    """Deleting an account cascades to memberships it was removed from in other
    orgs, so revoke their leases first (as DeleteAccountMutation does)."""
    DynamicSecretLease = apps.get_model("api", "DynamicSecretLease")
    _revoke_leases(
        DynamicSecretLease.objects.filter(
            organisation_member__user_id__in=user_ids,
            status=DynamicSecretLease.ACTIVE,
        )
    )


def _revoke_leases(leases):
    from ee.integrations.secrets.dynamic.utils import revoke_lease_now

    failed = 0
    for lease in leases.select_related("secret"):
        try:
            revoke_lease_now(lease)
        except Exception:
            logger.exception("Failed to revoke dynamic secret lease %s", lease.id)
            failed += 1

    if failed:
        raise PurgeBlockedError(f"could not revoke {failed} dynamic secret lease(s)")


def _revoke_rotating_secret_credentials(organisation):
    RotatingSecret = apps.get_model("api", "RotatingSecret")
    RotatingSecretCredential = apps.get_model("api", "RotatingSecretCredential")
    from ee.integrations.secrets.rotation.engine import (
        cancel_rotation_jobs,
        revoke_credential,
    )

    for rotating_secret in RotatingSecret.objects.filter(
        environment__app__organisation=organisation
    ):
        cancel_rotation_jobs(rotating_secret)

    # Same "live" set the rotation engine uses for break-glass revokes.
    live = RotatingSecretCredential.objects.filter(
        rotating_secret__environment__app__organisation=organisation,
        status__in=[
            RotatingSecretCredential.PENDING,
            RotatingSecretCredential.ACTIVE,
            RotatingSecretCredential.EXPIRING,
            RotatingSecretCredential.REVOKING,
        ],
    )

    for credential_id in list(live.values_list("id", flat=True)):
        try:
            revoke_credential(credential_id, immediate=True)
        except Exception:
            logger.exception(
                "Failed to revoke rotating secret credential %s", credential_id
            )

    remaining = live.count()
    if remaining:
        raise PurgeBlockedError(
            f"could not revoke {remaining} rotating secret credential(s)"
        )


def _stop_background_jobs(organisation):
    EnvironmentSync = apps.get_model("api", "EnvironmentSync")
    LogStream = apps.get_model("api", "LogStream")
    from api.tasks.syncing import cancel_sync_tasks
    from ee.integrations.logs.streams.engine import cancel_ship_job

    syncs = EnvironmentSync.objects.filter(environment__app__organisation=organisation)
    syncs.update(is_active=False)
    for sync in syncs:
        cancel_sync_tasks(sync)

    # Inactive streams are skipped by the sweeper, so no new ship jobs start.
    streams = LogStream.objects.filter(organisation=organisation)
    streams.update(is_active=False)
    for stream in streams:
        cancel_ship_job(stream)


def _delete_secret_events(organisation):
    """SecretEvent has an M2M, so the ORM cascade would load every row. Delete
    in batches first, as purge_app_logs does."""
    Environment = apps.get_model("api", "Environment")
    SecretEvent = apps.get_model("api", "SecretEvent")
    tags_through = SecretEvent.tags.through

    environment_ids = list(
        Environment.objects.filter(app__organisation=organisation).values_list(
            "id", flat=True
        )
    )
    for environment_id in environment_ids:
        while True:
            batch = list(
                SecretEvent.objects.filter(environment_id=environment_id).values_list(
                    "id", flat=True
                )[:SECRET_EVENT_BATCH_SIZE]
            )
            if not batch:
                break
            # _raw_delete skips the ORM cascade, so clear the M2M rows first.
            tags_through.objects.filter(secretevent_id__in=batch)._raw_delete("default")
            SecretEvent.objects.filter(id__in=batch)._raw_delete("default")


def _scim_only_accounts(organisation):
    """Accounts SCIM manages in this org that belong to no other org. The org's
    owners are kept: they asked for the deletion."""
    CustomUser = apps.get_model("api", "CustomUser")
    OrganisationMember = apps.get_model("api", "OrganisationMember")
    SCIMUser = apps.get_model("api", "SCIMUser")

    owners = OrganisationMember.objects.filter(
        organisation=organisation,
        role__is_default=True,
        role__managed_key=OWNER_ROLE_KEY,
        deleted_at=None,
    ).values("user_id")
    other_memberships = OrganisationMember.objects.filter(
        user=OuterRef("pk"), deleted_at=None
    ).exclude(organisation=organisation)

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
    """Delete the accounts, except any that joined another org meanwhile."""
    CustomUser = apps.get_model("api", "CustomUser")
    OrganisationMember = apps.get_model("api", "OrganisationMember")

    accounts = CustomUser.objects.filter(pk__in=user_ids).exclude(
        Exists(OrganisationMember.objects.filter(user=OuterRef("pk"), deleted_at=None))
    )
    _, deleted = accounts.delete()
    return deleted.get(CustomUser._meta.label, 0)


def _count_unrevokable_credentials(organisation):
    RotatingSecretCredential = apps.get_model("api", "RotatingSecretCredential")
    return RotatingSecretCredential.objects.filter(
        rotating_secret__environment__app__organisation=organisation,
        status=RotatingSecretCredential.REVOKE_FAILED,
    ).count()


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
        scim_accounts = _scim_only_accounts(organisation)
        _revoke_account_leases(scim_accounts)
        _stop_background_jobs(organisation)
        if _is_cloud():
            from ee.billing.stripe import cancel_all_subscriptions

            cancel_all_subscriptions(organisation)
    except Exception as e:
        _notify(
            f"Deletion of organisation {label} is blocked and will retry on the "
            f"next sweep: {e}"
        )
        raise

    unrevokable = _count_unrevokable_credentials(organisation)

    _delete_secret_events(organisation)

    Organisation = apps.get_model("api", "Organisation")
    with transaction.atomic():
        organisation = (
            Organisation.objects.select_for_update().filter(id=organisation_id).first()
        )
        if organisation is None or not _purge_due(organisation):
            return
        organisation.delete()
        deleted_accounts = _delete_accounts(scim_accounts)

    from backend.graphene.middleware import OrgSSOEnforcementMiddleware

    OrgSSOEnforcementMiddleware.invalidate_decision(organisation_id)

    message = f"Organisation {label} was permanently deleted"
    if deleted_accounts:
        message += f", with {deleted_accounts} SCIM-managed account(s)"
    if unrevokable:
        message += (
            f". {unrevokable} rotating secret credential(s) had already failed to "
            "revoke and may still be live at the provider"
        )
    _notify(message)

    from api.emails import send_organisation_deleted_email

    for email, display_name in recipients:
        try:
            send_organisation_deleted_email(email, display_name, name)
        except Exception:
            logger.exception("Failed to send organisation deleted email to %s", email)
