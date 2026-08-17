from allauth.account.signals import user_signed_up
from django.db.models.signals import pre_delete
from django.dispatch import receiver
from django.conf import settings
from backend.api.notifier import notify_slack
from api.models import RotatingSecret, RotatingSecretCredential

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
