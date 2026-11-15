"""App and environment deletion: a delete request locks the app or environment
for a grace period, after which a background job purges it unless it was
restored."""

from datetime import timedelta

from django.apps import apps
from django.db import transaction
from django.db.models import Max, Q
from django.utils import timezone

GRACE_PERIOD = timedelta(hours=24)
# The purge starts this long after restoring stops, so a restore that is still
# committing, or a worker whose clock runs ahead, can't overlap it.
PURGE_MARGIN = timedelta(minutes=5)

NAME_IN_USE = "in_use"
NAME_PENDING_DELETION = "pending_deletion"


def pending_deletion(queryset):
    """Narrow an `all_objects` queryset of apps or environments to those
    scheduled for deletion. Apps soft-deleted by releases before 2024
    (`is_deleted`) are not: they stay hidden, and are never purged."""
    return queryset.filter(deleted_at__isnull=False, is_deleted=False)


def is_pending_deletion(resource):
    return resource.deleted_at is not None and not resource.is_deleted


def deletion_scheduled_for(resource):
    """When the purge of an app or environment becomes due, or None if no
    deletion is pending."""
    if not is_pending_deletion(resource):
        return None
    return resource.deleted_at + GRACE_PERIOD


def purge_due(resource):
    """Whether the grace period has ended."""
    return (
        is_pending_deletion(resource)
        and resource.deleted_at <= timezone.now() - GRACE_PERIOD
    )


def can_restore(resource):
    """Until the grace period ends, and later while the purge is blocked: a
    blocked purge deletes nothing, and clears the block before it does."""
    return is_pending_deletion(resource) and (
        not purge_due(resource) or resource.purge_blocked_at is not None
    )


def ready_for_purge(queryset):
    """Narrow an `all_objects` queryset to what the purge job may delete."""
    return pending_deletion(queryset).filter(
        deleted_at__lte=timezone.now() - GRACE_PERIOD - PURGE_MARGIN
    )


def is_ready_for_purge(resource):
    return (
        is_pending_deletion(resource)
        and resource.deleted_at <= timezone.now() - GRACE_PERIOD - PURGE_MARGIN
    )


def _restart_grace_periods(queryset):
    pending_deletion(queryset).update(
        deleted_at=timezone.now(), purge_blocked_at=None
    )


def environment_is_locked(environment_id):
    """Whether the environment, or its app, is pending deletion. Reads the
    database, so a job holding a stale copy sees a deletion made since."""
    Environment = apps.get_model("api", "Environment")
    return (
        Environment.all_objects.filter(id=environment_id)
        .filter(Q(deleted_at__isnull=False) | Q(app__deleted_at__isnull=False))
        .exists()
    )


def environment_name_conflict(app, name, exclude_id=None):
    """Why `name` can't be used for an environment of `app`: NAME_IN_USE,
    NAME_PENDING_DELETION, or None when it is free. An environment pending
    deletion keeps its name, so restoring it can't collide."""
    Environment = apps.get_model("api", "Environment")
    taken = Environment.all_objects.filter(app=app, name__iexact=name)
    if exclude_id is not None:
        taken = taken.exclude(id=exclude_id)

    deleted = list(taken.values_list("deleted_at", flat=True))
    if not deleted:
        return None
    if any(deleted_at is None for deleted_at in deleted):
        return NAME_IN_USE
    return NAME_PENDING_DELETION


def environment_name_conflict_message(conflict, name):
    if conflict == NAME_PENDING_DELETION:
        return (
            f"An environment named '{name}' is scheduled for deletion in this "
            "app. Restore it, or wait until it has been deleted."
        )
    return f"An environment named '{name}' already exists in this app."


class ResourceDeletionError(Exception):
    """A deletion or restore that can't go ahead. The message is for the user."""


def schedule_app_deletion(app):
    """Lock `app` for the grace period, after which it is purged."""
    App = apps.get_model("api", "App")

    now = timezone.now()
    # A conditional update, so two requests can't both schedule it.
    scheduled = App.all_objects.filter(id=app.id, deleted_at__isnull=True).update(
        deleted_at=now, is_deleted=False, purge_blocked_at=None, updated_at=now
    )
    if not scheduled:
        raise ResourceDeletionError("This app is already scheduled for deletion.")

    app.deleted_at = now
    app.is_deleted = False
    app.purge_blocked_at = None
    return app


def restore_app(app_id):
    """Cancel an app's pending deletion. Returns the restored app."""
    App = apps.get_model("api", "App")
    Environment = apps.get_model("api", "Environment")
    from backend.quotas import can_add_app

    with transaction.atomic():
        # of=self: the organisation row stays unlocked.
        app = (
            App.all_objects.select_for_update(of=("self",))
            .select_related("organisation")
            .get(id=app_id)
        )
        if not is_pending_deletion(app):
            raise ResourceDeletionError("This app is not scheduled for deletion.")
        # Past the deadline the purge may already be running.
        if not can_restore(app):
            raise ResourceDeletionError("This app can no longer be restored.")
        # Apps pending deletion don't count towards the plan's limit.
        if not can_add_app(app.organisation):
            raise ResourceDeletionError(
                "This organisation has reached its plan's limit of apps. "
                "Delete an app or upgrade your plan to restore this one."
            )

        app.deleted_at = None
        app.purge_blocked_at = None
        app.save(update_fields=["deleted_at", "purge_blocked_at", "updated_at"])
        # Its environments pending deletion could be neither purged nor
        # restored meanwhile, so they get the whole grace period again.
        _restart_grace_periods(Environment.all_objects.filter(app=app))

    return app


def schedule_environment_deletion(environment):
    """Lock `environment` for the grace period, after which it is purged."""
    Environment = apps.get_model("api", "Environment")

    now = timezone.now()
    # update(), not save(): Environment.save() triggers the environment's syncs.
    scheduled = Environment.all_objects.filter(
        id=environment.id, deleted_at__isnull=True
    ).update(deleted_at=now, is_deleted=False, purge_blocked_at=None, updated_at=now)
    if not scheduled:
        raise ResourceDeletionError(
            "This environment is already scheduled for deletion."
        )

    environment.deleted_at = now
    environment.is_deleted = False
    environment.purge_blocked_at = None
    return environment


def restore_environment(environment_id):
    """Cancel an environment's pending deletion. Returns the restored
    environment."""
    Environment = apps.get_model("api", "Environment")
    from backend.quotas import can_add_environment

    with transaction.atomic():
        # of=self: the app row stays unlocked.
        environment = (
            Environment.all_objects.select_for_update(of=("self",))
            .select_related("app__organisation")
            .get(id=environment_id)
        )
        app = environment.app
        if not is_pending_deletion(environment):
            raise ResourceDeletionError(
                "This environment is not scheduled for deletion."
            )
        if app.deleted_at is not None:
            raise ResourceDeletionError(
                "This environment's app is scheduled for deletion. Restore the "
                "app first."
            )
        # Past the deadline the purge may already be running.
        if not can_restore(environment):
            raise ResourceDeletionError("This environment can no longer be restored.")
        # Environments pending deletion don't count towards the plan's limit.
        if not can_add_environment(app):
            raise ResourceDeletionError(
                "This app has reached its plan's limit of environments. Delete "
                "an environment or upgrade your plan to restore this one."
            )
        # Creating and renaming refuse a name held by an environment pending
        # deletion, so this only catches one that slipped past them.
        if (
            environment_name_conflict(app, environment.name, environment.id)
            == NAME_IN_USE
        ):
            raise ResourceDeletionError(
                f"Another environment in this app is now named "
                f"'{environment.name}'. Rename it to restore this one."
            )

        # Its place in the order may have been taken while it was hidden.
        index = environment.index
        siblings = Environment.objects.filter(app=app)
        if siblings.filter(index=index).exists():
            index = siblings.aggregate(Max("index"))["index__max"] + 1

        now = timezone.now()
        # update(), not save(): Environment.save() triggers the environment's
        # syncs, which the restore job re-runs once this has committed.
        Environment.all_objects.filter(id=environment.id).update(
            deleted_at=None, purge_blocked_at=None, index=index, updated_at=now
        )
        environment.deleted_at = None
        environment.purge_blocked_at = None
        environment.index = index
        environment.updated_at = now

    return environment


def restart_grace_periods(organisation):
    """Purging and restoring both stop while an organisation is pending
    deletion. Once it is restored, whatever in it was scheduled for deletion
    gets the whole grace period again."""
    App = apps.get_model("api", "App")
    Environment = apps.get_model("api", "Environment")

    _restart_grace_periods(App.all_objects.filter(organisation=organisation))
    _restart_grace_periods(
        Environment.all_objects.filter(app__organisation=organisation)
    )
