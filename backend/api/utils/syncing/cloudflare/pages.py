import json
import requests
from api.utils.crypto import decrypt_asymmetric, get_server_keypair
import graphene
from graphene import ObjectType
from .auth import CLOUDFLARE_API_BASE_URL, get_cloudflare_headers


class CloudFlarePagesType(ObjectType):
    name = graphene.String()
    deployment_id = graphene.String()
    environments = graphene.List(graphene.String)


# Function to list all Cloudflare pages. This is a straightforward API call
# that prints out details of all pages/projects within the Cloudflare account.
def list_cloudflare_pages(ACCOUNT_ID, ACCESS_TOKEN):
    """List all Cloudflare pages."""
    url = f"{CLOUDFLARE_API_BASE_URL}/accounts/{ACCOUNT_ID}/pages/projects"
    response = requests.get(url, headers=get_cloudflare_headers(ACCESS_TOKEN))
    if response.status_code == 200:
        projects = response.json().get("result", [])

        cf_projects = []

        for project in projects:
            cf_projects.append(
                {
                    "name": project["name"],
                    "deployment_id": project["id"],
                    "environments": project.get(
                        "environments", ["production", "preview"]
                    ),
                }
            )
        return cf_projects

    elif response.status_code == 401 or response.status_code == 403:
        raise Exception("Error listing Cloudflare Pages: Incorrect credentials")

    else:
        raise Exception(
            "Error listing Cloudflare Pages. Please verify that your credentials are correct."
        )


# TODO replace this with a generic util using the logic in the credential resolver for EnvironmentSyncType
def get_cf_pages_credentials(environment_sync):
    pk, sk = get_server_keypair()

    account_id = decrypt_asymmetric(
        environment_sync.authentication.credentials["account_id"], sk.hex(), pk.hex()
    )
    access_token = decrypt_asymmetric(
        environment_sync.authentication.credentials["access_token"], sk.hex(), pk.hex()
    )

    return account_id, access_token


# Function to synchronize the environment variables of a Cloudflare project
# with the local secrets.json file. It demonstrates a common pattern of
# fetching existing data, comparing it to the desired state, and making
# the necessary changes to reach that state.
def sync_cloudflare_secrets(
    secrets, ACCOUNT_ID, ACCESS_TOKEN, project_name, project_environment
):
    """Sync secrets to Cloudflare page."""
    try:
        url = f"{CLOUDFLARE_API_BASE_URL}/accounts/{ACCOUNT_ID}/pages/projects/{project_name}"

        response = requests.get(url, headers=get_cloudflare_headers(ACCESS_TOKEN))
        if response.status_code != 200:
            return False, {
                "response_code": response.status_code,
                "message": f"Error fetching project details: {response.text}",
            }

        project_data = response.json().get("result", {})
        existing_vars = (
            project_data.get("deployment_configs", {})
            .get(project_environment, {})
            .get("env_vars", {})
        )

        new_vars = {}
        for key, value, _ in secrets:
            new_vars[key] = {"type": "secret_text", "value": value}

        if existing_vars is not None:
            for existing_key in existing_vars:
                if not any(key == existing_key for key, _, _ in secrets):
                    new_vars[existing_key] = None

        payload = {
            "deployment_configs": {
                project_environment: {
                    "compatibility_date": "2022-01-01",
                    "compatibility_flags": ["url_standard"],
                    "env_vars": new_vars,
                }
            }
        }

        update_response = requests.patch(
            url, headers=get_cloudflare_headers(ACCESS_TOKEN), json=payload
        )
        if update_response.status_code == 200:
            return True, {
                "response_code": update_response.status_code,
                "message": "Successfully synced secrets.",
            }
        else:
            return False, {
                "response_code": update_response.status_code,
                "message": f"Error syncing secrets: {update_response.text}",
            }

    except requests.RequestException as e:
        return False, {"message": f"HTTP request error: {str(e)}"}
    except json.JSONDecodeError:
        return False, {"message": "Error decoding JSON response"}
    except Exception as e:
        return False, {"message": f"An unexpected error occurred: {str(e)}"}
