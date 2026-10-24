import json
import requests
import graphene
from graphene import ObjectType
from api.utils.syncing.auth import get_credentials

# Some Coolify instances sit behind Cloudflare, which rejects requests that
# carry the default python-requests User-Agent with a 403.
COOLIFY_USER_AGENT = "Phase-Console-Sync"

# Coolify manages variables with this prefix itself (magic variables such as
# SERVICE_FQDN_* for docker compose apps). They are never deleted by a sync.
COOLIFY_MANAGED_PREFIX = "SERVICE_"


class CoolifyApplicationType(ObjectType):
    id = graphene.ID(required=True)
    name = graphene.String(required=True)
    fqdn = graphene.String()


def normalize_coolify_url(url):
    """Return the API base URL for a Coolify instance.

    Accepts the instance URL with or without a trailing slash, scheme or
    /api/v1 suffix, e.g. "coolify.example.com", "https://coolify.example.com/"
    or "https://coolify.example.com/api/v1".
    """
    url = str(url or "").strip().rstrip("/")
    if not url:
        raise Exception("No Coolify URL provided")
    if not url.startswith(("http://", "https://")):
        url = f"https://{url}"
    if url.endswith("/api/v1"):
        url = url[: -len("/api/v1")]
    elif url.endswith("/api"):
        url = url[: -len("/api")]
    return f"{url.rstrip('/')}/api/v1"


def get_coolify_headers(api_token):
    return {
        "Authorization": f"Bearer {api_token}",
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": COOLIFY_USER_AGENT,
    }


def get_coolify_api_config(credential_id):
    credentials = get_credentials(credential_id)
    base_url = normalize_coolify_url(credentials.get("coolify_url"))
    headers = get_coolify_headers(credentials.get("api_token"))
    return base_url, headers


def list_coolify_applications(credential_id):
    """List all Coolify applications accessible with the given API token."""
    base_url, headers = get_coolify_api_config(credential_id)

    response = requests.get(f"{base_url}/applications", headers=headers)

    if response.status_code == 200:
        return [
            {
                "id": application["uuid"],
                "name": application["name"],
                "fqdn": application.get("fqdn"),
            }
            for application in response.json()
        ]
    elif response.status_code in [401, 403]:
        raise Exception("Error listing Coolify applications: Incorrect credentials")
    else:
        raise Exception(
            "Error listing Coolify applications. Please verify that your credentials are correct."
        )


def build_coolify_env_payload(secrets):
    """Build the bulk upsert payload for a set of secrets.

    Coolify stores a production and a preview copy of every variable, so each
    secret is written twice. Values are marked literal so Coolify doesn't
    interpolate "$VAR" or "{{ ... }}" references inside them, and multi-line
    values are flagged so Coolify keeps the line breaks.
    """
    payload = []
    for is_preview in [False, True]:
        for key, value, _ in secrets:
            payload.append(
                {
                    "key": key,
                    "value": value,
                    "is_preview": is_preview,
                    "is_literal": True,
                    "is_multiline": "\n" in value,
                    "is_shown_once": False,
                }
            )
    return payload


def sync_coolify_secrets(secrets, credential_id, application_uuid):
    """Sync secrets to a Coolify application's environment variables.

    Variables that exist in Coolify but not in Phase are deleted, except
    variables managed by Coolify itself. The application is not redeployed.
    """
    try:
        base_url, headers = get_coolify_api_config(credential_id)
        envs_url = f"{base_url}/applications/{application_uuid}/envs"

        phase_keys = {key for key, _, _ in secrets}

        response = requests.get(envs_url, headers=headers)
        if response.status_code != 200:
            return False, {
                "response_code": response.status_code,
                "message": f"Error fetching Coolify environment variables: {response.text}",
            }

        envs_to_delete = [
            env
            for env in response.json()
            if env["key"] not in phase_keys
            and not env["key"].startswith(COOLIFY_MANAGED_PREFIX)
        ]

        # Push before deleting so a failed write leaves the target intact
        payload = build_coolify_env_payload(secrets)
        if payload:
            upsert_response = requests.patch(
                f"{envs_url}/bulk", headers=headers, json={"data": payload}
            )
            if upsert_response.status_code not in [200, 201]:
                return False, {
                    "response_code": upsert_response.status_code,
                    "message": f"Error syncing secrets: {upsert_response.text}",
                }

        for env in envs_to_delete:
            delete_response = requests.delete(
                f"{envs_url}/{env['uuid']}", headers=headers
            )
            # 404: already gone, nothing left to do
            if delete_response.status_code not in [200, 204, 404]:
                return False, {
                    "response_code": delete_response.status_code,
                    "message": f"Error deleting Coolify environment variable {env['key']}: {delete_response.text}",
                }

        return True, {"response_code": 200, "message": "Successfully synced secrets."}

    except requests.RequestException as e:
        return False, {"message": f"HTTP request error: {str(e)}"}
    except json.JSONDecodeError:
        return False, {"message": "Error decoding JSON response"}
    except Exception as e:
        return False, {"message": f"An unexpected error occurred: {str(e)}"}
