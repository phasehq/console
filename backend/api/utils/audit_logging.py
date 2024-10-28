from django.utils import timezone

from api.models import SecretEvent


def log_secret_event(
    secret,
    event_type,
    user=None,
    service_token=None,
    service_account=None,
    ip_address=None,
    user_agent=None,
):
    """
    Utility function to log secret events.
    """
    event = SecretEvent.objects.create(
        secret=secret,
        environment=secret.environment,
        folder=secret.folder,
        path=secret.path,
        user=user,
        service_token=service_token,
        service_account=service_account,
        key=secret.key,
        key_digest=secret.key_digest,
        value=secret.value,
        version=secret.version,
        comment=secret.comment,
        event_type=event_type,
        timestamp=timezone.now(),
        ip_address=ip_address,
        user_agent=user_agent,
    )

    event.tags.set(secret.tags.all())
