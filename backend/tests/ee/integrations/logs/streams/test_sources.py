"""Source fetch semantics: the commit-safety watermark.

Events are timestamped inside the writing transaction — a slow transaction
can commit an older-timestamped event after a newer one was fetched and
shipped, landing it permanently behind the cursor. `fetch` therefore only
returns events older than SHIP_WATERMARK_SECONDS.
"""

from unittest.mock import MagicMock, patch

from django.utils import timezone

from ee.integrations.logs.streams import sources as sources_mod


def test_fetch_applies_commit_watermark():
    source = sources_mod.OrgAuditLogSource()
    qs = MagicMock()
    qs.filter.return_value.order_by.return_value.__getitem__.return_value = []

    with patch.object(sources_mod.OrgAuditLogSource, "_queryset", return_value=qs):
        result = source.fetch(
            MagicMock(), {"ts": timezone.now().isoformat(), "id": ""}, 10
        )

    assert result == []
    watermark = qs.filter.call_args.kwargs["timestamp__lt"]
    age = (timezone.now() - watermark).total_seconds()
    assert (
        sources_mod.SHIP_WATERMARK_SECONDS - 5
        <= age
        <= sources_mod.SHIP_WATERMARK_SECONDS + 5
    )


def test_cursor_filter_carries_redundant_sargable_lower_bound():
    """The timestamp__gte bound is semantically redundant with the OR arms
    but load-bearing: Postgres derives no lower scan bound across an OR, so
    dropping it reverts the tail query to an O(org-history) ordered scan.
    Behaviorally invisible by design — pinned structurally instead."""
    q = sources_mod.LogSource()._cursor_filter(
        {"ts": "2026-07-30T12:00:00+00:00", "id": "e-5"}
    )
    assert "timestamp__gte" in str(q)
