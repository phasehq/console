import requests
import time
from django.conf import settings


def write(key, value, meta):
    account_id = settings.CLOUDFLARE['ACCOUNT_ID']
    kv_namespace = settings.CLOUDFLARE['KV_NAMESPACE']
    api_key = settings.CLOUDFLARE['API_KEY']

    url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/storage/kv/namespaces/{kv_namespace}/bulk"

    payload = [
        {
            "base64": False,
            "key": key,
            "value": value,
            "metadata": meta
        }
    ]
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    }

    response = requests.request("PUT", url, json=payload, headers=headers)
    if response.status_code == 200:
        return True
    print('Error writing to KV:', response)
    return False


def delete(key):
    account_id = settings.CLOUDFLARE['ACCOUNT_ID']
    kv_namespace = settings.CLOUDFLARE['KV_NAMESPACE']
    api_key = settings.CLOUDFLARE['API_KEY']

    url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/storage/kv/namespaces/{kv_namespace}/values/{key}"

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    }

    response = requests.request("DELETE", url, headers=headers)

    if response.status_code == 200:
        return True
    print('Error deleting from KV:', response)
    return False


def purge(resource):
    api_key = settings.CLOUDFLARE['API_KEY']
    zone_id = settings.CLOUDFLARE['ZONE_ID']

    url = f"https://api.cloudflare.com/client/v4/zones/{zone_id}/purge_cache"

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    }

    payload = {
        "files": [f"https://kms.phase.dev/{resource}"]
    }

    responses = []
    
    responses.append(requests.request("POST", url, headers=headers, json=payload))

    time.sleep(0.1)

    responses.append(requests.request("POST", url, headers=headers, json=payload))

    time.sleep(0.1)

    responses.append(requests.request("POST", url, headers=headers, json=payload))

    for response in responses:
        if response.status_code != 200:
            print('Error purging from cache:', response)
            return False

    return True    
