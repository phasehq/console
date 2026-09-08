import json
import requests
import graphene
from graphene import ObjectType
from api.utils.syncing.auth import get_credentials

SUPABASE_API_BASE_URL = "https://api.supabase.com/v1"

# Names with this prefix are reserved by Supabase and can't be set or deleted
# via the Management API.
SUPABASE_RESERVED_PREFIX = "SUPABASE_"

# The Management API caps bulk secret creation at 100 items per request.
SUPABASE_SECRETS_BATCH_SIZE = 100


class SupabaseProjectType(ObjectType):
    id = graphene.ID(required=True)
    name = graphene.String(required=True)
    region = graphene.String()


def get_supabase_headers(access_token):
    return {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }


def list_supabase_projects(credential_id):
    """List all Supabase projects accessible with the given access token."""
    credentials = get_credentials(credential_id)
    access_token = credentials.get("access_token")

    response = requests.get(
        f"{SUPABASE_API_BASE_URL}/projects",
        headers=get_supabase_headers(access_token),
    )

    if response.status_code == 200:
        return [
            {
                # "id" is deprecated upstream in favour of "ref"
                "id": project.get("ref") or project["id"],
                "name": project["name"],
                "region": project.get("region"),
            }
            for project in response.json()
        ]
    elif response.status_code in [401, 403]:
        raise Exception("Error listing Supabase projects: Incorrect credentials")
    else:
        raise Exception(
            "Error listing Supabase projects. Please verify that your credentials are correct."
        )


def sync_supabase_secrets(secrets, credential_id, project_ref):
    """Sync secrets to a Supabase project as Edge Function secrets."""
    try:
        credentials = get_credentials(credential_id)
        access_token = credentials.get("access_token")

        headers = get_supabase_headers(access_token)
        url = f"{SUPABASE_API_BASE_URL}/projects/{project_ref}/secrets"

        response = requests.get(url, headers=headers)
        if response.status_code != 200:
            return False, {
                "response_code": response.status_code,
                "message": f"Error fetching Supabase secrets: {response.text}",
            }

        existing_names = {secret["name"] for secret in response.json()}

        phase_keys = {key for key, _, _ in secrets}
        skipped_keys = sorted(
            key for key in phase_keys if key.startswith(SUPABASE_RESERVED_PREFIX)
        )

        names_to_delete = [
            name
            for name in existing_names
            if name not in phase_keys and not name.startswith(SUPABASE_RESERVED_PREFIX)
        ]

        if names_to_delete:
            delete_response = requests.delete(url, headers=headers, json=names_to_delete)
            if delete_response.status_code != 200:
                return False, {
                    "response_code": delete_response.status_code,
                    "message": f"Error deleting Supabase secrets: {delete_response.text}",
                }

        payload = [
            {"name": key, "value": value}
            for key, value, _ in secrets
            if not key.startswith(SUPABASE_RESERVED_PREFIX)
        ]

        for i in range(0, len(payload), SUPABASE_SECRETS_BATCH_SIZE):
            batch = payload[i : i + SUPABASE_SECRETS_BATCH_SIZE]
            create_response = requests.post(url, headers=headers, json=batch)
            if create_response.status_code not in [200, 201]:
                return False, {
                    "response_code": create_response.status_code,
                    "message": f"Error syncing secrets: {create_response.text}",
                }

        message = "Successfully synced secrets."
        if skipped_keys:
            message += (
                f" Skipped reserved keys: {', '.join(skipped_keys)}."
            )

        return True, {"response_code": 200, "message": message}

    except requests.RequestException as e:
        return False, {"message": f"HTTP request error: {str(e)}"}
    except json.JSONDecodeError:
        return False, {"message": "Error decoding JSON response"}
    except Exception as e:
        return False, {"message": f"An unexpected error occurred: {str(e)}"}
