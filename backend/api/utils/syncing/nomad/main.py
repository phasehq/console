from api.utils.syncing.auth import get_credentials
import requests
import re


def get_nomad_token_info(credential_id):
    """Get info for a given nomad token."""

    credentials = get_credentials(credential_id)

    NOMAD_ADDR = credentials["nomad_addr"]
    NOMAD_TOKEN = credentials["nomad_token_secret"]

    session = requests.Session()
    session.headers.update(
        {
            "Authorization": f"Bearer {NOMAD_TOKEN}",
            "Content-Type": "application/json",
        }
    )

    url = f"{NOMAD_ADDR}/v1/acl/token/self"
    response = session.get(url)
    response.raise_for_status()
    return response.json()


def test_nomad_creds(credential_id):
    """Test Nomad credentials by attempting to get token info."""
    try:
        get_nomad_token_info(credential_id)
        return True
    except requests.HTTPError as e:
        return False


def sync_nomad_secrets(secrets, credential_id, path, namespace="default"):
    results = {}

    if not secrets or len(secrets) == 0:
        results["error"] = "Error: No secrets to sync."
        return False, results

    try:
        secrets_dict = dict(secrets)

        # Regex to validate the path
        path_regex = re.compile(r"^[a-zA-Z0-9-_~/]{1,128}$")

        # Normalize and check the path
        safe_path = path.strip("/").replace("//", "/")
        if not path_regex.match(safe_path):
            raise ValueError(
                f"Invalid path: {safe_path}. Path must match the pattern [a-zA-Z0-9-_~/]{{1,128}}."
            )

        credentials = get_credentials(credential_id)

        NOMAD_ADDR = credentials["nomad_addr"]
        NOMAD_TOKEN = credentials["nomad_token_secret"]

        session = requests.Session()
        session.headers.update(
            {
                "Authorization": f"Bearer {NOMAD_TOKEN}",
                "Content-Type": "application/json",
            }
        )

        url = f"{NOMAD_ADDR}/v1/var/{safe_path}?namespace={namespace}"

        # All secrets are included under the 'Items' field in the payload
        payload = {
            "Namespace": namespace,
            "Path": safe_path,
            "Items": secrets_dict,
        }

        response = session.put(url, json=payload)

        response.raise_for_status()

        success = True
        results["message"] = (
            f"All secrets successfully synced to Nomad at path: {safe_path} in namespace: {namespace}."
        )

    except Exception as e:
        success = False
        results["error"] = f"An error occurred: {str(e)}"

    return success, results
