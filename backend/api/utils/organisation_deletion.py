"""Organisation deletion: an owner request locks the organisation for a grace
period, after which a background job purges it unless it was restored."""

from datetime import timedelta

from django.apps import apps

GRACE_PERIOD = timedelta(days=7)


def deletion_scheduled_for(organisation):
    """When the purge becomes due, or None if no deletion is pending."""
    if organisation.deleted_at is None:
        return None
    return organisation.deleted_at + GRACE_PERIOD


def organisation_is_locked(organisation_id):
    Organisation = apps.get_model("api", "Organisation")
    return Organisation.objects.filter(
        id=organisation_id, deleted_at__isnull=False
    ).exists()
