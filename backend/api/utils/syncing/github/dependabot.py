import json
import requests

from .actions import normalize_api_host, check_rate_limit, encrypt_secret

GITHUB_CLOUD_API_URL = "https://api.github.com"


def get_all_dependabot_repo_secrets(
    repo, owner, headers, api_host=GITHUB_CLOUD_API_URL
):
    api_host = normalize_api_host(api_host)
    all_secrets = []
    page = 1
    while True:
        response = requests.get(
            f"{api_host}/repos/{owner}/{repo}/dependabot/secrets?page={page}",
            headers=headers,
        )
        if response.status_code != 200:
            break
        try:
            data = response.json()
        except json.JSONDecodeError:
            break
        if not data.get("secrets"):
            break
        all_secrets.extend(data["secrets"])
        page += 1
    return all_secrets


def get_all_dependabot_org_secrets(org, headers, api_host=GITHUB_CLOUD_API_URL):
    api_host = normalize_api_host(api_host)
    all_secrets = []
    page = 1
    while True:
        response = requests.get(
            f"{api_host}/orgs/{org}/dependabot/secrets?page={page}",
            headers=headers,
        )
        if response.status_code != 200:
            break
        try:
            data = response.json()
        except json.JSONDecodeError:
            break
        if not data.get("secrets"):
            break
        all_secrets.extend(data["secrets"])
        page += 1
    return all_secrets


def sync_github_dependabot_secrets(
    secrets,
    access_token,
    repo,
    owner,
    api_host=GITHUB_CLOUD_API_URL,
):
    api_host = normalize_api_host(api_host)

    try:
        if not check_rate_limit(access_token, api_host):
            return False, {"message": "Rate limit exceeded"}

        headers = {
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/vnd.github+json",
        }

        public_key_url = (
            f"{api_host}/repos/{owner}/{repo}/dependabot/secrets/public-key"
        )

        public_key_response = requests.get(public_key_url, headers=headers)
        if public_key_response.status_code != 200:
            if public_key_response.status_code == 404:
                return False, {
                    "response_code": public_key_response.status_code,
                    "message": "Unable to access repository. Please verify the repository exists and your access token has the required permissions (Dependabot secrets read/write).",
                }
            return False, {
                "response_code": public_key_response.status_code,
                "message": f"Failed to fetch repository public key: {public_key_response.text}",
            }

        public_key = public_key_response.json()
        key_id = public_key["key_id"]
        public_key_value = public_key["key"]

        local_secrets = {k: v for k, v, _ in secrets}
        existing_secrets = get_all_dependabot_repo_secrets(
            repo, owner, headers, api_host
        )
        existing_secret_names = {secret["name"] for secret in existing_secrets}

        for key, value in local_secrets.items():
            encrypted_value = encrypt_secret(public_key_value, value)
            if len(encrypted_value) > 64 * 1024:
                message = (
                    f"Secret '{key}' is too large to sync. GitHub Dependabot has a limit of 64KB for secrets."
                )
                return False, {"message": message}

            secret_data = {"encrypted_value": encrypted_value, "key_id": key_id}
            secret_url = f"{api_host}/repos/{owner}/{repo}/dependabot/secrets/{key}"
            response = requests.put(secret_url, headers=headers, json=secret_data)

            if response.status_code not in [201, 204]:
                return False, {
                    "response_code": response.status_code,
                    "message": f"Error syncing secret '{key}': {response.text}",
                }

        for secret_name in existing_secret_names:
            if secret_name not in local_secrets:
                delete_url = (
                    f"{api_host}/repos/{owner}/{repo}/dependabot/secrets/{secret_name}"
                )
                delete_response = requests.delete(delete_url, headers=headers)
                if delete_response.status_code != 204:
                    return False, {
                        "response_code": delete_response.status_code,
                        "message": f"Error deleting secret '{secret_name}': {delete_response.text}",
                    }

        return True, {"message": "Dependabot secrets synced successfully"}

    except requests.RequestException as e:
        return False, {"message": f"HTTP request error: {str(e)}"}
    except json.JSONDecodeError:
        return False, {"message": "Error decoding JSON response"}
    except Exception as e:
        import traceback

        traceback.print_exc()
        return False, {"message": f"An unexpected error occurred: {str(e)}"}


def sync_github_dependabot_org_secrets(
    secrets,
    access_token,
    org,
    api_host=GITHUB_CLOUD_API_URL,
    visibility="all",
):
    api_host = normalize_api_host(api_host)

    try:
        if not check_rate_limit(access_token, api_host):
            return False, {"message": "Rate limit exceeded"}

        headers = {
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/vnd.github+json",
        }

        public_key_url = f"{api_host}/orgs/{org}/dependabot/secrets/public-key"

        public_key_response = requests.get(public_key_url, headers=headers)
        if public_key_response.status_code != 200:
            if public_key_response.status_code == 404:
                return False, {
                    "response_code": public_key_response.status_code,
                    "message": "Unable to access organization. Please verify the organization exists and your access token has the required permissions (Dependabot secrets read/write).",
                }
            return False, {
                "response_code": public_key_response.status_code,
                "message": f"Failed to fetch organization public key: {public_key_response.text}",
            }

        public_key = public_key_response.json()
        key_id = public_key["key_id"]
        public_key_value = public_key["key"]

        local_secrets = {k: v for k, v, _ in secrets}
        existing_secrets = get_all_dependabot_org_secrets(org, headers, api_host)
        existing_secret_names = {secret["name"] for secret in existing_secrets}

        for key, value in local_secrets.items():
            encrypted_value = encrypt_secret(public_key_value, value)
            if len(encrypted_value) > 64 * 1024:
                message = (
                    f"Secret '{key}' is too large to sync. GitHub Dependabot has a limit of 64KB for secrets."
                )
                return False, {"message": message}

            secret_data = {
                "encrypted_value": encrypted_value,
                "key_id": key_id,
                "visibility": visibility or "all",
            }
            secret_url = f"{api_host}/orgs/{org}/dependabot/secrets/{key}"
            response = requests.put(secret_url, headers=headers, json=secret_data)

            if response.status_code not in [201, 204]:
                return False, {
                    "response_code": response.status_code,
                    "message": f"Error syncing secret '{key}': {response.text}",
                }

        for secret_name in existing_secret_names:
            if secret_name not in local_secrets:
                delete_url = f"{api_host}/orgs/{org}/dependabot/secrets/{secret_name}"
                delete_response = requests.delete(delete_url, headers=headers)
                if delete_response.status_code != 204:
                    return False, {
                        "response_code": delete_response.status_code,
                        "message": f"Error deleting secret '{secret_name}': {delete_response.text}",
                    }

        return True, {"message": "Dependabot secrets synced successfully"}

    except requests.RequestException as e:
        return False, {"message": f"HTTP request error: {str(e)}"}
    except json.JSONDecodeError:
        return False, {"message": "Error decoding JSON response"}
    except Exception as e:
        import traceback

        traceback.print_exc()
        return False, {"message": f"An unexpected error occurred: {str(e)}"}

