from .utils import check_existing_licenses
import django_rq
from datetime import timedelta
from django.utils import timezone


def init_license_checker():
    interval = 60 * 60 * 24  # 24 hours
    scheduler = django_rq.get_scheduler("scheduled-jobs")

    scheduler.schedule(
        scheduled_time=timezone.now()
        + timedelta(seconds=15),  # Time for first execution
        func=check_existing_licenses,
        interval=interval,  # Run every 60 seconds
        repeat=None,  # None means repeat indefinitely
        result_ttl=interval
        + 60,  # TTL needs to be greater than the interval to make sure the next run is queued, so we add 60 seconds to the interval
    )
