"""Background jobs for app and environment deletion.

A delete request locks the app or environment (``deleted_at``): it is hidden,
and its syncs and rotations pause. An hourly sweep enqueues a purge on the
maintenance queue once the grace period has ended. The purge revokes live
provider credentials, stops sync jobs, deletes the secret events in throttled
batches, then deletes the app or environment and everything under it.
Restoring before the grace period ends lifts the lock and resumes the syncs
and rotations.
"""

import logging
from datetime import timedelta

import django_rq
from django.apps import apps
from django.db import transaction
from django.utils import timezone
from rq.exceptions import NoSuchJobError
from rq.job import Job

from api.tasks.purge import (
    delete_environment_secret_events,
    delete_with_cascade,
    notify,
    revoke_dynamic_secret_leases,
    revoke_rotating_secret_credentials,
    stop_syncs,
)
from api.utils.audit_logging import (
    audit_app_cascade_envs,
    deletion_actor,
    log_audit_event,
)
from api.utils.resource_deletion import GRACE_PERIOD, purge_due

logger = logging.getLogger(__name__)

# NOTE: rq 2.x forbids ":" in job ids.
SWEEP_JOB_ID = "resource-deletion-sweep"
SWEEP_INTERVAL_SECONDS = 60 * 60
PURGE_JOB_TIMEOUT = 6 * 60 * 60


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


def handle_app_restored(app_id):
    App = apps.get_model("api", "App")
    app = App.objects.filter(id=app_id).first()
    if app is None:
        return  # deleted again before this job ran

    _resume({"app": app})
    _provision_team_keys(app)
    for environment_id in app.environments.values_list("id", flat=True):
        _resync_referencing_environments(environment_id)


def handle_environment_restored(environment_id):
    Environment = apps.get_model("api", "Environment")
    environment = (
        Environment.objects.filter(id=environment_id).select_related("app").first()
    )
    if environment is None:
        return  # deleted again before this job ran

    _resume({"id": environment.id})
    _provision_team_keys(environment.app)
    _resync_referencing_environments(environment.id)


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


def _resync_referencing_environments(environment_id):
    """Other environments' references to this one didn't resolve while it was
    locked, so re-run their syncs."""
    from api.tasks.syncing import detect_and_trigger_referencing_syncs

    detect_and_trigger_referencing_syncs.delay(str(environment_id))


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


def sweep_resource_deletions():
    """Enqueue a purge for every app and environment whose grace period has
    ended."""
    App = apps.get_model("api", "App")
    Environment = apps.get_model("api", "Environment")
    queue = django_rq.get_queue("maintenance")
    due = timezone.now() - GRACE_PERIOD

    for app_id in App.all_objects.filter(deleted_at__lte=due).values_list(
        "id", flat=True
    ):
        _enqueue_purge(queue, purge_app, f"purge-app-{app_id}", app_id)

    # An environment whose app is pending deletion too goes with the app, or
    # becomes due again if the app is restored.
    for environment_id in Environment.all_objects.filter(
        deleted_at__lte=due, app__deleted_at__isnull=True
    ).values_list("id", flat=True):
        _enqueue_purge(
            queue,
            purge_environment,
            f"purge-environment-{environment_id}",
            environment_id,
        )


def _enqueue_purge(queue, purge, job_id, resource_id):
    try:
        job = Job.fetch(job_id, connection=queue.connection)
        if job.is_queued or job.is_started:
            return
    except NoSuchJobError:
        pass

    queue.enqueue(purge, resource_id, job_id=job_id, job_timeout=PURGE_JOB_TIMEOUT)


# ---------------------------------------------------------------------------
# Purge
# ---------------------------------------------------------------------------


def _release(environments, label):
    """Revoke what is live at providers, stop the sync jobs and delete the
    secret events. Restore is refused once the purge is due, so none of this
    can be undone under a restore. Returns False when the events are not all
    deleted yet."""
    try:
        revoke_dynamic_secret_leases(environments)
        revoke_rotating_secret_credentials(environments)
        stop_syncs(environments)
    except Exception as e:
        notify(
            f"Deletion of {label} is blocked and will retry on the next sweep: {e}"
        )
        raise

    if not delete_environment_secret_events(environments):
        logger.info(
            "Purge of %s hit its time budget; the next sweep continues", label
        )
        return False
    return True


def purge_app(app_id):
    """Permanently delete an app whose grace period has ended."""
    App = apps.get_model("api", "App")
    Environment = apps.get_model("api", "Environment")

    app = App.all_objects.filter(id=app_id).select_related("organisation").first()
    if app is None or not purge_due(app):
        return  # already purged, restored, or not due yet

    label = _app_label(app)
    if not _release({"app": app}, label):
        return

    with transaction.atomic():
        # of=self: the organisation row stays unlocked.
        app = (
            App.all_objects.select_for_update(of=("self",))
            .filter(id=app_id)
            .select_related("organisation")
            .first()
        )
        if app is None or not purge_due(app):
            return
        environments = list(Environment.all_objects.filter(app=app))
        actor = deletion_actor(app.organisation, "app", app.id)
        delete_with_cascade(app)

    # After the commit, so a failed delete leaves no record of one.
    actor_type, actor_id, actor_metadata = actor
    audit_app_cascade_envs(
        app, environments, actor_type, actor_id, actor_metadata, None, ""
    )
    log_audit_event(
        organisation=app.organisation,
        event_type="D",
        resource_type="app",
        resource_id=app_id,
        actor_type=actor_type,
        actor_id=actor_id,
        actor_metadata=actor_metadata,
        resource_metadata={"name": app.name},
        old_values={"name": app.name},
        description=f"Permanently deleted app '{app.name}'",
    )
    logger.info("Deleted %s", label)


def purge_environment(environment_id):
    """Permanently delete an environment whose grace period has ended."""
    Environment = apps.get_model("api", "Environment")

    def get(queryset):
        return (
            queryset.filter(id=environment_id)
            .select_related("app__organisation")
            .first()
        )

    def due(environment):
        # Not while the app is pending deletion too: the app's purge takes
        # the environment with it.
        return (
            environment is not None
            and purge_due(environment)
            and environment.app.deleted_at is None
        )

    environment = get(Environment.all_objects)
    if not due(environment):
        return  # already purged, restored, or not due yet

    label = _environment_label(environment)
    if not _release({"id": environment.id}, label):
        return

    with transaction.atomic():
        # of=self: the app row stays unlocked.
        environment = get(Environment.all_objects.select_for_update(of=("self",)))
        if not due(environment):
            return
        app = environment.app
        name = environment.name
        actor = deletion_actor(app.organisation, "env", environment_id)
        delete_with_cascade(environment)

    actor_type, actor_id, actor_metadata = actor
    log_audit_event(
        organisation=app.organisation,
        event_type="D",
        resource_type="env",
        resource_id=environment_id,
        actor_type=actor_type,
        actor_id=actor_id,
        actor_metadata=actor_metadata,
        resource_metadata={"name": name, "app_id": str(app.id), "app_name": app.name},
        old_values={"name": name},
        description=f"Permanently deleted environment '{name}' from app '{app.name}'",
    )
    logger.info("Deleted %s", label)
