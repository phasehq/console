import requests
from api.utils.syncing.auth import get_credentials
from graphene import ObjectType, String, ID, List, Field

RENDER_API_BASE_URL = "https://api.render.com/v1"


class RenderServiceType(ObjectType):
    id = ID(required=True)
    name = String(required=True)
    type = String()  # e.g., "web_service", "static_site", etc.
    region = String()
    repo = String()  # e.g., GitHub repo URL or name
    branch = String()
    created_at = String()
    updated_at = String()


def get_render_headers(credential_id):
    """
    Prepare headers for Render API requests with the necessary authentication token.
    """
    credentials = get_credentials(credential_id)
    api_key = credentials.get("api_key")

    return {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }


def list_render_services(credential_id):
    """
    List all Render services available under the account associated with the API key.
    Handles pagination using the 'cursor' field.
    API DOCS: https://api-docs.render.com/reference/get-services
    """
    url = f"{RENDER_API_BASE_URL}/services"
    headers = get_render_headers(credential_id)
    params = {}
    all_services = []
    cursor = None

    while True:
        if cursor:
            params["cursor"] = cursor
        else:
            params.pop("cursor", None)
        response = requests.get(url, headers=headers, params=params)
        if response.status_code == 200:
            data = response.json()
            if isinstance(data, list):
                for item in data:
                    service = item.get("service")
                    if service:
                        all_services.append(service)
                # Get cursor from the last item, if present
                last_cursor = data[-1].get("cursor") if data else None
                if last_cursor:
                    cursor = last_cursor
                else:
                    break
            else:
                print("Unexpected response format:", data)
                break
        else:
            print("Error listing services:", response.text)
            raise Exception(response.text)
    return all_services


def sync_render_service_env_vars(secrets, credential_id, service_id):
    """
    Sync environment variables to a Render service.
    This function overwrites all existing environment variables with the ones defined in `secrets.json`.
    There is a limit of 150 environment variables.
    """
    try:
        url = f"{RENDER_API_BASE_URL}/services/{service_id}/env-vars"
        headers = get_render_headers(credential_id)

        # Prepare the payload with environment variables from secrets.json
        payload = [{"key": key, "value": value} for key, value, _ in secrets]

        # Make the PUT request to overwrite the environment variables on Render service
        update_response = requests.put(url, headers=headers, json=payload)
        if update_response.status_code in [200, 204]:
            print("Successfully synced environment variables.")
            return True, {
                "response_code": update_response.status_code,
                "message": "Successfully synced secrets.",
            }
        else:
            print(f"Error syncing environment variables: {update_response.text}")
            raise Exception(update_response.text)
    except Exception as e:
        return False, {"message": f"Error syncing secrets: {str(e)}"}
