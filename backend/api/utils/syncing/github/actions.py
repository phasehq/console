from api.utils.crypto import decrypt_asymmetric, get_server_keypair
import requests
import json
import graphene
from graphene import ObjectType
import nacl.encoding
import nacl.public
import base64
import datetime
from django.apps import apps

GITHUB_CLOUD_API_URL = "https://api.github.com"


class GitHubRepoType(ObjectType):
    name = graphene.String()
    owner = graphene.String()
    type = graphene.String()


def normalize_api_host(api_host):
    if not api_host or api_host.strip() == "":
        api_host = GITHUB_CLOUD_API_URL

    stripped_host = api_host.rstrip("/")

    if stripped_host == GITHUB_CLOUD_API_URL.rstrip("/"):
        return stripped_host
    else:
        if not stripped_host.endswith("/v3"):
            return f"{stripped_host}/v3"  # Add version if not present
        return stripped_host


def list_repos(credential_id):
    ProviderCredentials = apps.get_model("api", "ProviderCredentials")

    pk, sk = get_server_keypair()
    credential = ProviderCredentials.objects.get(id=credential_id)

    access_token = decrypt_asymmetric(
        credential.credentials["access_token"], sk.hex(), pk.hex()
    )

    api_host = GITHUB_CLOUD_API_URL
    if "host" in credential.credentials:
        api_host = decrypt_asymmetric(
            credential.credentials["api_url"], sk.hex(), pk.hex()
        )

    api_host = normalize_api_host(api_host)

    def fetch_repos(url, token):
        headers = {"Authorization": f"Bearer {token}"}
        response = requests.get(url, headers=headers)
        return response

    def serialize_repos(repos):
        return [
            {
                "name": repo["name"],
                "owner": repo["owner"]["login"],
                "type": "private" if repo["private"] else "public",
            }
            for repo in repos
        ]

    all_repos = []

    # Fetch all user repos
    page = 1
    while True:
        user_repos_response = fetch_repos(
            f"{api_host}/user/repos?per_page=100&type=all&page={page}", access_token
        )
        if user_repos_response.status_code == 200:
            repos_on_page = user_repos_response.json()
            if not repos_on_page:  # No more repos on this page
                break
            all_repos.extend(serialize_repos(repos_on_page))
            page += 1
        else:
            raise Exception(
                f"Error fetching user repositories: {user_repos_response.text}"
            )

    return all_repos


def get_gh_actions_credentials(environment_sync):
    pk, sk = get_server_keypair()

    access_token = decrypt_asymmetric(
        environment_sync.authentication.credentials["access_token"], sk.hex(), pk.hex()
    )

    api_host = GITHUB_CLOUD_API_URL

    if "api_url" in environment_sync.authentication.credentials:
        api_host = decrypt_asymmetric(
            environment_sync.authentication.credentials["api_url"], sk.hex(), pk.hex()
        )

    api_host = normalize_api_host(api_host)
    return access_token, api_host


def list_environments(credential_id, owner, repo_name):
    """Return a list of GitHub Actions environment names for a repo.

    This requires at least the `repo` scope on the OAuth token.
    """
    ProviderCredentials = apps.get_model("api", "ProviderCredentials")

    pk, sk = get_server_keypair()
    credential = ProviderCredentials.objects.get(id=credential_id)

    access_token = decrypt_asymmetric(
        credential.credentials["access_token"], sk.hex(), pk.hex()
    )

    api_host = GITHUB_CLOUD_API_URL
    if "host" in credential.credentials:
        api_host = decrypt_asymmetric(
            credential.credentials["api_url"], sk.hex(), pk.hex()
        )

    api_host = normalize_api_host(api_host)

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Accept": "application/vnd.github+json",
    }

    environments = []
    page = 1
    while True:
        url = f"{api_host}/repos/{owner}/{repo_name}/environments?per_page=100&page={page}"
        response = requests.get(url, headers=headers)
        if response.status_code != 200:
            raise Exception(
                f"Error fetching environments: {response.status_code} {response.text}"
            )

        payload = response.json()
        items = payload.get("environments", [])
        if not items:
            break
        environments.extend([env.get("name") for env in items if env.get("name")])
        page += 1

    return environments


def encrypt_secret(public_key: str, secret_value: str) -> str:
    pk = nacl.public.PublicKey(public_key, nacl.encoding.Base64Encoder())
    box = nacl.public.SealedBox(pk)
    encrypted = box.encrypt(secret_value.encode())
    return base64.b64encode(encrypted).decode("utf-8")


def check_rate_limit(access_token, api_host=GITHUB_CLOUD_API_URL):
    api_host = normalize_api_host(api_host)
    headers = {"Authorization": f"token {access_token}"}
    response = requests.get(f"{api_host}/rate_limit", headers=headers)
    rate_limit = response.json().get("resources", {}).get("core", {})
    if rate_limit.get("remaining", 1) == 0:
        print(
            f"Rate limit exceeded. Try again after {datetime.datetime.fromtimestamp(rate_limit.get('reset'))}."
        )
        return False
    return True


def get_all_secrets(repo, owner, headers, api_host=GITHUB_CLOUD_API_URL):
    api_host = normalize_api_host(api_host)
    all_secrets = []
    page = 1
    while True:
        response = requests.get(
            f"{api_host}/repos/{owner}/{repo}/actions/secrets?page={page}",
            headers=headers,
        )
        if response.status_code != 200 or not response.json().get("secrets"):
            break
        all_secrets.extend(response.json()["secrets"])
        page += 1
    return all_secrets


def get_all_env_secrets(
    repo, owner, environment_name, headers, api_host=GITHUB_CLOUD_API_URL
):
    api_host = normalize_api_host(api_host)
    all_secrets = []
    page = 1
    while True:
        response = requests.get(
            f"{api_host}/repos/{owner}/{repo}/environments/{environment_name}/secrets?page={page}",
            headers=headers,
        )
        if response.status_code != 200 or not response.json().get("secrets"):
            break
        all_secrets.extend(response.json()["secrets"])
        page += 1
    return all_secrets


def sync_github_secrets(
    secrets,
    access_token,
    repo,
    owner,
    api_host=GITHUB_CLOUD_API_URL,
    environment_name=None,
):
    api_host = normalize_api_host(api_host)

    try:
        if not check_rate_limit(access_token, api_host):
            return False, {"message": "Rate limit exceeded"}

        headers = {
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/vnd.github+json",
        }

        if environment_name:
            public_key_url = f"{api_host}/repos/{owner}/{repo}/environments/{environment_name}/secrets/public-key"
        else:
            public_key_url = (
                f"{api_host}/repos/{owner}/{repo}/actions/secrets/public-key"
            )

        public_key_response = requests.get(public_key_url, headers=headers)
        if public_key_response.status_code != 200:
            if public_key_response.status_code == 404:
                return False, {
                    "response_code": public_key_response.status_code,
                    "message": "Unable to access repository. Please verify the repository exists and your access token has the required permissions (Secrets: Read and write, Environments: Read-only).",
                }
            return False, {
                "response_code": public_key_response.status_code,
                "message": f"Failed to fetch repository public key: {public_key_response.text}",
            }

        public_key = public_key_response.json()
        key_id = public_key["key_id"]
        public_key_value = public_key["key"]

        local_secrets = {k: v for k, v, _ in secrets}
        if environment_name:
            existing_secrets = get_all_env_secrets(
                repo, owner, environment_name, headers, api_host
            )
        else:
            existing_secrets = get_all_secrets(repo, owner, headers, api_host)
        existing_secret_names = {secret["name"] for secret in existing_secrets}

        for key, value in local_secrets.items():
            encrypted_value = encrypt_secret(public_key_value, value)
            if len(encrypted_value) > 64 * 1024:
                continue  # Skip oversized secret

            secret_data = {"encrypted_value": encrypted_value, "key_id": key_id}
            if environment_name:
                secret_url = f"{api_host}/repos/{owner}/{repo}/environments/{environment_name}/secrets/{key}"
            else:
                secret_url = f"{api_host}/repos/{owner}/{repo}/actions/secrets/{key}"
            response = requests.put(secret_url, headers=headers, json=secret_data)

            if response.status_code not in [201, 204]:
                return False, {
                    "response_code": response.status_code,
                    "message": f"Error syncing secret '{key}': {response.text}",
                }

        for secret_name in existing_secret_names:
            if secret_name not in local_secrets:
                if environment_name:
                    delete_url = f"{api_host}/repos/{owner}/{repo}/environments/{environment_name}/secrets/{secret_name}"
                else:
                    delete_url = (
                        f"{api_host}/repos/{owner}/{repo}/actions/secrets/{secret_name}"
                    )
                delete_response = requests.delete(delete_url, headers=headers)
                if delete_response.status_code != 204:
                    return False, {
                        "response_code": delete_response.status_code,
                        "message": f"Error deleting secret '{secret_name}': {delete_response.text}",
                    }

        return True, {"message": "Secrets synced successfully"}

    except requests.RequestException as e:
        return False, {"message": f"HTTP request error: {str(e)}"}
    except json.JSONDecodeError:
        return False, {"message": "Error decoding JSON response"}
    except Exception as e:
        import traceback

        traceback.print_exc()
        return False, {"message": f"An unexpected error occurred: {str(e)}"}
