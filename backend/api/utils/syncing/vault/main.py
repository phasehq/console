from api.utils.syncing.auth import get_credentials
from hvac import Client as VaultClient, exceptions as hvac_exceptions
import graphene


class VaultMountType(graphene.ObjectType):
    name = graphene.String()
    description = graphene.String()
    id = graphene.ID()


def authenticate_vault_client(credential_id):
    """Authenticate with Vault using AppRole credentials."""

    credentials = get_credentials(credential_id)

    VAULT_ADDR = credentials["vault_addr"]
    VAULT_ROLE_ID = credentials["vault_role_id"]
    VAULT_SECRET_ID = credentials["vault_secret_id"]
    VAULT_NAMESPACE = credentials.get("vault_namespace", "")

    client = VaultClient(url=VAULT_ADDR, namespace=VAULT_NAMESPACE)
    client.auth.approle.login(role_id=VAULT_ROLE_ID, secret_id=VAULT_SECRET_ID)
    return client


def renew_vault_token(client):
    """Renew the Vault token if necessary."""
    try:
        token_info = client.lookup_token()
        ttl_remaining = token_info["data"]["ttl"]

        # Renew token if TTL is below a threshold (e.g., 10 minutes)
        if ttl_remaining < 600:
            client.renew_self_token()
    except hvac_exceptions.VaultError as e:
        print(f"Error renewing token: {e}")
        raise


def test_vault_creds(credential_id):
    """Test the credentials for HashiCorp Vault."""
    client = authenticate_vault_client(credential_id)
    renew_vault_token(client)
    try:
        # Attempt a simple read operation as a test
        client.sys.read_health_status(method="GET")
        return True
    except hvac_exceptions.VaultError as e:
        return False


def sync_vault_secrets(secrets, credential_id, engine, path):
    results = {}
    success = True

    try:
        client = authenticate_vault_client(credential_id)
        renew_vault_token(client)

        # Add 'data/' prefix to the adjusted_path
        adjusted_path = f"data/{path.lstrip('/')}"

        try:
            list_response = client.secrets.kv.v2.list_secrets(
                mount_point=engine, path=adjusted_path
            )
            existing_keys = set(key for key in list_response["data"].get("keys", []))
        except hvac_exceptions.InvalidPath as e:
            existing_keys = set()
            pass

        secrets_dict = {k: v for k, v, _ in secrets}

        for key, value in secrets_dict.items():
            secret_path = f"data/{path.lstrip('/')}/{key}"
            client.secrets.kv.v2.create_or_update_secret(
                mount_point=engine, path=secret_path, secret={key: value}
            )
            existing_keys.discard(key)

        for key in existing_keys:
            delete_path = f"data/{path.lstrip('/')}/{key}"
            client.secrets.kv.v2.delete_metadata_and_all_versions(
                mount_point=engine, path=delete_path
            )

        results["message"] = f"Secrets successfully synced to Vault path: {path}"

    except Exception as e:
        success = False
        results["error"] = f"An error occurred: {str(e)}"

    return success, results
