import json
import requests
import graphene
from graphene import ObjectType
from .auth import CLOUDFLARE_API_BASE_URL, get_cloudflare_headers
from api.utils.crypto import decrypt_asymmetric, get_server_keypair

class CloudflareWorkerType(ObjectType):
    name = graphene.String()
    script_id = graphene.String()

def list_cloudflare_workers(ACCOUNT_ID, ACCESS_TOKEN):
    """List all Cloudflare workers."""
    url = f"{CLOUDFLARE_API_BASE_URL}/accounts/{ACCOUNT_ID}/workers/scripts"
    response = requests.get(url, headers=get_cloudflare_headers(ACCESS_TOKEN))
    if response.status_code == 200:
        workers = response.json().get("result", [])
        cf_workers = []
        for worker in workers:
            cf_workers.append({
                "name": worker["id"],
                "script_id": worker["id"]
            })
        return cf_workers
    elif response.status_code in [401, 403]:
        raise Exception("Error listing Cloudflare Workers: Incorrect credentials")
    else:
        raise Exception("Error listing Cloudflare Workers. Please verify that your credentials are correct.")

def get_cf_workers_credentials(environment_sync):
    pk, sk = get_server_keypair()
    account_id = decrypt_asymmetric(
        environment_sync.authentication.credentials["account_id"], sk.hex(), pk.hex()
    )
    access_token = decrypt_asymmetric(
        environment_sync.authentication.credentials["access_token"], sk.hex(), pk.hex()
    )
    return account_id, access_token

def sync_cloudflare_worker_secrets(secrets, ACCOUNT_ID, ACCESS_TOKEN, worker_name):
    """Sync secrets to Cloudflare worker."""
    try:
        url = f"{CLOUDFLARE_API_BASE_URL}/accounts/{ACCOUNT_ID}/workers/scripts/{worker_name}/secrets"
        
        # Get existing secrets
        response = requests.get(url, headers=get_cloudflare_headers(ACCESS_TOKEN))
        if response.status_code != 200:
            return False, {
                "response_code": response.status_code,
                "message": f"Error fetching worker secrets: {response.text}"
            }

        existing_secrets = {secret["name"]: secret for secret in response.json().get("result", [])}
        
        # Delete secrets not in the new set
        for secret_name in existing_secrets:
            if not any(key == secret_name for key, _, _ in secrets):
                delete_response = requests.delete(
                    f"{url}/{secret_name}",
                    headers=get_cloudflare_headers(ACCESS_TOKEN)
                )
                if delete_response.status_code != 200:
                    return False, {
                        "response_code": delete_response.status_code,
                        "message": f"Error deleting secret {secret_name}: {delete_response.text}"
                    }

        # Update or create secrets
        for key, value, _ in secrets:
            payload = {
                "name": key,
                "text": value,
                "type": "secret_text"
            }
            response = requests.put(
                url,
                headers=get_cloudflare_headers(ACCESS_TOKEN),
                json=payload
            )
            if response.status_code not in [200, 201]:
                return False, {
                    "response_code": response.status_code,
                    "message": f"Error syncing secret {key}: {response.text}"
                }

        return True, {
            "response_code": 200,
            "message": "Successfully synced secrets."
        }

    except requests.RequestException as e:
        return False, {"message": f"HTTP request error: {str(e)}"}
    except json.JSONDecodeError:
        return False, {"message": "Error decoding JSON response"}
    except Exception as e:
        return False, {"message": f"An unexpected error occurred: {str(e)}"} 