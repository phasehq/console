import requests
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


def list_vercel_project_environments(credential_id, project_id, team_id=None):
    """List available environments for a specific Vercel project.

    Returns a list of dicts: { slug: string, id: string | null }
    Includes defaults (production/preview/development) with id=None,
    and adds custom environments with their ids.
    """
    token = get_vercel_credentials(credential_id)

    url = f"{VERCEL_API_BASE_URL}/v9/projects/{project_id}/custom-environments"

    response = requests.get(url, headers=get_vercel_headers(token))
    if response.status_code != 200:
        # Fall back to defaults if we cannot read custom environments
        return [
            {"slug": "production", "id": None},
            {"slug": "preview", "id": None},
            {"slug": "development", "id": None},
        ]

    custom_envs = response.json().get("environments", [])

    result = [
        {"slug": "production", "id": None},
        {"slug": "preview", "id": None},
        {"slug": "development", "id": None},
    ]

    for env in custom_envs:
        slug = (env.get("slug") or env.get("id") or "").strip()
        if slug:
            result.append({"slug": slug, "id": env.get("id")})

    # De-duplicate by slug while preserving order
    seen = set()
    deduped = []
    for item in result:
        if item["slug"] in seen:
            continue
        seen.add(item["slug"])
        deduped.append(item)
    return deduped


def get_existing_env_vars(token, project_id, team_id=None, target_environment=None, custom_environment_id=None):
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

    print(f"response: {response.json()}")

    if response.status_code != 200:
        raise Exception(f"Error retrieving environment variables: {response.text}")

    envs = response.json().get("envs", [])

    # Filter variables by target environment or custom environment if specified
    if custom_environment_id is not None:
        envs = [
            env
            for env in envs
            if custom_environment_id in (env.get("customEnvironmentIds") or [])
        ]
    elif target_environment:
        envs = [env for env in envs if target_environment in env.get("target", [])]

    return {
        env["key"]: {
            "id": env["id"],
            "value": env["value"],
            "target": env["target"],
            "customEnvironmentIds": env.get("customEnvironmentIds"),
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
    custom_environment_id=None,
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
        default_envs = {"production", "preview", "development"}

        all_updates_successful = True
        messages = []

        # Process each target environment separately
        for target_env in target_environments:
            # If caller provided a custom env id (stored at sync creation), prefer it and skip lookups
            custom_env_id = (
                custom_environment_id if target_env not in default_envs else None
            )

            # Get existing environment variables for this destination
            existing_env_vars = get_existing_env_vars(
                token,
                project_id,
                team_id,
                target_environment=target_env if custom_env_id is None else None,
                custom_environment_id=custom_env_id,
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

                env_var = {"key": key, "value": value, "type": secret_type}
                if custom_env_id is None:
                    env_var["target"] = [target_env]
                else:
                    env_var["customEnvironmentIds"] = [custom_env_id]
                if comment:
                    env_var["comment"] = comment
                payload.append(env_var)

            # Delete or scope-update variables not in the source (only for this destination)
            for key, env_var in existing_env_vars.items():
                if not any(s[0] == key for s in secrets):
                    if custom_env_id is None:
                        # Default envs: safe to delete this env-scoped record
                        delete_env_var(token, project_id, team_id, env_var["id"])
                    else:
                        # Custom env: remove only the custom env id from this variable, preserve others
                        existing_custom_ids = env_var.get("customEnvironmentIds") or []
                        remaining_custom_ids = [cid for cid in existing_custom_ids if cid != custom_env_id]
                        remaining_targets = env_var.get("target") or []

                        # If the record didn't actually target this custom env (edge-case), skip
                        if len(remaining_custom_ids) == len(existing_custom_ids):
                            continue

                        if not remaining_custom_ids and not remaining_targets:
                            # No remaining scopes; delete the variable entirely
                            delete_env_var(token, project_id, team_id, env_var["id"])
                        else:
                            # Upsert variable with remaining scopes to drop only this custom env
                            update_var = {
                                "key": key,
                                "value": env_var["value"],
                                "type": secret_type,
                            }
                            if remaining_targets:
                                update_var["target"] = remaining_targets
                            if remaining_custom_ids:
                                update_var["customEnvironmentIds"] = remaining_custom_ids
                            payload.append(update_var)
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
