"""Write-behind buffer for ``SecretEvent`` rows.

Secret reads and writes stay synchronous against Postgres. Only the audit
rows they produce are deferred: the request serialises its events into one
compressed Redis stream entry (a single round trip regardless of how many
secrets were touched), and the ``flush_secret_events`` consumer bulk-inserts
entries from every tenant into ``api_secretevent`` in large batches.

Guarantees and safety valves:

* **Nothing is dropped on the request path.** If Redis is unreachable, slow,
  or the buffer is over its byte budget, the events are inserted
  synchronously, exactly as before. The budget is what keeps Redis memory
  bounded when the flusher falls behind.
* **Idempotent replay.** Event ids are minted here, before the entry is
  written, and the flusher inserts with ``ON CONFLICT DO NOTHING``. An entry
  that is flushed twice (consumer crashed between commit and ack) or that was
  both buffered and inserted synchronously (Redis timed out after accepting
  the write) lands once.
* **Event time is preserved.** Each entry carries the time of the request;
  rows land with that timestamp, not the flush time.
* **Tenancy lives on the row.** Every row carries its environment id (and
  therefore app and organisation), so one flat stream serves all tenants and
  a single INSERT can carry rows for many organisations.

Keys use a ``{secret-events}`` hash tag so the stream and its byte counter
share a slot under Redis/Valkey cluster mode.
"""

import json
import logging
import os
import socket
import time
import zlib
from datetime import datetime, timezone as dt_timezone
from uuid import uuid4

from django.conf import settings
from django.db import transaction

logger = logging.getLogger(__name__)

STREAM_KEY = "{secret-events}:stream"
BYTES_KEY = "{secret-events}:bytes"
DEAD_LETTER_KEY = "{secret-events}:dead"
CONSUMER_GROUP = "secret-event-flushers"
PAYLOAD_VERSION = 1

# Conditional XADD: refuse the write once the stream holds more than the byte
# budget, so a stalled flusher degrades to synchronous inserts instead of
# growing Redis without bound.
_ENQUEUE_LUA = """
local size = string.len(ARGV[1])
local used = tonumber(redis.call('GET', KEYS[2]) or '0')
if used + size > tonumber(ARGV[2]) then
    return 0
end
redis.call('XADD', KEYS[1], '*', 'd', ARGV[1], 'n', ARGV[3])
redis.call('INCRBY', KEYS[2], size)
return 1
"""

# Ack + delete flushed entries and release their bytes atomically. Resets the
# counter whenever the stream is empty so drift (e.g. a consumer killed
# between XDEL and DECRBY in some older code path) can never wedge the budget.
_ACK_LUA = """
local n = #ARGV - 2
local ids = {}
for i = 3, #ARGV do ids[i - 2] = ARGV[i] end
redis.call('XACK', KEYS[1], ARGV[1], unpack(ids))
redis.call('XDEL', KEYS[1], unpack(ids))
local left = redis.call('DECRBY', KEYS[2], ARGV[2])
if left < 0 or redis.call('XLEN', KEYS[1]) == 0 then
    redis.call('SET', KEYS[2], 0)
end
return n
"""

_client = None
_client_pid = None
_scripts = {}

# Per-process circuit breaker: after a Redis failure, skip the buffer for a
# few seconds instead of paying the socket timeout on every request.
_breaker_open_until = 0.0
_BREAKER_SECONDS = 5.0

# Fallbacks are reported as one summary line per process per interval rather
# than one line per request (an overloaded flusher would otherwise make every
# request log).
_FALLBACK_REPORT_SECONDS = 10.0
_fallbacks = {"over_budget": 0, "unavailable": 0, "breaker_open": 0}
_fallbacks_reported_at = 0.0


def _note_fallback(reason, exc_info=False):
    global _fallbacks_reported_at
    _fallbacks[reason] += 1
    now = time.monotonic()
    if now - _fallbacks_reported_at < _FALLBACK_REPORT_SECONDS and not exc_info:
        return
    _fallbacks_reported_at = now
    counts = {k: v for k, v in _fallbacks.items() if v}
    for k in _fallbacks:
        _fallbacks[k] = 0
    logger.warning(
        "Secret event buffer fallback: requests inserted synchronously %s "
        "(budget %s bytes)",
        counts,
        settings.SECRET_EVENT_BUFFER_MAX_BYTES,
        exc_info=exc_info,
    )


def is_enabled():
    return getattr(settings, "SECRET_EVENT_BUFFER_ENABLED", False)


def should_buffer(event_type):
    return is_enabled() and event_type in getattr(
        settings, "SECRET_EVENT_BUFFER_EVENT_TYPES", frozenset("R")
    )


def make_client(timeout):
    """New Redis client for the buffer's keys. ``timeout`` bounds connect and
    socket reads; the request path uses a short one, the flusher a long one
    (it blocks in XREADGROUP)."""
    import redis

    kwargs = {
        "host": settings.REDIS_HOST,
        "port": settings.REDIS_PORT,
        "username": settings.REDIS_USER,
        "password": settings.REDIS_PASSWORD,
        "socket_timeout": timeout,
        "socket_connect_timeout": timeout,
        "health_check_interval": 30,
    }
    if settings.REDIS_SSL:
        kwargs.update(
            ssl=True,
            ssl_cert_reqs="required",
            ssl_ca_certs=os.getenv("REDIS_SSL_CA_PATH"),
        )
    return redis.Redis(**kwargs)


def get_client():
    """Process-local request-path client with short timeouts (fork-safe)."""
    global _client, _client_pid, _scripts
    pid = os.getpid()
    if _client is None or _client_pid != pid:
        _client = make_client(settings.SECRET_EVENT_BUFFER_REDIS_TIMEOUT)
        _client_pid = pid
        _scripts = {
            "enqueue": _client.register_script(_ENQUEUE_LUA),
            "ack": _client.register_script(_ACK_LUA),
        }
    return _client


def _script(name):
    get_client()
    return _scripts[name]


# --------------------------------------------------------------------------
# Payload encoding
# --------------------------------------------------------------------------
#
# One entry per request: a header with the fields shared by every row (actor,
# request metadata, event type, timestamp) and one compact positional list per
# secret. JSON + zlib level 1: ciphertexts are base64 and barely compress, but
# the ids, paths and header do.

ROW_FIELDS = (
    "id",
    "secret_id",
    "environment_id",
    "folder_id",
    "path",
    "key",
    "key_digest",
    "value",
    "version",
    "comment",
    "type",
    "tag_ids",
)


def encode_payload(header, rows):
    doc = {"v": PAYLOAD_VERSION, "h": header, "r": rows}
    raw = json.dumps(doc, separators=(",", ":")).encode()
    return zlib.compress(raw, 1)


def decode_payload(blob):
    doc = json.loads(zlib.decompress(blob))
    if doc.get("v") != PAYLOAD_VERSION:
        raise ValueError(f"Unsupported secret event payload version {doc.get('v')!r}")
    return doc["h"], doc["r"]


def _id(value):
    # Ids are TextFields defaulting to uuid4: a row created in this request
    # still holds a uuid.UUID until it is reloaded, which JSON can't encode.
    return None if value is None else str(value)


def build_header(event_type, timestamp, user, service_account_token, ip_address, user_agent):
    sat = service_account_token
    return {
        "et": event_type,
        "ts": timestamp.isoformat(),
        "u": _id(user.id) if user is not None else None,
        # service_account_id, not .service_account: avoids a lazy-load query.
        "sa": _id(sat.service_account_id) if sat is not None else None,
        "sat": _id(sat.id) if sat is not None else None,
        "ip": ip_address,
        "ua": user_agent,
    }


def build_row(event_id, secret, tag_ids):
    # *_id attributes only: touching secret.environment / secret.folder here
    # would issue one query per secret.
    return [
        event_id,
        _id(secret.id),
        _id(secret.environment_id),
        _id(secret.folder_id),
        secret.path,
        secret.key,
        secret.key_digest,
        secret.value,
        secret.version,
        secret.comment,
        secret.type,
        [_id(t) for t in tag_ids],
    ]


def rows_to_event_kwargs(header, rows):
    """Expand a decoded entry into (SecretEvent kwargs, tag ids) pairs."""
    ts = datetime.fromisoformat(header["ts"])
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=dt_timezone.utc)
    shared = {
        "event_type": header["et"],
        "timestamp": ts,
        "user_id": header["u"],
        "service_account_id": header["sa"],
        "service_account_token_id": header["sat"],
        "ip_address": header["ip"],
        "user_agent": header["ua"],
    }
    out = []
    for row in rows:
        values = dict(zip(ROW_FIELDS, row))
        tag_ids = values.pop("tag_ids") or []
        values.update(shared)
        out.append((values, tag_ids))
    return out


# --------------------------------------------------------------------------
# Producer
# --------------------------------------------------------------------------


def enqueue(header, rows):
    """Try to buffer one request's events. Returns True when Redis accepted
    them, False when the caller must insert synchronously (buffer over budget,
    Redis unavailable, or breaker open)."""
    global _breaker_open_until

    if time.monotonic() < _breaker_open_until:
        _note_fallback("breaker_open")
        return False

    try:
        blob = encode_payload(header, rows)
        accepted = _script("enqueue")(
            keys=[STREAM_KEY, BYTES_KEY],
            args=[blob, settings.SECRET_EVENT_BUFFER_MAX_BYTES, len(rows)],
        )
    except Exception:
        _breaker_open_until = time.monotonic() + _BREAKER_SECONDS
        _note_fallback("unavailable", exc_info=True)
        return False

    if not accepted:
        _note_fallback("over_budget")
        return False
    return True


def buffer_or_insert(header, rows, insert_sync):
    """Buffer after the surrounding transaction commits (immediately in
    autocommit), falling back to ``insert_sync(header, rows)``.

    Deferring to on_commit means a rolled-back secret write never produces a
    buffered event that would later reference a row that does not exist.
    """

    def _run():
        if not enqueue(header, rows):
            insert_sync(header, rows)

    transaction.on_commit(_run)


# --------------------------------------------------------------------------
# Introspection used by log streams and monitoring
# --------------------------------------------------------------------------


def oldest_buffered_at():
    """Enqueue time of the oldest entry still in the buffer, None when empty.

    Entries are deleted only after their rows are committed, so this is a
    floor for the timestamp of any event that has not yet reached Postgres.
    Raises on Redis errors; callers decide how to degrade.
    """
    head = get_client().xrange(STREAM_KEY, count=1)
    if not head:
        return None
    entry_id = head[0][0]
    if isinstance(entry_id, bytes):
        entry_id = entry_id.decode()
    ms = int(entry_id.split("-", 1)[0])
    return datetime.fromtimestamp(ms / 1000.0, tz=dt_timezone.utc)


def stats():
    client = get_client()
    pipe = client.pipeline(transaction=False)
    pipe.xlen(STREAM_KEY)
    pipe.get(BYTES_KEY)
    pipe.xlen(DEAD_LETTER_KEY)
    length, used, dead = pipe.execute()
    return {
        "entries": length,
        "bytes": int(used or 0),
        "dead_letters": dead,
        "oldest_buffered_at": oldest_buffered_at(),
    }


def default_consumer_name():
    return f"{socket.gethostname()}-{os.getpid()}-{uuid4().hex[:6]}"
