"""Write-behind buffer for SecretEvent rows: payload encoding, producer
fallbacks, flusher ack/salvage behaviour and the log-stream watermark.

Unit tests run without Redis or Postgres. The Lua-script integration test at
the bottom runs only when SECRET_EVENT_BUFFER_TEST_REDIS_URL points at a
scratch Redis database.
"""

import os
from datetime import datetime, timedelta, timezone as dt_timezone
from unittest.mock import MagicMock, call, patch
from uuid import uuid4

import pytest
from django.db import IntegrityError, OperationalError
from django.test import override_settings

from api.utils import secret_event_buffer as buf


# ────────────────────────────────────────────────────────────────────
# Doubles
# ────────────────────────────────────────────────────────────────────


class _Tag:
    def __init__(self, tag_id):
        self.id = tag_id


class _Tags:
    def __init__(self, tags):
        self._tags = tags

    def all(self):
        return self._tags


class _Secret:
    """Secret double whose related-object accessors raise: the logger must
    only read *_id attributes, otherwise it issues one query per secret."""

    def __init__(self, tag_ids=(), env_id="env-1", folder_id=None):
        self.id = str(uuid4())
        self.environment_id = env_id
        self.folder_id = folder_id
        self.path = "/"
        self.key = "ph:v1:" + "a" * 64 + ":a2V5"
        self.key_digest = "d" * 64
        self.value = "ph:v1:" + "b" * 64 + ":dmFsdWU="
        self.version = 3
        self.comment = "ph:v1:" + "c" * 64 + ":"
        self.type = "secret"
        self.tags = _Tags([_Tag(t) for t in tag_ids])

    @property
    def environment(self):
        raise AssertionError("lazy-loaded secret.environment (N+1 query)")

    @property
    def folder(self):
        raise AssertionError("lazy-loaded secret.folder (N+1 query)")


class _Token:
    def __init__(self):
        self.id = "sat-1"
        self.service_account_id = "sa-1"

    @property
    def service_account(self):
        raise AssertionError("lazy-loaded token.service_account")


class _Member:
    id = "om-1"


@pytest.fixture(autouse=True)
def _reset_breaker():
    buf._breaker_open_until = 0.0
    yield
    buf._breaker_open_until = 0.0
    for k in buf._fallbacks:
        buf._fallbacks[k] = 0


@pytest.fixture
def run_on_commit_now():
    with patch(
        "api.utils.secret_event_buffer.transaction.on_commit",
        side_effect=lambda fn: fn(),
    ):
        yield


@pytest.fixture
def no_prefetch():
    with patch("api.utils.audit_logging.prefetch_related_objects"):
        yield


# ────────────────────────────────────────────────────────────────────
# Payload encoding
# ────────────────────────────────────────────────────────────────────


def test_payload_round_trip_preserves_every_field_and_event_time():
    ts = datetime(2026, 10, 31, 9, 15, 2, 123456, tzinfo=dt_timezone.utc)
    secret = _Secret(tag_ids=["tag-1", "tag-2"], folder_id="folder-9")
    header = buf.build_header("R", ts, _Member(), _Token(), "10.0.0.7", "phase-cli/1.19")
    rows = [buf.build_row("event-1", secret, ["tag-1", "tag-2"])]

    decoded_header, decoded_rows = buf.decode_payload(buf.encode_payload(header, rows))
    [(kwargs, tag_ids)] = buf.rows_to_event_kwargs(decoded_header, decoded_rows)

    assert kwargs == {
        "id": "event-1",
        "secret_id": secret.id,
        "environment_id": "env-1",
        "folder_id": "folder-9",
        "path": "/",
        "key": secret.key,
        "key_digest": secret.key_digest,
        "value": secret.value,
        "version": 3,
        "comment": secret.comment,
        "type": "secret",
        "event_type": "R",
        "timestamp": ts,
        "user_id": "om-1",
        "service_account_id": "sa-1",
        "service_account_token_id": "sat-1",
        "ip_address": "10.0.0.7",
        "user_agent": "phase-cli/1.19",
    }
    assert kwargs["timestamp"].tzinfo is not None
    assert tag_ids == ["tag-1", "tag-2"]


def test_rows_for_secrets_created_in_this_request_encode():
    """A row created in the same request still holds uuid.UUID ids."""
    from uuid import UUID

    secret = _Secret(folder_id=uuid4())
    secret.id, secret.environment_id = uuid4(), uuid4()
    token = _Token()
    token.id, token.service_account_id = uuid4(), uuid4()
    header = buf.build_header("C", datetime.now(dt_timezone.utc), None, token, None, None)
    rows = [buf.build_row("event-1", secret, [uuid4()])]

    decoded_header, decoded_rows = buf.decode_payload(buf.encode_payload(header, rows))
    [(kwargs, tag_ids)] = buf.rows_to_event_kwargs(decoded_header, decoded_rows)
    assert kwargs["secret_id"] == str(secret.id)
    assert kwargs["folder_id"] == str(secret.folder_id)
    assert kwargs["service_account_token_id"] == str(token.id)
    assert all(isinstance(t, str) and UUID(t) for t in tag_ids)


def test_decode_rejects_unknown_payload_version():
    import json
    import zlib

    blob = zlib.compress(json.dumps({"v": 999, "h": {}, "r": []}).encode())
    with pytest.raises(ValueError):
        buf.decode_payload(blob)


# ────────────────────────────────────────────────────────────────────
# log_secret_events_bulk
# ────────────────────────────────────────────────────────────────────


@override_settings(SECRET_EVENT_BUFFER_ENABLED=False)
def test_sync_path_inserts_one_row_per_secret_without_lazy_loads(no_prefetch):
    from api.utils.audit_logging import log_secret_events_bulk

    secrets = [_Secret(tag_ids=["t1"]), _Secret(), _Secret(tag_ids=["t1", "t2"])]
    with patch("api.utils.audit_logging.insert_secret_events") as insert:
        log_secret_events_bulk(secrets, "R", None, _Token(), "10.0.0.1", "ua")

    [pairs] = insert.call_args.args
    assert [kw["secret_id"] for kw, _ in pairs] == [s.id for s in secrets]
    assert [tags for _, tags in pairs] == [["t1"], [], ["t1", "t2"]]
    assert len({kw["id"] for kw, _ in pairs}) == 3
    assert len({kw["timestamp"] for kw, _ in pairs}) == 1


def test_empty_secret_list_logs_nothing(no_prefetch):
    from api.utils.audit_logging import log_secret_events_bulk

    with patch("api.utils.audit_logging.insert_secret_events") as insert, patch.object(
        buf, "enqueue"
    ) as enqueue:
        log_secret_events_bulk([], "R")
    insert.assert_not_called()
    enqueue.assert_not_called()


@override_settings(
    SECRET_EVENT_BUFFER_ENABLED=True, SECRET_EVENT_BUFFER_EVENT_TYPES=frozenset("CRUD")
)
def test_buffered_path_writes_to_redis_not_postgres(no_prefetch, run_on_commit_now):
    from api.utils.audit_logging import log_secret_events_bulk

    secrets = [_Secret(), _Secret()]
    with patch.object(buf, "enqueue", return_value=True) as enqueue, patch(
        "api.utils.audit_logging.insert_secret_events"
    ) as insert:
        log_secret_events_bulk(secrets, "U", _Member(), None, "10.0.0.1", "ua")

    insert.assert_not_called()
    header, rows = enqueue.call_args.args
    assert header["et"] == "U" and header["u"] == "om-1" and header["sat"] is None
    assert [r[1] for r in rows] == [s.id for s in secrets]


@override_settings(
    SECRET_EVENT_BUFFER_ENABLED=True, SECRET_EVENT_BUFFER_EVENT_TYPES=frozenset("R")
)
def test_event_types_outside_the_buffer_list_insert_synchronously(
    no_prefetch, run_on_commit_now
):
    from api.utils.audit_logging import log_secret_events_bulk

    with patch.object(buf, "enqueue", return_value=True) as enqueue, patch(
        "api.utils.audit_logging.insert_secret_events"
    ) as insert:
        log_secret_events_bulk([_Secret()], "U", _Member())
        insert.assert_called_once()
        enqueue.assert_not_called()

        log_secret_events_bulk([_Secret()], "R", _Member())
        enqueue.assert_called_once()
        insert.assert_called_once()


@override_settings(SECRET_EVENT_BUFFER_ENABLED=True)
def test_refused_enqueue_falls_back_to_sync_insert_with_same_event_ids(
    no_prefetch, run_on_commit_now
):
    """Same ids on both paths: if Redis accepted the write but the reply was
    lost, the flusher's ON CONFLICT DO NOTHING dedupes against the sync row."""
    from api.utils.audit_logging import log_secret_events_bulk

    with patch.object(buf, "enqueue", return_value=False) as enqueue, patch(
        "api.utils.audit_logging.insert_secret_events"
    ) as insert:
        log_secret_events_bulk([_Secret(), _Secret()], "R", None, _Token())

    _, rows = enqueue.call_args.args
    [pairs] = insert.call_args.args
    assert [kw["id"] for kw, _ in pairs] == [r[0] for r in rows]


def test_log_secret_event_delegates_to_bulk():
    from api.utils import audit_logging

    secret = _Secret()
    with patch.object(audit_logging, "log_secret_events_bulk") as bulk:
        audit_logging.log_secret_event(secret, "C", user="u", ip_address="1.2.3.4")
    bulk.assert_called_once_with(
        [secret],
        "C",
        user="u",
        service_account_token=None,
        ip_address="1.2.3.4",
        user_agent=None,
    )


# ────────────────────────────────────────────────────────────────────
# enqueue
# ────────────────────────────────────────────────────────────────────


def _header():
    return buf.build_header(
        "R", datetime.now(dt_timezone.utc), None, None, "10.0.0.1", "ua"
    )


@override_settings(SECRET_EVENT_BUFFER_MAX_BYTES=1024)
def test_enqueue_passes_budget_and_row_count_to_script():
    script = MagicMock(return_value=1)
    with patch.object(buf, "_script", return_value=script):
        assert buf.enqueue(_header(), [buf.build_row("e1", _Secret(), [])]) is True
    kwargs = script.call_args.kwargs
    assert kwargs["keys"] == [buf.STREAM_KEY, buf.BYTES_KEY]
    assert kwargs["args"][1:] == [1024, 1]


def test_enqueue_over_budget_returns_false_and_rate_limits_the_warning():
    buf._fallbacks_reported_at = 0.0
    with patch.object(buf, "_script", return_value=MagicMock(return_value=0)), patch.object(
        buf.logger, "warning"
    ) as warn:
        for _ in range(50):
            assert buf.enqueue(_header(), [buf.build_row("e1", _Secret(), [])]) is False
    assert warn.call_count == 1  # one summary line, not one per request
    assert buf._fallbacks["over_budget"] == 49  # counted for the next report


def test_enqueue_redis_error_opens_breaker():
    import redis

    failing = MagicMock(side_effect=redis.ConnectionError("down"))
    with patch.object(buf, "_script", return_value=failing) as script:
        assert buf.enqueue(_header(), []) is False
        # Within the breaker window Redis is not touched again.
        assert buf.enqueue(_header(), []) is False
    assert script.call_count == 1


# ────────────────────────────────────────────────────────────────────
# Flusher
# ────────────────────────────────────────────────────────────────────


@pytest.fixture
def flusher():
    from api.utils.secret_event_flusher import SecretEventFlusher

    client = MagicMock()
    ack = MagicMock()
    client.register_script.return_value = ack
    with patch.object(buf, "make_client", return_value=client):
        f = SecretEventFlusher(consumer="test-consumer")
    f.client, f._ack = client, ack
    return f


def _entry(entry_id, secrets, event_type="R", sat=None):
    header = buf.build_header(
        event_type, datetime.now(dt_timezone.utc), None, sat, "10.0.0.1", "ua"
    )
    rows = [buf.build_row(str(uuid4()), s, [t.id for t in s.tags.all()]) for s in secrets]
    blob = buf.encode_payload(header, rows)
    return (entry_id, {b"d": blob}), blob


def test_flusher_inserts_all_entries_in_one_batch_then_acks(flusher):
    (e1, blob1), (e2, blob2) = _entry(b"1-0", [_Secret()]), _entry(b"2-0", [_Secret(), _Secret()])
    order = MagicMock()
    flusher._ack.side_effect = lambda **kw: order.ack(**kw)

    def insert(pairs, batch_size):
        order.insert(len(pairs))
        return len(pairs)

    with patch("api.utils.audit_logging.insert_secret_events", side_effect=insert):
        rows = flusher.process([e1, e2])

    assert rows == 3
    assert order.mock_calls == [
        call.insert(3),
        call.ack(
            keys=[buf.STREAM_KEY, buf.BYTES_KEY],
            args=[buf.CONSUMER_GROUP, len(blob1) + len(blob2), b"1-0", b"2-0"],
        ),
    ]


def test_flusher_leaves_entries_pending_when_postgres_fails(flusher):
    entry, _ = _entry(b"1-0", [_Secret()])
    with patch(
        "api.utils.audit_logging.insert_secret_events",
        side_effect=OperationalError("connection refused"),
    ):
        with pytest.raises(OperationalError):
            flusher.process([entry])
    flusher._ack.assert_not_called()


def test_flusher_salvages_rows_whose_parents_were_deleted(flusher):
    alive, orphan = _Secret(tag_ids=["tag-live", "tag-gone"]), _Secret()
    entry, _ = _entry(b"1-0", [alive, orphan], sat=_Token())

    def existing(model, ids):
        ids = set(i for i in ids if i)
        gone = {orphan.id, "sat-1", "tag-gone"}  # token and a tag were deleted too
        return ids - gone

    inserted = []

    def insert(pairs, batch_size):
        if not inserted:
            inserted.append(None)
            raise IntegrityError("violates foreign key constraint")
        inserted.append(pairs)
        return len(pairs)

    with patch.object(flusher, "_existing_ids", side_effect=existing), patch(
        "api.utils.audit_logging.insert_secret_events", side_effect=insert
    ):
        flusher.process([entry])

    [(kwargs, tags)] = inserted[1]
    assert kwargs["secret_id"] == alive.id
    assert kwargs["service_account_token_id"] is None  # ON DELETE SET NULL
    assert kwargs["service_account_id"] == "sa-1"
    assert tags == ["tag-live"]
    assert flusher.totals["dropped_rows"] == 1  # ON DELETE CASCADE
    flusher._ack.assert_called_once()


def test_flusher_dead_letters_a_poison_entry_but_inserts_its_neighbours(flusher):
    (good, _), (bad, _) = _entry(b"1-0", [_Secret()]), _entry(b"2-0", [_Secret()])
    bad_secret_id = buf.decode_payload(bad[1][b"d"])[1][0][1]

    def insert(pairs, batch_size):
        if any(kw["secret_id"] == bad_secret_id for kw, _ in pairs):
            raise ValueError("unserialisable row")
        return len(pairs)

    with patch.object(flusher, "_existing_ids", side_effect=lambda m, ids: set(ids)), patch(
        "api.utils.audit_logging.insert_secret_events", side_effect=insert
    ):
        assert flusher.process([good, bad]) == 1

    assert flusher.client.xadd.call_args.args[0] == buf.DEAD_LETTER_KEY
    assert flusher.client.xadd.call_args.args[1]["src"] == b"2-0"
    flusher._ack.assert_called_once()


def test_flusher_retries_a_lone_failing_entry_before_dead_lettering(flusher):
    from api.utils.secret_event_flusher import MAX_ENTRY_ATTEMPTS

    entry, _ = _entry(b"1-0", [_Secret()])
    with patch.object(flusher, "_existing_ids", side_effect=lambda m, ids: set(ids)), patch(
        "api.utils.audit_logging.insert_secret_events",
        side_effect=IntegrityError("column does not exist yet"),
    ):
        for _ in range(MAX_ENTRY_ATTEMPTS - 1):
            with pytest.raises(IntegrityError):
                flusher.process([entry])
            flusher._ack.assert_not_called()
            flusher.client.xadd.assert_not_called()
        flusher.process([entry])

    assert flusher.client.xadd.call_args.args[0] == buf.DEAD_LETTER_KEY
    flusher._ack.assert_called_once()


def test_flusher_dead_letters_undecodable_entry_and_still_acks(flusher):
    good, _ = _entry(b"2-0", [_Secret()])
    with patch(
        "api.utils.audit_logging.insert_secret_events", return_value=1
    ) as insert:
        flusher.process([(b"1-0", {b"d": b"not zlib"}), good])

    assert flusher.client.xadd.call_args.args[0] == buf.DEAD_LETTER_KEY
    assert len(insert.call_args.args[0]) == 1
    assert flusher._ack.call_args.kwargs["args"][2:] == [b"1-0", b"2-0"]
    assert flusher.totals["dead_letters"] == 1


def test_flusher_forgets_only_idle_consumers_with_nothing_pending(flusher):
    hour = 3_600_000
    flusher.client.xinfo_consumers.return_value = [
        {"name": b"old-empty", "pending": 0, "idle": hour + 1},
        {"name": b"old-with-pending", "pending": 3, "idle": hour * 5},
        {"name": b"recent", "pending": 0, "idle": 1000},
        {"name": flusher.consumer.encode(), "pending": 0, "idle": hour * 2},
    ]
    assert flusher.remove_dead_consumers() == 1
    flusher.client.xgroup_delconsumer.assert_called_once_with(
        buf.STREAM_KEY, buf.CONSUMER_GROUP, "old-empty"
    )


def test_flusher_acks_entries_already_deleted_by_a_previous_owner(flusher):
    with patch("api.utils.audit_logging.insert_secret_events") as insert:
        flusher.process([(b"1-0", None)])
    insert.assert_not_called()
    assert flusher._ack.call_args.kwargs["args"] == [buf.CONSUMER_GROUP, 0, b"1-0"]


# ────────────────────────────────────────────────────────────────────
# Log stream watermark
# ────────────────────────────────────────────────────────────────────

NOW = datetime(2026, 10, 31, 12, 0, 0, tzinfo=dt_timezone.utc)


@pytest.fixture
def frozen_now():
    with patch("ee.integrations.logs.streams.sources.timezone.now", return_value=NOW):
        yield


@override_settings(SECRET_EVENT_BUFFER_ENABLED=False)
def test_watermark_unchanged_when_buffer_disabled(frozen_now):
    from ee.integrations.logs.streams.sources import SecretEventLogSource

    with patch.object(buf, "oldest_buffered_at") as oldest:
        assert SecretEventLogSource().ship_watermark() == NOW - timedelta(seconds=30)
    oldest.assert_not_called()


@override_settings(SECRET_EVENT_BUFFER_ENABLED=True)
def test_watermark_held_behind_oldest_buffered_entry(frozen_now):
    from ee.integrations.logs.streams.sources import SecretEventLogSource

    oldest = NOW - timedelta(minutes=5)
    with patch.object(buf, "oldest_buffered_at", return_value=oldest):
        assert SecretEventLogSource().ship_watermark() == oldest - timedelta(seconds=30)
    with patch.object(buf, "oldest_buffered_at", return_value=None):
        assert SecretEventLogSource().ship_watermark() == NOW - timedelta(seconds=30)


@override_settings(SECRET_EVENT_BUFFER_ENABLED=True)
def test_unreadable_buffer_holds_the_cursor(frozen_now):
    from ee.integrations.logs.streams.sources import SecretEventLogSource

    source = SecretEventLogSource()
    with patch.object(buf, "oldest_buffered_at", side_effect=ConnectionError), patch.object(
        source, "_queryset", side_effect=AssertionError("must not query")
    ):
        assert source.ship_watermark() is None
        assert source.fetch(organisation=None, cursor={"ts": NOW.isoformat(), "id": ""}, limit=10) == []


@override_settings(SECRET_EVENT_BUFFER_ENABLED=True)
def test_audit_log_source_ignores_the_secret_event_buffer(frozen_now):
    from ee.integrations.logs.streams.sources import OrgAuditLogSource

    with patch.object(buf, "oldest_buffered_at") as oldest:
        assert OrgAuditLogSource().ship_watermark() == NOW - timedelta(seconds=30)
    oldest.assert_not_called()


# ────────────────────────────────────────────────────────────────────
# Lua scripts against a real Redis (opt-in)
# ────────────────────────────────────────────────────────────────────

REDIS_URL = os.getenv("SECRET_EVENT_BUFFER_TEST_REDIS_URL")


@pytest.fixture
def real_redis():
    if not REDIS_URL:
        pytest.skip("SECRET_EVENT_BUFFER_TEST_REDIS_URL not set")
    import redis

    client = redis.Redis.from_url(REDIS_URL)
    client.delete(buf.STREAM_KEY, buf.BYTES_KEY, buf.DEAD_LETTER_KEY)
    saved = (buf._client, buf._client_pid, buf._scripts)
    buf._client, buf._client_pid = client, os.getpid()
    buf._scripts = {
        "enqueue": client.register_script(buf._ENQUEUE_LUA),
        "ack": client.register_script(buf._ACK_LUA),
    }
    yield client
    client.delete(buf.STREAM_KEY, buf.BYTES_KEY, buf.DEAD_LETTER_KEY)
    buf._client, buf._client_pid, buf._scripts = saved


def test_budget_refuses_writes_and_ack_releases_bytes(real_redis):
    rows = [buf.build_row(str(uuid4()), _Secret(), [])]
    size = len(buf.encode_payload(_header(), rows))

    with override_settings(SECRET_EVENT_BUFFER_MAX_BYTES=size * 2 + size // 2):
        assert buf.enqueue(_header(), rows)
        assert buf.enqueue(_header(), rows)
        assert not buf.enqueue(_header(), rows)  # third would exceed the budget

    used = int(real_redis.get(buf.BYTES_KEY))
    assert real_redis.xlen(buf.STREAM_KEY) == 2
    real_redis.xgroup_create(buf.STREAM_KEY, buf.CONSUMER_GROUP, id="0")
    entries = real_redis.xreadgroup(buf.CONSUMER_GROUP, "c1", {buf.STREAM_KEY: ">"})[0][1]

    ack = buf._scripts["ack"]
    first_id = entries[0][0]
    first_len = len(entries[0][1][b"d"])
    ack(keys=[buf.STREAM_KEY, buf.BYTES_KEY], args=[buf.CONSUMER_GROUP, first_len, first_id])
    assert int(real_redis.get(buf.BYTES_KEY)) == used - first_len
    assert buf.oldest_buffered_at() is not None

    # Draining the stream resets the counter even if it had drifted.
    real_redis.incrby(buf.BYTES_KEY, 12345)
    second_id = entries[1][0]
    ack(keys=[buf.STREAM_KEY, buf.BYTES_KEY], args=[buf.CONSUMER_GROUP, 1, second_id])
    assert int(real_redis.get(buf.BYTES_KEY)) == 0
    assert real_redis.xlen(buf.STREAM_KEY) == 0
    assert buf.oldest_buffered_at() is None
