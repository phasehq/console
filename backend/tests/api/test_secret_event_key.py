"""SecretEventType.key: reads keep no copy of the secret, so they show the
secret's current key; events with a copy show their own."""

from types import SimpleNamespace

from backend.graphene.types import SecretEventType


def _resolve(event_key, secret_key=None):
    secret = None if secret_key is None else SimpleNamespace(key=secret_key)
    event = SimpleNamespace(key=event_key, secret_id=secret and "sec-1", secret=secret)
    return SecretEventType.resolve_key(event, None)


def test_read_shows_the_secret_key():
    assert _resolve("", secret_key="ph:v1:current") == "ph:v1:current"


def test_event_with_a_copy_shows_its_own_key():
    assert _resolve("ph:v1:then", secret_key="ph:v1:current") == "ph:v1:then"


def test_event_without_a_secret_shows_no_key():
    assert _resolve("") == ""
