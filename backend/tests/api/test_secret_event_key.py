"""SecretEventType.key: reads keep no copy of the secret, so a page of them is
given, in one query, the key of the write event for the version each read;
without one, a read shows the secret's current key."""

from types import SimpleNamespace
from unittest.mock import patch

from api.models import SecretEvent
from backend.graphene.types import SecretEventType, attach_keys_when_read


def _event(key="", secret_key=None, event_type=SecretEvent.READ, version=1):
    secret = None if secret_key is None else SimpleNamespace(key=secret_key)
    return SimpleNamespace(
        key=key,
        event_type=event_type,
        secret_id=secret and "sec-1",
        secret=secret,
        version=version,
    )


def _attach(events, writes):
    with patch.object(SecretEvent, "objects") as objects:
        lookup = objects.filter.return_value.order_by.return_value.values_list
        lookup.return_value = writes
        attach_keys_when_read(events)
    return objects


def test_event_with_a_copy_shows_its_own_key():
    event = _event(key="ph:v1:own", secret_key="ph:v1:current")
    event._key_when_read = "ph:v1:then"
    assert SecretEventType.resolve_key(event, None) == "ph:v1:own"


def test_read_shows_the_key_of_the_version_it_read():
    event = _event(secret_key="ph:v1:current")
    event._key_when_read = "ph:v1:then"
    assert SecretEventType.resolve_key(event, None) == "ph:v1:then"


def test_read_without_its_version_shows_the_current_key():
    assert SecretEventType.resolve_key(_event(secret_key="ph:v1:current"), None) == (
        "ph:v1:current"
    )


def test_event_without_a_secret_shows_no_key():
    assert SecretEventType.resolve_key(_event(), None) == ""


def test_a_page_of_reads_takes_one_query():
    first = _event(secret_key="ph:v1:current")
    second = _event(secret_key="ph:v1:current", version=2)
    missing = _event(secret_key="ph:v1:current", version=3)

    objects = _attach(
        [first, second, missing],
        [("sec-1", 1, "ph:v1:one"), ("sec-1", 2, "ph:v1:two")],
    )

    objects.filter.assert_called_once_with(
        secret_id__in={"sec-1"},
        event_type__in=[SecretEvent.CREATE, SecretEvent.UPDATE],
    )
    objects.filter.return_value.order_by.assert_called_once_with("timestamp")
    assert first._key_when_read == "ph:v1:one"
    assert second._key_when_read == "ph:v1:two"
    assert missing._key_when_read is None


def test_the_latest_write_of_a_version_wins():
    read = _event(secret_key="ph:v1:current")

    _attach([read], [("sec-1", 1, "ph:v1:older"), ("sec-1", 1, "ph:v1:newer")])

    assert read._key_when_read == "ph:v1:newer"


def test_events_with_their_own_key_take_no_query():
    write = _event(
        key="ph:v1:own", secret_key="ph:v1:current", event_type=SecretEvent.UPDATE
    )
    old_read = _event(key="ph:v1:own", secret_key="ph:v1:current")

    objects = _attach([write, old_read], [])

    objects.filter.assert_not_called()
    assert not hasattr(write, "_key_when_read")
    assert not hasattr(old_read, "_key_when_read")
