from api.utils.crypto import decrypt_asymmetric, get_server_keypair
import requests
import json
from api.utils.syncing.auth import store_oauth_token
import graphene
from graphene import ObjectType
import os
import nacl.encoding
import nacl.public
import base64
import datetime
from django.apps import apps

GITHUB_API_URL = "https://api.github.com"


class GitHubRepoType(ObjectType):
    name = graphene.String()
    owner = graphene.String()
    type = graphene.String()


def list_repos(credential_id):
    ProviderCredentials = apps.get_model("api", "ProviderCredentials")

    pk, sk = get_server_keypair()

    credential = ProviderCredentials.objects.get(id=credential_id)

    access_token = decrypt_asymmetric(
        credential.credentials["access_token"], sk.hex(), pk.hex()
    )

    def fetch_repos(url, token):
        headers = {"Authorization": f"Bearer {token}"}
        response = requests.get(url, headers=headers)
        return response

    def serialize_repos(repos):
        repo_list = []
        for repo in repos:
            repo_list.append(
                {
                    "name": repo["name"],
                    "owner": repo["owner"]["login"],
                    "type": "private" if repo["private"] else "public",
                }
            )
        return repo_list

    all_repos = []

    # Fetch user repos
    user_repos_response = fetch_repos(
        f"{GITHUB_API_URL}/user/repos?per_page=100&type=all", access_token
    )
    if user_repos_response.status_code == 200:
        all_repos.extend(serialize_repos(user_repos_response.json()))
    else:
        raise Exception(f"Error fetching user repositories: {user_repos_response.text}")

    return all_repos


def get_gh_actions_credentials(environment_sync):
    pk, sk = get_server_keypair()

    access_token = decrypt_asymmetric(
        environment_sync.authentication.credentials["access_token"], sk.hex(), pk.hex()
    )

    return access_token


def encrypt_secret(public_key: str, secret_value: str) -> str:
    """
    Encrypts a secret using the repository's public key. This is necessary before storing the secret in GitHub.
    """
    pk = nacl.public.PublicKey(public_key, nacl.encoding.Base64Encoder())
    box = nacl.public.SealedBox(pk)
    encrypted = box.encrypt(secret_value.encode())
    return base64.b64encode(encrypted).decode("utf-8")


def check_rate_limit(access_token):
    """
    Checks the current rate limit status with GitHub.
    """
    headers = {"Authorization": f"token {access_token}"}
    response = requests.get(f"{GITHUB_API_URL}/rate_limit", headers=headers)
    rate_limit = response.json().get("resources", {}).get("core", {})
    if rate_limit.get("remaining", 1) == 0:
        print(
            f"Rate limit exceeded. Try again after {datetime.fromtimestamp(rate_limit.get('reset'))}."
        )
        return False
    return True


def get_all_secrets(repo, owner, headers):
    """
    Retrieves all secrets from a GitHub repository, handling pagination.
    """
    all_secrets = []
    page = 1
    while True:
        response = requests.get(
            f"{GITHUB_API_URL}/repos/{owner}/{repo}/actions/secrets?page={page}",
            headers=headers,
        )
        if response.status_code != 200 or not response.json().get("secrets"):
            break
        all_secrets.extend(response.json()["secrets"])
        page += 1
    return all_secrets


def sync_github_secrets(secrets, access_token, repo, owner):
    try:
        if not check_rate_limit(access_token):
            return False, {"message": "Rate limit exceeded"}

        headers = {
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/vnd.github+json",
        }

        # Fetch public key for encryption
        public_key_response = requests.get(
            f"{GITHUB_API_URL}/repos/{owner}/{repo}/actions/secrets/public-key",
            headers=headers,
        )
        if public_key_response.status_code != 200:
            return False, {
                "response_code": public_key_response.status_code,
                "message": f"Failed to fetch repository public key: {public_key_response.text}",
            }

        public_key = public_key_response.json()
        key_id = public_key["key_id"]
        public_key_value = public_key["key"]

        # Convert secrets list of tuples to a dictionary
        local_secrets = {k: v for k, v, _ in secrets}

        # Fetch all existing secrets
        existing_secrets = get_all_secrets(repo, owner, headers)
        existing_secret_names = {secret["name"] for secret in existing_secrets}

        # Update and create secrets
        for key, value in local_secrets.items():
            encrypted_value = encrypt_secret(public_key_value, value)
            if (
                len(encrypted_value) > 64 * 1024
            ):  # Check if encrypted value exceeds 64 KB
                continue  # Skipping oversized secret

            secret_data = {"encrypted_value": encrypted_value, "key_id": key_id}
            secret_url = f"{GITHUB_API_URL}/repos/{owner}/{repo}/actions/secrets/{key}"
            response = requests.put(secret_url, headers=headers, json=secret_data)

            if response.status_code not in [201, 204]:
                return False, {
                    "response_code": response.status_code,
                    "message": f"Error syncing secret '{key}': {response.text}",
                }

        # Delete secrets not in local file
        for secret_name in existing_secret_names:
            if secret_name not in local_secrets:
                delete_url = f"{GITHUB_API_URL}/repos/{owner}/{repo}/actions/secrets/{secret_name}"
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
        return False, {"message": f"An unexpected error occurred: {str(e)}"}
