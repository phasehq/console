from allauth.account.signals import user_signed_up
from django.dispatch import receiver
from django.conf import settings
from backend.api.notifier import notify_slack

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
