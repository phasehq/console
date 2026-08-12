"""Log stream shipping engine.

A recurring sweep (rq-scheduler, see jobs.py) enqueues one ship job per
active stream onto the dedicated ``log-streams`` queue. A ship job tails each
of the stream's event sources from its stored cursor, serializes events into
neutral envelopes, chunks them, and delivers chunk-by-chunk through the
stream's adapter.

Delivery contract (at-least-once):

- A source cursor advances only after its chunk is accepted (or after the
  chunk exhausts its retry budget — the failed range is recorded and remains
  manually re-shippable, so the stream never head-of-line blocks).
- Auth failures pause the stream (``paused_reason="auth_error"``); retrying
  with dead credentials is pointless.
- Cursors older than the adapter's ``max_event_age`` are floored (the
  destination would silently drop the backlog anyway); the skipped range is
  recorded as a SKIPPED delivery event.
"""

import logging
import time
from datetime import timedelta
from uuid import uuid4

import django_rq
from django.apps import apps
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django_rq import job
from rq.exceptions import NoSuchJobError
from rq.job import Job
from rq.timeouts import JobTimeoutException

from api.utils.syncing.auth import get_credentials
from backend.quotas import can_use_log_streams

from .adapters import all_adapters, get_adapter
from .chunker import CHUNK_MAX_EVENTS, chunk_envelopes
from .exceptions import (
    AdapterAuthError,
    AdapterError,
    AdapterPermanentError,
    AdapterRateLimitedError,
    AdapterTransientError,
)
from .sources import get_source

logger = logging.getLogger(__name__)

QUEUE_NAME = "log-streams"
SWEEP_INTERVAL_SECONDS = 30
SHIP_JOB_TIMEOUT = 3600
RETRY_JOB_TIMEOUT = 1800
RETRY_BACKOFF_SECONDS = (5, 15, 60, 120, 300)
RETRY_SLEEP_CAP = 300
MAX_TAIL_LOOPS = 20
MAX_ATTEMPTS_CAP = 10
# Manual retries re-materialize a recorded range in one go. Failed ranges are
# at most one chunk, so this cap only trips on pathological rows — which get
# an honest "range_too_large" failure instead of a silent partial resolve.
RETRY_MAX_EVENTS = 10 * CHUNK_MAX_EVENTS
# One chunk's retry ladder is wall-clock bounded: Retry-After sleeps capped
# at RETRY_SLEEP_CAP per gap could otherwise stretch ten attempts to ~51
# minutes.
DELIVERY_DEADLINE_SECONDS = 30 * 60
# Headroom between "we will still try to deliver this" and the destination's
# hard age cutoff. Every chunk is delivered directly after a fresh
# skip-ahead floor (one chunk per tail iteration), so this only has to
# exceed ONE deadline-bounded delivery cycle — otherwise events admitted for
# delivery can age past the cutoff mid-flight and be accepted-then-dropped
# by the destination while recorded as delivered.
SKIP_AHEAD_MARGIN = timedelta(minutes=40)

# The accepted-then-dropped guard, as arithmetic: one chunk cycle (ship
# path) and one whole manual-retry job must both fit inside the margin with
# request-time slack. Also pinned by tests.
assert DELIVERY_DEADLINE_SECONDS + 300 <= SKIP_AHEAD_MARGIN.total_seconds()
assert RETRY_JOB_TIMEOUT + 300 <= SKIP_AHEAD_MARGIN.total_seconds()
DELIVERY_RETENTION_DAYS = 30
# Rows outside the ingestion window are unretryable — auto-resolved after a
# grace so the loss is visible on the badge first (skips are born expired).
# Must exceed every adapter's (window - margin + retry lifetime) so a row is
# never resolved while a retry that passed the window check is still running.
EXPIRED_RESOLVE_GRACE = timedelta(hours=24)
assert all(
    EXPIRED_RESOLVE_GRACE
    >= a.max_event_age - SKIP_AHEAD_MARGIN + timedelta(seconds=RETRY_JOB_TIMEOUT)
    for a in all_adapters()
    if a.max_event_age
)
# Pending events older than this when a ship job runs indicate the schedule
# stopped firing (host sleep, dead scheduler) — logged for operators; users
# just see the stream's "Delayed" state.
LATE_DELIVERY_WARN_SECONDS = 300

# Delivery event statuses (mirror api.models.LogStreamDeliveryEvent)
STATUS_COMPLETED = "completed"
STATUS_FAILED = "failed"
STATUS_SKIPPED = "skipped"

# _deliver_chunk outcomes
DELIVERED = "delivered"
AUTH_ERROR = "auth_error"
EXHAUSTED = "exhausted"
# The stream was paused, deleted or reconfigured mid-ladder — nothing was
# egressed for this chunk; stop without recording an outcome for it.
ABORTED = "aborted"

# chunk-loop control
CONTINUE = "continue"
PAUSE = "pause"
# Stop shipping this source without advancing the cursor (e.g. a failure
# record could not be persisted — advancing would silently lose the range).
HALT = "halt"


def _queue():
    return django_rq.get_queue(QUEUE_NAME)


def _redis():
    return _queue().connection


def record_delivery(stream, source_id, status, **fields):
    LogStreamDeliveryEvent = apps.get_model("api", "LogStreamDeliveryEvent")
    # The out-of-sync badge counts unresolved rows, which must all be
    # actionable. Stream-level rows (no source — nothing to re-ship) and
    # FAILED rows that record a retry *attempt* (the original row remains the
    # open item) are terminal outcomes: store them pre-resolved so they
    # inform without inflating the badge forever.
    if not source_id or (
        status == STATUS_FAILED and fields.get("retried_from") is not None
    ):
        fields.setdefault("resolved_at", timezone.now())
    try:
        return LogStreamDeliveryEvent.objects.create(
            stream=stream,
            source=source_id,
            status=status,
            completed_at=timezone.now(),
            **fields,
        )
    except Exception:
        logger.exception(
            "Failed to record log stream delivery event",
            extra={"stream_id": stream.id, "source": source_id, "status": status},
        )
        return None


def _cursor_timestamp(stream, source_id):
    cursor = (stream.cursors or {}).get(source_id)
    if cursor and cursor.get("ts"):
        ts = cursor["ts"]
        return parse_datetime(ts) if isinstance(ts, str) else ts
    return stream.created_at or timezone.now()


def _get_cursor(stream, source_id):
    cursor = (stream.cursors or {}).get(source_id)
    if cursor and cursor.get("ts"):
        return cursor
    # Ship-forward-only: new streams start at their creation time.
    start = stream.created_at or timezone.now()
    return {"ts": start.isoformat(), "id": ""}


def _set_cursor(stream, source_id, cursor):
    cursors = dict(stream.cursors or {})
    cursors[source_id] = cursor
    stream.cursors = cursors


def _mark_healthy(stream):
    stream.health = stream.HEALTHY
    stream.last_failure_at = None
    stream.last_failure_reason = ""


def _mark_degraded(stream, reason):
    stream.health = stream.DEGRADED
    stream.last_failure_at = timezone.now()
    stream.last_failure_reason = str(reason)[:1024]


# Fields the (per-stream serialized) ship path owns. Lifecycle fields
# (is_active, paused_reason) are deliberately excluded: jobs hold a row
# loaded at job start, and writing lifecycle state from it would revert a
# pause/delete the user made while the job was running.
DELIVERY_STATE_FIELDS = [
    "cursors",
    "health",
    "last_shipped_at",
    "last_failure_at",
    "last_failure_reason",
    "updated_at",
]

HEALTH_FIELDS = ["health", "last_failure_at", "last_failure_reason", "updated_at"]


def _save_delivery_state(stream):
    stream.save(update_fields=DELIVERY_STATE_FIELDS)


def _save_health(stream):
    stream.save(update_fields=HEALTH_FIELDS)


def _pause_stream_row(stream, reason, failure_message):
    """Pause + degrade via a targeted queryset update so a stale in-memory
    row can never clobber cursors or other concurrently-written fields."""
    now = timezone.now()
    LogStream = apps.get_model("api", "LogStream")
    LogStream.objects.filter(id=stream.id).update(
        is_active=False,
        paused_reason=reason,
        health=stream.DEGRADED,
        last_failure_at=now,
        last_failure_reason=str(failure_message)[:1024],
        updated_at=now,
    )
    # Keep the in-memory row consistent for the rest of the job.
    stream.is_active = False
    stream.paused_reason = reason
    _mark_degraded(stream, failure_message)


def _stream_is_shippable(stream):
    """Live DB check between delivery attempts: rq cannot stop a started
    job, and the job's row predates anything the user did after it started.

    Halts when the stream was paused or deleted, when its configuration
    changed (the job still holds the old sources/credentials/options — it
    must exit and let the next sweep reload fresh state rather than keep
    egressing with stale authority), or when the organisation lost the
    Enterprise plan (mirrors quotas.can_use_log_streams, where plan is the
    single source of truth)."""
    LogStream = apps.get_model("api", "LogStream")
    row = (
        LogStream.objects.filter(
            id=stream.id,
            is_active=True,
            deleted_at__isnull=True,
            organisation__plan="EN",
        )
        .values("sources", "authentication_id", "options", "max_attempts")
        .first()
    )
    if row is None:
        return False
    return (
        row["sources"] == stream.sources
        and row["authentication_id"] == stream.authentication_id
        and row["options"] == stream.options
        and row["max_attempts"] == stream.max_attempts
    )


def _backoff(attempt):
    return RETRY_BACKOFF_SECONDS[min(attempt - 1, len(RETRY_BACKOFF_SECONDS) - 1)]


def _deliver_chunk(stream, chunk, adapter, credentials, options, context):
    """Run the retry ladder for one chunk.

    Returns (outcome, attempts, info) where outcome is DELIVERED / AUTH_ERROR
    / EXHAUSTED and info is the ShipResult (on success) or the last
    AdapterError (on failure).

    The ladder is wall-clock bounded by DELIVERY_DEADLINE_SECONDS: sleeps
    are honoured only while they fit inside the deadline. Without the bound,
    a rate-limited destination sending large Retry-After values could
    stretch one chunk past SKIP_AHEAD_MARGIN — its events would cross the
    destination's age cutoff mid-ladder and be accepted-then-dropped while
    recorded as delivered.
    """
    max_attempts = max(1, min(stream.max_attempts or 1, MAX_ATTEMPTS_CAP))
    last_error = None
    deadline = time.monotonic() + DELIVERY_DEADLINE_SECONDS

    for attempt in range(1, max_attempts + 1):
        # A pause/delete/reconfiguration can land during a backoff sleep —
        # re-check right before every egress attempt, not just per chunk.
        if not _stream_is_shippable(stream):
            return ABORTED, attempt - 1, None
        delay = None
        try:
            result = adapter.ship(chunk.events, credentials, options, context)
            return DELIVERED, attempt, result
        except AdapterAuthError as ex:
            return AUTH_ERROR, attempt, ex
        except AdapterRateLimitedError as ex:
            last_error = ex
            delay = min(
                ex.retry_after if ex.retry_after else _backoff(attempt),
                RETRY_SLEEP_CAP,
            )
        except AdapterPermanentError as ex:
            last_error = ex
            break
        except AdapterTransientError as ex:
            last_error = ex
            delay = _backoff(attempt)
        except JobTimeoutException:
            raise
        except Exception as ex:
            # Adapters must raise typed errors (base.py contract); an untyped
            # escape is an adapter bug. Map it onto the transient path so the
            # ladder and the failure record still apply — crashing the job
            # with the cursor held would head-of-line block the stream on a
            # deterministic bug.
            logger.exception(
                "Log stream adapter raised an untyped exception",
                extra={"stream_id": stream.id, "provider": stream.provider},
            )
            last_error = AdapterTransientError(
                f"Adapter crashed: {type(ex).__name__}",
                user_message="The delivery adapter failed unexpectedly",
            )
            delay = _backoff(attempt)

        if attempt >= max_attempts or time.monotonic() + delay > deadline:
            break
        time.sleep(delay)

    return EXHAUSTED, attempt, last_error


def _error_meta(error):
    meta = {"error": getattr(error, "user_message", str(error))}
    status_code = getattr(error, "status_code", None)
    if status_code:
        meta["status_code"] = status_code
    retry_after = getattr(error, "retry_after", None)
    if retry_after:
        meta["retry_after"] = retry_after
    return meta


def _ship_chunk(stream, source_id, chunk, adapter, credentials, options, context):
    outcome, attempts, info = _deliver_chunk(
        stream, chunk, adapter, credentials, options, context
    )

    if outcome == ABORTED:
        # Nothing was egressed and nothing failed — hold the cursor and stop
        # the job; the next sweep reloads fresh state.
        return PAUSE

    if outcome == DELIVERED:
        _set_cursor(stream, source_id, chunk.last_cursor)
        stream.last_shipped_at = timezone.now()
        _mark_healthy(stream)
        _save_delivery_state(stream)
        auto_resolved = _resolve_covered_failures(stream, source_id, chunk)
        meta = {
            "status_code": info.status_code,
            "duration_ms": info.duration_ms,
            **info.meta,
        }
        if auto_resolved:
            meta["auto_resolved"] = auto_resolved
        record_delivery(
            stream,
            source_id,
            STATUS_COMPLETED,
            event_count=len(chunk.events),
            payload_bytes=chunk.byte_size,
            attempts=attempts,
            cursor_from=chunk.cursor_from,
            cursor_to=chunk.cursor_to,
            cursor_from_id=chunk.cursor_from_id,
            cursor_to_id=chunk.cursor_to_id,
            meta=meta,
        )
        return CONTINUE

    if outcome == AUTH_ERROR:
        record_delivery(
            stream,
            source_id,
            STATUS_FAILED,
            event_count=len(chunk.events),
            payload_bytes=chunk.byte_size,
            attempts=attempts,
            cursor_from=chunk.cursor_from,
            cursor_to=chunk.cursor_to,
            cursor_from_id=chunk.cursor_from_id,
            cursor_to_id=chunk.cursor_to_id,
            meta=_error_meta(info),
        )
        _pause_stream_row(
            stream, "auth_error", getattr(info, "user_message", "authentication failed")
        )
        logger.warning(
            "Log stream paused after auth failure",
            extra={"stream_id": stream.id, "provider": stream.provider},
        )
        return PAUSE

    # EXHAUSTED / permanent: record the failed range, skip past it so newer
    # events keep flowing. The range stays in Postgres and can be re-shipped
    # from the delivery history.
    record = record_delivery(
        stream,
        source_id,
        STATUS_FAILED,
        event_count=len(chunk.events),
        payload_bytes=chunk.byte_size,
        attempts=attempts,
        cursor_from=chunk.cursor_from,
        cursor_to=chunk.cursor_to,
        cursor_from_id=chunk.cursor_from_id,
        cursor_to_id=chunk.cursor_to_id,
        meta=_error_meta(info),
    )
    if record is None:
        # The failed range couldn't be recorded — advancing the cursor now
        # would lose these events with no re-shippable trace. Hold position;
        # the next sweep retries from the same cursor.
        _mark_degraded(
            stream, "Delivery failed and the failure could not be recorded"
        )
        _save_health(stream)
        return HALT
    _set_cursor(stream, source_id, chunk.last_cursor)
    _mark_degraded(stream, getattr(info, "user_message", str(info)))
    _save_delivery_state(stream)
    return CONTINUE


def _resolve_covered_failures(stream, source_id, chunk):
    """Mark unresolved failed/skipped delivery rows as resolved when a later
    successful ship covers their event range.

    An auth failure holds the cursor, so after the credentials are fixed the
    normal sweep re-ships the failed ranges automatically — without this, the
    stale failure rows keep the out-of-sync badge up and invite a manual retry
    that would double-ship the same events.

    Containment compares (timestamp, id) bounds, not timestamps alone:
    chunks can split inside a single timestamp, and a timestamp-only match
    would let a chunk resolve a failed row whose events it did NOT deliver.
    Empty-string id bounds ("unknown": legacy rows, open floor boundaries)
    compare leniently, preserving the timestamp behaviour for them.
    """
    if chunk.cursor_from is None or chunk.cursor_to is None:
        return 0
    from django.db.models import Q

    starts_inside = Q(cursor_from__gt=chunk.cursor_from)
    if chunk.cursor_from_id:
        starts_inside |= Q(cursor_from=chunk.cursor_from) & (
            Q(cursor_from_id__gte=chunk.cursor_from_id) | Q(cursor_from_id="")
        )
    else:
        starts_inside |= Q(cursor_from=chunk.cursor_from)

    ends_inside = Q(cursor_to__lt=chunk.cursor_to)
    if chunk.cursor_to_id:
        ends_inside |= Q(cursor_to=chunk.cursor_to) & (
            Q(cursor_to_id__lte=chunk.cursor_to_id) | Q(cursor_to_id="")
        )
    else:
        ends_inside |= Q(cursor_to=chunk.cursor_to)

    LogStreamDeliveryEvent = apps.get_model("api", "LogStreamDeliveryEvent")
    try:
        return (
            LogStreamDeliveryEvent.objects.filter(
                stream=stream,
                source=source_id,
                status__in=[STATUS_FAILED, STATUS_SKIPPED],
                resolved_at__isnull=True,
            )
            .filter(starts_inside)
            .filter(ends_inside)
            .update(resolved_at=timezone.now())
        )
    except Exception:
        logger.exception(
            "Failed to auto-resolve covered delivery failures",
            extra={"stream_id": stream.id, "source": source_id},
        )
        return 0


def _ingestion_floor(adapter, now=None):
    """Oldest timestamp the destination still accepts, plus safety margin.
    Ranges below it are dropped, so the engine floors/skips past them and
    rejects retries under it."""
    return (now or timezone.now()) - adapter.max_event_age + SKIP_AHEAD_MARGIN


def _skip_ahead(stream, source_id, source, adapter):
    """Floor a stale cursor at the destination's max event age.

    Returns True when shipping may proceed. Returns False when the cursor is
    stale but the skipped-range record could not be persisted — proceeding
    would ship expired events the destination accepts-then-drops, advancing
    the cursor past them with no durable trace of the loss.
    """
    if not adapter.max_event_age:
        return True
    floor = _ingestion_floor(adapter)
    cursor_ts = _cursor_timestamp(stream, source_id)
    if cursor_ts >= floor:
        return True

    cursor = _get_cursor(stream, source_id)
    try:
        skipped = source.count_before(stream.organisation, cursor, floor)
    except Exception:
        logger.exception(
            "Failed to count skipped events", extra={"stream_id": stream.id}
        )
        skipped = None

    if skipped is None or skipped:
        meta = {
            "reason": "max_event_age_exceeded",
            "max_event_age_hours": adapter.max_event_age.total_seconds() / 3600,
        }
        if skipped is None:
            meta["count_unknown"] = True
        record = record_delivery(
            stream,
            source_id,
            STATUS_SKIPPED,
            event_count=skipped or 0,
            cursor_from=cursor_ts,
            cursor_to=floor,
            cursor_from_id=cursor.get("id", ""),
            # The floor is a computed boundary, not an event — open id bound.
            cursor_to_id="",
            meta=meta,
        )
        if record is None:
            # No trace of the loss — hold the cursor, halt this source, let
            # the next sweep retry the recording.
            return False
    _set_cursor(stream, source_id, {"ts": floor.isoformat(), "id": ""})
    _save_delivery_state(stream)
    return True


def _degrade_once(stream, error_code, reason):
    """Degrade + record a stream-level failure only on transition — the sweep
    fires every 30s and a persistent condition must not write a delivery row
    per sweep."""
    if stream.health == stream.DEGRADED and stream.last_failure_reason == reason:
        return
    record_delivery(stream, "", STATUS_FAILED, meta={"error": error_code})
    _mark_degraded(stream, reason)
    _save_health(stream)


def _ship_stream(stream):
    try:
        adapter = get_adapter(stream.provider)
    except ValueError:
        # A stream whose provider has no registered adapter can never ship —
        # pause it visibly instead of crash-looping on every sweep.
        record_delivery(stream, "", STATUS_FAILED, meta={"error": "unknown_provider"})
        _pause_stream_row(
            stream,
            "unknown_provider",
            f"No adapter is registered for provider '{stream.provider}'",
        )
        logger.error(
            "Log stream paused: unknown provider",
            extra={"stream_id": stream.id, "provider": stream.provider},
        )
        return

    if not stream.authentication_id:
        _degrade_once(
            stream, "credentials_missing", "Third-party credentials are missing"
        )
        return

    try:
        credentials = get_credentials(stream.authentication_id)
    except Exception as ex:
        _degrade_once(
            stream,
            f"credentials_unreadable: {type(ex).__name__}",
            "Could not decrypt third-party credentials",
        )
        return

    try:
        options = adapter.validate_options(stream.options)
    except Exception:
        # Options are validated at create/update, so a failure here is a
        # deterministic config error — pause instead of crash-looping.
        record_delivery(stream, "", STATUS_FAILED, meta={"error": "invalid_options"})
        _pause_stream_row(
            stream, "invalid_options", "The stream's configuration failed validation"
        )
        logger.exception(
            "Log stream paused: options failed validation",
            extra={"stream_id": stream.id, "provider": stream.provider},
        )
        return
    context = {
        "organisation_name": stream.organisation.name,
        "stream_name": stream.name,
    }

    for source_id in list(stream.sources or []):
        try:
            source = get_source(source_id)
        except ValueError:
            logger.warning(
                "Skipping unknown log stream source",
                extra={"stream_id": stream.id, "source": source_id},
            )
            continue

        warned_late = False
        for _ in range(MAX_TAIL_LOOPS):
            # Re-floor every iteration, not just once per source: a slow
            # chunk cycle (full retry ladder) can take long enough that the
            # next fetch's oldest events have crossed the destination's age
            # cutoff — they'd be accepted-and-dropped yet recorded delivered.
            if not _skip_ahead(stream, source_id, source, adapter):
                break
            cursor = _get_cursor(stream, source_id)
            events = source.fetch(stream.organisation, cursor, CHUNK_MAX_EVENTS)
            if not events:
                break

            # Operator signal only: a large pending age on the oldest fetched
            # event means the recurring sweep hadn't fired for a while (host
            # sleep, scheduler outage) or deliveries were failing long enough
            # to back up. Derived from the fetch the loop already performs —
            # no extra oldest-pending query per ship job.
            if not warned_late:
                warned_late = True
                delay = int((timezone.now() - events[0].timestamp).total_seconds())
                if delay > LATE_DELIVERY_WARN_SECONDS:
                    logger.warning(
                        "Log stream deliveries are running %ss late — the sweep "
                        "schedule may have stalled or deliveries were backed up",
                        delay,
                        extra={"stream_id": stream.id, "source": source_id},
                    )

            entries = [
                {
                    "envelope": source.serialize(event, stream.organisation),
                    "cursor": source.cursor_of(event),
                    "timestamp": event.timestamp,
                }
                for event in events
            ]

            # Ship ONE chunk per iteration. A fetch can byte-split into
            # several chunks, and each delivery may leg through a full
            # (deadline-bounded) retry ladder — shipping them all from this
            # fetch would let the later chunks age past the ingestion floor
            # computed above. Looping back re-floors and refetches from the
            # advanced cursor instead.
            chunks = chunk_envelopes(entries)

            # A console pause/delete/reconfiguration must take effect
            # mid-job: rq cannot stop a started job, and this row predates
            # the user's action.
            if not _stream_is_shippable(stream):
                return
            result = _ship_chunk(
                stream, source_id, chunks[0], adapter, credentials, options, context
            )
            if result == PAUSE:
                return
            if result == HALT:
                break

            if len(events) < CHUNK_MAX_EVENTS and len(chunks) == 1:
                break


@job(QUEUE_NAME, timeout=SHIP_JOB_TIMEOUT)
def ship_log_stream(stream_id):
    LogStream = apps.get_model("api", "LogStream")
    stream = (
        LogStream.objects.filter(id=stream_id, deleted_at__isnull=True)
        .select_related("organisation")
        .first()
    )
    if stream is None or not stream.is_active:
        return

    # Authoritative overlap guard — the sweep's Job.fetch check is only a
    # cheap first layer. HTTP delivery must never run under a DB transaction,
    # so a Redis lock (TTL > job timeout) serializes ship jobs per stream.
    conn = _redis()
    lock_key = f"log_streams:ship:{stream.id}"
    token = str(uuid4())
    if not conn.set(lock_key, token, nx=True, ex=SHIP_JOB_TIMEOUT + 60):
        return

    try:
        _ship_stream(stream)
    except JobTimeoutException:
        # _degrade_once: a deterministic, persistent failure re-runs every
        # 30s sweep — record it on transition only, not per run.
        _degrade_once(stream, "ship_job_timed_out", "Ship job timed out")
    except Exception as ex:
        logger.exception(
            "Log stream ship job crashed", extra={"stream_id": stream.id}
        )
        # Class name only — raw exception strings (driver/SQL internals) are
        # user-visible via meta.error and last_failure_reason.
        _degrade_once(
            stream,
            f"ship_job_crashed: {type(ex).__name__}",
            f"Delivery failed unexpectedly ({type(ex).__name__}) — check the server logs",
        )
    finally:
        try:
            if conn.get(lock_key) == token.encode():
                conn.delete(lock_key)
        except Exception:
            pass


def _manual_export_hint(source_id):
    """Recovery guidance for a range the stream can no longer deliver. The
    loss is destination-side only — the events remain queryable in the
    Console (organisation audit logs / per-app secret logs). When the public
    audit-logs REST route ships (currently disabled in urls.py), org_audit
    ranges can point at a bulk export again."""
    return "The events remain available in the Phase Console's logs."


@job(QUEUE_NAME, timeout=RETRY_JOB_TIMEOUT)
def retry_delivery(delivery_event_id):
    """Manually re-ship the event range covered by a failed/skipped delivery.

    Double-clicks and concurrent API calls can enqueue duplicate jobs before
    any worker resolves the row — a per-delivery Redis claim (mirroring the
    per-stream ship lock) serializes them so the same range isn't shipped
    twice in parallel.
    """
    conn = _redis()
    claim_key = f"log_streams:retry:{delivery_event_id}"
    claim_token = str(uuid4())
    if not conn.set(claim_key, claim_token, nx=True, ex=RETRY_JOB_TIMEOUT + 60):
        return
    try:
        _retry_delivery_locked(delivery_event_id)
    finally:
        try:
            if conn.get(claim_key) == claim_token.encode():
                conn.delete(claim_key)
        except Exception:
            pass


def _retry_delivery_locked(delivery_event_id):
    """On success a linked COMPLETED delivery event is written and the
    original is marked resolved. Stream cursors and lifecycle fields are
    never written — the range is in the past relative to the live cursor,
    and a concurrent ship job may have advanced state this job must not
    clobber.
    """
    LogStream = apps.get_model("api", "LogStream")
    LogStreamDeliveryEvent = apps.get_model("api", "LogStreamDeliveryEvent")
    original = (
        LogStreamDeliveryEvent.objects.filter(id=delivery_event_id)
        .select_related("stream", "stream__organisation")
        .first()
    )
    if (
        original is None
        or original.status not in (STATUS_FAILED, STATUS_SKIPPED)
        or original.resolved_at is not None
    ):
        return
    stream = original.stream
    if stream.deleted_at is not None or not original.source:
        return
    # Pause means no egress — manual retries included. The mutation surfaces
    # the user-facing error; this covers the direct-enqueue/queued-job path.
    if not stream.is_active:
        return
    if original.cursor_from is None or original.cursor_to is None:
        return

    try:
        adapter = get_adapter(stream.provider)
        source = get_source(original.source)
        credentials = get_credentials(stream.authentication_id)
    except Exception as ex:
        record_delivery(
            stream,
            original.source,
            STATUS_FAILED,
            retried_from=original,
            meta={"error": f"retry_setup_failed: {type(ex).__name__}"},
        )
        return

    # The destination silently discards events older than max_event_age
    # (Datadog 202s, then drops) — shipping an expired range would falsely
    # mark it recovered. Reject fully-expired ranges; for partially-expired
    # ones, ship the live tail and record the expired head as skipped.
    effective_from = original.cursor_from
    expired_head = None
    if adapter.max_event_age:
        floor = _ingestion_floor(adapter)
        if original.cursor_to < floor:
            record_delivery(
                stream,
                original.source,
                STATUS_FAILED,
                retried_from=original,
                cursor_from=original.cursor_from,
                cursor_to=original.cursor_to,
                meta={
                    "error": "range_expired",
                    "detail": (
                        "The destination no longer accepts events this old. "
                        + _manual_export_hint(original.source)
                    ),
                },
            )
            return
        if original.cursor_from < floor:
            expired_head = (original.cursor_from, floor)
            effective_from = floor

    total_events = 0
    total_bytes = 0
    total_attempts = 0
    try:
        # Setup runs inside the recording guard too: the user already saw
        # "retry queued", so a DB error in fetch_range or a job timeout while
        # materializing a large range must still leave a FAILED trace.
        options = adapter.validate_options(stream.options)
        context = {
            "organisation_name": stream.organisation.name,
            "stream_name": stream.name,
        }

        events = source.fetch_range(
            stream.organisation,
            effective_from,
            original.cursor_to,
            limit=RETRY_MAX_EVENTS + 1,
        )
        if len(events) > RETRY_MAX_EVENTS:
            record_delivery(
                stream,
                original.source,
                STATUS_FAILED,
                retried_from=original,
                cursor_from=original.cursor_from,
                cursor_to=original.cursor_to,
                meta={
                    "error": "range_too_large",
                    "detail": (
                        f"More than {RETRY_MAX_EVENTS} events in this range. "
                        + _manual_export_hint(original.source)
                    ),
                },
            )
            return

        entries = [
            {
                "envelope": source.serialize(event, stream.organisation),
                "cursor": source.cursor_of(event),
                "timestamp": event.timestamp,
            }
            for event in events
        ]
        chunks = chunk_envelopes(entries)

        for chunk in chunks:
            # Same live check as the ship path: a pause/delete/
            # reconfiguration issued while this retry runs must stop egress,
            # and rq can't stop a started job. Record the aborted attempt —
            # chunks may already have been egressed, and a silent exit would
            # leave that duplication unexplained in the history.
            if not _stream_is_shippable(stream):
                record_delivery(
                    stream,
                    original.source,
                    STATUS_FAILED,
                    retried_from=original,
                    event_count=total_events,
                    payload_bytes=total_bytes,
                    cursor_from=original.cursor_from,
                    cursor_to=original.cursor_to,
                    meta={
                        "error": "stream_changed_mid_retry",
                        "shipped_events": total_events,
                    },
                )
                return
            outcome, attempts, info = _deliver_chunk(
                stream, chunk, adapter, credentials, options, context
            )
            total_attempts = max(total_attempts, attempts)
            if outcome == ABORTED:
                # Paused/reconfigured during this chunk's ladder — nothing
                # from this chunk was egressed; record what already shipped.
                record_delivery(
                    stream,
                    original.source,
                    STATUS_FAILED,
                    retried_from=original,
                    event_count=total_events,
                    payload_bytes=total_bytes,
                    cursor_from=original.cursor_from,
                    cursor_to=original.cursor_to,
                    meta={
                        "error": "stream_changed_mid_retry",
                        "shipped_events": total_events,
                    },
                )
                return
            if outcome != DELIVERED:
                record_delivery(
                    stream,
                    original.source,
                    LogStreamDeliveryEvent.FAILED,
                    retried_from=original,
                    event_count=len(chunk.events),
                    payload_bytes=chunk.byte_size,
                    attempts=attempts,
                    cursor_from=original.cursor_from,
                    cursor_to=original.cursor_to,
                    meta=_error_meta(info),
                )
                if outcome == AUTH_ERROR:
                    _pause_stream_row(
                        stream,
                        "auth_error",
                        getattr(info, "user_message", "authentication failed"),
                    )
                return
            total_events += len(chunk.events)
            total_bytes += chunk.byte_size
    except JobTimeoutException:
        # Without this record, the user saw "retry queued" and nothing would
        # ever appear in the history. The original stays unresolved.
        record_delivery(
            stream,
            original.source,
            STATUS_FAILED,
            retried_from=original,
            cursor_from=original.cursor_from,
            cursor_to=original.cursor_to,
            meta={"error": "retry_job_timed_out"},
        )
        return
    except Exception as ex:
        logger.exception(
            "Log stream delivery retry crashed",
            extra={"stream_id": stream.id, "delivery_event_id": delivery_event_id},
        )
        record_delivery(
            stream,
            original.source,
            STATUS_FAILED,
            retried_from=original,
            cursor_from=original.cursor_from,
            cursor_to=original.cursor_to,
            meta={"error": f"retry_failed: {type(ex).__name__}"},
        )
        return

    head_record = None
    if expired_head:
        # The head of the range fell outside the ingestion window before this
        # retry ran — record it as its own skipped row so the loss stays
        # visible after the original is resolved.
        try:
            head_count = source.count_before(
                stream.organisation,
                {"ts": expired_head[0].isoformat(), "id": ""},
                expired_head[1],
            )
        except Exception:
            head_count = None
        head_meta = {
            "reason": "max_event_age_exceeded",
            "max_event_age_hours": adapter.max_event_age.total_seconds() / 3600,
        }
        if head_count is None:
            head_meta["count_unknown"] = True
        head_record = record_delivery(
            stream,
            original.source,
            STATUS_SKIPPED,
            retried_from=original,
            event_count=head_count or 0,
            cursor_from=expired_head[0],
            cursor_to=expired_head[1],
            cursor_from_id=original.cursor_from_id or "",
            # The floor is a computed boundary, not an event — open id bound.
            cursor_to_id="",
            meta=head_meta,
        )

    record_delivery(
        stream,
        original.source,
        STATUS_COMPLETED,
        retried_from=original,
        event_count=total_events,
        payload_bytes=total_bytes,
        attempts=total_attempts,
        cursor_from=effective_from,
        cursor_to=original.cursor_to,
        cursor_from_id="" if expired_head else (original.cursor_from_id or ""),
        cursor_to_id=original.cursor_to_id or "",
        meta={"manual_retry": True} if events else {"manual_retry": True, "note": "no_events_in_range"},
    )
    if expired_head and head_record is None:
        # The lost head has no durable record — keep the original open so the
        # loss stays visible. A later retry may re-ship the tail; the
        # at-least-once contract tolerates the duplication.
        logger.warning(
            "Skipped-head record could not be persisted; leaving the original "
            "delivery unresolved",
            extra={"stream_id": stream.id, "delivery_event_id": delivery_event_id},
        )
        return
    original.resolved_at = timezone.now()
    original.save(update_fields=["resolved_at"])
    LogStream.objects.filter(id=stream.id).update(
        last_shipped_at=timezone.now(), updated_at=timezone.now()
    )


def sweep_log_streams():
    """Recurring sweep: enqueue a ship job for every shippable stream."""
    LogStream = apps.get_model("api", "LogStream")
    queue = _queue()

    # Streams whose credential row was hard-deleted (the FK is SET_NULL) can
    # never ship again — pause them visibly instead of leaving a permanently
    # "healthy" stream that silently ships nothing. One-shot: the pause
    # removes them from subsequent sweeps.
    stranded = LogStream.objects.filter(
        is_active=True, deleted_at__isnull=True, authentication__isnull=True
    )
    for stream in stranded:
        try:
            record_delivery(
                stream, "", STATUS_FAILED, meta={"error": "credentials_missing"}
            )
            _pause_stream_row(
                stream, "credentials_missing", "Third-party credentials were deleted"
            )
            logger.warning(
                "Log stream paused: its third-party credentials were deleted",
                extra={"stream_id": stream.id},
            )
        except Exception:
            logger.exception(
                "Failed to pause credential-less log stream",
                extra={"stream_id": stream.id},
            )

    streams = (
        LogStream.objects.filter(
            is_active=True,
            deleted_at__isnull=True,
            authentication__isnull=False,
        )
        .select_related("organisation")
        .order_by("created_at")
    )

    starved_streams = 0
    for stream in streams:
        try:
            if not can_use_log_streams(stream.organisation):
                continue

            # Cheap overlap layer: skip if the last ship job is still alive.
            # Still *queued* after a full sweep interval means no worker ever
            # picked it up — the pool is saturated, not the destination slow.
            if stream.ship_job_id:
                try:
                    last_job = Job.fetch(stream.ship_job_id, connection=queue.connection)
                    if last_job.is_queued:
                        starved_streams += 1
                        continue
                    if last_job.is_started:
                        continue
                except NoSuchJobError:
                    pass

            new_job = ship_log_stream.delay(stream.id)
            stream.ship_job_id = new_job.get_id()
            stream.save(update_fields=["ship_job_id", "updated_at"])
        except Exception:
            logger.exception(
                "Failed to enqueue log stream ship job",
                extra={"stream_id": stream.id},
            )

    if starved_streams:
        logger.warning(
            "%s log stream ship job(s) from the previous sweep are still "
            "waiting for a worker — the log-streams pool is saturated; "
            "raise LOG_STREAM_WORKERS to add delivery capacity",
            starved_streams,
        )

    _resolve_expired_failures()
    _cleanup_delivery_events()


def _resolve_expired_failures():
    """Resolve unresolved failed/skipped rows that can no longer be re-shipped.

    Once a row's whole range is older than its destination's ingestion
    window, the retry mutation rejects it as range_expired — leaving it
    unresolved would pin the out-of-sync badge forever and exempt the row
    from retention indefinitely. The row itself survives (resolved, meta
    resolution="expired") as the durable record of the loss until retention
    prunes it. Runs every sweep: the unresolved set is empty on healthy
    streams and served by the partial index."""
    LogStreamDeliveryEvent = apps.get_model("api", "LogStreamDeliveryEvent")
    now = timezone.now()
    try:
        rows = list(
            LogStreamDeliveryEvent.objects.filter(
                status__in=[STATUS_FAILED, STATUS_SKIPPED],
                resolved_at__isnull=True,
                cursor_to__isnull=False,
                created_at__lt=now - EXPIRED_RESOLVE_GRACE,
                stream__deleted_at__isnull=True,
            )
            .exclude(source="")
            .select_related("stream")
        )
    except Exception:
        logger.exception("Failed to load unresolved delivery rows for expiry")
        return

    for row in rows:
        try:
            adapter = get_adapter(row.stream.provider)
        except ValueError:
            continue
        if not adapter.max_event_age:
            continue
        if row.cursor_to >= _ingestion_floor(adapter, now):
            continue
        try:
            meta = dict(row.meta or {})
            meta["resolution"] = "expired"
            # Conditional: never clobber a concurrently-written resolution.
            LogStreamDeliveryEvent.objects.filter(
                id=row.id, resolved_at__isnull=True
            ).update(resolved_at=now, meta=meta)
        except Exception:
            logger.exception(
                "Failed to resolve expired delivery row",
                extra={"stream_id": row.stream_id, "delivery_event_id": row.id},
            )


CLEANUP_BATCH_SIZE = 5000
CLEANUP_MARKER_KEY = "log_streams:cleanup_marker"
# Claim TTL while the prune runs; extended to a day only on success, so a
# crash or job timeout retries within the hour instead of skipping a day
# (a skipped day compounds — the next run has a bigger backlog).
CLEANUP_CLAIM_SECONDS = 3600


def _cleanup_delivery_events():
    """Prune old delivery history ~once a day. Unresolved failed/skipped rows
    with an event range are kept — they are the out-of-sync record and stay
    re-shippable. Stream-level failure rows (no source) aren't retryable, so
    they age out normally."""
    from django.db.models import Q

    try:
        conn = _redis()
        if not conn.set(CLEANUP_MARKER_KEY, "1", nx=True, ex=CLEANUP_CLAIM_SECONDS):
            return
    except Exception:
        return

    LogStreamDeliveryEvent = apps.get_model("api", "LogStreamDeliveryEvent")
    cutoff = timezone.now() - timedelta(days=DELIVERY_RETENTION_DAYS)
    prunable = LogStreamDeliveryEvent.objects.filter(created_at__lt=cutoff).exclude(
        Q(status__in=[STATUS_FAILED, STATUS_SKIPPED])
        & Q(resolved_at__isnull=True)
        & ~Q(source="")
    )
    try:
        # Batched: one unbounded DELETE (plus the retried_from SET_NULL
        # collector) can outlive the sweep job's timeout on a large backlog.
        # Each batch commits independently, so an interrupted prune keeps its
        # progress and the retried claim finishes the remainder.
        while True:
            batch = list(prunable.values_list("id", flat=True)[:CLEANUP_BATCH_SIZE])
            if not batch:
                break
            LogStreamDeliveryEvent.objects.filter(id__in=batch).delete()
    except Exception:
        logger.exception("Failed to prune log stream delivery events")
        return

    try:
        conn.set(CLEANUP_MARKER_KEY, "1", ex=86400)
    except Exception:
        pass


def lag_for(stream, source_id):
    """Delivery delay in seconds: the age of the oldest event still waiting
    to ship, 0 when caught up.

    Deliberately NOT cursor distance — after an idle gap, a single fresh
    event would make cursor distance spike to the length of the gap for one
    sweep interval, reading as a phantom multi-hour stall."""
    try:
        source = get_source(source_id)
    except ValueError:
        return 0
    pending = source.oldest_pending_timestamp(
        stream.organisation, _get_cursor(stream, source_id)
    )
    if pending is None:
        return 0
    return max(0, int((timezone.now() - pending).total_seconds()))


def pause(stream, reason=""):
    stream.is_active = False
    stream.paused_reason = reason
    stream.save(update_fields=["is_active", "paused_reason", "updated_at"])
    cancel_ship_job(stream)


def resume(stream):
    """Reactivate a paused stream; shipping continues from the stored cursor
    on the next sweep (subject to the max-event-age floor)."""
    stream.is_active = True
    stream.paused_reason = ""
    stream.save(update_fields=["is_active", "paused_reason", "updated_at"])


def cancel_ship_job(stream):
    if not stream.ship_job_id:
        return
    queue = _queue()
    try:
        rq_job = Job.fetch(stream.ship_job_id, connection=queue.connection)
        if rq_job.is_queued or rq_job.is_started:
            rq_job.cancel()
        queue.remove(stream.ship_job_id)
    except NoSuchJobError:
        pass
    except Exception:
        logger.debug(
            "Could not cancel ship job %s", stream.ship_job_id, exc_info=True
        )


def test_adapter_connection(provider_id, credential_id, options, organisation):
    """Synchronous connection test used by the TestLogStreamConnection
    mutation. Returns (ok, message)."""
    try:
        adapter = get_adapter(provider_id)
    except ValueError as ex:
        return False, str(ex)

    try:
        credentials = get_credentials(credential_id)
    except Exception:
        return False, "Could not read the selected credentials"

    try:
        options = adapter.validate_options(options)
        adapter.test(
            credentials,
            options,
            {"organisation_name": organisation.name, "stream_name": "connection-test"},
        )
        return True, "Connection successful"
    except AdapterError as ex:
        return False, ex.user_message
    except Exception:
        logger.exception(
            "Log stream connection test crashed",
            extra={"provider": provider_id, "credential_id": credential_id},
        )
        return False, "The connection test failed unexpectedly"
