"""Secret event logging must not issue a query per secret.

``log_secret_events_bulk`` used to build each row with
``environment=secret.environment`` / ``folder=secret.folder``, which
lazy-loads one row per secret: a 50-secret read issued 50 extra SELECTs.
These doubles raise on the related-object accessors, so any regression to
lazy loading fails loudly.
"""

from contextlib import nullcontext
from unittest.mock import patch
from uuid import uuid4

from django.test import override_settings

from api.models import SecretEvent
from api.utils.audit_logging import log_secret_events_bulk


class _Tag:
    def __init__(self, tag_id):
        self.id = tag_id
        self.pk = tag_id


class _Tags:
    def __init__(self, tag_ids):
        self._tags = [_Tag(t) for t in tag_ids]

    def all(self):
        return self._tags


class _Secret:
    def __init__(self, tag_ids=()):
        self.id = str(uuid4())
        self.environment_id = "env-1"
        self.folder_id = None
        self.path = "/"
        self.key = "ph:v1:" + "a" * 64 + ":a2V5"
        self.key_digest = "d" * 64
        self.value = "ph:v1:" + "b" * 64 + ":dmFsdWU="
        self.version = 2
        self.comment = ""
        self.type = "secret"
        self.tags = _Tags(tag_ids)

    @property
    def environment(self):
        raise AssertionError("lazy-loaded secret.environment (one query per secret)")

    @property
    def folder(self):
        raise AssertionError("lazy-loaded secret.folder (one query per secret)")


class _Token:
    id = "sat-1"
    service_account_id = "sa-1"

    @property
    def service_account(self):
        raise AssertionError("lazy-loaded token.service_account")


def _capture_inserts():
    through = SecretEvent.tags.through
    return (
        patch("api.utils.audit_logging.prefetch_related_objects"),
        patch("api.utils.audit_logging.transaction.atomic", return_value=nullcontext()),
        patch.object(
            SecretEvent.objects, "bulk_create", side_effect=lambda objs, **kw: objs
        ),
        patch.object(through.objects, "bulk_create", side_effect=lambda objs, **kw: objs),
    )


@override_settings(SECRET_EVENT_BUFFER_ENABLED=False)
def test_bulk_logging_reads_only_foreign_key_ids():
    secrets = [_Secret(["t1"]), _Secret(), _Secret(["t1", "t2"])]
    p_prefetch, p_atomic, p_events, p_links = _capture_inserts()
    with p_prefetch, p_atomic, p_events as events_create, p_links as links_create:
        log_secret_events_bulk(secrets, SecretEvent.READ, None, _Token(), "10.0.0.1", "ua")

    events = events_create.call_args.args[0]
    assert [e.secret_id for e in events] == [s.id for s in secrets]
    assert {e.environment_id for e in events} == {"env-1"}
    assert all(e.folder_id is None for e in events)
    assert all(e.service_account_id == "sa-1" for e in events)
    assert all(e.service_account_token_id == "sat-1" for e in events)
    assert all(e.event_type == SecretEvent.READ for e in events)

    links = links_create.call_args.args[0]
    assert sorted((str(l.secretevent_id), l.secrettag_id) for l in links) == sorted(
        [
            (str(events[0].pk), "t1"),
            (str(events[2].pk), "t1"),
            (str(events[2].pk), "t2"),
        ]
    )


@override_settings(SECRET_EVENT_BUFFER_ENABLED=False)
def test_bulk_logging_with_no_secrets_writes_nothing():
    p_prefetch, p_atomic, p_events, p_links = _capture_inserts()
    with p_prefetch, p_atomic, p_events as events_create, p_links:
        log_secret_events_bulk([], SecretEvent.READ)
    events_create.assert_not_called()
