from django.utils import timezone
from api.services import ServiceConfig
from api.utils.syncing.aws.auth import get_aws_secrets_manager_credentials
from api.utils.syncing.aws.secrets_manager import sync_aws_secrets
from api.utils.syncing.github.actions import (
    get_gh_actions_credentials,
    sync_github_secrets,
)
from api.utils.syncing.vault.main import sync_vault_secrets
from api.utils.syncing.nomad.main import sync_nomad_secrets
from api.utils.syncing.gitlab.main import sync_gitlab_secrets
from api.utils.syncing.railway.main import sync_railway_secrets
from api.utils.syncing.vercel.main import sync_vercel_secrets
from .utils.syncing.cloudflare.pages import (
    get_cf_pages_credentials,
    sync_cloudflare_secrets,
)
from .utils.syncing.cloudflare.workers import (
    get_cf_workers_credentials,
    sync_cloudflare_worker_secrets,
)
from django.apps import apps
from .utils.syncing.secrets import get_environment_secrets
from django_rq import job
from rq.timeouts import JobTimeoutException
from rq.job import Job
from django_rq import get_queue
import django_rq
from rq.exceptions import NoSuchJobError
import logging

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT = 3600


def trigger_sync_tasks(env_sync):
    EnvironmentSync = apps.get_model("api", "EnvironmentSync")
    EnvironmentSyncEvent = apps.get_model("api", "EnvironmentSyncEvent")

    cancel_sync_tasks(env_sync)  # cancel any running or queued jobs for this sync

    if env_sync.service == ServiceConfig.CLOUDFLARE_PAGES["id"]:
        env_sync.status = EnvironmentSync.IN_PROGRESS
        env_sync.save()

        job = perform_cloudflare_pages_sync.delay(env_sync)
        job_id = job.get_id()

        EnvironmentSyncEvent.objects.create(id=job_id, env_sync=env_sync)

    elif env_sync.service == ServiceConfig.CLOUDFLARE_WORKERS["id"]:
        env_sync.status = EnvironmentSync.IN_PROGRESS
        env_sync.save()

        job = perform_cloudflare_workers_sync.delay(env_sync)
        job_id = job.get_id()

        EnvironmentSyncEvent.objects.create(id=job_id, env_sync=env_sync)

    elif env_sync.service == ServiceConfig.AWS_SECRETS_MANAGER["id"]:
        env_sync.status = EnvironmentSync.IN_PROGRESS
        env_sync.save()

        job = perform_aws_sm_sync.delay(env_sync)
        job_id = job.get_id()

        EnvironmentSyncEvent.objects.create(id=job_id, env_sync=env_sync)

    elif env_sync.service == ServiceConfig.GITHUB_ACTIONS["id"]:
        env_sync.status = EnvironmentSync.IN_PROGRESS
        env_sync.save()

        job = perform_github_actions_sync.delay(env_sync)
        job_id = job.get_id()

        EnvironmentSyncEvent.objects.create(id=job_id, env_sync=env_sync)

    elif env_sync.service == ServiceConfig.HASHICORP_VAULT["id"]:
        env_sync.status = EnvironmentSync.IN_PROGRESS
        env_sync.save()

        job = perform_vault_sync.delay(env_sync)
        job_id = job.get_id()

        EnvironmentSyncEvent.objects.create(id=job_id, env_sync=env_sync)

    elif env_sync.service == ServiceConfig.HASHICORP_NOMAD["id"]:
        env_sync.status = EnvironmentSync.IN_PROGRESS
        env_sync.save()

        job = perform_nomad_sync.delay(env_sync)
        job_id = job.get_id()

        EnvironmentSyncEvent.objects.create(id=job_id, env_sync=env_sync)

    elif env_sync.service == ServiceConfig.GITLAB_CI["id"]:
        env_sync.status = EnvironmentSync.IN_PROGRESS
        env_sync.save()

        job = perform_gitlab_sync.delay(env_sync)
        job_id = job.get_id()

        EnvironmentSyncEvent.objects.create(id=job_id, env_sync=env_sync)

    elif env_sync.service == ServiceConfig.RAILWAY["id"]:
        env_sync.status = EnvironmentSync.IN_PROGRESS
        env_sync.save()

        job = perform_railway_sync.delay(env_sync)
        job_id = job.get_id()

        EnvironmentSyncEvent.objects.create(id=job_id, env_sync=env_sync)

    elif env_sync.service == ServiceConfig.VERCEL["id"]:
        env_sync.status = EnvironmentSync.IN_PROGRESS
        env_sync.save()

        job = perform_vercel_sync.delay(env_sync)
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


def handle_sync_event(environment_sync, sync_function, *args, **kwargs):

    EnvironmentSync = apps.get_model("api", "EnvironmentSync")
    EnvironmentSyncEvent = apps.get_model("api", "EnvironmentSyncEvent")

    sync_event = (
        EnvironmentSyncEvent.objects.filter(env_sync=environment_sync)
        .order_by("-created_at")
        .first()
    )

    try:
        EnvironmentSync = apps.get_model("api", "EnvironmentSync")
        EnvironmentSyncEvent = apps.get_model("api", "EnvironmentSyncEvent")

        secrets = get_environment_secrets(
            environment_sync.environment, environment_sync.path
        )

        if environment_sync.authentication is None:
            sync_data = (
                False,
                {"message": "No authentication credentials for this sync"},
            )
            raise Exception("No authentication credentials for this sync")

        success, sync_data = sync_function(secrets, *args, **kwargs)

        if success:
            sync_event.status = EnvironmentSync.COMPLETED
            environment_sync.status = EnvironmentSync.COMPLETED
        else:
            sync_event.status = EnvironmentSync.FAILED
            environment_sync.status = EnvironmentSync.FAILED

        sync_event.meta = sync_data

    except JobTimeoutException:
        # Handle timeout exception

        logger.info(f"Sync job timed out")

        sync_data = {"message": "Sync job timed out"}

        try:
            sync_event.meta = sync_data
        except:
            pass

        sync_event.status = EnvironmentSync.TIMED_OUT
        environment_sync.status = EnvironmentSync.TIMED_OUT

    except Exception as ex:
        logger.info(f"Sync job failed with exception: {ex}")

        sync_data = {"message": str(ex)}

        try:
            sync_event.meta = sync_data
        except:
            pass

        sync_event.status = EnvironmentSync.FAILED
        environment_sync.status = EnvironmentSync.FAILED

    finally:
        sync_event.completed_at = timezone.now()
        sync_event.save()

        environment_sync.last_sync = timezone.now()
        environment_sync.save()

        if sync_event.status == EnvironmentSync.TIMED_OUT:
            raise  # Re-raise the JobTimeoutException


@job("default", timeout=DEFAULT_TIMEOUT)
def perform_cloudflare_pages_sync(environment_sync):

    account_id, access_token = get_cf_pages_credentials(environment_sync)
    project_info = environment_sync.options

    handle_sync_event(
        environment_sync,
        sync_cloudflare_secrets,
        account_id,
        access_token,
        project_info["project_name"],
        project_info["environment"],
    )


@job("default", timeout=DEFAULT_TIMEOUT)
def perform_github_actions_sync(environment_sync):

    access_token = get_gh_actions_credentials(environment_sync)
    repo_name = environment_sync.options.get("repo_name")
    repo_owner = environment_sync.options.get("owner")

    handle_sync_event(
        environment_sync, sync_github_secrets, access_token, repo_name, repo_owner
    )


@job("default", timeout=DEFAULT_TIMEOUT)
def perform_aws_sm_sync(environment_sync):

    credentials = get_aws_secrets_manager_credentials(environment_sync)
    project_info = environment_sync.options

    handle_sync_event(
        environment_sync,
        sync_aws_secrets,
        credentials.get("access_key_id"),
        credentials.get("secret_access_key"),
        credentials.get("region"),
        project_info.get("secret_name"),
        project_info.get("arn"),
        project_info.get("kms_id"),
    )


@job("default", timeout=DEFAULT_TIMEOUT)
def perform_vault_sync(environment_sync):

    project_info = environment_sync.options

    handle_sync_event(
        environment_sync,
        sync_vault_secrets,
        environment_sync.authentication.id,
        project_info.get("engine"),
        project_info.get("path"),
    )


@job("default", timeout=DEFAULT_TIMEOUT)
def perform_nomad_sync(environment_sync):

    project_info = environment_sync.options

    handle_sync_event(
        environment_sync,
        sync_nomad_secrets,
        environment_sync.authentication.id,
        project_info.get("path"),
        project_info.get("namespace"),
    )


@job("default", timeout=DEFAULT_TIMEOUT)
def perform_gitlab_sync(environment_sync):

    project_info = environment_sync.options
    resource_id = project_info.get("resource_id")
    resource_path = project_info.get("resource_path")

    handle_sync_event(
        environment_sync,
        sync_gitlab_secrets,
        environment_sync.authentication.id,
        resource_id if resource_id is not None else resource_path,
        project_info.get("is_group"),
        project_info.get("masked"),
        project_info.get("protected"),
    )


@job("default", timeout=DEFAULT_TIMEOUT)
def perform_railway_sync(environment_sync):

    railway_sync_options = environment_sync.options

    railway_project = railway_sync_options.get("project")
    railway_environment = railway_sync_options.get("environment")
    railway_service = railway_sync_options.get("service")

    handle_sync_event(
        environment_sync,
        sync_railway_secrets,
        environment_sync.authentication.id,
        railway_project["id"],
        railway_environment["id"],
        railway_service["id"] if railway_service is not None else None,
    )


@job("default", timeout=DEFAULT_TIMEOUT)
def perform_vercel_sync(environment_sync):

    vercel_sync_options = environment_sync.options

    vercel_project = vercel_sync_options.get("project")
    vercel_team = vercel_sync_options.get("team")
    vercel_environment = vercel_sync_options.get("environment", "production")
    vercel_secret_type = vercel_sync_options.get("secret_type", "encrypted")

    handle_sync_event(
        environment_sync,
        sync_vercel_secrets,
        environment_sync.authentication.id,
        vercel_project["id"],
        vercel_team["id"] if vercel_team is not None else None,
        vercel_environment,
        vercel_secret_type,
    )


@job("default", timeout=DEFAULT_TIMEOUT)
def perform_cloudflare_workers_sync(environment_sync):
    account_id, access_token = get_cf_workers_credentials(environment_sync)

    worker_info = environment_sync.options

    handle_sync_event(
        environment_sync,
        sync_cloudflare_worker_secrets,
        account_id,
        access_token,
        worker_info["worker_name"],
    )
