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


def log_secret_events_bulk(
    secrets,
    event_type,
    user=None,
    service_token=None,
    service_account_token=None,
    ip_address=None,
    user_agent=None,
):
    """
    Bulk version of log_secret_event. Logs events for multiple secrets
    using bulk_create to reduce database round-trips.
    """

    if not secrets:
        return []

    service_account = None
    if service_account_token is not None:
        service_account = service_account_token.service_account

    now = timezone.now()

    events = [
        SecretEvent(
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
            timestamp=now,
            ip_address=ip_address,
            user_agent=user_agent,
        )
        for secret in secrets
    ]

    created = SecretEvent.objects.bulk_create(events)

    # Bulk M2M: collect all tag associations and insert at once
    through_model = SecretEvent.tags.through
    m2m_rows = []
    for event, secret in zip(created, secrets):
        for tag in secret.tags.all():
            m2m_rows.append(
                through_model(secretevent_id=event.pk, secrettag_id=tag.pk)
            )
    if m2m_rows:
        through_model.objects.bulk_create(m2m_rows)

    return created
