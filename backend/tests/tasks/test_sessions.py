"""Expired session rows are removed by a recurring job."""

from importlib import import_module
from unittest.mock import MagicMock, patch

from django.conf import settings

from api.tasks import sessions as jobs


def test_registration_replaces_the_schedule():
    """Registration runs on every migrate and worker start, so it must
    replace the schedule, never add a second one."""
    scheduler = MagicMock()
    with patch.object(
        jobs.django_rq, "get_scheduler", return_value=scheduler
    ) as get_scheduler:
        jobs.init_expired_session_purge()

    get_scheduler.assert_called_once_with("scheduled-jobs")
    assert [name for name, _, _ in scheduler.mock_calls] == ["cancel", "schedule"]
    scheduler.cancel.assert_called_once_with(jobs.PURGE_JOB_ID)
    kwargs = scheduler.schedule.call_args.kwargs
    assert kwargs["id"] == jobs.PURGE_JOB_ID
    assert kwargs["func"] == jobs.purge_expired_sessions
    assert kwargs["interval"] == jobs.PURGE_INTERVAL_SECONDS
    assert kwargs["repeat"] is None
    assert kwargs["result_ttl"] == -1
    assert kwargs["queue_name"] == "maintenance"


def test_registration_survives_a_failed_cancel():
    scheduler = MagicMock()
    scheduler.cancel.side_effect = RuntimeError("no such job")
    with patch.object(jobs.django_rq, "get_scheduler", return_value=scheduler):
        jobs.init_expired_session_purge()

    scheduler.schedule.assert_called_once()


def test_purge_clears_expired_sessions_of_the_configured_engine():
    engine = import_module(settings.SESSION_ENGINE)

    with patch.object(engine.SessionStore, "clear_expired") as clear_expired:
        jobs.purge_expired_sessions()

    clear_expired.assert_called_once_with()
