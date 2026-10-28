"""Split serialized envelopes into destination-sized chunks.

Limits stay comfortably under Datadog's intake caps (1000 events / 5 MB per
payload, 1 MB per event) so that adapter-added reserved fields never push a
chunk over the wire limit.
"""

import json
from dataclasses import dataclass, field

CHUNK_MAX_EVENTS = 500
CHUNK_MAX_BYTES = 2_500_000
EVENT_MAX_BYTES = 900_000


@dataclass
class Chunk:
    events: list = field(default_factory=list)
    byte_size: int = 0
    cursor_from: object = None
    cursor_to: object = None
    # Id bounds of the covered range — (timestamp, id) is the event order,
    # so timestamp containment alone can't distinguish two chunks that split
    # inside a single timestamp.
    cursor_from_id: str = ""
    cursor_to_id: str = ""
    last_cursor: dict = None


def _envelope_size(envelope):
    return len(json.dumps(envelope, default=str).encode("utf-8"))


def _bound_envelope(envelope):
    """Cap a single envelope's size; oversize payloads live in the JSON
    metadata fields, so truncate those rather than dropping the event."""
    size = _envelope_size(envelope)
    if size <= EVENT_MAX_BYTES:
        return envelope, size

    phase = envelope.get("phase", {})
    for key in ("old_values", "new_values"):
        if phase.get(key) is not None:
            phase[key] = {"truncated": True}
    size = _envelope_size(envelope)
    if size <= EVENT_MAX_BYTES:
        return envelope, size

    if "metadata" in phase.get("resource", {}):
        phase["resource"]["metadata"] = {"truncated": True}
    size = _envelope_size(envelope)
    if size <= EVENT_MAX_BYTES:
        return envelope, size

    # Last resort: strip to the identifying core. EVENT_MAX_BYTES leaves
    # 100KB of headroom under Datadog's 1MB wire limit for adapter-added
    # fields (message/ddtags/remaps), but that guarantee only holds if the
    # envelope itself is genuinely bounded — a pathological event must not
    # be allowed to permanently 413 its chunk.
    slim = {
        "schema_version": envelope.get("schema_version"),
        "event": envelope.get("event"),
        "timestamp": envelope.get("timestamp"),
        "actor": envelope.get("actor"),
        "phase": {
            "organisation": phase.get("organisation"),
            "description": str(phase.get("description", ""))[:2000],
            "truncated": True,
        },
    }
    envelope.clear()
    envelope.update(slim)
    return envelope, _envelope_size(envelope)


def chunk_envelopes(entries):
    """Group entries into ordered chunks.

    `entries` is a list of dicts: {"envelope": dict, "cursor": dict,
    "timestamp": datetime} — one per event, already in (timestamp, id) order.
    Each chunk records the timestamp range it covers and the cursor of its
    last event, which becomes the stream cursor once the chunk is delivered.
    """
    chunks = []
    current = None

    for entry in entries:
        envelope, size = _bound_envelope(entry["envelope"])

        if current is not None and (
            len(current.events) >= CHUNK_MAX_EVENTS
            or current.byte_size + size > CHUNK_MAX_BYTES
        ):
            chunks.append(current)
            current = None

        if current is None:
            current = Chunk()
            current.cursor_from = entry["timestamp"]
            current.cursor_from_id = entry["cursor"].get("id", "")

        current.events.append(envelope)
        current.byte_size += size
        current.cursor_to = entry["timestamp"]
        current.cursor_to_id = entry["cursor"].get("id", "")
        current.last_cursor = entry["cursor"]

    if current is not None and current.events:
        chunks.append(current)

    return chunks
