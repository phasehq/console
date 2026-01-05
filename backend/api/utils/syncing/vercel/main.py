import requests
import logging
import time
from graphene import ObjectType, List, ID, String
from api.utils.syncing.auth import get_credentials

logger = logging.getLogger(__name__)

VERCEL_API_BASE_URL = "https://api.vercel.com"


class VercelEnvironmentType(ObjectType):
    id = ID(required=True)
    name = String(required=True)
    description = String()
    slug = String(required=True)
    type = String()  # "standard" or "custom"


class VercelProjectType(ObjectType):
    id = ID(required=True)
    name = String(required=True)
    environments = List(VercelEnvironmentType)


class VercelTeamProjectsType(ObjectType):
    id = String(required=True)
    team_name = String(required=True)
    projects = List(VercelProjectType)


def get_vercel_credentials(credential_id):
    """Get Vercel credentials from the encrypted storage."""
    credentials = get_credentials(credential_id)
    token = credentials.get("api_token")
    return token


def get_vercel_headers(token):
    """Prepare headers for Vercel API requests."""
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def vercel_request(method, url, headers, json=None, max_retries=5):
    """Make requests to the Vercel API and handle rate limits."""
    last_response = None
    for attempt in range(max_retries):
        response = requests.request(method, url, headers=headers, json=json)
        last_response = response

        is_rate_limited = response.status_code == 429 or "rate_limited" in response.text
        if not is_rate_limited:
            return response

        reset_header = response.headers.get("X-RateLimit-Reset")
        wait_seconds = 5
        if reset_header and reset_header.isdigit():
            wait_seconds = max(int(reset_header) - int(time.time()), 1)

        logger.warning(
            f"Vercel {method} {url} rate limited (attempt {attempt + 1}/{max_retries}); "
            f"waiting {wait_seconds}s before retrying."
        )
        time.sleep(wait_seconds)

    return last_response


def test_vercel_creds(credential_id):
    """Test if the Vercel credentials are valid."""
    try:
        token = get_vercel_credentials(credential_id)
        url = f"{VERCEL_API_BASE_URL}/v2/user"
        response = requests.get(url, headers=get_vercel_headers(token))
        return response.status_code == 200
    except Exception:
        return False


def delete_env_var(token, project_id, team_id, env_var_id):
    """Delete a Vercel environment variable using its ID."""
    url = f"{VERCEL_API_BASE_URL}/v9/projects/{project_id}/env/{env_var_id}"
    if team_id is not None:
        url += f"?teamId={team_id}"

    response = vercel_request("DELETE", url, headers=get_vercel_headers(token))
    if response.status_code != 200:
        raise Exception(f"Error deleting environment variable: {response.text}")


def get_project_custom_environments(token, project_id, team_id=None):
    """
    Retrieve custom environments for a specific Vercel project.

    Args:
        token (str): Vercel API token
        project_id (str): Project ID
        team_id (str, optional): Team ID

    Returns:
        list: List of custom environment dictionaries
    """
    url = f"{VERCEL_API_BASE_URL}/v1/projects/{project_id}/custom-environments"
    if team_id:
        url += f"?teamId={team_id}"

    try:
        response = requests.get(url, headers=get_vercel_headers(token))

        if response.status_code != 200:
            logger.warning(
                f"Failed to fetch custom environments for project '{project_id}'"
                f"{' (team: ' + team_id + ')' if team_id else ''}: "
                f"Status code: {response.status_code}"
            )
            return []

        custom_envs = response.json().get("environments", [])
        logger.info(
            f"Found {len(custom_envs)} custom environments for project {project_id}"
        )

        return [
            {
                "id": env["id"],
                "name": env["slug"].capitalize(),
                "description": env.get("description", ""),
                "slug": env["slug"],
            }
            for env in custom_envs
        ]
    except Exception as e:
        logger.error(f"Exception fetching custom environments: {str(e)}")
        return []


def list_vercel_projects(credential_id):
    """
    List all Vercel projects accessible with the provided credentials.
    Includes personal projects as part of the "personal team" when teams are listed.
    Returns a list of dictionaries with team names and their projects.
    """
    try:
        token = get_vercel_credentials(credential_id)

        # Fetch teams
        teams_url = f"{VERCEL_API_BASE_URL}/v2/teams"
        teams_response = requests.get(teams_url, headers=get_vercel_headers(token))
        if teams_response.status_code != 200:
            raise Exception(f"Failed to list Vercel teams: {teams_response.text}")

        teams = teams_response.json().get("teams", [])

        result = []

        # Fetch projects for each team
        for team in teams:
            team_id = team["id"]
            team_name = team["name"]

            # Construct the URL based on whether it's a personal team
            team_projects_url = (
                f"{VERCEL_API_BASE_URL}/v9/projects"
                if team_id is None
                else f"{VERCEL_API_BASE_URL}/v9/projects?teamId={team_id}"
            )
            team_projects_response = requests.get(
                team_projects_url, headers=get_vercel_headers(token)
            )
            if team_projects_response.status_code != 200:
                logger.error(
                    f"Failed to list projects for team {team_name}: {team_projects_response.text}"
                )
                continue

            team_projects = team_projects_response.json().get("projects", [])

            # Get available environments for each project (including custom environments)
            projects_with_envs = []
            for project in team_projects:
                project_id = project["id"]
                custom_envs = get_project_custom_environments(
                    token, project_id, team_id
                )

                # Standard environments
                environments = [
                    {
                        "id": "all",
                        "name": "All Environments",
                        "slug": "all",
                        "type": "all",
                    },
                    {
                        "id": "dev",
                        "name": "Development",
                        "slug": "development",
                        "type": "standard",
                    },
                    {
                        "id": "prev",
                        "name": "Preview",
                        "slug": "preview",
                        "type": "standard",
                    },
                    {
                        "id": "prod",
                        "name": "Production",
                        "slug": "production",
                        "type": "standard",
                    },
                ]

                # Add custom environments with full details
                for env in custom_envs:
                    environments.append(
                        {
                            "id": env["id"],
                            "name": env["name"],
                            "description": env.get("description", ""),
                            "slug": env["slug"],
                            "type": "custom",
                        }
                    )

                projects_with_envs.append(
                    {
                        "id": project["id"],
                        "name": project["name"],
                        "environments": environments,
                    }
                )

            result.append(
                {
                    "id": team_id,
                    "team_name": team_name,
                    "projects": projects_with_envs,
                }
            )

        return result

    except Exception as e:
        raise Exception(f"Error listing Vercel projects: {str(e)}")


def get_existing_env_vars(token, project_id, team_id, target_environment):
    """
    Retrieve environment variables for a specific Vercel project and environment.
    Only returns variables that EXCLUSIVELY target the specified environment.

    Args:
        token (str): Vercel API token
        project_id (str): Project ID
        team_id (str): Team ID
        target_environment (str): Specific environment to filter by (REQUIRED)

    Returns:
        dict: Dictionary mapping variable keys to their metadata (id, value, target, comment)
    """
    url = f"{VERCEL_API_BASE_URL}/v9/projects/{project_id}/env"
    if team_id is not None:
        url += f"?teamId={team_id}"

    response = vercel_request("GET", url, headers=get_vercel_headers(token))
    if response.status_code != 200:
        raise Exception(f"Error retrieving environment variables: {response.text}")

    envs = response.json().get("envs", [])
    filtered_envs = []

    # Get custom environments to map slugs to IDs for proper filtering
    custom_envs = get_project_custom_environments(token, project_id, team_id)
    custom_env_map = {env["slug"]: env["id"] for env in custom_envs}

    for env in envs:
        env_targets = set(env.get("target", []))
        custom_env_ids = set(env.get("customEnvironmentIds", []))

        if target_environment in custom_env_map:
            # For custom environments, check customEnvironmentIds field
            custom_env_id = custom_env_map[target_environment]

            # Variable should ONLY target this custom environment
            if (
                len(custom_env_ids) == 1
                and custom_env_id in custom_env_ids
                and len(env_targets) == 0
            ):
                filtered_envs.append(env)
        else:
            # For standard environments, only include if it EXCLUSIVELY targets this environment
            if (
                len(env_targets) == 1
                and target_environment in env_targets
                and len(custom_env_ids) == 0
            ):
                filtered_envs.append(env)

    logger.info(
        f"Found {len(filtered_envs)} variables exclusively targeting environment: {target_environment}"
    )

    return {
        env["key"]: {
            "id": env["id"],
            "value": env["value"],
            "target": env["target"],
            "comment": env.get("comment"),
        }
        for env in filtered_envs
    }


def sync_vercel_secrets(
    secrets,
    credential_id,
    project_id,
    team_id,
    environment="production",
    secret_type="encrypted",
):
    """
    Sync secrets to a specific Vercel project environment.
    For 'all' environments, creates separate variables for each environment to avoid cross-environment deletion issues.

    Args:
        secrets (list of tuple): List of (key, value, comment) tuples to sync
        credential_id (str): The ID of the stored credentials
        project_id (str): The Vercel project ID
        team_id (str): The Vercel project team ID
        environment (str): Target environment (development/preview/production/all/custom-env-slug)
        secret_type (str): Type of secret (plain/encrypted/sensitive)

    Returns:
        tuple: (bool, dict) indicating success/failure and a message
    """
    try:
        token = get_vercel_credentials(credential_id)

        # Get custom environments mapping for proper target identification
        custom_envs = get_project_custom_environments(token, project_id, team_id)
        custom_env_map = {env["slug"]: env["id"] for env in custom_envs}

        # Validate environment exists before proceeding
        if (
            environment not in ["all", "production", "preview", "development"]
            and environment not in custom_env_map
        ):
            available_envs = ["all", "production", "preview", "development"] + list(
                custom_env_map.keys()
            )
            raise Exception(
                f"Environment '{environment}' not found. Available environments: {available_envs}"
            )

        logger.info(f"Syncing {len(secrets)} secrets to environment: {environment}")

        # Determine target environments to sync to
        if environment == "all":
            target_environments = ["production", "preview", "development"] + list(
                custom_env_map.keys()
            )
            logger.info(
                f"Syncing to all environments individually: {target_environments}"
            )
        else:
            target_environments = [environment]

        all_success = True
        messages = []

        # Process each target environment separately
        for target_env in target_environments:
            logger.info(f"Processing environment: {target_env}")

            # Get existing environment variables for this specific environment
            existing_env_vars = get_existing_env_vars(
                token, project_id, team_id, target_environment=target_env
            )

            logger.info(
                f"Found {len(existing_env_vars)} existing variables for environment: {target_env}"
            )

            # Prepare payload for this specific environment
            payload = []
            updated_count = 0

            for key, value, comment in secrets:
                # Check if the environment variable exists and needs updating
                if key in existing_env_vars:
                    existing_var = existing_env_vars[key]
                    if value != existing_var["value"] or comment != existing_var.get(
                        "comment"
                    ):
                        logger.info(f"Updating variable in environment: {target_env}")
                        delete_env_var(token, project_id, team_id, existing_var["id"])
                        updated_count += 1

                # Create environment variable with proper targeting for this specific environment
                env_var = {
                    "key": key,
                    "value": value,
                    "type": secret_type,
                }

                if comment:
                    env_var["comment"] = comment

                # Always create single-environment variables
                if target_env in custom_env_map:
                    # For custom environments, use customEnvironmentIds
                    env_var["customEnvironmentIds"] = [custom_env_map[target_env]]
                else:
                    # For standard environments, use target array
                    env_var["target"] = [target_env]

                payload.append(env_var)

            # Handle deletion of variables not in the source for this specific environment
            secrets_to_keep = {secret[0] for secret in secrets}
            deleted_count = 0

            for key, env_var in existing_env_vars.items():
                if key not in secrets_to_keep:
                    logger.info(
                        f"Deleting unused variable from environment: {target_env}"
                    )
                    delete_env_var(token, project_id, team_id, env_var["id"])
                    deleted_count += 1

            # Bulk create environment variables for this environment
            if payload:
                logger.info(
                    f"Syncing {len(payload)} variables to environment: {target_env}"
                )

                url = f"{VERCEL_API_BASE_URL}/v10/projects/{project_id}/env?upsert=true"
                if team_id is not None:
                    url += f"&teamId={team_id}"

                response = vercel_request(
                    "POST", url, headers=get_vercel_headers(token), json=payload
                )

                if response.status_code not in [200, 201]:
                    all_success = False
                    error_msg = (
                        f"Failed to sync secrets to {target_env}: {response.text}"
                    )
                    logger.error(error_msg)
                    messages.append(error_msg)
                else:
                    success_msg = f"Successfully synced to {target_env}: {len(payload)} total, {updated_count} updated, {deleted_count} deleted"
                    logger.info(success_msg)
                    messages.append(success_msg)
            else:
                messages.append(f"No secrets to sync for environment: {target_env}")

        return all_success, {"message": "\n".join(messages)}

    except Exception as e:
        error_msg = f"Failed to sync secrets: {str(e)}"
        logger.error(error_msg)
        return False, {"message": error_msg}
