from django.utils import timezone
from api.services import ServiceConfig
from .utils.syncing.cloudflare.pages import (
    get_authentication_credentials,
    sync_cloudflare_secrets,
)
from django.apps import apps
from .utils.syncing.secrets import get_environment_secrets
from django_rq import job
from rq.timeouts import JobTimeoutException
import time


def trigger_sync_tasks(env_sync):
    EnvironmentSync = apps.get_model("api", "EnvironmentSync")

    if env_sync.service == ServiceConfig.CLOUDFLARE_PAGES["id"]:
        env_sync.status = EnvironmentSync.IN_PROGRESS
        env_sync.save()
        sync_cloudflare_pages.delay(env_sync)


@job("default", timeout=3600)
def sync_cloudflare_pages(environment_sync):
    try:
        EnvironmentSync = apps.get_model("api", "EnvironmentSync")
        EnvironmentSyncEvent = apps.get_model("api", "EnvironmentSyncEvent")

        sync_event = EnvironmentSyncEvent.objects.create(env_sync=environment_sync)

        time.sleep(15)

        kv_pairs = get_environment_secrets(environment_sync)

        account_id, access_token = get_authentication_credentials(environment_sync)

        project_info = environment_sync.options

        success, sync_data = sync_cloudflare_secrets(
            kv_pairs,
            account_id,
            access_token,
            project_info["project_name"],
            project_info["environment"],
        )

        if success:
            sync_event.status = EnvironmentSync.COMPLETED
            sync_event.completed_at = timezone.now()
            sync_event.meta = sync_data
            sync_event.save()

            environment_sync.last_sync = timezone.now()
            environment_sync.status = EnvironmentSync.COMPLETED
            environment_sync.save()

        else:
            sync_event.status = EnvironmentSync.FAILED
            sync_event.completed_at = timezone.now()
            sync_event.meta = sync_data
            sync_event.save()

            environment_sync.last_sync = timezone.now()
            environment_sync.status = EnvironmentSync.FAILED
            environment_sync.save()

    except JobTimeoutException:
        # Handle timeout exception
        sync_event.status = EnvironmentSync.TIMED_OUT
        sync_event.completed_at = timezone.now()
        sync_event.save()

        environment_sync.last_sync = timezone.now()
        environment_sync.status = EnvironmentSync.TIMED_OUT
        environment_sync.save()
        raise  # Re-raise the JobTimeoutException
