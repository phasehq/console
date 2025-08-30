from datetime import timedelta
from ee.integrations.secrets.dynamic.aws.utils import (
    revoke_aws_dynamic_secret_lease,
)
from graphql import GraphQLError
from django.utils import timezone
import django_rq
from rq.job import Job
import logging

logger = logging.getLogger(__name__)


def renew_dynamic_secret_lease(lease, ttl):
    if timedelta(seconds=ttl) > lease.secret.max_ttl:
        raise GraphQLError(
            "The specified TTL exceeds the maximum TTL for this dynamic secret."
        )

    if lease.expires_at <= timezone.now():
        raise GraphQLError("This lease has expired and cannot be renewed")

    else:
        lease.expires_at = timezone.now() + timedelta(seconds=ttl)
        lease.updated_at = timezone.now()

    # --- reschedule cleanup job ---
    scheduler = django_rq.get_scheduler("scheduled-jobs")

    # cancel the old job if it exists
    if lease.cleanup_job_id:
        try:
            old_job = Job.fetch(lease.cleanup_job_id, connection=scheduler.connection)
            old_job.cancel()
        except Exception as e:
            logger.info(f"Failed to delete job: {e}")
            pass

    # enqueue a new revocation job
    job = scheduler.enqueue_at(
        lease.expires_at,
        revoke_aws_dynamic_secret_lease,
        lease.id,
    )
    lease.cleanup_job_id = job.id
    lease.save()

    return lease
