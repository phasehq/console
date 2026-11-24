"""Sessions are stored in the database. Django leaves expired session rows in
place, so a recurring job removes them."""

from django.core.management import call_command

from api.tasks.recurring import ensure_recurring_job

PURGE_JOB_ID = "expired-session-purge"
PURGE_INTERVAL_SECONDS = 24 * 60 * 60


def init_expired_session_purge():
    ensure_recurring_job(
        PURGE_JOB_ID,
        purge_expired_sessions,
        PURGE_INTERVAL_SECONDS,
        # Nothing waits on this, so it runs on the maintenance worker.
        queue_name="maintenance",
    )


def purge_expired_sessions():
    """Delete sessions that are past their expiry."""
    call_command("clearsessions")
