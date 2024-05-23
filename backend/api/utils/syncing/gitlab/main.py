import requests
import re
import urllib.parse
import graphene

from api.utils.syncing.auth import get_credentials


class NamespaceType(graphene.ObjectType):
    id = graphene.Int()
    name = graphene.String()
    path = graphene.String()


class GitLabProjectType(graphene.ObjectType):
    id = graphene.Int()
    name = graphene.String()
    name_with_namespace = graphene.String()
    path = graphene.String()
    path_with_namespace = graphene.String()
    created_at = graphene.DateTime()
    default_branch = graphene.String()
    tag_list = graphene.List(graphene.String)
    topics = graphene.List(graphene.String)
    ssh_url_to_repo = graphene.String()
    http_url_to_repo = graphene.String()
    web_url = graphene.String()
    avatar_url = graphene.String()
    star_count = graphene.Int()
    last_activity_at = graphene.DateTime()
    namespace = graphene.Field(NamespaceType)


class GitLabGroupType(graphene.ObjectType):
    id = graphene.ID()
    name = graphene.String()
    path = graphene.String()
    description = graphene.String()
    visibility = graphene.String()
    share_with_group_lock = graphene.Boolean()
    require_two_factor_authentication = graphene.Boolean()
    two_factor_grace_period = graphene.Int()
    project_creation_level = graphene.String()
    auto_devops_enabled = graphene.Boolean()
    subgroup_creation_level = graphene.String()
    emails_disabled = graphene.Boolean()
    emails_enabled = graphene.Boolean()
    mentions_disabled = graphene.Boolean()
    lfs_enabled = graphene.Boolean()
    default_branch = graphene.String()
    default_branch_protection = graphene.Int()
    avatar_url = graphene.String()
    web_url = graphene.String()
    request_access_enabled = graphene.Boolean()
    repository_storage = graphene.String()
    full_name = graphene.String()
    full_path = graphene.String()
    file_template_project_id = graphene.ID()
    parent_id = graphene.ID()
    created_at = graphene.DateTime()


def get_gitlab_credentials(credential_id):

    credentials = get_credentials(credential_id)

    host = credentials["gitlab_host"]
    token = credentials["gitlab_token"]

    return host, token


def validate_auth(credential_id):
    """
    Check if the GitLab token is valid and operational.
    This function makes a request to the GitLab API to fetch the user's details.
    A successful request (status code 200) indicates a valid token.
    """

    GITLAB_HOST, GITLAB_TOKEN = get_gitlab_credentials(credential_id)

    headers = {"Private-Token": GITLAB_TOKEN}
    response = requests.get(f"{GITLAB_HOST}/api/v4/user", headers=headers)

    return response.status_code == 200


def list_gitlab_projects(credential_id):
    """
    List all GitLab repositories the user has access to with CRUD permissions on CI/CD variables.
    This function paginates through the GitLab API to fetch all projects accessible to the user.
    It checks for project access levels to determine if the user can CRUD CI/CD variables.
    """

    if not validate_auth(credential_id):
        raise Exception(
            "Could not authenticate with GitLab. Please check that your credentials are valid"
        )

    GITLAB_HOST, GITLAB_TOKEN = get_gitlab_credentials(credential_id)

    headers = {"Private-Token": GITLAB_TOKEN}
    url = f"{GITLAB_HOST}/api/v4/projects?membership=true&min_access_level=30&per_page=100"
    all_projects = []

    while url:
        response = requests.get(url, headers=headers)
        if response.status_code != 200:
            return None

        projects = response.json()
        all_projects.extend(projects)

        next_page = response.headers.get("X-Next-Page")
        url = (
            f"{GITLAB_HOST}/api/v4/projects?membership=true&per_page=100&page={next_page}"
            if next_page
            else None
        )

    return all_projects


def list_gitlab_groups(credential_id):
    """
    List all GitLab visible groups for the authenticated user.
    This function paginates through the GitLab API to fetch all groups accessible to the user.
    It filters access levels to groups that the user can CRUD CI/CD variables.
    """

    if not validate_auth(credential_id):
        raise Exception(
            "Could not authenticate with GitLab. Please check that your credentials are valid"
        )

    GITLAB_HOST, GITLAB_TOKEN = get_gitlab_credentials(credential_id)

    headers = {"Private-Token": GITLAB_TOKEN}
    url = (
        f"{GITLAB_HOST}/api/v4/groups?membership=true&min_access_level=30&per_page=100"
    )
    all_groups = []

    while url:
        response = requests.get(url, headers=headers)
        if response.status_code != 200:
            return None

        groups = response.json()
        all_groups.extend(groups)

        next_page = response.headers.get("X-Next-Page")
        url = (
            f"{GITLAB_HOST}/api/v4/projects?membership=true&min_access_level=30&per_page=100&page={next_page}"
            if next_page
            else None
        )

    return all_groups


def extract_project_path(repo_url):
    """
    Extract the project or group path from the repository URL.
    This function uses a regular expression to parse the GitLab project or group path from a given URL.
    """
    repo_url = repo_url.rstrip("/")
    domain_match = re.search(r"https?://[^/]+/(.+)", repo_url)
    if not domain_match:
        return None
    return domain_match.group(1)


def sync_gitlab_secrets(
    secrets,
    credential_id,
    destination_url,
    is_group=False,
    is_masked=False,
    is_protected=False,
):
    """
    Sync secrets from secrets.json to the specified repository URL.
    This function handles pagination when fetching existing secrets and synchronizes
    the differences with secrets.json.
    """

    results = {}

    GITLAB_HOST, GITLAB_TOKEN = get_gitlab_credentials(credential_id)

    headers = {"Private-Token": GITLAB_TOKEN}
    destination_path = destination_url

    try:
        if not destination_path:
            raise ValueError("Error: Invalid project or group URL.")

        encoded_destination_path = urllib.parse.quote_plus(destination_path)
        base_url = f"{GITLAB_HOST}/api/v4/{'groups' if is_group else 'projects'}/{encoded_destination_path}/variables"

        # Fetch all existing GitLab secrets with pagination
        existing_secrets = {}
        page = 1
        while True:
            paginated_url = f"{base_url}?page={page}&per_page=100"
            response = requests.get(paginated_url, headers=headers)
            if response.status_code != 200:
                raise Exception(f"Error fetching existing secrets: {response.text}")

            secrets_page = response.json()
            if not secrets_page:
                break  # Exit loop if no more secrets are found

            existing_secrets.update({var["key"]: var for var in secrets_page})
            page += 1

        changes_made = False
        # Iterate through the secrets to be synced
        for key, value, comment in secrets:
            secret_specific_url = f"{base_url}/{urllib.parse.quote_plus(key)}"
            payload = {
                "value": value,
                "masked": is_masked,
                "protected": is_protected,
                "raw": True,
                "description": comment,
            }
            if key in existing_secrets:
                existing_secret = existing_secrets[key]
                if (
                    existing_secret["value"] != value
                    or existing_secret["masked"] != payload["masked"]
                    or existing_secret["protected"] != payload["protected"]
                    or existing_secret["description"] != payload["description"]
                ):
                    changes_made = True
                    update_response = requests.put(
                        secret_specific_url, headers=headers, json=payload
                    )
                    if update_response.status_code not in [200, 201]:
                        raise Exception(
                            f"Failed to update secret {key}: {update_response.text}"
                        )

            else:
                changes_made = True
                create_response = requests.post(
                    base_url, headers=headers, json={"key": key, **payload}
                )
                if create_response.status_code not in [200, 201]:
                    raise Exception(
                        f"Failed to create secret {key}: {create_response.text}"
                    )

        for key in existing_secrets:
            # if the key doesn't exist in the new secrets list then it should be deleted from gitlab
            if not any(secret[0] == key for secret in secrets):
                changes_made = True
                delete_specific_url = f"{base_url}/{urllib.parse.quote_plus(key)}"
                delete_response = requests.delete(delete_specific_url, headers=headers)
                if delete_response.status_code != 204:
                    raise Exception(
                        f"Failed to delete secret {key}: {delete_response.text}"
                    )

        success = True
        results["message"] = (
            "Secrets synchronized successfully."
            if changes_made
            else "No changes needed. Secrets are already synchronized."
        )
    except Exception as e:
        success = False
        results["error"] = f"An error occurred: {str(e)}"

    return success, results
