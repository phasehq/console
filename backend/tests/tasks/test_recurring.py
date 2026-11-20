"""A recurring job is scheduled once, late enough for a rolling deploy to
finish, and then left alone."""

from datetime import timedelta
from unittest.mock import MagicMock, patch

import pytest
from django.utils import timezone
from rq.exceptions import NoSuchJobError
from rq.job import Job

from api.tasks import recurring
from api.tasks.resource_deletion import sweep_resource_deletions as sweep

JOB_ID = "some-sweep"
INTERVAL = 60 * 60
# The name rq itself stores for the function.
SWEEP_NAME = Job.create(sweep, connection=MagicMock()).func_name


def _stored(func_name=SWEEP_NAME, interval=INTERVAL, origin="scheduled-jobs"):
    """The job as the schedule holds it."""
    return MagicMock(func_name=func_name, meta={"interval": interval}, origin=origin)


def _ensure(scheduled, stored=None, **kwargs):
    scheduler = MagicMock()
    scheduler.__contains__.return_value = scheduled
    if stored is None:
        scheduler.job_class.fetch.side_effect = NoSuchJobError
    else:
        scheduler.job_class.fetch.return_value = stored

    with patch.object(
        recurring.django_rq, "get_scheduler", return_value=scheduler
    ) as get_scheduler:
        result = recurring.ensure_recurring_job(JOB_ID, sweep, INTERVAL, **kwargs)

    get_scheduler.assert_called_once_with("scheduled-jobs")
    return scheduler, result


def test_a_new_job_first_runs_after_a_rolling_deploy_has_finished():
    before = timezone.now()

    scheduler, scheduled_now = _ensure(scheduled=False)

    assert scheduled_now is True
    scheduler.schedule.assert_called_once()
    schedule = scheduler.schedule.call_args.kwargs
    # Until the old workers stop they take jobs too, and they can't import a
    # job that this release adds.
    first_run = schedule.pop("scheduled_time")
    assert first_run - before >= timedelta(minutes=10)
    assert first_run - timezone.now() <= timedelta(minutes=10)
    assert schedule == {
        "func": sweep,
        "interval": INTERVAL,
        "repeat": None,
        # The schedule is kept on the job hash, so it must never expire.
        "result_ttl": -1,
        "id": JOB_ID,
        "queue_name": "scheduled-jobs",
    }


def test_a_job_that_is_already_scheduled_is_left_alone():
    # Every worker start gets here. Scheduling again would put off the next
    # run each time: workers that restart often enough would never run it.
    scheduler, scheduled_now = _ensure(scheduled=True, stored=_stored())

    assert scheduled_now is False
    scheduler.schedule.assert_not_called()
    scheduler.cancel.assert_not_called()
    scheduler.job_class.fetch.assert_called_once_with(
        JOB_ID, connection=scheduler.connection
    )


@pytest.mark.parametrize(
    "stored",
    [
        # The same function, moved to another module.
        _stored(func_name="api.tasks.elsewhere.sweep_resource_deletions"),
        _stored(interval=INTERVAL * 2),
        _stored(origin="maintenance"),
        # Without an interval the scheduler would run it once and drop it.
        MagicMock(func_name=SWEEP_NAME, meta={}, origin="scheduled-jobs"),
        # The entry is there but the job hash is gone.
        None,
    ],
    ids=["function", "interval", "queue", "no interval", "no job"],
)
def test_a_schedule_that_differs_is_replaced(stored):
    scheduler, scheduled_now = _ensure(scheduled=True, stored=stored)

    assert scheduled_now is True
    scheduler.schedule.assert_called_once()
    assert scheduler.schedule.call_args.kwargs["id"] == JOB_ID


def test_a_job_can_run_on_another_queue_than_the_schedulers():
    scheduler, _ = _ensure(scheduled=False, queue_name="maintenance")

    assert scheduler.schedule.call_args.kwargs["queue_name"] == "maintenance"

    scheduler, scheduled_now = _ensure(
        scheduled=True, stored=_stored(origin="maintenance"), queue_name="maintenance"
    )

    assert scheduled_now is False
    scheduler.schedule.assert_not_called()


def test_a_job_that_is_no_longer_in_the_schedule_is_scheduled_again():
    # Its hash can outlive its entry: cancelling removes only the entry.
    scheduler, scheduled_now = _ensure(scheduled=False, stored=_stored())

    assert scheduled_now is True
    scheduler.schedule.assert_called_once()
