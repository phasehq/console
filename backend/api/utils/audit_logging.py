from django.utils import timezone

from api.models import SecretEvent


def log_secret_event(
    secret,
    event_type,
    user=None,
    service_token=None,
    service_account_token=None,
    ip_address=None,
    user_agent=None,
):
    """
    Utility function to log secret events.
    """

    service_account = None
    if service_account_token is not None:
        service_account = service_account_token.service_account

    event = SecretEvent.objects.create(
        secret=secret,
        environment=secret.environment,
        folder=secret.folder,
        path=secret.path,
        user=user,
        service_token=service_token,
        service_account=service_account,
        service_account_token=service_account_token,
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
