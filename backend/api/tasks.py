from django.utils import timezone
from api.services import ServiceConfig
from api.utils.syncing.aws.auth import get_aws_secrets_manager_credentials
from api.utils.syncing.aws.secrets_manager import sync_aws_secrets
from .utils.syncing.cloudflare.pages import (
    get_cf_pages_credentials,
    sync_cloudflare_secrets,
)
from django.apps import apps
from .utils.syncing.secrets import get_environment_secrets
from django_rq import job
from rq.timeouts import JobTimeoutException
from rq.job import Job
from django_rq import get_queue
import django_rq
from rq.exceptions import NoSuchJobError


def trigger_sync_tasks(env_sync):
    EnvironmentSync = apps.get_model("api", "EnvironmentSync")
    EnvironmentSyncEvent = apps.get_model("api", "EnvironmentSyncEvent")

    cancel_sync_tasks(env_sync)  # cancel any running or queued jobs for this sync

    if env_sync.service == ServiceConfig.CLOUDFLARE_PAGES["id"]:
        env_sync.status = EnvironmentSync.IN_PROGRESS
        env_sync.save()

        job = sync_cloudflare_pages.delay(env_sync)
        job_id = job.get_id()

        EnvironmentSyncEvent.objects.create(id=job_id, env_sync=env_sync)


# try and cancel running or queued jobs for this sync
def cancel_sync_tasks(env_sync):
    queue = django_rq.get_queue("default")

    EnvironmentSync = apps.get_model("api", "EnvironmentSync")
    EnvironmentSyncEvent = apps.get_model("api", "EnvironmentSyncEvent")

    for sync_event in EnvironmentSyncEvent.objects.filter(
        env_sync=env_sync, status=EnvironmentSync.IN_PROGRESS
    ):
        try:
            job = Job.fetch(sync_event.id, connection=get_queue("default").connection)
            if job.is_queued or job.is_started:
                # send_stop_job_command(redis, sync_event.id)  # Stop the running job
                queue.remove(sync_event.id)
                sync_event.status = EnvironmentSync.CANCELLED
                sync_event.save()

        except NoSuchJobError:
            pass
        except Exception:
            pass


@job("default", timeout=3600)
def sync_cloudflare_pages(environment_sync):
    try:
        EnvironmentSync = apps.get_model("api", "EnvironmentSync")
        EnvironmentSyncEvent = apps.get_model("api", "EnvironmentSyncEvent")

        sync_event = (
            EnvironmentSyncEvent.objects.filter(env_sync=environment_sync)
            .order_by("-created_at")
            .first()
        )

        kv_pairs = get_environment_secrets(environment_sync)

        if environment_sync.authentication is None:
            sync_data = (
                False,
                {"message": "No authentication credentials for this sync"},
            )
            raise Exception("No authentication credentials for this sync")

        account_id, access_token = get_cf_pages_credentials(environment_sync)

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

    except Exception:
        sync_event.status = EnvironmentSync.FAILED
        sync_event.completed_at = timezone.now()

        try:
            sync_event.meta = sync_data
        except:
            pass
        sync_event.save()

        environment_sync.last_sync = timezone.now()
        environment_sync.status = EnvironmentSync.FAILED
        environment_sync.save()


# @job("default", timeout=3600)
# def sync_aws_secrets_manager(environment_sync):
#     try:
#         EnvironmentSync = apps.get_model("api", "EnvironmentSync")
#         EnvironmentSyncEvent = apps.get_model("api", "EnvironmentSyncEvent")

#         sync_event = EnvironmentSyncEvent.objects.create(env_sync=environment_sync)

#         kv_pairs = get_environment_secrets(environment_sync)

#         access_key_id, secret_access_key = get_aws_secrets_manager_credentials(
#             environment_sync
#         )

#         project_info = environment_sync.options

#         success, sync_data = sync_aws_secrets(
#             kv_pairs,
#             access_key_id,
#             secret_access_key,
#             project_info["region"],
#             project_info["secret_name"],
#             project_info["arn"],
#         )

#         if success:
#             sync_event.status = EnvironmentSync.COMPLETED
#             sync_event.completed_at = timezone.now()
#             sync_event.meta = sync_data
#             sync_event.save()

#             environment_sync.last_sync = timezone.now()
#             environment_sync.status = EnvironmentSync.COMPLETED
#             environment_sync.save()

#         else:
#             sync_event.status = EnvironmentSync.FAILED
#             sync_event.completed_at = timezone.now()
#             sync_event.meta = sync_data
#             sync_event.save()

#             environment_sync.last_sync = timezone.now()
#             environment_sync.status = EnvironmentSync.FAILED
#             environment_sync.save()

#     except JobTimeoutException:
#         # Handle timeout exception
#         sync_event.status = EnvironmentSync.TIMED_OUT
#         sync_event.completed_at = timezone.now()
#         sync_event.save()

#         environment_sync.last_sync = timezone.now()
#         environment_sync.status = EnvironmentSync.TIMED_OUT
#         environment_sync.save()
#         raise  # Re-raise the JobTimeoutException
