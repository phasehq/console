import requests
import graphene
from graphene import ObjectType

from api.utils.syncing.auth import get_credentials

VERCEL_API_BASE_URL = "https://api.vercel.com"


from graphene import ObjectType, List, ID, String


class VercelProjectType(ObjectType):
    id = ID(required=True)
    name = String(required=True)
    environment = List(String)


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
                print(
                    f"Failed to list projects for team {team_name}: {team_projects_response.text}"
                )
                continue

            team_projects = team_projects_response.json().get("projects", [])
            result.append(
                {
                    "id": team_id,
                    "team_name": team_name,
                    "projects": [
                        {
                            "id": project["id"],
                            "name": project["name"],
                            "environment": ["development", "preview", "production"],
                        }
                        for project in team_projects
                    ],
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

    Args:
        secrets (list of tuple): List of (key, value, comment) tuples to sync
        credential_id (str): The ID of the stored credentials
        project_id (str): The Vercel project ID
        team_id (str): The Vercel project team ID
        environment (str): Target environment (development/preview/production/all)
        secret_type (str): Type of secret (plain/encrypted/sensitive)

    Returns:
        tuple: (bool, dict) indicating success/failure and a message
    """
    try:
        token = get_vercel_credentials(credential_id)

        # Determine target environments
        target_environments = (
            ["production", "preview", "development"]
            if environment == "all"
            else [environment]
        )

        all_updates_successful = True
        messages = []

        # Process each target environment separately
        for target_env in target_environments:
            # Get existing environment variables for this specific environment
            existing_env_vars = get_existing_env_vars(
                token, project_id, team_id, target_environment=target_env
            )

            # Prepare payload for bulk creation
            payload = []
            for key, value, comment in secrets:
                # Check if the environment variable exists and needs updating
                if key in existing_env_vars:
                    existing_var = existing_env_vars[key]
                    if (
                        value != existing_var["value"]
                        or comment != existing_var.get("comment")
                    ):
                        # Only delete if we're updating this specific variable
                        delete_env_var(token, project_id, team_id, existing_var["id"])

                env_var = {
                    "key": key,
                    "value": value,
                    "type": secret_type,
                    "target": [target_env],  # Set target to specific environment
                }
                if comment:
                    env_var["comment"] = comment
                payload.append(env_var)

            # Delete environment variables not in the source (only for this environment)
            for key, env_var in existing_env_vars.items():
                if not any(s[0] == key for s in secrets):
                    delete_env_var(token, project_id, team_id, env_var["id"])

            # Bulk create environment variables
            if payload:
                url = f"{VERCEL_API_BASE_URL}/v10/projects/{project_id}/env?upsert=true"
                if team_id is not None:
                    url += f"&teamId={team_id}"
                response = requests.post(
                    url, headers=get_vercel_headers(token), json=payload
                )

                if response.status_code != 201:
                    all_updates_successful = False
                    messages.append(
                        f"Failed to sync secrets for environment {target_env}: {response.text}"
                    )
                else:
                    messages.append(
                        f"Successfully synced secrets to environment: {target_env}"
                    )

        return all_updates_successful, {"message": "; ".join(messages)}

    except Exception as e:
        return False, {"message": f"Failed to sync secrets: {str(e)}"}
