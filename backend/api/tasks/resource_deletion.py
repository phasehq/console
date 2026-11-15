"""Background jobs for app and environment deletion.

A delete request locks the app or environment (``deleted_at``): it is hidden,
and its syncs and rotations pause. An hourly sweep enqueues a purge on the
maintenance queue once the grace period has ended. The purge revokes live
provider credentials, stops sync jobs, deletes the secret events in throttled
batches, then deletes the app or environment and everything under it, and
emails the organisation's owners. Restoring lifts the lock and resumes the
syncs and rotations. That is possible until the grace period ends, and later
while a credential that can't be revoked blocks the purge.
"""

import logging
from datetime import timedelta

import django_rq
from django.apps import apps
from django.db import transaction
from django.utils import timezone

from api.tasks.purge import (
    PurgeBlockedError,
    delete_environment_secret_events,
    delete_with_cascade,
    enqueue_purges,
    notify,
    owner_recipients,
    revoke_dynamic_secret_leases,
    revoke_rotating_secret_credentials,
    stop_syncs,
)
from api.utils.audit_logging import (
    audit_app_cascade_envs,
    deletion_actor,
    log_audit_event,
)
from api.utils.resource_deletion import is_ready_for_purge, ready_for_purge

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


def _release(environments, pending, label, email_delayed):
    """Revoke what is live at providers, stop the sync jobs and delete the
    secret events. `pending` is the row being purged, as a queryset. Returns
    False when the purge can't go on yet."""
    try:
        revoke_dynamic_secret_leases(environments)
        revoke_rotating_secret_credentials(environments)
    except Exception as e:
        notify(
            f"Deletion of {label} is blocked and will retry on the next sweep: {e}"
        )
        if isinstance(e, PurgeBlockedError):
            _mark_blocked(pending, label, email_delayed)
        raise

    # What follows can't be undone, and a blocked purge can be restored. So
    # clear the block first, unless it was restored meanwhile: restoring is
    # refused from here on.
    if not ready_for_purge(pending).update(purge_blocked_at=None):
        return False

    stop_syncs(environments)
    if not delete_environment_secret_events(environments):
        logger.info(
            "Purge of %s hit its time budget; the next sweep continues", label
        )
        return False
    return True


def _mark_blocked(pending, label, email_delayed):
    """Allow restoring past the grace period, and email about it once per
    deletion. Later sweeps retry without emailing again."""
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
    """Who scheduled the deletion, for the email, or None if unknown."""
    actor_type, _, metadata = actor
    if actor_type == "sa":
        name = metadata.get("name")
        return f"the service account {name}" if name else None
    return metadata.get("email") or None


def _recipients(organisation, actor):
    """The organisation's owners, and the member who scheduled the deletion:
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


def purge_app(app_id):
    """Permanently delete an app whose grace period has ended."""
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

    def email_delayed():
        _email(
            organisation,
            actor,
            lambda email, display_name: send_app_deletion_delayed_email(
                email, display_name, name, organisation.name
            ),
        )

    pending = App.all_objects.filter(id=app_id)
    if not _release({"app": app}, pending, label, email_delayed):
        return

    with transaction.atomic():
        # of=self: the organisation row stays unlocked.
        app = (
            pending.select_for_update(of=("self",))
            .select_related("organisation")
            .first()
        )
        if not _app_may_be_purged(app):
            return
        environments = list(Environment.all_objects.filter(app=app))
        delete_with_cascade(app)

    # The cascade clears the primary key of what it deleted.
    app.id = app_id

    # After the commit, so a failed delete leaves no record of one.
    actor_type, actor_id, actor_metadata = actor
    audit_app_cascade_envs(
        app, environments, actor_type, actor_id, actor_metadata, None, ""
    )
    log_audit_event(
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
    logger.info("Deleted %s", label)

    _email(
        organisation,
        actor,
        lambda email, display_name: send_app_deleted_email(
            email, display_name, name, organisation.name, _requested_by(actor)
        ),
    )


def purge_environment(environment_id):
    """Permanently delete an environment whose grace period has ended."""
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

    def email_delayed():
        _email(
            organisation,
            actor,
            lambda email, display_name: send_environment_deletion_delayed_email(
                email, display_name, name, app.name, organisation.name
            ),
        )

    if not _release({"id": environment_id}, pending, label, email_delayed):
        return

    with transaction.atomic():
        # of=self: the app row stays unlocked.
        environment = (
            pending.select_for_update(of=("self",))
            .select_related("app__organisation")
            .first()
        )
        if not _environment_may_be_purged(environment):
            return
        delete_with_cascade(environment)

    # After the commit, so a failed delete leaves no record of one.
    actor_type, actor_id, actor_metadata = actor
    log_audit_event(
        organisation=organisation,
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
