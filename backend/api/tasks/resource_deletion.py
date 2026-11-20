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
from datetime import timedelta

import django_rq
from django.apps import apps
from django.db import transaction
from django.db.models import F, Value
from django.db.models.functions import Coalesce
from django.utils import timezone
from rq import Retry

from api.tasks.purge import (
    PurgeBlockedError,
    collect_cascade,
    delete_environment_secret_events,
    delete_late_secret_events,
    delete_with_cascade,
    enqueue_purges,
    live_credentials_remain,
    lock_environments,
    lock_secrets,
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
# How often one run revokes what was minted while it ran, before leaving the
# rest to the next sweep.
FINAL_DELETE_ATTEMPTS = 2
RESTORE_JOB_TIMEOUT = 60 * 60
# A restore can't be asked for twice, so its follow-up is tried again if it
# fails or its worker dies. Every step can be repeated.
RESTORE_JOB_RETRIES = 3
RESTORE_JOB_RETRY_INTERVALS = [10, 30, 60]


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
    _enqueue_restored(handle_app_restored, app_id)


def enqueue_environment_restored(environment_id):
    _enqueue_restored(handle_environment_restored, environment_id)


def _enqueue_restored(handler, resource_id):
    django_rq.get_queue("default").enqueue(
        handler,
        resource_id,
        job_timeout=RESTORE_JOB_TIMEOUT,
        retry=Retry(max=RESTORE_JOB_RETRIES, interval=RESTORE_JOB_RETRY_INTERVALS),
    )


def _as_restored(queryset):
    """The row as the restore left it, or None if it is gone. The job is
    queued inside the restore's transaction and can start before that ends.
    The restore holds the row locked until then, so reading it with a lock
    waits for it, however long it takes."""
    with transaction.atomic():
        # no_key: waits for the restore, not for requests adding rows below.
        return queryset.select_for_update(no_key=True, of=("self",)).first()


def handle_app_restored(app_id):
    App = apps.get_model("api", "App")
    # all_objects: until the restore commits, the app is still hidden.
    app = _as_restored(App.all_objects.filter(id=app_id))
    if app is None or app.deleted_at is not None:
        return  # the restore was rolled back, or it was deleted again

    _resume({"app": app})
    _resync_referencing_environments(app.environments.values_list("id", flat=True))
    # Last: it raises once every team was tried.
    _provision_team_keys(app)


def handle_environment_restored(environment_id):
    Environment = apps.get_model("api", "Environment")
    environment = _as_restored(
        Environment.all_objects.filter(id=environment_id).select_related("app")
    )
    if (
        environment is None
        or environment.deleted_at is not None
        or environment.app.deleted_at is not None
    ):
        return  # the restore was rolled back, or it was deleted again

    _resume({"id": environment.id})
    _resync_referencing_environments([environment.id])
    # Last: it raises once every team was tried.
    _provision_team_keys(environment.app)


def _resume(environments):
    """Re-arm the rotations and re-run the syncs. Paused secrets and syncs
    stay paused. An environment still pending deletion stays locked."""
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
        # The syncs run once, below: not once for each secret re-armed.
        reschedule(rotating_secret, trigger_syncs=False)

    # Every sync, not only those cancelled while locked. One can be out of
    # date without having been cancelled: the scan that follows a change to
    # a secret it references skips a locked environment.
    for env_sync in EnvironmentSync.objects.filter(**scope, **unlocked):
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
    failed = None
    for team in teams:
        try:
            provision_team_environment_keys(team, app)
        except Exception as e:
            logger.exception(
                "Failed to provision keys for team %s on restored app %s",
                team.id,
                app.id,
            )
            failed = e
    if failed is not None:
        # Once every team was tried: the job fails, and its retry does the rest.
        raise failed


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


def _revoke_or_delay(environments, pending, label, email_delayed, restorable):
    """Revoke what is live at providers. If a credential can't be revoked,
    record that the purge is delayed and email about it before raising.
    `restorable` is whether that email may offer a restore."""
    try:
        _revoke(environments)
    except Exception as e:
        notify(
            f"Deletion of {label} is blocked and will retry on the next sweep: {e}"
        )
        if isinstance(e, PurgeBlockedError):
            _mark_blocked(pending, label, lambda: email_delayed(restorable))
        raise


def _release(resource, environments, pending, label, email_delayed):
    """Revoke what is live at providers, stop the sync jobs and delete the
    secret events. `resource` is the row being purged as first read, and
    `pending` the same row as a queryset. Returns False when the purge can't
    go on yet."""
    started = resource.purge_started_at is not None
    # Until the point of no return, a run claims the row before it revokes
    # anything. Neither a restore, nor a parent's restore giving the row a new
    # grace period, can then land while the credentials of what would be a
    # live resource are being revoked.
    if not started and not _claim(pending):
        return False  # restored first, or no longer due

    try:
        _revoke_or_delay(
            environments, pending, label, email_delayed, restorable=not started
        )
    except Exception:
        if not started:
            # Nothing is deleted yet. Blocked, it can be restored again.
            _release_claim(pending, label)
        raise

    # What follows can't be undone. From here on the row is never restorable,
    # whatever happens to its app or organisation.
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
    """Take the row for this run. False if it was restored first, or is no
    longer due. One purge job runs per row at a time, so a claim found here
    was left by a run that died, and is taken over."""
    return bool(
        ready_for_purge(pending.filter(purge_started_at__isnull=True)).update(
            purge_claimed_at=timezone.now()
        )
    )


def _release_claim(pending, label):
    """Hand back a row whose run stopped before the point of no return."""
    try:
        pending.filter(purge_started_at__isnull=True).update(purge_claimed_at=None)
    except Exception:
        logger.exception("Failed to release the purge claim on %s", label)


def _start(pending):
    """Pass the point of no return. False if the row is gone."""
    return bool(
        ready_for_purge(pending).update(
            purge_started_at=Coalesce(F("purge_started_at"), Value(timezone.now())),
            purge_claimed_at=None,
            purge_blocked_at=None,
        )
    )


def _mark_blocked(pending, label, email_delayed):
    """Record that a credential holds up the purge, and email about it once.
    Later sweeps retry without emailing again."""
    try:
        first = ready_for_purge(pending.filter(purge_blocked_at__isnull=True)).update(
            purge_blocked_at=timezone.now()
        )
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


def _delete(environments, lock, may_be_purged, delete, label, revoke):
    """The final delete, in one transaction with its audit rows. `lock()`
    returns the row, locked; `delete(row)` runs the cascade and records it;
    `revoke()` revokes what was minted meanwhile. Returns the deleted row, or
    None when nothing was deleted."""
    for _ in range(FINAL_DELETE_ATTEMPTS):
        with transaction.atomic():
            # The secrets before the rows above them: a rotation in flight
            # holds its rotating secret and then updates the environment, so
            # the other order could deadlock with it.
            lock_secrets(environments)
            row = lock()
            if not may_be_purged(row):
                return None
            # Looked for only now, with every row a new lease or credential
            # would hang off locked: whatever a request already under way was
            # adding has committed, and nothing more can be added.
            lock_environments(environments)
            if not live_credentials_remain(environments):
                # Written since the batched delete by a request already under
                # way. The cascade skips them, and would fail on one left.
                delete_late_secret_events(environments)
                delete(row)
                return row

        # Minted by a request that began before the deletion was asked for.
        logger.info("Purge of %s found a credential minted meanwhile", label)
        revoke()

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

    def email_delayed(restorable):
        _email(
            organisation,
            actor,
            lambda email, display_name: send_app_deletion_delayed_email(
                email, display_name, name, organisation.name, restorable
            ),
        )

    scope = {"app": app}
    pending = App.all_objects.filter(id=app_id)
    if not _release(app, scope, pending, label, email_delayed):
        return

    def lock():
        # no_key: keeps a restore out, yet lets a request already under way
        # commit. One holding an environment row may need a key-share lock on
        # the app row to commit, and would deadlock with a full lock here.
        # of=self: the organisation row stays unlocked.
        return (
            pending.select_for_update(no_key=True, of=("self",))
            .select_related("organisation")
            .first()
        )

    def delete(app):
        cascade = collect_cascade(app)
        # The environments the cascade found, not a list of our own: a request
        # already under way can commit a new one in between, and it would be
        # deleted with no record. all_objects: they are hidden.
        environments = list(
            Environment.all_objects.filter(
                id__in=[found.pk for found in cascade.data.get(Environment, ())]
            )
        )
        cascade.delete()
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

    def revoke_minted():
        # Past the point of no return: delayed, but not restorable.
        _revoke_or_delay(scope, pending, label, email_delayed, restorable=False)

    if _delete(scope, lock, _app_may_be_purged, delete, label, revoke_minted) is None:
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

    def email_delayed(restorable):
        _email(
            organisation,
            actor,
            lambda email, display_name: send_environment_deletion_delayed_email(
                email, display_name, name, app.name, organisation.name, restorable
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

    def revoke_minted():
        # Past the point of no return: delayed, but not restorable.
        _revoke_or_delay(scope, pending, label, email_delayed, restorable=False)

    if (
        _delete(scope, lock, _environment_may_be_purged, delete, label, revoke_minted)
        is None
    ):
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
