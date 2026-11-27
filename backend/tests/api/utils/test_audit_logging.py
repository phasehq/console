"""Secret events: a read records who read which version of a secret, not a copy
of it. The write event of that version already holds the key, value, comment
and tags."""

from itertools import count
from types import SimpleNamespace
from unittest.mock import patch

from api.models import SecretEvent
from api.utils import audit_logging

_M = "api.utils.audit_logging"


def _secret(tags=()):
    return SimpleNamespace(
        environment="env-1",
        folder=None,
        path="/billing",
        key="ph:v1:key",
        key_digest="digest",
        value="ph:v1:value",
        version=3,
        comment="ph:v1:comment",
        type="config",
        tags=SimpleNamespace(all=lambda: list(tags)),
    )


def _log(log, secrets, event_type):
    ids = count(1)
    with patch(f"{_M}.SecretEvent") as events, patch(
        f"{_M}.prefetch_related_objects"
    ) as prefetch, patch(f"{_M}.transaction"):
        events.READ = SecretEvent.READ
        events.side_effect = lambda **fields: SimpleNamespace(
            pk=f"event-{next(ids)}", **fields
        )
        events.objects.bulk_create.side_effect = lambda rows, batch_size: rows
        log(secrets, event_type, ip_address="10.0.0.1", user_agent="phase-cli")
    created = events.objects.bulk_create.call_args.args[0]
    return created, events, prefetch


def test_read_keeps_no_copy_of_the_secret():
    created, events, prefetch = _log(
        audit_logging.log_secret_events_bulk,
        [_secret(tags=[SimpleNamespace(pk="tag-1")])],
        SecretEvent.READ,
    )

    (event,) = created
    assert (event.key, event.key_digest, event.value, event.comment) == ("", "", "", "")
    assert (event.version, event.path, event.type) == (3, "/billing", "config")
    assert (event.ip_address, event.user_agent) == ("10.0.0.1", "phase-cli")
    events.tags.through.objects.bulk_create.assert_not_called()
    prefetch.assert_not_called()


def test_write_keeps_the_secret_and_its_tags():
    tags = [SimpleNamespace(pk="tag-1"), SimpleNamespace(pk="tag-2")]

    created, events, prefetch = _log(
        audit_logging.log_secret_events_bulk, [_secret(tags=tags)], SecretEvent.UPDATE
    )

    (event,) = created
    assert (event.key, event.key_digest, event.value, event.comment) == (
        "ph:v1:key",
        "digest",
        "ph:v1:value",
        "ph:v1:comment",
    )
    links = [call.kwargs for call in events.tags.through.call_args_list]
    assert links == [
        {"secretevent_id": event.pk, "secrettag_id": "tag-1"},
        {"secretevent_id": event.pk, "secrettag_id": "tag-2"},
    ]
    events.tags.through.objects.bulk_create.assert_called_once()
    prefetch.assert_called_once()


def test_single_event_logging_follows_the_same_rule():
    def log_one(secrets, event_type, **meta):
        audit_logging.log_secret_event(secrets[0], event_type, **meta)

    created, events, _ = _log(log_one, [_secret()], SecretEvent.READ)

    (event,) = created
    assert (event.key, event.value, event.comment) == ("", "", "")
    events.tags.through.objects.bulk_create.assert_not_called()
