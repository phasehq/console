"""Tests for the throttled secret event delete shared by purge_app_logs and the
organisation purge."""

from unittest.mock import MagicMock, patch

from api.utils import secret_logs

_M = "api.utils.secret_logs"


def _queryset(batches, remaining=False):
    queryset = MagicMock()
    ids = (
        queryset.order_by.return_value.select_for_update.return_value.values_list.return_value
    )
    ids.__getitem__.side_effect = batches
    queryset.exists.return_value = remaining
    return queryset


def _run(queryset, **options):
    secret_event = MagicMock()
    secret_event.objects.filter.return_value._raw_delete.side_effect = lambda _: len(
        secret_event.objects.filter.call_args.kwargs["id__in"]
    )
    with patch(f"{_M}.apps.get_model", return_value=secret_event), patch(
        f"{_M}.transaction"
    ), patch(f"{_M}.time.sleep") as sleep:
        result = secret_logs.delete_secret_events(queryset, **options)
    return result, secret_event, sleep


def test_deletes_oldest_first_in_batches_with_a_pause():
    queryset = _queryset([["e1", "e2"], ["e3"], []])

    result, secret_event, sleep = _run(queryset, batch_size=2, sleep_ms=250)

    assert result == (3, True)
    queryset.order_by.assert_called_once_with("timestamp")
    ids = queryset.order_by.return_value.select_for_update
    ids.assert_called_with(skip_locked=True)
    ids.return_value.values_list.return_value.__getitem__.assert_any_call(
        slice(None, 2)
    )
    assert sleep.call_count == 2
    sleep.assert_called_with(0.25)


def test_clears_tag_links_before_each_batch():
    queryset = _queryset([["e1", "e2"], []])
    calls = []

    secret_event = MagicMock()
    through = secret_event.tags.through.objects.filter.return_value
    through._raw_delete.side_effect = lambda _: calls.append("tags")
    events = secret_event.objects.filter.return_value
    events._raw_delete.side_effect = lambda _: calls.append("events") or 2
    with patch(f"{_M}.apps.get_model", return_value=secret_event), patch(
        f"{_M}.transaction"
    ), patch(f"{_M}.time.sleep"):
        secret_logs.delete_secret_events(queryset, sleep_ms=0)

    assert calls == ["tags", "events"]
    secret_event.tags.through.objects.filter.assert_called_once_with(
        secretevent_id__in=["e1", "e2"]
    )


def test_stops_at_the_deadline():
    queryset = _queryset([["e1"], ["e2"], []])

    with patch(f"{_M}.time.monotonic", side_effect=[0, 5, 11]):
        result, _, _ = _run(queryset, deadline=10)

    assert result == (2, False)


def test_rows_skipped_as_locked_count_as_remaining():
    queryset = _queryset([[]], remaining=True)

    result, secret_event, _ = _run(queryset)

    assert result == (0, False)
    secret_event.objects.filter.assert_not_called()


def test_reports_each_batch():
    queryset = _queryset([["e1", "e2"], ["e3"], []])
    on_batch = MagicMock()

    _run(queryset, sleep_ms=0, on_batch=on_batch)

    assert [c.args for c in on_batch.call_args_list] == [(1, 2, 2), (2, 1, 3)]
