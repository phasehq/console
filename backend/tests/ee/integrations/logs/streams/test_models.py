"""LogStream model lifecycle behaviour."""

from unittest.mock import MagicMock, patch

from api.models import LogStream


def test_stream_delete_resolves_open_delivery_rows():
    """A deleted stream's failed/skipped ranges can never be re-shipped, and
    both auto-resolve and retention skip deleted streams — delete must
    resolve them or they are exempt from retention forever (unbounded table
    growth across create/fail/delete cycles)."""
    stream = LogStream()
    events = MagicMock()

    # The reverse manager descriptor is replaced at class level, keeping the
    # test DB-less.
    with patch.object(LogStream, "delivery_events", events), patch.object(
        LogStream, "save"
    ), patch(
        "ee.integrations.logs.streams.engine.cancel_ship_job"
    ) as mock_cancel:
        stream.delete()

    filter_kwargs = events.filter.call_args.kwargs
    assert set(filter_kwargs["status__in"]) == {"failed", "skipped"}
    assert filter_kwargs["resolved_at__isnull"] is True
    assert events.filter.return_value.update.call_args.kwargs["resolved_at"] is not None

    assert stream.deleted_at is not None
    assert stream.is_active is False
    mock_cancel.assert_called_once_with(stream)
