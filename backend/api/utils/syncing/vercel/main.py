import requests
import logging
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


def test_vercel_creds(credential_id):
    """Test if the Vercel credentials are valid."""
    try:
        token = get_vercel_credentials(credential_id)
        url = f"{VERCEL_API_BASE_URL}/v2/user"
        response = requests.get(url, headers=get_vercel_headers(token))
        return response.status_code == 200
    except Exception:
        return False


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

    response = requests.get(url, headers=get_vercel_headers(token))

    if response.status_code != 200:
        # Log error details for debugging
        logger.error(
            f"Failed to fetch custom environments for project '{project_id}'"
            f"{' (team: ' + team_id + ')' if team_id else ''}: "
            f"Status code: {response.status_code}, Response: {response.text}"
        )
        return []

    # Parse the correct response structure
    custom_envs = response.json().get("environments", [])
    if not custom_envs:
        logger.info(
            f"No custom environments exist for project '{project_id}'"
            f"{' (team: ' + team_id + ')' if team_id else ''}."
        )
    return [
        {
            "id": env["id"],
            "name": env["slug"].capitalize(),  # Use slug as name, capitalize first letter
            "description": env.get("description", ""),
            "slug": env["slug"],
        }
        for env in custom_envs
    ]


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


def get_existing_env_vars(token, project_id, team_id=None, target_environment=None):
    """
    Retrieve environment variables for a specific Vercel project and environment.

    Args:
        token (str): Vercel API token
        project_id (str): Project ID
        team_id (str, optional): Team ID
        target_environment (str, optional): Specific environment to filter by
    """
    url = f"{VERCEL_API_BASE_URL}/v9/projects/{project_id}/env"
    if team_id is not None:
        url += f"?teamId={team_id}"
    response = requests.get(url, headers=get_vercel_headers(token))

    if response.status_code != 200:
        raise Exception(f"Error retrieving environment variables: {response.text}")

    envs = response.json().get("envs", [])

    # Filter variables by target environment if specified
    if target_environment:
        # Get custom environments to map slugs to IDs for proper filtering
        custom_envs = get_project_custom_environments(token, project_id, team_id)
        custom_env_map = {env["slug"]: env["id"] for env in custom_envs}

        # Check if target_environment is a custom environment
        if target_environment in custom_env_map:
            # For custom environments, check if the custom environment ID is in the target array
            custom_env_id = custom_env_map[target_environment]
            envs = [env for env in envs if custom_env_id in env["target"]]
        else:
            # For standard environments, use the slug directly
            envs = [env for env in envs if target_environment in env["target"]]

    return {
        env["key"]: {
            "id": env["id"],
            "value": env["value"],
            "target": env["target"],
            "comment": env.get("comment"),
        }
        for env in envs
    }


def delete_env_var(token, project_id, team_id, env_var_id):
    """Delete a Vercel environment variable using its ID."""
    url = f"{VERCEL_API_BASE_URL}/v9/projects/{project_id}/env/{env_var_id}"
    if team_id is not None:
        url += f"?teamId={team_id}"
    response = requests.delete(url, headers=get_vercel_headers(token))

    if response.status_code != 200:
        raise Exception(f"Error deleting environment variable: {response.text}")


def resolve_environment_targets(token, project_id, team_id, environment):
    """
    Resolve environment string to actual target environments.
    Handles standard environments and custom environment resolution.

    Args:
        token (str): Vercel API token
        project_id (str): Project ID
        team_id (str): Team ID
        environment (str): Environment specification

    Returns:
        list: List of resolved environment targets
    """
    # Handle "all" case
    if environment == "all":
        standard_envs = ["production", "preview", "development"]
        custom_envs = get_project_custom_environments(token, project_id, team_id)
        custom_env_slugs = [env["slug"] for env in custom_envs]
        return standard_envs + custom_env_slugs

    # Handle standard environments
    if environment in ["production", "preview", "development"]:
        return [environment]

    # Check if it's a custom environment slug
    custom_envs = get_project_custom_environments(token, project_id, team_id)
    custom_env_slugs = [env["slug"] for env in custom_envs]

    if environment in custom_env_slugs:
        return [environment]

    # If not found, raise an error
    available_envs = ["production", "preview", "development"] + custom_env_slugs
    raise Exception(
        f"Environment '{environment}' not found. Available environments: {available_envs}"
    )


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
    Now properly handles custom environments and 'all' environments using Vercel's native targeting.

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

        logger.info(f"Syncing secrets to environment: {environment}")

        # Get existing environment variables
        if environment == "all":
            # For 'all', get all env vars without filtering
            existing_env_vars = get_existing_env_vars(token, project_id, team_id)
        else:
            # For specific environments, filter appropriately
            existing_env_vars = get_existing_env_vars(
                token, project_id, team_id, target_environment=environment
            )

        # Prepare payload for bulk creation
        payload = []
        for key, value, comment in secrets:
            # Check if the environment variable exists and needs updating
            if key in existing_env_vars:
                existing_var = existing_env_vars[key]
                if value != existing_var["value"] or comment != existing_var.get(
                    "comment"
                ):
                    # Delete the existing variable so we can recreate it
                    delete_env_var(token, project_id, team_id, existing_var["id"])

            # Create environment variable with proper targeting
            env_var = {
                "key": key,
                "value": value,
                "type": secret_type,
            }

            # Add comment if provided
            if comment:
                env_var["comment"] = comment

            # Handle different environment targeting
            if environment == "all":
                # For 'all' environments, target standard environments and add custom environment IDs
                env_var["target"] = ["production", "preview", "development"]
                if custom_envs:
                    env_var["customEnvironmentIds"] = [env["id"] for env in custom_envs]
                logger.info(
                    f"Targeting all environments with custom IDs: {[env['id'] for env in custom_envs]}"
                )
            elif environment in custom_env_map:
                # For custom environments, use customEnvironmentIds
                env_var["customEnvironmentIds"] = [custom_env_map[environment]]
                logger.info(
                    f"Using customEnvironmentIds for {environment}: {custom_env_map[environment]}"
                )
            else:
                # For standard environments, use target array
                env_var["target"] = [environment]
                logger.info(f"Using target for {environment}")

            payload.append(env_var)

        # Handle deletion of variables not in the source
        # For 'all' environments, we need to be more careful about deletion
        # to ensure we delete from all environments that the variable was originally in
        for key, env_var in existing_env_vars.items():
            if not any(s[0] == key for s in secrets):
                delete_env_var(token, project_id, team_id, env_var["id"])

        # Bulk create environment variables
        if payload:
            logger.info(
                f"Syncing {len(payload)} variables to environment: {environment}"
            )

            url = f"{VERCEL_API_BASE_URL}/v10/projects/{project_id}/env?upsert=true"
            if team_id is not None:
                url += f"&teamId={team_id}"

            response = requests.post(
                url, headers=get_vercel_headers(token), json=payload
            )

            logger.info(f"API response: {response.status_code}")
            if response.status_code >= 400:
                logger.error(f"Response body: {response.text}")

            if response.status_code not in [200, 201]:
                error_msg = f"Failed to sync secrets: {response.text}"
                logger.error(error_msg)
                return False, {"message": error_msg}
            else:
                success_msg = f"Successfully synced {len(payload)} secrets to environment: {environment}"
                logger.info(success_msg)
                return True, {"message": success_msg}
        else:
            return True, {"message": "No secrets to sync"}

    except Exception as e:
        error_msg = f"Failed to sync secrets: {str(e)}"
        logger.error(error_msg)
        return False, {"message": error_msg}
