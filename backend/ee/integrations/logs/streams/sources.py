"""Event source registry for log streams.

Adding a new streamable event source is a two-step change:

1. Implement a ``LogSource`` subclass below (fetch/fetch_range/count_before/
   oldest_pending_timestamp/serialize over your event model).
2. Register an instance in ``SOURCES``.

Everything else — the UI checkbox, per-stream cursors, lag reporting and
delivery history — follows automatically from the registry entry.

Cursors are ``{"ts": "<iso8601>", "id": "<pk>"}`` pairs. Events are totally
ordered by ``(timestamp, id)``; the id tiebreak makes pagination stable when
multiple events share a timestamp (ids are uuid strings, so intra-timestamp
order is arbitrary but consistent).
"""

from datetime import timedelta

from django.apps import apps
from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from .serializers import audit_event_to_envelope, secret_event_to_envelope

# Events are timestamped inside the writing transaction, so a slow
# transaction can COMMIT an older-timestamped event after a newer one was
# already fetched and shipped — the late event would land permanently behind
# the cursor and never ship. Only events older than this watermark are
# eligible, giving in-flight transactions time to commit first. Well under
# the 30s sweep interval's user-facing latency promise ("about a minute").
SHIP_WATERMARK_SECONDS = 30


class LogSource:
    id = None
    name = None
    description = None

    def _queryset(self, organisation):
        raise NotImplementedError

    def serialize(self, event, organisation):
        raise NotImplementedError

    def _cursor_filter(self, cursor):
        ts = parse_datetime(cursor["ts"]) if isinstance(cursor["ts"], str) else cursor["ts"]
        last_id = cursor.get("id") or ""
        # Redundant but load-bearing: Postgres derives no lower scan bound
        # across the OR arms.
        return (Q(timestamp__gt=ts) | (Q(timestamp=ts) & Q(id__gt=last_id))) & Q(
            timestamp__gte=ts
        )

    def fetch(self, organisation, cursor, limit):
        """Events strictly after `cursor` but older than the commit-safety
        watermark, oldest first."""
        watermark = timezone.now() - timedelta(seconds=SHIP_WATERMARK_SECONDS)
        return list(
            self._queryset(organisation)
            .filter(self._cursor_filter(cursor), timestamp__lt=watermark)
            .order_by("timestamp", "id")[:limit]
        )

    def fetch_range(self, organisation, ts_from, ts_to, limit=None):
        """Events in the inclusive [ts_from, ts_to] window, oldest first.

        Used by manual delivery retries. The window is the failed chunk's
        recorded timestamp range, so boundary events that also landed in a
        neighbouring chunk may be re-shipped — acceptable under the
        at-least-once delivery contract. `limit` bounds materialization so a
        pathologically large range can't exhaust a worker; the caller detects
        the cap and fails the retry honestly instead of shipping a subset.
        """
        queryset = (
            self._queryset(organisation)
            .filter(timestamp__gte=ts_from, timestamp__lte=ts_to)
            .order_by("timestamp", "id")
        )
        if limit is not None:
            queryset = queryset[:limit]
        return list(queryset)

    def count_before(self, organisation, cursor, ts_floor):
        """Events after `cursor` but older than `ts_floor` (skip-ahead count)."""
        return (
            self._queryset(organisation)
            .filter(self._cursor_filter(cursor), timestamp__lt=ts_floor)
            .count()
        )

    def oldest_pending_timestamp(self, organisation, cursor):
        """Timestamp of the oldest event still waiting to ship, or None.

        Drives the delivery-delay metric: its age is how late deliveries
        actually are, unlike cursor distance, which spikes misleadingly when
        a new event arrives after an idle gap.
        """
        return (
            self._queryset(organisation)
            .filter(self._cursor_filter(cursor))
            .order_by("timestamp", "id")
            .values_list("timestamp", flat=True)
            .first()
        )

    def cursor_of(self, event):
        return {"ts": event.timestamp.isoformat(), "id": str(event.id)}


class OrgAuditLogSource(LogSource):
    id = "org_audit"
    name = "Organisation audit logs"
    description = "Organisation-level activity: members, roles, apps, tokens and teams."

    def _queryset(self, organisation):
        AuditEvent = apps.get_model("api", "AuditEvent")
        return AuditEvent.objects.filter(organisation=organisation)

    def serialize(self, event, organisation):
        return audit_event_to_envelope(event, organisation)


class SecretEventLogSource(LogSource):
    id = "secrets"
    name = "App secret logs"
    description = "Create, read, update and delete events for secrets across all apps."

    def _queryset(self, organisation):
        SecretEvent = apps.get_model("api", "SecretEvent")
        return SecretEvent.objects.filter(
            environment__app__organisation=organisation
        ).select_related(
            "secret",
            "environment",
            "environment__app",
            "user",
            "user__user",
            "service_token",
            "service_account",
            "service_account_token",
        )

    def serialize(self, event, organisation):
        return secret_event_to_envelope(event, organisation)


SOURCES = {
    source.id: source
    for source in (
        OrgAuditLogSource(),
        SecretEventLogSource(),
    )
}


def get_source(source_id):
    source = SOURCES.get(source_id)
    if source is None:
        raise ValueError(f"Unknown log stream source '{source_id}'")
    return source


def all_sources():
    return list(SOURCES.values())
