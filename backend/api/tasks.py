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

        job = perform_cloudflare_pages_sync.delay(env_sync)
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


# TODO - replace individual 'perform'  job handlers with this generic function
@job("default", timeout=3600)
def generic_sync_task(
    environment_sync, sync_function, get_credentials_function, project_info_keys
):
    EnvironmentSync = apps.get_model("api", "EnvironmentSync")
    EnvironmentSyncEvent = apps.get_model("api", "EnvironmentSyncEvent")

    try:
        sync_event = (
            EnvironmentSyncEvent.objects.filter(env_sync=environment_sync)
            .order_by("-created_at")
            .first()
        )

        kv_pairs = get_environment_secrets(
            environment_sync.environment, environment_sync.path
        )
        if environment_sync.authentication is None:
            sync_data = (
                False,
                {"message": "No authentication credentials for this sync"},
            )
            raise Exception("No authentication credentials for this sync")

        credentials = get_credentials_function(environment_sync)
        project_info = environment_sync.options

        success, sync_data = sync_function(
            kv_pairs,
            *[
                credentials.get(key) if key in credentials else project_info.get(key)
                for key in project_info_keys
            ],
        )

        sync_event.status = (
            EnvironmentSync.COMPLETED if success else EnvironmentSync.FAILED
        )
        sync_event.completed_at = timezone.now()
        sync_event.meta = sync_data
        sync_event.save()

        environment_sync.last_sync = timezone.now()
        environment_sync.status = (
            EnvironmentSync.COMPLETED if success else EnvironmentSync.FAILED
        )
        environment_sync.save()

    except JobTimeoutException:
        sync_event.status = EnvironmentSync.TIMED_OUT
        sync_event.completed_at = timezone.now()
        sync_event.save()

        environment_sync.last_sync = timezone.now()
        environment_sync.status = EnvironmentSync.TIMED_OUT
        environment_sync.save()
        raise

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


@job("default", timeout=3600)
def perform_cloudflare_pages_sync(environment_sync):
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

        account_id, access_token = get_cf_pages_credentials(environment_sync)

        project_info = environment_sync.options

        success, sync_data = sync_cloudflare_secrets(
            secrets,
            account_id,
            access_token,
            project_info["project_name"],
            project_info["environment"],
        )

        sync_event = (
            EnvironmentSyncEvent.objects.filter(env_sync=environment_sync)
            .order_by("-created_at")
            .first()
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


@job("default", timeout=3600)
def perform_github_actions_sync(environment_sync):
    try:
        EnvironmentSync = apps.get_model("api", "EnvironmentSync")
        EnvironmentSyncEvent = apps.get_model("api", "EnvironmentSyncEvent")

        kv_pairs = get_environment_secrets(
            environment_sync.environment, environment_sync.path
        )

        if environment_sync.authentication is None:
            sync_data = (
                False,
                {"message": "No authentication credentials for this sync"},
            )
            raise Exception("No authentication credentials for this sync")

        access_token = get_gh_actions_credentials(environment_sync)

        project_info = environment_sync.options

        success, sync_data = sync_github_secrets(
            kv_pairs,
            access_token,
            project_info["repo_name"],
            project_info["owner"],
        )

        sync_event = (
            EnvironmentSyncEvent.objects.filter(env_sync=environment_sync)
            .order_by("-created_at")
            .first()
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

    except Exception as ex:
        print(f"------- EXCEPTION ---------- {ex}")
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


@job("default", timeout=3600)
def perform_aws_sm_sync(environment_sync):
    try:
        EnvironmentSync = apps.get_model("api", "EnvironmentSync")
        EnvironmentSyncEvent = apps.get_model("api", "EnvironmentSyncEvent")

        kv_pairs = get_environment_secrets(
            environment_sync.environment, environment_sync.path
        )

        if environment_sync.authentication is None:
            sync_data = (
                False,
                {"message": "No authentication credentials for this sync"},
            )
            raise Exception("No authentication credentials for this sync")

        credentials = get_aws_secrets_manager_credentials(environment_sync)

        project_info = environment_sync.options

        success, sync_data = sync_aws_secrets(
            kv_pairs,
            credentials.get("access_key_id"),
            credentials.get("secret_access_key"),
            credentials.get("region"),
            project_info.get("secret_name"),
            project_info.get("arn"),
            project_info.get("kms_id"),
        )

        sync_event = (
            EnvironmentSyncEvent.objects.filter(env_sync=environment_sync)
            .order_by("-created_at")
            .first()
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


@job("default", timeout=3600)
def perform_vault_sync(environment_sync):
    try:
        EnvironmentSync = apps.get_model("api", "EnvironmentSync")
        EnvironmentSyncEvent = apps.get_model("api", "EnvironmentSyncEvent")

        kv_pairs = get_environment_secrets(
            environment_sync.environment, environment_sync.path
        )

        if environment_sync.authentication is None:
            sync_data = (
                False,
                {"message": "No authentication credentials for this sync"},
            )
            raise Exception("No authentication credentials for this sync")

        project_info = environment_sync.options

        success, sync_data = sync_vault_secrets(
            kv_pairs,
            environment_sync.authentication.id,
            project_info.get("engine"),
            project_info.get("path"),
        )

        sync_event = (
            EnvironmentSyncEvent.objects.filter(env_sync=environment_sync)
            .order_by("-created_at")
            .first()
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

    except Exception as ex:
        print(f"EXCEPTION {ex}")
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


@job("default", timeout=3600)
def perform_nomad_sync(environment_sync):
    try:
        EnvironmentSync = apps.get_model("api", "EnvironmentSync")
        EnvironmentSyncEvent = apps.get_model("api", "EnvironmentSyncEvent")

        kv_pairs = get_environment_secrets(
            environment_sync.environment, environment_sync.path
        )

        if environment_sync.authentication is None:
            sync_data = (
                False,
                {"message": "No authentication credentials for this sync"},
            )
            raise Exception("No authentication credentials for this sync")

        project_info = environment_sync.options

        success, sync_data = sync_nomad_secrets(
            kv_pairs,
            environment_sync.authentication.id,
            project_info.get("path"),
            project_info.get("namespace"),
        )

        sync_event = (
            EnvironmentSyncEvent.objects.filter(env_sync=environment_sync)
            .order_by("-created_at")
            .first()
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

    except Exception as ex:
        print(f"EXCEPTION {ex}")
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


@job("default", timeout=3600)
def perform_gitlab_sync(environment_sync):
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

        project_info = environment_sync.options

        resource_id = project_info.get("resource_id")
        resource_path = project_info.get("resource_path")

        success, sync_data = sync_gitlab_secrets(
            secrets,
            environment_sync.authentication.id,
            resource_id if resource_id is not None else resource_path,
            project_info.get("is_group"),
            project_info.get("masked"),
            project_info.get("protected"),
        )

        sync_event = (
            EnvironmentSyncEvent.objects.filter(env_sync=environment_sync)
            .order_by("-created_at")
            .first()
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

    except Exception as ex:
        print(f"EXCEPTION {ex}")
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


@job("default", timeout=3600)
def perform_railway_sync(environment_sync):
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

        railway_sync_options = environment_sync.options

        railway_project = railway_sync_options.get("project")
        railway_environment = railway_sync_options.get("environment")
        railway_service = railway_sync_options.get("service")

        success, sync_data = sync_railway_secrets(
            secrets,
            environment_sync.authentication.id,
            railway_project["id"],
            railway_environment["id"],
            railway_service["id"] if railway_service is not None else None,
        )

        sync_event = (
            EnvironmentSyncEvent.objects.filter(env_sync=environment_sync)
            .order_by("-created_at")
            .first()
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

    except Exception as ex:
        print(f"EXCEPTION {ex}")
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


@job("default", timeout=3600)
def perform_vercel_sync(environment_sync):
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

        vercel_sync_options = environment_sync.options

        vercel_project = vercel_sync_options.get("project")
        vercel_team = vercel_sync_options.get("team")
        vercel_environment = vercel_sync_options.get("environment", "production")
        vercel_secret_type = vercel_sync_options.get("secret_type", "encrypted")

        success, sync_data = sync_vercel_secrets(
            secrets,
            environment_sync.authentication.id,
            vercel_project["id"],
            vercel_team["id"] if vercel_team is not None else None,
            vercel_environment,
            vercel_secret_type,
        )

        sync_event = (
            EnvironmentSyncEvent.objects.filter(env_sync=environment_sync)
            .order_by("-created_at")
            .first()
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

    except Exception as ex:
        print(f"EXCEPTION {ex}")
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
