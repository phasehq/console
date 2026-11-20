"""Jobs that run at an interval. The schedule lives only in Redis: rq-scheduler
queues each run and sets the time of the next one."""

import logging
from datetime import timedelta

import django_rq
from django.utils import timezone
from rq.exceptions import NoSuchJobError

logger = logging.getLogger(__name__)

SCHEDULER_QUEUE = "scheduled-jobs"

# While a deploy rolls, the old workers read the same queues, and they can't
# import a job this release adds: it fails on them. So a job scheduled for the
# first time waits until they have stopped.
FIRST_RUN_DELAY = timedelta(minutes=10)


def ensure_recurring_job(job_id, func, interval_seconds, queue_name=SCHEDULER_QUEUE):
    """Schedule `func` every `interval_seconds` on `queue_name`, unless it is
    scheduled that way already. Every worker calls this when it starts, so
    replacing the schedule each time would put off the next run with each
    restart. Returns True if the job was scheduled now."""
    scheduler = django_rq.get_scheduler(SCHEDULER_QUEUE)

    if _is_scheduled(scheduler, job_id, func, interval_seconds, queue_name):
        logger.info(
            "Recurring job %s is already scheduled every %ss",
            job_id,
            interval_seconds,
        )
        return False

    first_run = timezone.now() + FIRST_RUN_DELAY
    scheduler.schedule(
        scheduled_time=first_run,
        func=func,
        interval=interval_seconds,
        repeat=None,
        # Never expire the job hash; see init_log_stream_sweeper.
        result_ttl=-1,
        id=job_id,
        queue_name=queue_name,
    )
    logger.info(
        "Recurring job %s scheduled every %ss, first run at %s",
        job_id,
        interval_seconds,
        first_run.isoformat(timespec="seconds"),
    )
    return True


def _is_scheduled(scheduler, job_id, func, interval_seconds, queue_name):
    """Whether the schedule holds this job as it would be scheduled now. A job
    whose function, interval or queue changed in this release does not count:
    it is scheduled again."""
    if job_id not in scheduler:
        return False

    try:
        job = scheduler.job_class.fetch(job_id, connection=scheduler.connection)
    except NoSuchJobError:
        # The scheduler drops an entry whose job is gone.
        return False

    return (
        job.func_name == f"{func.__module__}.{func.__qualname__}"
        and job.meta.get("interval") == interval_seconds
        and job.origin == queue_name
    )
