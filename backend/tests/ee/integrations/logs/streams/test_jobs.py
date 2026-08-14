"""Sweeper bootstrap: stable job id, cancel-before-schedule."""

from unittest.mock import MagicMock, patch

from ee.integrations.logs.streams.jobs import SWEEP_JOB_ID, init_log_stream_sweeper

_M = "ee.integrations.logs.streams.jobs"


def test_sweeper_registers_with_stable_id_and_cancels_prior():
    scheduler = MagicMock()

    with patch(f"{_M}.django_rq.get_scheduler", return_value=scheduler):
        init_log_stream_sweeper()

    # Cancel any prior registration first — repeated migrates must replace the
    # schedule, not accumulate duplicates (the licensing job's known wart).
    scheduler.cancel.assert_called_once_with(SWEEP_JOB_ID)

    _, kwargs = scheduler.schedule.call_args
    assert kwargs["id"] == SWEEP_JOB_ID
    assert kwargs["interval"] == 30
    assert kwargs["repeat"] is None
    # -1 = job hash never expires. Interval jobs keep their schedule metadata
    # on the hash; a finite TTL lets a host freeze expire it, after which
    # rq-scheduler silently drops the schedule (the 11h-stall incident).
    assert kwargs["result_ttl"] == -1


def test_sweeper_survives_cancel_failure():
    scheduler = MagicMock()
    scheduler.cancel.side_effect = Exception("nothing to cancel")

    with patch(f"{_M}.django_rq.get_scheduler", return_value=scheduler):
        init_log_stream_sweeper()

    assert scheduler.schedule.called
