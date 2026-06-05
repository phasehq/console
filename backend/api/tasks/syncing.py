from django.utils import timezone
from api.services import ServiceConfig
from api.utils.syncing.aws.auth import (
    get_aws_secrets_manager_credentials,
    get_aws_assume_role_credentials,
)
from api.utils.syncing.aws.secrets_manager import sync_aws_secrets
from api.utils.syncing.github.actions import (
    get_gh_actions_credentials,
    sync_github_secrets,
    sync_github_org_secrets,
)
from api.utils.syncing.github.dependabot import (
    sync_github_dependabot_secrets,
    sync_github_dependabot_org_secrets,
)
from api.utils.syncing.vault.main import sync_vault_secrets
from api.utils.syncing.nomad.main import sync_nomad_secrets
from api.utils.syncing.gitlab.main import sync_gitlab_secrets
from api.utils.syncing.railway.main import sync_railway_secrets
from api.utils.syncing.vercel.main import sync_vercel_secrets
from api.utils.syncing.render.main import (
    RenderResourceType,
    sync_render_env_group_secret_file,
    sync_render_service_env_vars,
)
from api.utils.syncing.azure.auth import get_azure_credential
from api.utils.syncing.azure.key_vault import (
    sync_azure_kv_individual,
    sync_azure_kv_blob,
)
from ..utils.syncing.cloudflare.pages import (
    get_cf_pages_credentials,
    sync_cloudflare_secrets,
)
from ..utils.syncing.cloudflare.workers import (
    get_cf_workers_credentials,
    sync_cloudflare_worker_secrets,
)
from django.apps import apps
from ..utils.syncing.secrets import get_environment_secrets
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

    SERVICE_DISPATCH = {
        ServiceConfig.CLOUDFLARE_PAGES["id"]: perform_cloudflare_pages_sync,
        ServiceConfig.CLOUDFLARE_WORKERS["id"]: perform_cloudflare_workers_sync,
        ServiceConfig.AWS_SECRETS_MANAGER["id"]: perform_aws_sm_sync,
        ServiceConfig.GITHUB_ACTIONS["id"]: perform_github_actions_sync,
        ServiceConfig.GITHUB_DEPENDABOT["id"]: perform_github_dependabot_sync,
        ServiceConfig.HASHICORP_VAULT["id"]: perform_vault_sync,
        ServiceConfig.HASHICORP_NOMAD["id"]: perform_nomad_sync,
        ServiceConfig.GITLAB_CI["id"]: perform_gitlab_sync,
        ServiceConfig.RAILWAY["id"]: perform_railway_sync,
        ServiceConfig.VERCEL["id"]: perform_vercel_sync,
        ServiceConfig.RENDER["id"]: perform_render_service_sync,
        ServiceConfig.AZURE_KEY_VAULT["id"]: perform_azure_kv_sync,
    }

    sync_func = SERVICE_DISPATCH.get(env_sync.service)
    if sync_func is None:
        return

    env_sync.status = EnvironmentSync.QUEUED
    env_sync.save()

    try:
        job = sync_func.delay(env_sync)
        job_id = job.get_id()
        EnvironmentSyncEvent.objects.create(id=job_id, env_sync=env_sync)
    except Exception as e:
        logger.error(f"Failed to dispatch sync job for {env_sync.id}: {e}")
        env_sync.status = EnvironmentSync.FAILED
        env_sync.save()


# try and cancel running or queued jobs for this sync
def cancel_sync_tasks(env_sync):
    queue = django_rq.get_queue("default")

    EnvironmentSync = apps.get_model("api", "EnvironmentSync")
    EnvironmentSyncEvent = apps.get_model("api", "EnvironmentSyncEvent")

    for sync_event in EnvironmentSyncEvent.objects.filter(
        env_sync=env_sync,
        status__in=[EnvironmentSync.IN_PROGRESS, EnvironmentSync.QUEUED],
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

    # Mark as in-progress now that the worker has picked up the job
    environment_sync.status = EnvironmentSync.IN_PROGRESS
    environment_sync.save()
    if sync_event:
        sync_event.status = EnvironmentSync.IN_PROGRESS
        sync_event.save()

    try:
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
        environment_sync.last_sync = timezone.now()
        environment_sync.save()
        sync_event.completed_at = timezone.now()
        sync_event.save()


@job("default", timeout=DEFAULT_TIMEOUT)
def perform_cloudflare_pages_sync(environment_sync):

    account_id = None
    access_token = None

    if environment_sync.authentication:
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

    access_token = None
    api_host = None

    if environment_sync.authentication:
        access_token, api_host = get_gh_actions_credentials(environment_sync)

    is_org_sync = environment_sync.options.get("org_sync", False)

    if is_org_sync:
        org = environment_sync.options.get("org")
        visibility = environment_sync.options.get("visibility", "all")
        handle_sync_event(
            environment_sync,
            sync_github_org_secrets,
            access_token,
            org,
            api_host,
            visibility,
        )
    else:
        repo_name = environment_sync.options.get("repo_name")
        repo_owner = environment_sync.options.get("owner")
        environment_name = environment_sync.options.get("environment_name")

        handle_sync_event(
            environment_sync,
            sync_github_secrets,
            access_token,
            repo_name,
            repo_owner,
            api_host,
            environment_name,
        )


@job("default", timeout=DEFAULT_TIMEOUT)
def perform_github_dependabot_sync(environment_sync):

    access_token = None
    api_host = None

    if environment_sync.authentication:
        access_token, api_host = get_gh_actions_credentials(environment_sync)

    is_org_sync = environment_sync.options.get("org_sync", False)

    if is_org_sync:
        org = environment_sync.options.get("org")
        visibility = environment_sync.options.get("visibility", "all")
        handle_sync_event(
            environment_sync,
            sync_github_dependabot_org_secrets,
            access_token,
            org,
            api_host,
            visibility,
        )
    else:
        repo_name = environment_sync.options.get("repo_name")
        repo_owner = environment_sync.options.get("owner")

        handle_sync_event(
            environment_sync,
            sync_github_dependabot_secrets,
            access_token,
            repo_name,
            repo_owner,
            api_host,
        )


@job("default", timeout=DEFAULT_TIMEOUT)
def perform_aws_sm_sync(environment_sync):
    project_info = environment_sync.options

    # Determine authentication method and get appropriate credentials
    credentials = {}

    if environment_sync.authentication:
        has_role_arn = "role_arn" in environment_sync.authentication.credentials

        if has_role_arn:
            credentials = get_aws_assume_role_credentials(environment_sync)
        else:
            credentials = get_aws_secrets_manager_credentials(environment_sync)

    handle_sync_event(
        environment_sync,
        sync_aws_secrets,
        credentials.get("region"),
        project_info.get("secret_name"),
        project_info.get("arn"),
        project_info.get("kms_id"),
        credentials.get("access_key_id"),
        credentials.get("secret_access_key"),
        credentials.get("role_arn"),
        credentials.get("external_id"),
    )


@job("default", timeout=DEFAULT_TIMEOUT)
def perform_vault_sync(environment_sync):

    project_info = environment_sync.options

    auth_id = None
    if environment_sync.authentication:
        auth_id = environment_sync.authentication.id

    handle_sync_event(
        environment_sync,
        sync_vault_secrets,
        auth_id,
        project_info.get("engine"),
        project_info.get("path"),
    )


@job("default", timeout=DEFAULT_TIMEOUT)
def perform_nomad_sync(environment_sync):

    project_info = environment_sync.options

    auth_id = None
    if environment_sync.authentication:
        auth_id = environment_sync.authentication.id

    handle_sync_event(
        environment_sync,
        sync_nomad_secrets,
        auth_id,
        project_info.get("path"),
        project_info.get("namespace"),
    )


@job("default", timeout=DEFAULT_TIMEOUT)
def perform_gitlab_sync(environment_sync):

    project_info = environment_sync.options
    resource_id = project_info.get("resource_id")
    resource_path = project_info.get("resource_path")

    auth_id = None
    if environment_sync.authentication:
        auth_id = environment_sync.authentication.id

    handle_sync_event(
        environment_sync,
        sync_gitlab_secrets,
        auth_id,
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

    auth_id = None
    if environment_sync.authentication:
        auth_id = environment_sync.authentication.id

    handle_sync_event(
        environment_sync,
        sync_railway_secrets,
        auth_id,
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

    auth_id = None
    if environment_sync.authentication:
        auth_id = environment_sync.authentication.id

    handle_sync_event(
        environment_sync,
        sync_vercel_secrets,
        auth_id,
        vercel_project["id"],
        vercel_team["id"] if vercel_team is not None else None,
        vercel_environment,
        vercel_secret_type,
    )


@job("default", timeout=DEFAULT_TIMEOUT)
def perform_cloudflare_workers_sync(environment_sync):
    account_id = None
    access_token = None

    if environment_sync.authentication:
        account_id, access_token = get_cf_workers_credentials(environment_sync)

    worker_info = environment_sync.options

    handle_sync_event(
        environment_sync,
        sync_cloudflare_worker_secrets,
        account_id,
        access_token,
        worker_info["worker_name"],
    )


@job("default", timeout=DEFAULT_TIMEOUT)
def perform_render_service_sync(environment_sync):
    render_service_options = environment_sync.options
    render_resource_id = render_service_options.get("resource_id")
    render_resource_type = render_service_options.get("resource_type")

    auth_id = None
    if environment_sync.authentication:
        auth_id = environment_sync.authentication.id

    if render_resource_type == RenderResourceType.ENVIRONMENT_GROUP.value:
        secret_file_name = render_service_options.get("secret_file_name")

        handle_sync_event(
            environment_sync,
            sync_render_env_group_secret_file,
            auth_id,
            render_resource_id,
            secret_file_name,
        )

    else:
        handle_sync_event(
            environment_sync,
            sync_render_service_env_vars,
            auth_id,
            render_resource_id,
        )


@job("default", timeout=DEFAULT_TIMEOUT)
def perform_azure_kv_sync(environment_sync):
    if not environment_sync.authentication:
        raise ValueError("Azure KV sync requires authentication credentials")

    credentials = get_azure_credential(environment_sync)

    options = environment_sync.options
    sync_mode = options.get("sync_mode", "individual")
    vault_uri = options.get("vault_uri")

    if sync_mode == "blob":
        handle_sync_event(
            environment_sync,
            sync_azure_kv_blob,
            credentials.get("tenant_id"),
            credentials.get("client_id"),
            credentials.get("client_secret"),
            vault_uri,
            options.get("secret_name"),
        )
    else:
        handle_sync_event(
            environment_sync,
            sync_azure_kv_individual,
            credentials.get("tenant_id"),
            credentials.get("client_id"),
            credentials.get("client_secret"),
            vault_uri,
        )


def trigger_syncs_for_referencing_envs(changed_env):
    """
    Finds environments with active syncs whose secrets reference the changed
    environment, and triggers those syncs to keep referenced values up to date.

    Called synchronously from Environment.save() so that sync status is set to
    IN_PROGRESS immediately (the actual sync work is dispatched async by
    trigger_sync_tasks). This ensures the UI reflects the pending sync right away.

    This handles the case where env B has a secret like ${staging.DB_HOST}
    referencing env "staging" — when a secret in "staging" changes, env B's
    syncs need to be triggered too.
    """
    from api.utils.secrets import env_has_references_to

    EnvironmentSync = apps.get_model("api", "EnvironmentSync")

    org = changed_env.app.organisation
    changed_env_name = changed_env.name
    changed_app_name = changed_env.app.name
    changed_app_id = changed_env.app_id

    # Find all active syncs in the org, excluding the changed environment
    candidate_syncs = EnvironmentSync.objects.filter(
        environment__app__organisation=org,
        is_active=True,
        deleted_at=None,
    ).exclude(
        environment=changed_env
    ).select_related("environment", "environment__app")

    # Group syncs by environment to avoid redundant reference checks
    env_syncs_map = {}
    for sync in candidate_syncs:
        env_id = sync.environment_id
        if env_id not in env_syncs_map:
            env_syncs_map[env_id] = []
        env_syncs_map[env_id].append(sync)

    if not env_syncs_map:
        return

    for env_id, syncs in env_syncs_map.items():
        try:
            if env_has_references_to(
                env_id, changed_env_name, changed_app_name, changed_app_id
            ):
                logger.info(
                    f"Environment {env_id} references changed environment "
                    f"{changed_env.id}, triggering syncs"
                )
                for sync in syncs:
                    trigger_sync_tasks(sync)
        except Exception as e:
            logger.warning(
                f"Failed to check references for environment {env_id}: {e}"
            )
