"""Sessions are stored in the database. Django leaves expired session rows in
place, so a recurring job removes them."""

import logging
from datetime import timedelta

import django_rq
from django.core.management import call_command
from django.utils import timezone

logger = logging.getLogger(__name__)

PURGE_JOB_ID = "expired-session-purge"
PURGE_INTERVAL_SECONDS = 24 * 60 * 60


def init_expired_session_purge():
    scheduler = django_rq.get_scheduler("scheduled-jobs")

    try:
        scheduler.cancel(PURGE_JOB_ID)
    except Exception:
        logger.debug("No existing expired session purge to cancel", exc_info=True)

    scheduler.schedule(
        scheduled_time=timezone.now() + timedelta(seconds=60),
        func=purge_expired_sessions,
        interval=PURGE_INTERVAL_SECONDS,
        repeat=None,
        # Never expire the job hash; see init_log_stream_sweeper.
        result_ttl=-1,
        id=PURGE_JOB_ID,
        # Nothing waits on this, so it runs on the maintenance worker.
        queue_name="maintenance",
    )
    logger.info(
        "Expired session purge scheduled every %ss (job id %s)",
        PURGE_INTERVAL_SECONDS,
        PURGE_JOB_ID,
    )


def purge_expired_sessions():
    """Delete sessions that are past their expiry."""
    call_command("clearsessions")
