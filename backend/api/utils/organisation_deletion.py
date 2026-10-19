"""Organisation deletion: an owner request locks the organisation for a grace
period, after which a background job purges it unless it was restored."""

from datetime import timedelta

from django.apps import apps
from django.conf import settings

# TEMP for staging QA. Revert to timedelta(days=7) before merging.
GRACE_PERIOD = timedelta(minutes=5)


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


def has_pending_invoices(organisation):
    """Phase Cloud: whether a paid subscription has an unpaid invoice. That blocks
    deletion, since the purge would cancel the subscription before it's paid."""
    if settings.APP_HOST != "cloud":
        return False
    from ee.billing.stripe import has_unpaid_subscriptions

    return has_unpaid_subscriptions(organisation)
