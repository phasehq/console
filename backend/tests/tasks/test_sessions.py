"""Expired session rows are removed by a recurring job."""

from importlib import import_module
from unittest.mock import MagicMock, patch

from django.conf import settings

from api.tasks import recurring
from api.tasks import sessions as jobs


def test_the_purge_is_scheduled_daily_on_the_maintenance_queue():
    scheduler = MagicMock()
    scheduler.__contains__.return_value = False
    with patch.object(recurring.django_rq, "get_scheduler", return_value=scheduler):
        jobs.init_expired_session_purge()

    kwargs = scheduler.schedule.call_args.kwargs
    assert kwargs["id"] == jobs.PURGE_JOB_ID
    assert kwargs["func"] == jobs.purge_expired_sessions
    assert kwargs["interval"] == jobs.PURGE_INTERVAL_SECONDS == 24 * 60 * 60
    # Nothing waits on it, so it does not hold up the jobs with deadlines.
    assert kwargs["queue_name"] == "maintenance"


def test_a_purge_that_is_already_scheduled_keeps_its_time():
    # Each worker start registers it: its next run must not move every time.
    scheduler = MagicMock()
    scheduler.__contains__.return_value = True
    # As the releases before this one stored it.
    scheduler.job_class.fetch.return_value = MagicMock(
        func_name="api.tasks.sessions.purge_expired_sessions",
        meta={"interval": 24 * 60 * 60},
        origin="maintenance",
    )
    with patch.object(recurring.django_rq, "get_scheduler", return_value=scheduler):
        jobs.init_expired_session_purge()

    scheduler.schedule.assert_not_called()
    scheduler.cancel.assert_not_called()


def test_purge_clears_expired_sessions_of_the_configured_engine():
    engine = import_module(settings.SESSION_ENGINE)

    with patch.object(engine.SessionStore, "clear_expired") as clear_expired:
        jobs.purge_expired_sessions()

    clear_expired.assert_called_once_with()
