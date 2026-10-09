import logging
import time
import weakref

from allauth.account.signals import user_signed_up
from django.db import transaction
from django.db.models.signals import pre_delete
from django.dispatch import receiver
from django.conf import settings
from backend.api.notifier import notify_slack
from api.models import DynamicSecretLease, RotatingSecret, RotatingSecretCredential

logger = logging.getLogger(__name__)

# Keeps one slow or unreachable provider from pushing a delete past worker timeouts.
CASCADE_REVOKE_BUDGET_SECONDS = 20
_cascade_revoke_state = {}

CLOUD_HOSTED = settings.APP_HOST == "cloud"


@receiver(user_signed_up)
def notify_new_user_signup(request, user, **kwargs):
    """Notify Slack when a new user signs up. Uses allauth's user_signed_up signal
    which fires AFTER the user is committed to the database, avoiding duplicate
    notifications from failed/retried OAuth flows."""

    if CLOUD_HOSTED:
        try:
            social_account = user.socialaccount_set.first()
            full_name = (
                (social_account.extra_data.get("name") if social_account else None)
                or user.full_name
                or user.username
                or user.email
            )
            notify_slack(f"New user signup: {full_name} - {user.email}")
        except Exception as e:
            print(f"Error notifying Slack: {e}")


@receiver(pre_delete, sender=RotatingSecret)
def _rotating_secret_pre_delete(sender, instance, **kwargs):
    # Cascade hard-deletes from Environment/App/Folder bypass the soft-delete
    # RotatingSecret.delete(). Without this, provider credentials stay live
    # and scheduled jobs keep firing against a gone row.
    from ee.integrations.secrets.rotation.engine import (
        cancel_rotation_jobs,
        revoke_credential,
    )

    cancel_rotation_jobs(instance)
    for cred in instance.credentials.filter(
        status__in=[
            RotatingSecretCredential.ACTIVE,
            RotatingSecretCredential.EXPIRING,
            RotatingSecretCredential.REVOKING,
        ]
    ):
        try:
            revoke_credential(cred.id, immediate=True)
        except Exception:
            pass


def _cascade_revoke_budget(origin):
    # One budget per delete attempt: a retry has a new origin object or transaction.
    atomic_blocks = transaction.get_connection().atomic_blocks
    outermost = atomic_blocks[0] if atomic_blocks else None
    owners = [owner for owner in (origin, outermost) if owner is not None]
    key = tuple(id(owner) for owner in owners)
    state = _cascade_revoke_state.get(key) if owners else None
    if state is None:
        state = {
            "deadline": time.monotonic() + CASCADE_REVOKE_BUDGET_SECONDS,
            "unreachable_authentication_ids": set(),
        }
        try:
            for owner in owners:
                weakref.finalize(owner, _cascade_revoke_state.pop, key, None)
        except TypeError:
            return state
        if owners:
            _cascade_revoke_state[key] = state
    return state


def _log_unrevoked_lease(lease, reason, exc_info=False):
    from ee.integrations.secrets.dynamic.utils import lease_iam_username

    logger.error(
        "Dynamic secret lease %s was not revoked during cascade delete (%s); "
        "delete IAM user %s manually (secret %s, environment %s, credential %s, "
        "expires %s)",
        lease.id,
        reason,
        lease_iam_username(lease) or "<unknown>",
        lease.secret_id,
        lease.secret.environment_id,
        lease.secret.authentication_id,
        lease.expires_at,
        exc_info=exc_info,
    )


@receiver(pre_delete, sender=DynamicSecretLease)
def _dynamic_secret_lease_pre_delete(sender, instance, origin=None, **kwargs):
    # Cascades skip DynamicSecret.delete(); a queued revoke job would find no row.
    if instance.status != DynamicSecretLease.ACTIVE:
        return

    from ee.integrations.secrets.dynamic.utils import (
        is_provider_unreachable_error,
        revoke_lease_immediately,
    )

    budget = _cascade_revoke_budget(origin)
    authentication_id = instance.secret.authentication_id
    if time.monotonic() > budget["deadline"]:
        _log_unrevoked_lease(instance, "revocation time budget exhausted")
        return
    if authentication_id in budget["unreachable_authentication_ids"]:
        _log_unrevoked_lease(instance, "provider unreachable earlier in this delete")
        return

    try:
        # Savepoint so a swallowed DB error can't abort the cascade transaction.
        with transaction.atomic():
            revoke_lease_immediately(instance)
    except Exception as exc:
        if is_provider_unreachable_error(exc):
            budget["unreachable_authentication_ids"].add(authentication_id)
        _log_unrevoked_lease(instance, "revocation failed", exc_info=True)
