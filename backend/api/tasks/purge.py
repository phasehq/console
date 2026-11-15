"""Steps shared by the purges that end a deletion grace period: organisations,
apps and environments.

Each step takes `environments`, a filter on Environment that names what is
being purged, e.g. ``{"app__organisation": organisation}`` or ``{"app": app}``.
"""

import logging
import os
import time
from urllib.parse import quote

import django_rq
from django.apps import apps
from django.conf import settings
from django.db.models.deletion import Collector
from rq.exceptions import NoSuchJobError
from rq.job import Job

from api.utils.access.roles import OWNER_ROLE_KEY
from api.utils.secret_logs import delete_secret_events

logger = logging.getLogger(__name__)

# Deleting secret events is the heavy part of a purge. Throttled like
# purge_app_logs; raise the pause if replicas lag.
SECRET_EVENT_BATCH_SIZE = int(os.getenv("ORG_PURGE_EVENT_BATCH_SIZE", "10000"))
SECRET_EVENT_SLEEP_MS = int(os.getenv("ORG_PURGE_EVENT_SLEEP_MS", "500"))
# Each run stops deleting events after this long so a large purge can't hold a
# worker for hours. The next sweep carries on; the lock stays meanwhile.
SECRET_EVENT_TIME_BUDGET_SECONDS = int(
    os.getenv("ORG_PURGE_EVENT_TIME_BUDGET_SECONDS", "600")
)


class PurgeBlockedError(Exception):
    """A live provider credential could not be revoked. The purge is retried on
    the next sweep rather than orphaning the credential."""


def purge_job_id(prefix, resource_id):
    # rq refuses ":" in a job id, and a client can choose an app's or an
    # organisation's id.
    return f"{prefix}-{quote(str(resource_id), safe='')}"


def enqueue_purges(purge, prefix, resource_ids, job_timeout):
    """Enqueue `purge(resource_id)` on the maintenance queue for each id that
    has no purge queued or running. A failure is logged and the sweep moves
    on, so one row can't hold up the rest."""
    queue = django_rq.get_queue("maintenance")

    for resource_id in resource_ids:
        try:
            job_id = purge_job_id(prefix, resource_id)
            try:
                job = Job.fetch(job_id, connection=queue.connection)
                if job.is_queued or job.is_started:
                    continue
            except NoSuchJobError:
                pass

            queue.enqueue(purge, resource_id, job_id=job_id, job_timeout=job_timeout)
        except Exception:
            logger.exception("Failed to enqueue %s(%r)", purge.__name__, resource_id)


def notify(message):
    logger.info(message)
    if settings.APP_HOST != "cloud":
        return

    from backend.api.notifier import notify_slack

    try:
        notify_slack(message)
    except Exception:
        logger.exception("Failed to send Slack notification")


def owner_recipients(organisation):
    """The organisation's owners, as (email, display name)."""
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


def _scoped(prefix, environments):
    return {f"{prefix}{lookup}": value for lookup, value in environments.items()}


def revoke_dynamic_secret_leases(environments):
    DynamicSecretLease = apps.get_model("api", "DynamicSecretLease")
    from ee.integrations.secrets.dynamic.utils import revoke_lease_now

    leases = DynamicSecretLease.objects.filter(
        status=DynamicSecretLease.ACTIVE,
        **_scoped("secret__environment__", environments),
    ).select_related("secret")

    failed = 0
    for lease in leases:
        try:
            revoke_lease_now(lease)
        except Exception:
            logger.exception("Failed to revoke dynamic secret lease %s", lease.id)
            failed += 1

    if failed:
        raise PurgeBlockedError(f"could not revoke {failed} dynamic secret lease(s)")


def revoke_rotating_secret_credentials(environments):
    RotatingSecret = apps.get_model("api", "RotatingSecret")
    RotatingSecretCredential = apps.get_model("api", "RotatingSecretCredential")
    from ee.integrations.secrets.rotation.engine import (
        cancel_rotation_jobs,
        revoke_credential,
    )

    for rotating_secret in RotatingSecret.objects.filter(
        **_scoped("environment__", environments)
    ):
        cancel_rotation_jobs(rotating_secret)

    # Every credential that may still be live at the provider, REVOKE_FAILED
    # included: once its rows are deleted, nothing can revoke them.
    unrevoked = RotatingSecretCredential.objects.filter(
        status__in=[
            RotatingSecretCredential.PENDING,
            RotatingSecretCredential.ACTIVE,
            RotatingSecretCredential.EXPIRING,
            RotatingSecretCredential.REVOKING,
            RotatingSecretCredential.REVOKE_FAILED,
        ],
        **_scoped("rotating_secret__environment__", environments),
    )

    for credential_id in list(unrevoked.values_list("id", flat=True)):
        try:
            revoke_credential(credential_id, immediate=True)
        except Exception:
            logger.exception(
                "Failed to revoke rotating secret credential %s", credential_id
            )

    remaining = unrevoked.count()
    if remaining:
        raise PurgeBlockedError(
            f"could not revoke {remaining} rotating secret credential(s)"
        )


def stop_syncs(environments):
    EnvironmentSync = apps.get_model("api", "EnvironmentSync")
    from api.tasks.syncing import cancel_sync_tasks

    syncs = EnvironmentSync.objects.filter(**_scoped("environment__", environments))
    syncs.update(is_active=False)
    for sync in syncs:
        cancel_sync_tasks(sync)


def delete_environment_secret_events(environments):
    """Delete the secret events in throttled batches per environment, ahead of
    the cascade, which skips them. Returns False when the time budget runs out
    first."""
    Environment = apps.get_model("api", "Environment")
    SecretEvent = apps.get_model("api", "SecretEvent")

    deadline = time.monotonic() + SECRET_EVENT_TIME_BUDGET_SECONDS
    # all_objects: environments pending deletion have events too.
    for environment_id in Environment.all_objects.filter(**environments).values_list(
        "id", flat=True
    ):
        _, finished = delete_secret_events(
            SecretEvent.objects.filter(environment_id=environment_id),
            batch_size=SECRET_EVENT_BATCH_SIZE,
            sleep_ms=SECRET_EVENT_SLEEP_MS,
            deadline=deadline,
        )
        if not finished:
            return False
    return True


class EventlessCollector(Collector):
    """Cascade for a purge's final delete. The secret events and their tag
    links are gone by then, so skip those tables rather than scan their dead
    rows: with row counts from before the batched delete, the planner picked
    full table scans. FKs are still checked at commit, so a leftover event
    fails the purge instead of being orphaned."""

    def related_objects(self, related_model, related_fields, objs):
        SecretEvent = apps.get_model("api", "SecretEvent")
        if related_model in (SecretEvent, SecretEvent.tags.through):
            return related_model._base_manager.none()
        return super().related_objects(related_model, related_fields, objs)


def delete_with_cascade(instance):
    collector = EventlessCollector(using=instance._state.db, origin=instance)
    collector.collect([instance])
    collector.delete()
