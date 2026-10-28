"""Chunking of serialized envelopes into destination-sized batches."""

from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from ee.integrations.logs.streams import chunker
from ee.integrations.logs.streams.chunker import chunk_envelopes


def _entries(n, start=None):
    start = start or datetime(2026, 1, 1, tzinfo=timezone.utc)
    return [
        {
            "envelope": {"event": {"id": f"e{i}"}, "phase": {}},
            "cursor": {"ts": (start + timedelta(seconds=i)).isoformat(), "id": f"e{i}"},
            "timestamp": start + timedelta(seconds=i),
        }
        for i in range(n)
    ]


def test_splits_on_event_count():
    with patch.object(chunker, "CHUNK_MAX_EVENTS", 2):
        chunks = chunk_envelopes(_entries(5))

    assert [len(c.events) for c in chunks] == [2, 2, 1]
    # Each chunk's cursor markers cover exactly its own events.
    assert chunks[0].last_cursor["id"] == "e1"
    assert chunks[1].last_cursor["id"] == "e3"
    assert chunks[2].last_cursor["id"] == "e4"
    assert chunks[0].cursor_from < chunks[0].cursor_to
    assert chunks[2].cursor_from == chunks[2].cursor_to


def test_splits_on_byte_size():
    entries = _entries(3)
    for entry in entries:
        entry["envelope"]["phase"]["description"] = "x" * 100

    # Each envelope is >100 bytes, so a 150-byte cap forces one per chunk.
    with patch.object(chunker, "CHUNK_MAX_BYTES", 150):
        chunks = chunk_envelopes(entries)

    assert [len(c.events) for c in chunks] == [1, 1, 1]
    assert all(c.byte_size > 0 for c in chunks)


def test_oversized_event_gets_json_metadata_truncated():
    entries = _entries(1)
    entries[0]["envelope"]["phase"]["old_values"] = {"blob": "y" * 500}
    entries[0]["envelope"]["phase"]["new_values"] = {"blob": "z" * 500}

    with patch.object(chunker, "EVENT_MAX_BYTES", 200):
        chunks = chunk_envelopes(entries)

    envelope = chunks[0].events[0]
    assert envelope["phase"]["old_values"] == {"truncated": True}
    assert envelope["phase"]["new_values"] == {"truncated": True}


def test_empty_input_returns_no_chunks():
    assert chunk_envelopes([]) == []


def test_chunks_record_id_bounds():
    """(timestamp, id) is the event order — auto-resolve containment needs
    the id bounds to tell apart chunks that split inside one timestamp."""
    chunks = chunk_envelopes(_entries(3))

    assert chunks[0].cursor_from_id == "e0"
    assert chunks[0].cursor_to_id == "e2"


def test_pathological_envelope_is_clamped_below_event_limit():
    """After metadata truncation fails to shrink an envelope, it must be
    stripped to an identifying core — EVENT_MAX_BYTES' headroom under the
    destination's wire limit only holds for genuinely bounded envelopes, and
    an oversize event would otherwise permanently 413 its chunk."""
    huge = "x" * (chunker.EVENT_MAX_BYTES + 100)
    entry = {
        "envelope": {
            "schema_version": 1,
            "event": {"id": "e0", "category": "org_audit", "type": "update"},
            "timestamp": "2026-01-01T00:00:00+00:00",
            "actor": {"type": "user", "id": "a1", "name": "A"},
            "user_agent": {"original": huge},
            "phase": {
                "organisation": {"id": "o1", "name": "acme"},
                "description": "Updated something",
            },
        },
        "cursor": {"ts": "2026-01-01T00:00:00+00:00", "id": "e0"},
        "timestamp": datetime(2026, 1, 1, tzinfo=timezone.utc),
    }

    chunks = chunk_envelopes([entry])

    event = chunks[0].events[0]
    assert chunks[0].byte_size <= chunker.EVENT_MAX_BYTES
    assert event["phase"]["truncated"] is True
    # The identifying core survives.
    assert event["event"]["id"] == "e0"
    assert event["phase"]["organisation"]["name"] == "acme"
