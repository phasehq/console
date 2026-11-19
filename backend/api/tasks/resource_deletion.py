"""Background jobs for app and environment deletion.

A delete request locks the app or environment (``deleted_at``): it is hidden,
and its syncs and rotations pause. An hourly sweep enqueues a purge on the
maintenance queue once the grace period has ended; a deletion asked for at
once is enqueued straight away. The purge revokes live
provider credentials, stops sync jobs, deletes the secret events in throttled
batches, then deletes the app or environment and everything under it, and
emails the organisation's owners. Restoring lifts the lock and resumes the
syncs and rotations. That is possible until the grace period ends, and later
while a credential that can't be revoked blocks the purge, but never once the
purge has started on what can't be undone.
"""

import logging
import time
from datetime import timedelta

import django_rq
from django.apps import apps
from django.db import transaction
from django.db.models import F, Value
from django.db.models.functions import Coalesce
from django.utils import timezone

from api.tasks.purge import (
    PurgeBlockedError,
    delete_environment_secret_events,
    delete_with_cascade,
    enqueue_purges,
    live_credentials_remain,
    notify,
    owner_recipients,
    revoke_dynamic_secret_leases,
    revoke_rotating_secret_credentials,
    stop_syncs,
)
from api.utils.audit_logging import (
    audit_app_cascade_envs,
    deletion_actor,
    record_audit_event,
)
from api.utils.resource_deletion import is_ready_for_purge, ready_for_purge

logger = logging.getLogger(__name__)

# NOTE: rq 2.x forbids ":" in job ids.
SWEEP_JOB_ID = "resource-deletion-sweep"
SWEEP_INTERVAL_SECONDS = 60 * 60
PURGE_JOB_TIMEOUT = 6 * 60 * 60
# The restore job is queued inside the restore's transaction, so it can start
# before that commits. It waits this long for the commit.
RESTORE_COMMIT_WAIT_SECONDS = 5
# How often one run revokes what was minted while it ran, before leaving the
# rest to the next sweep.
FINAL_DELETE_ATTEMPTS = 2


def _app_label(app):
    return f"app {app.name} ({app.id}) in organisation {app.organisation.name}"


def _environment_label(environment):
    return (
        f"environment {environment.name} ({environment.id}) of "
        f"{_app_label(environment.app)}"
    )


# ---------------------------------------------------------------------------
# Restore
# ---------------------------------------------------------------------------


def enqueue_app_restored(app_id):
    django_rq.get_queue("default").enqueue(handle_app_restored, app_id)


def enqueue_environment_restored(environment_id):
    django_rq.get_queue("default").enqueue(
        handle_environment_restored, environment_id
    )


def _once_live(queryset):
    """The restored row, once the restore has committed. None if it is not
    live after the wait: the restore was rolled back, or it was deleted
    again."""
    deadline = time.monotonic() + RESTORE_COMMIT_WAIT_SECONDS
    while True:
        resource = queryset.first()
        if resource is not None or time.monotonic() >= deadline:
            return resource
        time.sleep(0.25)


def handle_app_restored(app_id):
    App = apps.get_model("api", "App")
    app = _once_live(App.objects.filter(id=app_id))
    if app is None:
        return

    _resume({"app": app})
    _provision_team_keys(app)
    _resync_referencing_environments(app.environments.values_list("id", flat=True))


def handle_environment_restored(environment_id):
    Environment = apps.get_model("api", "Environment")
    environment = _once_live(
        Environment.objects.filter(id=environment_id).select_related("app")
    )
    if environment is None:
        return

    _resume({"id": environment.id})
    _provision_team_keys(environment.app)
    _resync_referencing_environments([environment.id])


def _resume(environments):
    """Re-arm the rotations and re-run the syncs skipped while locked. Paused
    secrets stay paused. An environment still pending deletion stays locked."""
    RotatingSecret = apps.get_model("api", "RotatingSecret")
    EnvironmentSync = apps.get_model("api", "EnvironmentSync")
    from api.tasks.syncing import trigger_sync_tasks
    from ee.integrations.secrets.rotation.engine import reschedule

    scope = {f"environment__{lookup}": value for lookup, value in environments.items()}
    unlocked = {
        "environment__deleted_at__isnull": True,
        "environment__app__deleted_at__isnull": True,
        "is_active": True,
        "deleted_at__isnull": True,
    }

    for rotating_secret in RotatingSecret.objects.filter(**scope, **unlocked):
        reschedule(rotating_secret)

    for env_sync in EnvironmentSync.objects.filter(
        status=EnvironmentSync.CANCELLED, **scope, **unlocked
    ):
        trigger_sync_tasks(env_sync)


def _resync_referencing_environments(environment_ids):
    """Other environments' references to these didn't resolve while they were
    locked, so re-run their syncs. One job for all of them: each scan reads
    the whole organisation's references."""
    from api.tasks.syncing import detect_and_trigger_referencing_syncs_for

    environment_ids = [str(environment_id) for environment_id in environment_ids]
    if environment_ids:
        detect_and_trigger_referencing_syncs_for.delay(environment_ids)


def _provision_team_keys(app):
    """Members who joined a team while its environments were locked got no keys
    for them."""
    Team = apps.get_model("api", "Team")
    from api.utils.keys import provision_team_environment_keys

    if not app.sse_enabled:
        return

    teams = Team.objects.filter(
        app_environments__app=app, deleted_at__isnull=True
    ).distinct()
    for team in teams:
        try:
            provision_team_environment_keys(team, app)
        except Exception:
            logger.exception(
                "Failed to provision keys for team %s on restored app %s",
                team.id,
                app.id,
            )


# ---------------------------------------------------------------------------
# Sweep
# ---------------------------------------------------------------------------


def init_resource_deletion_sweeper():
    scheduler = django_rq.get_scheduler("scheduled-jobs")

    try:
        scheduler.cancel(SWEEP_JOB_ID)
    except Exception:
        logger.debug("No existing resource deletion sweep to cancel", exc_info=True)

    scheduler.schedule(
        scheduled_time=timezone.now() + timedelta(seconds=30),
        func=sweep_resource_deletions,
        interval=SWEEP_INTERVAL_SECONDS,
        repeat=None,
        # Never expire the job hash; see init_log_stream_sweeper.
        result_ttl=-1,
        id=SWEEP_JOB_ID,
    )
    logger.info(
        "App and environment deletion sweeper scheduled every %ss (job id %s)",
        SWEEP_INTERVAL_SECONDS,
        SWEEP_JOB_ID,
    )


def enqueue_app_purge(app_id):
    """For a deletion asked for at once: don't wait for the sweep, which
    still retries it."""
    enqueue_purges(purge_app, "purge-app", [app_id], PURGE_JOB_TIMEOUT)


def enqueue_environment_purge(environment_id):
    enqueue_purges(
        purge_environment, "purge-environment", [environment_id], PURGE_JOB_TIMEOUT
    )


def sweep_resource_deletions():
    """Enqueue a purge for every app and environment whose grace period has
    ended, or was skipped."""
    App = apps.get_model("api", "App")
    Environment = apps.get_model("api", "Environment")

    # Not while the organisation is pending deletion: its purge takes them,
    # and restoring it restarts their grace periods.
    due_apps = ready_for_purge(
        App.all_objects.filter(organisation__deleted_at__isnull=True)
    )
    enqueue_purges(
        purge_app, "purge-app", due_apps.values_list("id", flat=True), PURGE_JOB_TIMEOUT
    )

    # Nor while the app is pending deletion: the same goes for it.
    due_environments = ready_for_purge(
        Environment.all_objects.filter(
            app__deleted_at__isnull=True,
            app__organisation__deleted_at__isnull=True,
        )
    )
    enqueue_purges(
        purge_environment,
        "purge-environment",
        due_environments.values_list("id", flat=True),
        PURGE_JOB_TIMEOUT,
    )


# ---------------------------------------------------------------------------
# Purge
# ---------------------------------------------------------------------------


def _app_may_be_purged(app):
    return (
        app is not None
        and is_ready_for_purge(app)
        and app.organisation.deleted_at is None
    )


def _environment_may_be_purged(environment):
    return (
        environment is not None
        and is_ready_for_purge(environment)
        and _parents_live(environment)
    )


def _parents_live(environment):
    app = environment.app
    return app.deleted_at is None and app.organisation.deleted_at is None


def _revoke(environments):
    revoke_dynamic_secret_leases(environments)
    revoke_rotating_secret_credentials(environments)


def _release(resource, environments, pending, label, email_delayed):
    """Revoke what is live at providers, stop the sync jobs and delete the
    secret events. `resource` is the row being purged as first read, and
    `pending` the same row as a queryset. Returns False when the purge can't
    go on yet."""
    started = resource.purge_started_at is not None
    # Blocked by an earlier run, so it can be restored. This retry claims it
    # before revoking anything: a restore then can't land while the
    # credentials of what would be a live resource are being revoked.
    retrying = resource.purge_blocked_at is not None
    if retrying and not started and not _claim(pending):
        return False  # restored first

    try:
        _revoke(environments)
    except Exception as e:
        notify(
            f"Deletion of {label} is blocked and will retry on the next sweep: {e}"
        )
        if retrying:
            _release_claim(pending, label)
        elif not started and isinstance(e, PurgeBlockedError):
            _mark_blocked(pending, label, email_delayed)
        raise

    # What follows can't be undone. Mark the row started, unless it was
    # restored or its grace period restarted meanwhile: from here on it is
    # never restorable, whatever happens to its app or organisation.
    if not _start(pending):
        return False

    stop_syncs(environments)
    if not delete_environment_secret_events(environments):
        logger.info(
            "Purge of %s hit its time budget; the next sweep continues", label
        )
        return False
    return True


def _claim(pending):
    """Take a blocked row for a retry. False if it was restored first."""
    return bool(
        ready_for_purge(
            pending.filter(
                purge_blocked_at__isnull=False, purge_started_at__isnull=True
            )
        ).update(purge_started_at=timezone.now())
    )


def _release_claim(pending, label):
    """Hand back a row whose retry was blocked again: it can be restored once
    more. Only while it is still marked blocked, which `_start` clears."""
    try:
        pending.filter(purge_blocked_at__isnull=False).update(purge_started_at=None)
    except Exception:
        logger.exception("Failed to release the purge claim on %s", label)


def _start(pending):
    """Pass the point of no return. False if the row is no longer due."""
    return bool(
        ready_for_purge(pending).update(
            purge_started_at=Coalesce(F("purge_started_at"), Value(timezone.now())),
            purge_blocked_at=None,
        )
    )


def _mark_blocked(pending, label, email_delayed):
    """Allow restoring past the grace period, and email about it once per
    deletion. Later sweeps retry without emailing again. Not for a row whose
    purge has started: part of it may be gone."""
    try:
        first = ready_for_purge(
            pending.filter(
                purge_blocked_at__isnull=True, purge_started_at__isnull=True
            )
        ).update(purge_blocked_at=timezone.now())
    except Exception:
        logger.exception("Failed to record the blocked purge of %s", label)
        return
    if first:
        email_delayed()


def _requested_by(actor):
    """Who asked for the deletion, for the email, or None if unknown."""
    actor_type, _, metadata = actor
    if actor_type == "sa":
        name = metadata.get("name")
        return f"the service account {name}" if name else None
    return metadata.get("email") or None


def _recipients(organisation, actor):
    """The organisation's owners, and the member who asked for the deletion:
    nobody was waiting on the request that finished it."""
    OrganisationMember = apps.get_model("api", "OrganisationMember")
    from api.emails import get_user_display_name

    recipients = dict(owner_recipients(organisation))

    actor_type, actor_id, _ = actor
    if actor_type == "user" and actor_id:
        member = (
            OrganisationMember.objects.filter(
                id=actor_id, organisation=organisation, deleted_at=None
            )
            .select_related("user")
            .first()
        )
        if member is not None and member.user.email:
            recipients.setdefault(
                member.user.email, get_user_display_name(member.user)
            )

    return list(recipients.items())


def _email(organisation, actor, send):
    """Email everyone concerned through `send(email, display_name)`. A failure
    here must not fail the job."""
    try:
        recipients = _recipients(organisation, actor)
    except Exception:
        logger.exception("Failed to find who to email about a deletion")
        return

    for email, display_name in recipients:
        try:
            send(email, display_name)
        except Exception:
            logger.exception("Failed to send deletion email to %s", email)


def _delete(environments, lock, may_be_purged, delete, label):
    """The final delete, in one transaction with its audit rows. `lock()`
    returns the row, locked; `delete(row)` runs the cascade and records it.
    Returns the deleted row, or None when nothing was deleted."""
    for _ in range(FINAL_DELETE_ATTEMPTS):
        with transaction.atomic():
            # Before the row itself: a rotation in flight holds its rotating
            # secret and then updates the environment, so the other order
            # could deadlock with it.
            minted = live_credentials_remain(environments)
            row = lock()
            if not may_be_purged(row):
                return None
            if not minted:
                delete(row)
                return row

        # Minted by a request that began before the deletion was asked for.
        logger.info("Purge of %s found a credential minted meanwhile", label)
        try:
            _revoke(environments)
        except Exception as e:
            notify(
                f"Deletion of {label} is blocked and will retry on the next sweep: {e}"
            )
            raise

    logger.warning(
        "Purge of %s keeps finding new credentials; the next sweep continues", label
    )
    return None


def purge_app(app_id):
    """Permanently delete an app whose grace period has ended, or was
    skipped."""
    App = apps.get_model("api", "App")
    Environment = apps.get_model("api", "Environment")
    from api.emails import send_app_deleted_email, send_app_deletion_delayed_email

    app = App.all_objects.filter(id=app_id).select_related("organisation").first()
    if not _app_may_be_purged(app):
        return  # already purged, restored, or not due yet

    label = _app_label(app)
    name = app.name
    organisation = app.organisation
    actor = deletion_actor(organisation, "app", app_id)
    actor_type, actor_id, actor_metadata = actor

    def email_delayed():
        _email(
            organisation,
            actor,
            lambda email, display_name: send_app_deletion_delayed_email(
                email, display_name, name, organisation.name
            ),
        )

    scope = {"app": app}
    pending = App.all_objects.filter(id=app_id)
    if not _release(app, scope, pending, label, email_delayed):
        return

    def lock():
        # of=self: the organisation row stays unlocked.
        return (
            pending.select_for_update(of=("self",))
            .select_related("organisation")
            .first()
        )

    def delete(app):
        environments = list(Environment.all_objects.filter(app=app))
        delete_with_cascade(app)
        # The cascade clears the primary key of what it deleted.
        app.id = app_id

        # In the same transaction, so the deletion and its record commit
        # together: neither a failed delete nor a crash leaves one without
        # the other.
        audit_app_cascade_envs(
            app, environments, actor_type, actor_id, actor_metadata, None, ""
        )
        record_audit_event(
            organisation=organisation,
            event_type="D",
            resource_type="app",
            resource_id=app_id,
            actor_type=actor_type,
            actor_id=actor_id,
            actor_metadata=actor_metadata,
            resource_metadata={"name": name},
            old_values={"name": name},
            description=f"Permanently deleted app '{name}'",
        )

    if _delete(scope, lock, _app_may_be_purged, delete, label) is None:
        return
    logger.info("Deleted %s", label)

    _email(
        organisation,
        actor,
        lambda email, display_name: send_app_deleted_email(
            email, display_name, name, organisation.name, _requested_by(actor)
        ),
    )


def purge_environment(environment_id):
    """Permanently delete an environment whose grace period has ended, or
    was skipped."""
    Environment = apps.get_model("api", "Environment")
    from api.emails import (
        send_environment_deleted_email,
        send_environment_deletion_delayed_email,
    )

    pending = Environment.all_objects.filter(id=environment_id)
    environment = pending.select_related("app__organisation").first()
    if not _environment_may_be_purged(environment):
        return  # already purged, restored, or not due yet

    label = _environment_label(environment)
    name = environment.name
    app = environment.app
    organisation = app.organisation
    actor = deletion_actor(organisation, "env", environment_id)
    actor_type, actor_id, actor_metadata = actor

    def email_delayed():
        _email(
            organisation,
            actor,
            lambda email, display_name: send_environment_deletion_delayed_email(
                email, display_name, name, app.name, organisation.name
            ),
        )

    scope = {"id": environment_id}
    if not _release(environment, scope, pending, label, email_delayed):
        return

    def lock():
        # of=self: the app row stays unlocked.
        return (
            pending.select_for_update(of=("self",))
            .select_related("app__organisation")
            .first()
        )

    def delete(environment):
        delete_with_cascade(environment)
        # In the same transaction: see purge_app.
        record_audit_event(
            organisation=organisation,
            event_type="D",
            resource_type="env",
            resource_id=environment_id,
            actor_type=actor_type,
            actor_id=actor_id,
            actor_metadata=actor_metadata,
            resource_metadata={
                "name": name,
                "app_id": str(app.id),
                "app_name": app.name,
            },
            old_values={"name": name},
            description=(
                f"Permanently deleted environment '{name}' from app '{app.name}'"
            ),
        )

    if _delete(scope, lock, _environment_may_be_purged, delete, label) is None:
        return
    logger.info("Deleted %s", label)

    _email(
        organisation,
        actor,
        lambda email, display_name: send_environment_deleted_email(
            email,
            display_name,
            name,
            app.name,
            organisation.name,
            _requested_by(actor),
        ),
    )
