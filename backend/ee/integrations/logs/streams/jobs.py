"""Bootstrap for the recurring log stream sweep.

Registered from a post_migrate hook (api/config.py) on cloud and self-hosted
alike. The job carries a stable id and is cancelled before re-registration,
so repeated migrations replace the schedule instead of accumulating
duplicates.
"""

import logging
from datetime import timedelta

import django_rq
from django.utils import timezone

from .engine import SWEEP_INTERVAL_SECONDS, sweep_log_streams

logger = logging.getLogger(__name__)

# NOTE: rq 2.x forbids ":" in job ids.
SWEEP_JOB_ID = "log-streams-sweep"


def init_log_stream_sweeper():
    scheduler = django_rq.get_scheduler("scheduled-jobs")

    try:
        scheduler.cancel(SWEEP_JOB_ID)
    except Exception:
        logger.debug("No existing log stream sweep to cancel", exc_info=True)

    scheduler.schedule(
        scheduled_time=timezone.now() + timedelta(seconds=15),
        func=sweep_log_streams,
        interval=SWEEP_INTERVAL_SECONDS,
        repeat=None,
        # -1 = never expire the job hash. rq-scheduler interval jobs keep
        # their schedule metadata ON the job hash; with a short result_ttl,
        # any freeze longer than the TTL (host sleep, paused VM, Redis
        # failover) expires the hash and the scheduler then permanently
        # drops the schedule on its next pass (NoSuchJobError -> cancel).
        # The stable id + cancel-before-schedule above keeps this single
        # persistent hash from ever accumulating.
        result_ttl=-1,
        id=SWEEP_JOB_ID,
    )
    logger.info(
        "Log stream sweeper scheduled every %ss (job id %s)",
        SWEEP_INTERVAL_SECONDS,
        SWEEP_JOB_ID,
    )
