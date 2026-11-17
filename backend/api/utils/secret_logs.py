"""Batched deletes on ``api_secretevent``, the largest table.

Shared by the ``purge_app_logs`` command and the organisation purge so both
stay gentle on the database: short transactions, oldest rows first, and a
pause between batches that gives autovacuum and replication headroom.
"""

import time

from django.apps import apps
from django.db import transaction

DEFAULT_BATCH_SIZE = 10_000
DEFAULT_SLEEP_MS = 500


def delete_secret_events(
    queryset,
    *,
    batch_size=DEFAULT_BATCH_SIZE,
    sleep_ms=DEFAULT_SLEEP_MS,
    deadline=None,
    on_batch=None,
):
    """Delete the events in ``queryset``, oldest first.

    Filter ``queryset`` to one environment so the scan walks the
    ``(environment_id, -timestamp)`` index. Stops before the next batch once
    ``deadline`` (a ``time.monotonic()`` value) has passed. Returns
    ``(deleted, finished)``; ``finished`` is True only when no rows remain.
    """
    SecretEvent = apps.get_model("api", "SecretEvent")
    oldest_first = queryset.order_by("timestamp")
    deleted = 0
    batch_number = 0
    while True:
        if deadline is not None and time.monotonic() >= deadline:
            return deleted, False

        with transaction.atomic():
            # SKIP LOCKED so a concurrent purge or any other locker is routed
            # around rather than blocking this batch.
            batch = list(
                oldest_first.select_for_update(skip_locked=True).values_list(
                    "id", flat=True
                )[:batch_size]
            )
            if not batch:
                # Rows skipped as locked still count as remaining.
                return deleted, not queryset.exists()

            # M2M FK is ON DELETE NO ACTION at the DB level and _raw_delete
            # bypasses the ORM cascade, so clear the through-table rows first.
            SecretEvent.tags.through.objects.filter(
                secretevent_id__in=batch
            )._raw_delete("default")
            count = SecretEvent.objects.filter(id__in=batch)._raw_delete("default")

        deleted += count
        batch_number += 1
        if on_batch:
            on_batch(batch_number, count, deleted)
        if sleep_ms:
            time.sleep(sleep_ms / 1000.0)
