from django.utils import timezone
from django.db import transaction
from django.db.models import prefetch_related_objects

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
        type=secret.type,
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

    # Load tags for all secrets in one query, regardless of caller's prefetch state.
    prefetch_related_objects(secrets, "tags")

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
            type=secret.type,
            event_type=event_type,
            ip_address=ip_address,
            user_agent=user_agent,
        )
        for secret in secrets
    ]

    with transaction.atomic():
        created = SecretEvent.objects.bulk_create(events, batch_size=1000)

        through_model = SecretEvent.tags.through
        m2m_rows = [
            through_model(secretevent_id=event.pk, secrettag_id=tag.pk)
            for event, secret in zip(created, secrets)
            for tag in secret.tags.all()
        ]
        if m2m_rows:
            through_model.objects.bulk_create(m2m_rows, batch_size=1000)

    return created
