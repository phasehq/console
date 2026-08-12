"""Shipping engine: retry ladder, cursor semantics, pause/skip behaviour.

The at-least-once contract under test:
- cursors advance only after a successful ship (or deliberately, past an
  exhausted chunk / a stale skip-ahead range),
- auth errors pause the stream instead of burning retries,
- manual retries resolve the original delivery record without touching the
  live cursor.
"""

from datetime import datetime, timedelta, timezone as dt_timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from django.utils import timezone

from ee.integrations.logs.streams import engine
from ee.integrations.logs.streams.chunker import Chunk
from ee.integrations.logs.streams.adapters.base import ShipResult
from ee.integrations.logs.streams.exceptions import (
    AdapterAuthError,
    AdapterPermanentError,
    AdapterRateLimitedError,
    AdapterTransientError,
)

_E = "ee.integrations.logs.streams.engine"

_TS = datetime(2026, 7, 30, 12, 0, 0, tzinfo=dt_timezone.utc)


# Bound at test-module import, BEFORE the autouse fixture patches the module
# attribute — lets liveness-semantics tests exercise the real implementation.
_real_stream_is_shippable = engine._stream_is_shippable


@pytest.fixture(autouse=True)
def _shippable():
    """Delivery attempts re-check stream liveness/config against the DB;
    default it to shippable so each test exercises its own concern. Liveness
    tests override the return value or call the real implementation."""
    with patch(f"{_E}._stream_is_shippable", return_value=True) as mock_shippable:
        yield mock_shippable


def _stream(**overrides):
    stream = MagicMock()
    stream.id = "stream-1"
    stream.name = "test-stream"
    stream.provider = "datadog"
    stream.HEALTHY = "healthy"
    stream.DEGRADED = "degraded"
    stream.health = "healthy"
    stream.cursors = {}
    stream.sources = ["org_audit"]
    stream.max_attempts = 3
    stream.is_active = True
    stream.paused_reason = ""
    stream.authentication_id = "cred-1"
    stream.organisation = MagicMock()
    stream.organisation.name = "Acme"
    stream.created_at = _TS
    stream.deleted_at = None
    for key, value in overrides.items():
        setattr(stream, key, value)
    return stream


def _chunk():
    return Chunk(
        events=[{"event": {"id": "e1"}}, {"event": {"id": "e2"}}],
        byte_size=256,
        cursor_from=_TS,
        cursor_to=_TS + timedelta(seconds=5),
        cursor_from_id="e1",
        cursor_to_id="e2",
        last_cursor={"ts": (_TS + timedelta(seconds=5)).isoformat(), "id": "e2"},
    )


def _adapter(ship=None, max_event_age=timedelta(hours=18)):
    adapter = MagicMock()
    adapter.max_event_age = max_event_age
    if ship is not None:
        adapter.ship = ship
    return adapter


# ---------------------------------------------------------------------------
# record_delivery — badge policy
# ---------------------------------------------------------------------------


def test_record_delivery_pre_resolves_informational_rows():
    """The out-of-sync badge counts unresolved rows, which must all be
    actionable. Stream-level rows and FAILED retry-attempt children (the
    original stays the open item) are terminal outcomes — stored resolved."""
    delivery_model = MagicMock()
    stream = _stream()

    with patch(f"{_E}.apps.get_model", return_value=delivery_model):
        engine.record_delivery(stream, "", engine.STATUS_FAILED, meta={})
        assert delivery_model.objects.create.call_args.kwargs["resolved_at"] is not None

        engine.record_delivery(
            stream,
            "org_audit",
            engine.STATUS_FAILED,
            retried_from=MagicMock(),
            meta={},
        )
        assert delivery_model.objects.create.call_args.kwargs["resolved_at"] is not None

        # A ranged live failure is the actionable record — stays unresolved.
        engine.record_delivery(stream, "org_audit", engine.STATUS_FAILED, meta={})
        assert "resolved_at" not in delivery_model.objects.create.call_args.kwargs

        # The skipped head of a partial-expiry retry is the durable loss
        # record — stays unresolved even though it is a child row.
        engine.record_delivery(
            stream,
            "org_audit",
            engine.STATUS_SKIPPED,
            retried_from=MagicMock(),
            meta={},
        )
        assert "resolved_at" not in delivery_model.objects.create.call_args.kwargs


# ---------------------------------------------------------------------------
# _deliver_chunk — the retry ladder
# ---------------------------------------------------------------------------


def test_deliver_chunk_success_first_attempt():
    result = ShipResult(status_code=202, duration_ms=42)
    adapter = _adapter(ship=MagicMock(return_value=result))

    outcome, attempts, info = engine._deliver_chunk(
        _stream(), _chunk(), adapter, {}, {}, {}
    )

    assert (outcome, attempts, info) == (engine.DELIVERED, 1, result)


def test_deliver_chunk_transient_backoff_then_success():
    result = ShipResult(status_code=202)
    adapter = _adapter(
        ship=MagicMock(
            side_effect=[AdapterTransientError("503"), AdapterTransientError("503"), result]
        )
    )

    with patch(f"{_E}.time.sleep") as mock_sleep:
        outcome, attempts, _ = engine._deliver_chunk(
            _stream(), _chunk(), adapter, {}, {}, {}
        )

    assert outcome == engine.DELIVERED
    assert attempts == 3
    assert [call.args[0] for call in mock_sleep.call_args_list] == [5, 15]


def test_deliver_chunk_honors_retry_after():
    result = ShipResult(status_code=202)
    adapter = _adapter(
        ship=MagicMock(
            side_effect=[AdapterRateLimitedError("429", retry_after=7), result]
        )
    )

    with patch(f"{_E}.time.sleep") as mock_sleep:
        outcome, attempts, _ = engine._deliver_chunk(
            _stream(), _chunk(), adapter, {}, {}, {}
        )

    assert outcome == engine.DELIVERED
    assert attempts == 2
    mock_sleep.assert_called_once_with(7)


def test_deliver_chunk_auth_error_short_circuits():
    adapter = _adapter(ship=MagicMock(side_effect=AdapterAuthError("401")))

    with patch(f"{_E}.time.sleep") as mock_sleep:
        outcome, attempts, info = engine._deliver_chunk(
            _stream(), _chunk(), adapter, {}, {}, {}
        )

    assert outcome == engine.AUTH_ERROR
    assert attempts == 1
    assert isinstance(info, AdapterAuthError)
    mock_sleep.assert_not_called()


def test_deliver_chunk_permanent_error_does_not_retry():
    adapter = _adapter(ship=MagicMock(side_effect=AdapterPermanentError("400")))

    with patch(f"{_E}.time.sleep") as mock_sleep:
        outcome, attempts, _ = engine._deliver_chunk(
            _stream(), _chunk(), adapter, {}, {}, {}
        )

    assert outcome == engine.EXHAUSTED
    assert attempts == 1
    mock_sleep.assert_not_called()


def test_deliver_chunk_stops_at_wall_clock_deadline():
    """Retry-After sleeps are honoured only inside the delivery deadline —
    otherwise a rate-limited destination could stretch one chunk past the
    ingestion-window margin and get its events accepted-then-dropped."""
    adapter = _adapter(
        ship=MagicMock(side_effect=AdapterRateLimitedError("429", retry_after=300))
    )

    with patch(f"{_E}.time.sleep") as mock_sleep, patch(
        f"{_E}.time.monotonic",
        side_effect=[0, engine.DELIVERY_DEADLINE_SECONDS + 1],
    ):
        outcome, attempts, _ = engine._deliver_chunk(
            _stream(max_attempts=10), _chunk(), adapter, {}, {}, {}
        )

    assert outcome == engine.EXHAUSTED
    assert attempts == 1
    mock_sleep.assert_not_called()


def test_deliver_chunk_aborts_when_stream_changes_mid_ladder(_shippable):
    """A pause or config change landing during a backoff sleep must stop the
    NEXT egress attempt — not wait for the chunk to finish its ladder."""
    _shippable.side_effect = [True, False]
    adapter = _adapter(ship=MagicMock(side_effect=AdapterTransientError("503")))

    with patch(f"{_E}.time.sleep"):
        outcome, attempts, info = engine._deliver_chunk(
            _stream(max_attempts=5), _chunk(), adapter, {}, {}, {}
        )

    assert outcome == engine.ABORTED
    assert attempts == 1
    assert info is None
    assert adapter.ship.call_count == 1


def test_ship_chunk_aborted_holds_cursor_and_stops():
    """ABORTED means nothing was egressed and nothing failed — hold position
    silently and let the next sweep reload fresh state."""
    stream = _stream()
    chunk = _chunk()

    with patch(
        f"{_E}._deliver_chunk", return_value=(engine.ABORTED, 0, None)
    ), patch(f"{_E}.record_delivery") as mock_record:
        outcome = engine._ship_chunk(
            stream, "org_audit", chunk, MagicMock(), {}, {}, {}
        )

    assert outcome == engine.PAUSE
    assert "org_audit" not in stream.cursors
    mock_record.assert_not_called()


def test_stream_is_shippable_halts_on_config_or_entitlement_change():
    """The live check must catch pause/delete AND configuration changes (the
    job still holds the old sources/credentials/options) AND loss of the
    Enterprise plan — not just activity state."""
    stream = _stream(
        sources=["org_audit"],
        max_attempts=3,
        options={"gzip": True},
        authentication_id="cred-1",
    )

    row = {
        "sources": ["org_audit"],
        "authentication_id": "cred-1",
        "options": {"gzip": True},
        "max_attempts": 3,
    }
    model = MagicMock()
    row_query = model.objects.filter.return_value.values.return_value

    with patch(f"{_E}.apps.get_model", return_value=model):
        row_query.first.return_value = dict(row)
        assert _real_stream_is_shippable(stream) is True
        # The Enterprise entitlement is part of the query itself (mirrors
        # quotas.can_use_log_streams).
        assert model.objects.filter.call_args.kwargs["organisation__plan"] == "EN"
        assert model.objects.filter.call_args.kwargs["is_active"] is True

        # Credential rotated by a concurrent update → halt.
        row_query.first.return_value = {**row, "authentication_id": "cred-2"}
        assert _real_stream_is_shippable(stream) is False

        # Source removed → halt.
        row_query.first.return_value = {**row, "sources": []}
        assert _real_stream_is_shippable(stream) is False

        # Paused / deleted / plan lost → row filtered out → halt.
        row_query.first.return_value = None
        assert _real_stream_is_shippable(stream) is False


def test_margin_bounds_worst_case_delivery_cycle():
    """Arithmetic guard: if the delivery deadline or the retry job timeout
    ever exceeds the skip-ahead margin, events admitted for delivery can
    cross the destination's age cutoff mid-flight and be silently discarded
    while recorded as delivered."""
    assert (
        engine.DELIVERY_DEADLINE_SECONDS + 300
        <= engine.SKIP_AHEAD_MARGIN.total_seconds()
    )
    assert engine.RETRY_JOB_TIMEOUT + 300 <= engine.SKIP_AHEAD_MARGIN.total_seconds()


def test_deliver_chunk_exhausts_at_max_attempts():
    adapter = _adapter(ship=MagicMock(side_effect=AdapterTransientError("503")))

    with patch(f"{_E}.time.sleep") as mock_sleep:
        outcome, attempts, _ = engine._deliver_chunk(
            _stream(max_attempts=3), _chunk(), adapter, {}, {}, {}
        )

    assert outcome == engine.EXHAUSTED
    assert attempts == 3
    # No sleep after the final attempt.
    assert mock_sleep.call_count == 2


# ---------------------------------------------------------------------------
# _ship_chunk — state effects
# ---------------------------------------------------------------------------


def test_ship_chunk_success_advances_cursor_and_marks_healthy():
    stream = _stream(health="degraded", last_failure_reason="old failure")
    chunk = _chunk()
    adapter = _adapter(ship=MagicMock(return_value=ShipResult(status_code=202)))

    with patch(f"{_E}.record_delivery") as mock_record:
        outcome = engine._ship_chunk(stream, "org_audit", chunk, adapter, {}, {}, {})

    assert outcome == engine.CONTINUE
    assert stream.cursors["org_audit"] == chunk.last_cursor
    assert stream.health == "healthy"
    assert stream.last_failure_reason == ""
    # Delivery-path saves must never write lifecycle fields — the job's row
    # is stale relative to a pause/delete the user made while it ran.
    update_fields = stream.save.call_args.kwargs["update_fields"]
    assert "is_active" not in update_fields
    assert "paused_reason" not in update_fields
    assert mock_record.call_args.args[2] == engine.STATUS_COMPLETED


def test_ship_chunk_auth_error_pauses_and_keeps_cursor():
    stream = _stream()
    chunk = _chunk()
    adapter = _adapter(ship=MagicMock(side_effect=AdapterAuthError("401")))
    log_stream_model = MagicMock()

    with patch(f"{_E}.record_delivery") as mock_record, patch(
        f"{_E}.apps.get_model", return_value=log_stream_model
    ):
        outcome = engine._ship_chunk(stream, "org_audit", chunk, adapter, {}, {}, {})

    assert outcome == engine.PAUSE
    assert "org_audit" not in stream.cursors
    # The pause is written through a targeted queryset update, never a full
    # save from the (possibly stale) in-memory row.
    update_kwargs = log_stream_model.objects.filter.return_value.update.call_args.kwargs
    assert update_kwargs["is_active"] is False
    assert update_kwargs["paused_reason"] == "auth_error"
    assert update_kwargs["health"] == "degraded"
    assert stream.is_active is False
    assert stream.paused_reason == "auth_error"
    assert stream.health == "degraded"
    assert mock_record.call_args.args[2] == engine.STATUS_FAILED


def test_ship_chunk_success_auto_resolves_covered_failures():
    """A successful ship covering a previously-failed range resolves the old
    failure rows, so the out-of-sync badge doesn't invite a double-shipping
    manual retry after an auth recovery. Containment compares (timestamp, id)
    bounds — a chunk that merely shares boundary timestamps with a failed
    row must NOT resolve events it didn't deliver."""
    from django.db.models import Q

    stream = _stream()
    chunk = _chunk()
    adapter = _adapter(ship=MagicMock(return_value=ShipResult(status_code=202)))

    delivery_model = MagicMock()
    (
        delivery_model.objects.filter.return_value.filter.return_value.filter.return_value.update.return_value
    ) = 2

    with patch(f"{_E}.record_delivery") as mock_record, patch(
        f"{_E}.apps.get_model", return_value=delivery_model
    ):
        engine._ship_chunk(stream, "org_audit", chunk, adapter, {}, {}, {})

    filter_kwargs = delivery_model.objects.filter.call_args.kwargs
    assert filter_kwargs["source"] == "org_audit"
    assert filter_kwargs["resolved_at__isnull"] is True

    starts_inside = delivery_model.objects.filter.return_value.filter.call_args.args[0]
    ends_inside = (
        delivery_model.objects.filter.return_value.filter.return_value.filter.call_args.args[0]
    )
    assert starts_inside == Q(cursor_from__gt=chunk.cursor_from) | (
        Q(cursor_from=chunk.cursor_from)
        & (Q(cursor_from_id__gte="e1") | Q(cursor_from_id=""))
    )
    assert ends_inside == Q(cursor_to__lt=chunk.cursor_to) | (
        Q(cursor_to=chunk.cursor_to)
        & (Q(cursor_to_id__lte="e2") | Q(cursor_to_id=""))
    )
    assert mock_record.call_args.kwargs["meta"]["auto_resolved"] == 2
    assert mock_record.call_args.kwargs["cursor_from_id"] == "e1"
    assert mock_record.call_args.kwargs["cursor_to_id"] == "e2"


def test_ship_chunk_exhaustion_skips_forward_and_degrades():
    stream = _stream()
    chunk = _chunk()
    adapter = _adapter(ship=MagicMock(side_effect=AdapterTransientError("503")))

    with patch(f"{_E}.record_delivery") as mock_record, patch(f"{_E}.time.sleep"):
        outcome = engine._ship_chunk(stream, "org_audit", chunk, adapter, {}, {}, {})

    assert outcome == engine.CONTINUE
    # Cursor advances PAST the failed chunk — no head-of-line blocking. The
    # range is recorded and stays manually re-shippable.
    assert stream.cursors["org_audit"] == chunk.last_cursor
    assert stream.health == "degraded"
    assert stream.is_active is True
    assert mock_record.call_args.args[2] == engine.STATUS_FAILED


def test_ship_chunk_exhaustion_holds_cursor_when_failure_record_is_lost():
    """If the failed-range record can't be persisted, advancing the cursor
    would silently lose the events with no re-shippable trace — the source
    must halt at the current cursor instead."""
    stream = _stream()
    chunk = _chunk()
    adapter = _adapter(ship=MagicMock(side_effect=AdapterPermanentError("400")))

    with patch(f"{_E}.record_delivery", return_value=None):
        outcome = engine._ship_chunk(stream, "org_audit", chunk, adapter, {}, {}, {})

    assert outcome == engine.HALT
    assert "org_audit" not in stream.cursors
    assert stream.health == "degraded"


# ---------------------------------------------------------------------------
# _skip_ahead — max-event-age floor
# ---------------------------------------------------------------------------


def test_skip_ahead_records_skipped_range_and_floors_cursor():
    stale = timezone.now() - timedelta(hours=30)
    stream = _stream(cursors={"org_audit": {"ts": stale.isoformat(), "id": ""}})
    source = MagicMock()
    source.count_before.return_value = 42

    with patch(f"{_E}.record_delivery") as mock_record:
        proceed = engine._skip_ahead(stream, "org_audit", source, _adapter())

    assert proceed is True
    assert mock_record.call_args.args[2] == engine.STATUS_SKIPPED
    assert mock_record.call_args.kwargs["event_count"] == 42
    new_cursor_ts = datetime.fromisoformat(stream.cursors["org_audit"]["ts"])
    assert timezone.now() - new_cursor_ts < timedelta(hours=18)


def test_skip_ahead_halts_source_when_record_is_lost():
    """No skipped-range record → no trace of the loss. The cursor must hold
    AND the source must halt (returns False) — otherwise the caller would
    fetch the expired backlog from the stale cursor and ship events the
    destination accepts-then-drops, advancing past them as 'completed'."""
    stale = timezone.now() - timedelta(hours=30)
    cursor = {"ts": stale.isoformat(), "id": ""}
    stream = _stream(cursors={"org_audit": cursor})
    source = MagicMock()
    source.count_before.return_value = 42

    with patch(f"{_E}.record_delivery", return_value=None):
        proceed = engine._skip_ahead(stream, "org_audit", source, _adapter())

    assert proceed is False
    assert stream.cursors["org_audit"] == cursor
    stream.save.assert_not_called()


def test_skip_ahead_noop_when_cursor_is_fresh():
    fresh = timezone.now() - timedelta(minutes=5)
    cursor = {"ts": fresh.isoformat(), "id": ""}
    stream = _stream(cursors={"org_audit": cursor})
    source = MagicMock()

    with patch(f"{_E}.record_delivery") as mock_record:
        engine._skip_ahead(stream, "org_audit", source, _adapter())

    mock_record.assert_not_called()
    assert stream.cursors["org_audit"] == cursor
    source.count_before.assert_not_called()


def test_skip_ahead_noop_without_max_event_age():
    stale = timezone.now() - timedelta(days=30)
    cursor = {"ts": stale.isoformat(), "id": ""}
    stream = _stream(cursors={"org_audit": cursor})

    with patch(f"{_E}.record_delivery") as mock_record:
        engine._skip_ahead(stream, "org_audit", MagicMock(), _adapter(max_event_age=None))

    mock_record.assert_not_called()
    assert stream.cursors["org_audit"] == cursor


# ---------------------------------------------------------------------------
# sweep — plan gate + overlap protection
# ---------------------------------------------------------------------------


def _sweep_setup(streams, stranded=()):
    log_stream_model = MagicMock()

    active_qs = MagicMock()
    active_qs.select_related.return_value.order_by.return_value = streams

    stranded_qs = MagicMock()
    stranded_qs.__iter__ = MagicMock(return_value=iter(stranded))

    def filter_side_effect(**kwargs):
        if kwargs.get("authentication__isnull") is True:
            return stranded_qs
        return active_qs

    log_stream_model.objects.filter.side_effect = filter_side_effect
    return log_stream_model


def test_sweep_gates_on_plan_and_running_jobs():
    stream_gated = _stream(id="s1")
    stream_running = _stream(id="s2", ship_job_id="job-2")
    stream_ok = _stream(id="s3", ship_job_id=None)

    running_job = MagicMock(is_queued=False, is_started=True)

    with patch(f"{_E}.apps.get_model", return_value=_sweep_setup(
        [stream_gated, stream_running, stream_ok]
    )), patch(
        f"{_E}.can_use_log_streams", side_effect=[False, True, True]
    ), patch(
        f"{_E}.Job.fetch", return_value=running_job
    ), patch.object(
        engine.ship_log_stream, "delay", return_value=MagicMock(get_id=lambda: "job-3")
    ) as mock_delay, patch(
        f"{_E}._queue"
    ), patch(
        f"{_E}._cleanup_delivery_events"
    ):
        engine.sweep_log_streams()

    mock_delay.assert_called_once_with("s3")
    assert stream_ok.ship_job_id == "job-3"


def test_sweep_warns_when_ship_jobs_starve_for_workers():
    """A ship job still *queued* a full sweep later means the worker pool is
    saturated — the sweep logs the LOG_STREAM_WORKERS capacity signal."""
    stream_starved = _stream(id="s1", ship_job_id="job-1")

    queued_job = MagicMock(is_queued=True, is_started=False)

    with patch(f"{_E}.apps.get_model", return_value=_sweep_setup([stream_starved])), patch(
        f"{_E}.can_use_log_streams", return_value=True
    ), patch(f"{_E}.Job.fetch", return_value=queued_job), patch.object(
        engine.ship_log_stream, "delay"
    ) as mock_delay, patch(
        f"{_E}._queue"
    ), patch(
        f"{_E}._cleanup_delivery_events"
    ), patch(
        f"{_E}.logger"
    ) as mock_logger:
        engine.sweep_log_streams()

    mock_delay.assert_not_called()
    warning_text = mock_logger.warning.call_args.args[0]
    assert "LOG_STREAM_WORKERS" in warning_text
    assert mock_logger.warning.call_args.args[1] == 1


def test_sweep_pauses_streams_with_deleted_credentials():
    """A hard-deleted credential row leaves authentication NULL (SET_NULL) —
    the sweep must pause such streams visibly instead of leaving them
    'healthy' while they silently ship nothing."""
    stranded = _stream(id="s1", authentication_id=None)

    with patch(
        f"{_E}.apps.get_model", return_value=_sweep_setup([], stranded=[stranded])
    ), patch(f"{_E}.record_delivery") as mock_record, patch(
        f"{_E}._pause_stream_row"
    ) as mock_pause, patch(
        f"{_E}._queue"
    ), patch(
        f"{_E}._cleanup_delivery_events"
    ):
        engine.sweep_log_streams()

    assert mock_record.call_args.args[2] == engine.STATUS_FAILED
    assert mock_record.call_args.kwargs["meta"]["error"] == "credentials_missing"
    assert mock_pause.call_args.args[1] == "credentials_missing"


def test_ship_stream_stops_when_paused_mid_job():
    """rq can't stop a started job — the chunk loop itself must notice a
    concurrent pause/delete via a live DB check and stop shipping."""
    stream = _stream()
    source = MagicMock()
    source.fetch.return_value = [SimpleNamespace(timestamp=_TS)]
    source.serialize.return_value = {"event": {"id": "e"}}
    source.cursor_of.return_value = {"ts": _TS.isoformat(), "id": "e"}

    with patch(f"{_E}.get_adapter", return_value=_adapter(max_event_age=None)), patch(
        f"{_E}.get_credentials", return_value={}
    ), patch(f"{_E}.get_source", return_value=source), patch(
        f"{_E}.lag_for", return_value=0
    ), patch(
        f"{_E}._stream_is_shippable", return_value=False
    ), patch(
        f"{_E}._ship_chunk"
    ) as mock_ship_chunk:
        engine._ship_stream(stream)

    mock_ship_chunk.assert_not_called()


def test_ship_stream_ships_one_chunk_per_tail_iteration():
    """A byte-split fetch must not ship its later chunks under the age floor
    computed for the first — each iteration re-floors and refetches from the
    advanced cursor instead."""
    stream = _stream()
    source = MagicMock()
    source.fetch.side_effect = [[SimpleNamespace(timestamp=_TS)], []]
    source.serialize.return_value = {"event": {"id": "e"}}
    source.cursor_of.return_value = {"ts": _TS.isoformat(), "id": "e"}

    chunk_a, chunk_b = _chunk(), _chunk()

    with patch(f"{_E}.get_adapter", return_value=_adapter(max_event_age=None)), patch(
        f"{_E}.get_credentials", return_value={}
    ), patch(f"{_E}.get_source", return_value=source), patch(
        f"{_E}.lag_for", return_value=0
    ), patch(
        f"{_E}.chunk_envelopes", return_value=[chunk_a, chunk_b]
    ), patch(
        f"{_E}._stream_is_shippable", return_value=True
    ), patch(
        f"{_E}._ship_chunk", return_value=engine.CONTINUE
    ) as mock_ship_chunk:
        engine._ship_stream(stream)

    # Only the FIRST chunk of the fetch ships; the loop re-fetches (empty on
    # the second iteration here) instead of shipping chunk_b stale.
    assert mock_ship_chunk.call_count == 1
    assert mock_ship_chunk.call_args.args[2] is chunk_a
    assert source.fetch.call_count == 2


def test_ship_log_stream_noops_without_redis_lock():
    stream = _stream()
    log_stream_model = MagicMock()
    (
        log_stream_model.objects.filter.return_value.select_related.return_value.first.return_value
    ) = stream

    conn = MagicMock()
    conn.set.return_value = False  # lock held elsewhere

    queue = MagicMock()
    queue.connection = conn

    with patch(f"{_E}.apps.get_model", return_value=log_stream_model), patch(
        f"{_E}._queue", return_value=queue
    ), patch(f"{_E}._ship_stream") as mock_ship:
        engine.ship_log_stream("stream-1")

    mock_ship.assert_not_called()


# ---------------------------------------------------------------------------
# retry_delivery — manual backfill
# ---------------------------------------------------------------------------


def _retry_original(stream, cursor_from, cursor_to):
    original = MagicMock()
    original.status = "failed"
    original.resolved_at = None
    original.source = "org_audit"
    original.stream = stream
    original.cursor_from = cursor_from
    original.cursor_to = cursor_to
    return original


def _retry_setup(original, source_events=1):
    delivery_model = MagicMock()
    delivery_model.FAILED = "failed"
    delivery_model.SKIPPED = "skipped"
    delivery_model.COMPLETED = "completed"
    (
        delivery_model.objects.filter.return_value.select_related.return_value.first.return_value
    ) = original

    source = MagicMock()
    base_ts = original.cursor_from if original.cursor_from else _TS
    source.fetch_range.return_value = [
        SimpleNamespace(timestamp=base_ts + timedelta(seconds=i))
        for i in range(source_events)
    ]
    source.serialize.return_value = {"event": {"id": "e"}}
    source.cursor_of.return_value = {"ts": base_ts.isoformat(), "id": "e"}

    return delivery_model, source


def test_retry_delivery_success_resolves_original():
    now = timezone.now()
    stream = _stream()
    original = _retry_original(stream, now - timedelta(hours=2), now - timedelta(hours=1))

    delivery_model, source = _retry_setup(original)

    with patch(f"{_E}.apps.get_model", return_value=delivery_model), patch(
        f"{_E}._redis"
    ), patch(
        f"{_E}.get_adapter", return_value=_adapter()
    ), patch(f"{_E}.get_source", return_value=source), patch(
        f"{_E}.get_credentials", return_value={}
    ), patch(
        f"{_E}._deliver_chunk",
        return_value=(engine.DELIVERED, 1, ShipResult(status_code=202)),
    ), patch(
        f"{_E}.record_delivery"
    ) as mock_record:
        engine.retry_delivery("delivery-1")

    assert mock_record.call_args.args[2] == engine.STATUS_COMPLETED
    assert mock_record.call_args.kwargs["retried_from"] is original
    assert original.resolved_at is not None
    original.save.assert_called_once_with(update_fields=["resolved_at"])
    # The stream row is only touched via a targeted queryset update
    # (last_shipped_at) — never a full save that could rewind live cursors.
    stream.save.assert_not_called()
    update_kwargs = delivery_model.objects.filter.return_value.update.call_args.kwargs
    assert set(update_kwargs.keys()) == {"last_shipped_at", "updated_at"}


def test_retry_delivery_failure_leaves_original_unresolved():
    now = timezone.now()
    stream = _stream()
    original = _retry_original(stream, now - timedelta(hours=2), now - timedelta(hours=1))

    delivery_model, source = _retry_setup(original)

    with patch(f"{_E}.apps.get_model", return_value=delivery_model), patch(
        f"{_E}._redis"
    ), patch(
        f"{_E}.get_adapter", return_value=_adapter()
    ), patch(f"{_E}.get_source", return_value=source), patch(
        f"{_E}.get_credentials", return_value={}
    ), patch(
        f"{_E}._deliver_chunk",
        return_value=(engine.EXHAUSTED, 3, AdapterTransientError("503")),
    ), patch(
        f"{_E}.record_delivery"
    ) as mock_record:
        engine.retry_delivery("delivery-1")

    assert mock_record.call_args.args[2] == engine.STATUS_FAILED
    assert mock_record.call_args.kwargs["retried_from"] is original
    assert original.resolved_at is None
    original.save.assert_not_called()


def test_retry_delivery_rejects_fully_expired_range():
    """Datadog 202s then silently discards events older than max_event_age —
    'successfully' re-shipping an expired range would falsely mark it
    recovered."""
    now = timezone.now()
    stream = _stream()
    original = _retry_original(
        stream, now - timedelta(hours=30), now - timedelta(hours=20)
    )

    delivery_model, source = _retry_setup(original)

    with patch(f"{_E}.apps.get_model", return_value=delivery_model), patch(
        f"{_E}._redis"
    ), patch(
        f"{_E}.get_adapter", return_value=_adapter()
    ), patch(f"{_E}.get_source", return_value=source), patch(
        f"{_E}.get_credentials", return_value={}
    ), patch(
        f"{_E}._deliver_chunk"
    ) as mock_deliver, patch(
        f"{_E}.record_delivery"
    ) as mock_record:
        engine.retry_delivery("delivery-1")

    mock_deliver.assert_not_called()
    assert mock_record.call_args.args[2] == engine.STATUS_FAILED
    assert mock_record.call_args.kwargs["meta"]["error"] == "range_expired"
    assert original.resolved_at is None
    original.save.assert_not_called()


def test_retry_delivery_splits_partially_expired_range():
    """Head expired, tail still inside the window: ship the tail, record the
    lost head as its own skipped row, resolve the original."""
    now = timezone.now()
    stream = _stream()
    original = _retry_original(
        stream, now - timedelta(hours=30), now - timedelta(hours=1)
    )

    delivery_model, source = _retry_setup(original)

    with patch(f"{_E}.apps.get_model", return_value=delivery_model), patch(
        f"{_E}._redis"
    ), patch(
        f"{_E}.get_adapter", return_value=_adapter()
    ), patch(f"{_E}.get_source", return_value=source), patch(
        f"{_E}.get_credentials", return_value={}
    ), patch(
        f"{_E}._deliver_chunk",
        return_value=(engine.DELIVERED, 1, ShipResult(status_code=202)),
    ), patch(
        f"{_E}.record_delivery"
    ) as mock_record:
        engine.retry_delivery("delivery-1")

    # fetch_range starts at the ingestion-window floor, not the expired head.
    fetch_from = source.fetch_range.call_args.args[1]
    assert fetch_from > original.cursor_from
    assert now - fetch_from < timedelta(hours=18)

    statuses = [call.args[2] for call in mock_record.call_args_list]
    assert statuses == [engine.STATUS_SKIPPED, engine.STATUS_COMPLETED]
    skipped_kwargs = mock_record.call_args_list[0].kwargs
    assert skipped_kwargs["cursor_from"] == original.cursor_from
    assert skipped_kwargs["meta"]["reason"] == "max_event_age_exceeded"
    assert original.resolved_at is not None


def test_retry_delivery_skips_when_claim_held():
    """Duplicate enqueues (double-click, concurrent API calls) must not ship
    the same range twice in parallel — the per-delivery Redis claim
    serializes them."""
    conn = MagicMock()
    conn.set.return_value = False  # claim held by another worker

    with patch(f"{_E}._redis", return_value=conn), patch(
        f"{_E}._retry_delivery_locked"
    ) as mock_locked:
        engine.retry_delivery("delivery-1")

    mock_locked.assert_not_called()


def test_retry_delivery_stops_mid_job_when_stream_paused():
    """Same live check as the ship path: a pause issued while the retry runs
    must stop egress before the next chunk."""
    now = timezone.now()
    stream = _stream()
    original = _retry_original(stream, now - timedelta(hours=2), now - timedelta(hours=1))

    delivery_model, source = _retry_setup(original)

    with patch(f"{_E}.apps.get_model", return_value=delivery_model), patch(
        f"{_E}._redis"
    ), patch(
        f"{_E}.get_adapter", return_value=_adapter()
    ), patch(f"{_E}.get_source", return_value=source), patch(
        f"{_E}.get_credentials", return_value={}
    ), patch(
        f"{_E}._stream_is_shippable", return_value=False
    ), patch(
        f"{_E}._deliver_chunk"
    ) as mock_deliver:
        engine.retry_delivery("delivery-1")

    mock_deliver.assert_not_called()
    assert original.resolved_at is None


def test_retry_delivery_noops_when_stream_paused():
    """Pause means no egress — manual retries included (the mutation raises
    the user-facing error; the job guard covers queued/direct paths)."""
    now = timezone.now()
    stream = _stream(is_active=False)
    original = _retry_original(stream, now - timedelta(hours=2), now - timedelta(hours=1))

    delivery_model, _ = _retry_setup(original)

    with patch(f"{_E}.apps.get_model", return_value=delivery_model), patch(
        f"{_E}._redis"
    ), patch(
        f"{_E}.get_adapter"
    ) as mock_adapter:
        engine.retry_delivery("delivery-1")

    mock_adapter.assert_not_called()


def test_retry_delivery_keeps_original_open_when_head_record_is_lost():
    """If the skipped-head insert fails during a partial-expiry retry, the
    original must stay unresolved — resolving it would erase the only trace
    of the expired head's loss."""
    now = timezone.now()
    stream = _stream()
    original = _retry_original(
        stream, now - timedelta(hours=30), now - timedelta(hours=1)
    )

    delivery_model, source = _retry_setup(original)

    def record_side_effect(stream_arg, source_arg, status, **fields):
        return None if status == engine.STATUS_SKIPPED else MagicMock()

    with patch(f"{_E}.apps.get_model", return_value=delivery_model), patch(
        f"{_E}._redis"
    ), patch(
        f"{_E}.get_adapter", return_value=_adapter()
    ), patch(f"{_E}.get_source", return_value=source), patch(
        f"{_E}.get_credentials", return_value={}
    ), patch(
        f"{_E}._deliver_chunk",
        return_value=(engine.DELIVERED, 1, ShipResult(status_code=202)),
    ), patch(
        f"{_E}.record_delivery", side_effect=record_side_effect
    ):
        engine.retry_delivery("delivery-1")

    assert original.resolved_at is None
    original.save.assert_not_called()


def test_retry_delivery_rejects_oversized_range():
    """A range with more events than the cap fails honestly instead of
    shipping a subset and falsely resolving the whole original."""
    now = timezone.now()
    stream = _stream()
    original = _retry_original(stream, now - timedelta(hours=2), now - timedelta(hours=1))

    delivery_model, source = _retry_setup(
        original, source_events=engine.RETRY_MAX_EVENTS + 1
    )

    with patch(f"{_E}.apps.get_model", return_value=delivery_model), patch(
        f"{_E}._redis"
    ), patch(
        f"{_E}.get_adapter", return_value=_adapter()
    ), patch(f"{_E}.get_source", return_value=source), patch(
        f"{_E}.get_credentials", return_value={}
    ), patch(
        f"{_E}._deliver_chunk"
    ) as mock_deliver, patch(
        f"{_E}.record_delivery"
    ) as mock_record:
        engine.retry_delivery("delivery-1")

    mock_deliver.assert_not_called()
    assert mock_record.call_args.kwargs["meta"]["error"] == "range_too_large"
    assert original.resolved_at is None


def test_retry_delivery_ignores_resolved_or_completed_rows():
    original = MagicMock()
    original.status = "completed"
    original.resolved_at = None

    delivery_model, _ = _retry_setup(original)

    with patch(f"{_E}.apps.get_model", return_value=delivery_model), patch(
        f"{_E}._redis"
    ), patch(
        f"{_E}.get_adapter"
    ) as mock_adapter:
        engine.retry_delivery("delivery-1")

    mock_adapter.assert_not_called()


# ---------------------------------------------------------------------------
# lag + pause/resume
# ---------------------------------------------------------------------------


def test_lag_for_is_oldest_pending_event_age():
    """Lag = delivery delay (age of the oldest unshipped event), NOT cursor
    distance — a fresh event after an idle gap must read ~0, not gap-sized."""
    now = timezone.now()
    source = MagicMock()
    source.oldest_pending_timestamp.return_value = now - timedelta(seconds=300)

    with patch(f"{_E}.get_source", return_value=source):
        lag = engine.lag_for(_stream(), "org_audit")

    assert 295 <= lag <= 305


def test_lag_for_fresh_event_after_idle_gap_reads_near_zero():
    now = timezone.now()
    # Cursor is hours old (idle org), but the only pending event just arrived.
    stream = _stream(
        cursors={"org_audit": {"ts": (now - timedelta(hours=6)).isoformat(), "id": ""}}
    )
    source = MagicMock()
    source.oldest_pending_timestamp.return_value = now - timedelta(seconds=5)

    with patch(f"{_E}.get_source", return_value=source):
        assert engine.lag_for(stream, "org_audit") <= 10


def test_lag_for_returns_zero_when_nothing_pending():
    source = MagicMock()
    source.oldest_pending_timestamp.return_value = None

    with patch(f"{_E}.get_source", return_value=source):
        assert engine.lag_for(_stream(), "org_audit") == 0


def test_pause_and_resume_roundtrip_preserves_cursor():
    cursor = {"ts": _TS.isoformat(), "id": "e9"}
    stream = _stream(cursors={"org_audit": cursor})

    with patch(f"{_E}.cancel_ship_job") as mock_cancel:
        engine.pause(stream)

    assert stream.is_active is False
    mock_cancel.assert_called_once_with(stream)

    engine.resume(stream)

    assert stream.is_active is True
    assert stream.paused_reason == ""
    # Resume never touches cursors — shipping continues where it left off.
    assert stream.cursors["org_audit"] == cursor


# ---------------------------------------------------------------------------
# Expired-row resolution + delivery history retention
# ---------------------------------------------------------------------------


def _delivery_row(provider="datadog", cursor_to=None, meta=None, event_id="d-1"):
    row = MagicMock()
    row.id = event_id
    row.stream = _stream(provider=provider)
    row.stream_id = "stream-1"
    row.cursor_to = cursor_to
    row.created_at = timezone.now() - timedelta(days=3)
    row.meta = meta
    row.resolved_at = None
    return row


def _expiry_update_calls(delivery_model):
    """(filter_kwargs, update_kwargs) pairs for the per-row conditional
    resolution writes (skipping the initial unresolved-set query)."""
    updates = []
    for call, update_call in zip(
        delivery_model.objects.filter.call_args_list[1:],
        delivery_model.objects.filter.return_value.update.call_args_list,
    ):
        updates.append((call.kwargs, update_call.kwargs))
    return updates


def test_resolve_expired_failures_resolves_only_unretryable_rows():
    """A row whose whole range left the ingestion window can never be
    re-shipped (retry rejects it as range_expired) — it must be resolved
    with meta resolution=expired so the badge stays actionable and the row
    ages out under retention. Rows still inside the window stay open, and
    the write is a conditional update so a concurrently-written resolution
    is never clobbered."""
    now = timezone.now()
    # Distinct ids so an inverted window predicate (resolving the live row
    # instead) can't pass with the same update count.
    expired = _delivery_row(cursor_to=now - timedelta(hours=30), event_id="d-expired")
    live = _delivery_row(cursor_to=now - timedelta(hours=1), event_id="d-live")

    delivery_model = MagicMock()
    (
        delivery_model.objects.filter.return_value.exclude.return_value.select_related.return_value
    ) = [expired, live]

    with patch(f"{_E}.apps.get_model", return_value=delivery_model):
        engine._resolve_expired_failures()

    updates = _expiry_update_calls(delivery_model)
    assert len(updates) == 1
    filter_kwargs, update_kwargs = updates[0]
    assert filter_kwargs == {"id": "d-expired", "resolved_at__isnull": True}
    assert update_kwargs["resolved_at"] is not None
    assert update_kwargs["meta"]["resolution"] == "expired"


def test_expired_resolve_grace_covers_every_adapter_window():
    """The static grace must exceed every registered adapter's
    (window - margin + retry-job lifetime) so a row is never auto-resolved
    while a retry that passed the window check is still in flight. A future
    wide-window adapter that breaks this trips the module-level assert."""
    from ee.integrations.logs.streams.adapters import all_adapters

    for adapter in all_adapters():
        if not adapter.max_event_age:
            continue
        worst_case = (
            adapter.max_event_age
            - engine.SKIP_AHEAD_MARGIN
            + timedelta(seconds=engine.RETRY_JOB_TIMEOUT)
        )
        assert engine.EXPIRED_RESOLVE_GRACE >= worst_case, adapter.id


def test_resolve_expired_failures_skips_unknown_and_windowless_providers():
    """Unknown adapters (unregistered provider) and adapters without an
    ingestion window have no expiry — their rows stay open until a retry
    or a covering ship resolves them."""
    from types import SimpleNamespace

    now = timezone.now()
    unknown = _delivery_row(provider="bogus", cursor_to=now - timedelta(days=5))
    windowless = _delivery_row(provider="webhook", cursor_to=now - timedelta(days=5))

    def fake_get_adapter(provider):
        if provider == "webhook":
            return SimpleNamespace(max_event_age=None)
        raise ValueError(provider)

    delivery_model = MagicMock()
    (
        delivery_model.objects.filter.return_value.exclude.return_value.select_related.return_value
    ) = [unknown, windowless]

    with patch(f"{_E}.apps.get_model", return_value=delivery_model), patch(
        f"{_E}.get_adapter", side_effect=fake_get_adapter
    ):
        engine._resolve_expired_failures()

    assert _expiry_update_calls(delivery_model) == []


def test_resolve_expired_failures_defers_young_rows_for_grace_period():
    """The DB filter excludes rows younger than the grace period so the
    loss stays visible on the badge first — skip-ahead SKIPPED rows are
    born expired and would otherwise never surface there at all."""
    delivery_model = MagicMock()
    (
        delivery_model.objects.filter.return_value.exclude.return_value.select_related.return_value
    ) = []

    with patch(f"{_E}.apps.get_model", return_value=delivery_model):
        engine._resolve_expired_failures()

    filter_kwargs = delivery_model.objects.filter.call_args.kwargs
    assert filter_kwargs["resolved_at__isnull"] is True
    assert filter_kwargs["cursor_to__isnull"] is False
    grace = timezone.now() - filter_kwargs["created_at__lt"]
    tolerance = timedelta(seconds=5)
    assert abs(grace - engine.EXPIRED_RESOLVE_GRACE) < tolerance


def test_cleanup_skips_when_daily_marker_held():
    """The retention prune runs at most once a day, gated on a Redis
    marker — a held marker must mean no delete query at all."""
    conn = MagicMock()
    conn.set.return_value = False
    delivery_model = MagicMock()

    with patch(f"{_E}._redis", return_value=conn), patch(
        f"{_E}.apps.get_model", return_value=delivery_model
    ):
        engine._cleanup_delivery_events()

    delivery_model.objects.filter.assert_not_called()


def test_cleanup_prunes_aged_rows_outside_the_protected_set():
    """Retention shape: the cutoff honours DELIVERY_RETENTION_DAYS, and the
    exclusion protects unresolved failed/skipped rows that carry a source
    (the re-shippable out-of-sync records). Full predicate semantics need a
    real database — the suite is DB-less by convention, so the query
    structure is pinned here instead."""
    conn = MagicMock()
    conn.set.return_value = True
    delivery_model = MagicMock()

    with patch(f"{_E}._redis", return_value=conn), patch(
        f"{_E}.apps.get_model", return_value=delivery_model
    ):
        engine._cleanup_delivery_events()

    cutoff = delivery_model.objects.filter.call_args.kwargs["created_at__lt"]
    retention = timezone.now() - cutoff
    tolerance = timedelta(seconds=5)
    assert abs(retention - timedelta(days=engine.DELIVERY_RETENTION_DAYS)) < tolerance

    exclusion = str(delivery_model.objects.filter.return_value.exclude.call_args.args[0])
    assert "status__in" in exclusion
    assert "resolved_at__isnull" in exclusion
    # Stream-level rows (source='') are NOT re-shippable, so the exclusion
    # must negate them — otherwise retention would protect them forever.
    assert "source" in exclusion
    assert "NOT" in exclusion
    delivery_model.objects.filter.return_value.exclude.return_value.delete.assert_called_once()


def test_sweep_runs_expiry_resolution_and_cleanup():
    with patch(f"{_E}.apps.get_model", return_value=_sweep_setup([])), patch(
        f"{_E}._resolve_expired_failures"
    ) as mock_expire, patch(f"{_E}._cleanup_delivery_events") as mock_cleanup:
        engine.sweep_log_streams()

    mock_expire.assert_called_once()
    mock_cleanup.assert_called_once()
