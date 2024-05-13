from api.utils.syncing.auth import get_credentials
import requests
import re


def list_nomad_variables(credential_id):
    """List all variables in a given namespace."""

    credentials = get_credentials(credential_id)

    NOMAD_ADDR = credentials["nomad_addr"]
    NOMAD_TOKEN = credentials["nomad_token"]
    NOMAD_NAMESPACE = credentials.get("nomad_namespace", "default")
    if not NOMAD_NAMESPACE:
        NOMAD_NAMESPACE = "default"

    session = requests.Session()
    session.headers.update(
        {
            "Authorization": f"Bearer {NOMAD_TOKEN}",
            "Content-Type": "application/json",
        }
    )

    url = f"{NOMAD_ADDR}/v1/vars?namespace={NOMAD_NAMESPACE}"
    response = session.get(url)
    response.raise_for_status()
    return response.json()


def test_nomad_creds(credential_id):
    """Test Nomad credentials by attempting a list operation."""

    try:
        list_nomad_variables(credential_id)
        return True
    except requests.HTTPError as e:
        return False


def sync_nomad_secrets(secrets, credential_id, path):
    results = {}

    if not secrets or len(secrets) == 0:
        results["error"] = "Error: No secrets to sync. The secrets.json file is empty."
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
        NOMAD_TOKEN = credentials["nomad_token"]
        NOMAD_NAMESPACE = credentials.get("nomad_namespace", "default")
        if not NOMAD_NAMESPACE:
            NOMAD_NAMESPACE = "default"

        session = requests.Session()
        session.headers.update(
            {
                "Authorization": f"Bearer {NOMAD_TOKEN}",
                "Content-Type": "application/json",
            }
        )

        url = f"{NOMAD_ADDR}/v1/var/{safe_path}?namespace={NOMAD_NAMESPACE}"

        # All secrets are included under the 'Items' field in the payload
        payload = {
            "Namespace": NOMAD_NAMESPACE,
            "Path": safe_path,
            "Items": secrets_dict,
        }

        response = session.put(url, json=payload)

        response.raise_for_status()

        success = True
        results["message"] = (
            f"All secrets successfully synced to Nomad at path: {safe_path} in namespace: {NOMAD_NAMESPACE}."
        )

    except Exception as e:
        success = False
        results["error"] = f"An error occurred: {str(e)}"

    return success, results
