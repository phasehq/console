import re
import json
import time
import logging
import graphene
from graphene import ObjectType
from azure.core.exceptions import HttpResponseError, ResourceNotFoundError

from .auth import get_azure_client_credential, get_kv_client

logger = logging.getLogger(__name__)

AZURE_KV_URI_PATTERN = re.compile(
    r"^https://[a-zA-Z](?!.*--)[a-zA-Z0-9-]{1,22}[a-zA-Z0-9]\.vault\."
    r"(azure\.net"            # Public cloud
    r"|usgovcloudapi\.net"    # US Government
    r"|azure\.cn"             # China (21Vianet)
    r")/?$"
)


def validate_vault_uri(vault_uri):
    """Validate and normalize an Azure Key Vault URI.

    Supports all Azure cloud environments (public, government, China, Germany).
    Returns the normalized URI (trailing slash stripped).
    Raises ValueError if the URI is invalid.
    """
    if not vault_uri:
        raise ValueError("Vault URI is required")
    vault_uri = vault_uri.rstrip("/")
    if not AZURE_KV_URI_PATTERN.match(vault_uri + "/"):
        raise ValueError(
            "Invalid Vault URI. Expected format: https://<vault-name>.vault.azure.net"
        )
    return vault_uri


class AzureKeyVaultSecretType(ObjectType):
    name = graphene.String()
    updated_on = graphene.DateTime()
    content_type = graphene.String()


def _retry_on_rate_limit(func, *args, max_retries=3, **kwargs):
    """Retry a function call with exponential backoff on 429 rate limit errors."""
    for attempt in range(max_retries + 1):
        try:
            return func(*args, **kwargs)
        except HttpResponseError as e:
            if e.status_code == 429 and attempt < max_retries:
                wait_time = 2**attempt
                if e.response and hasattr(e.response, "headers"):
                    retry_after = e.response.headers.get("Retry-After")
                    if retry_after:
                        try:
                            wait_time = int(retry_after)
                        except (ValueError, TypeError):
                            pass
                logger.warning(
                    "Azure KV rate limited (attempt %d/%d), waiting %ds",
                    attempt + 1,
                    max_retries,
                    wait_time,
                )
                time.sleep(wait_time)
            else:
                raise


def list_kv_secrets(client):
    """List all secret names in the vault (enabled only, for query results)."""
    secrets = []
    for secret_properties in client.list_properties_of_secrets():
        if secret_properties.enabled:
            secrets.append({
                "name": secret_properties.name,
                "updated_on": secret_properties.updated_on,
                "content_type": secret_properties.content_type,
            })
    return secrets


def list_all_kv_secrets(client):
    """List all secrets in the vault with their enabled status (for sync)."""
    secrets = {}
    for secret_properties in client.list_properties_of_secrets():
        secrets[secret_properties.name] = secret_properties.enabled
    return secrets


def get_kv_secret(client, name):
    """Get a single secret's value from the vault."""
    secret = client.get_secret(name)
    return secret.value


def list_deleted_kv_secrets(client):
    """List secrets in soft-deleted state."""
    deleted = []
    for secret in client.list_deleted_secrets():
        deleted.append(secret.name)
    return deleted


def recover_kv_secret(client, name):
    """Recover a soft-deleted secret and poll until complete."""
    poller = client.begin_recover_deleted_secret(name)
    poller.wait()


def set_kv_secret(client, name, value, content_type=None):
    """Create or update a secret in the vault."""
    kwargs = {}
    if content_type:
        kwargs["content_type"] = content_type
    client.set_secret(name, value, **kwargs)


def disable_kv_secret(client, name):
    """Disable a secret by setting enabled=False."""
    client.update_secret_properties(name, enabled=False)


def enable_kv_secret(client, name):
    """Enable a secret by setting enabled=True."""
    client.update_secret_properties(name, enabled=True)


def _transform_secret_name(name):
    """Transform a Phase secret name to a valid Azure KV secret name.

    Azure KV secret names allow alphanumerics and hyphens only.
    Underscores are replaced with hyphens.
    """
    return name.replace("_", "-")


def sync_azure_kv_individual(
    secrets, tenant_id, client_id, client_secret, vault_uri
):
    """Sync individual secrets to Azure Key Vault.

    Each Phase secret becomes a separate KV secret.
    Secrets not in Phase are disabled in KV.

    Args:
        secrets: List of (key, value, comment) tuples from Phase.
        tenant_id, client_id, client_secret: Azure credentials.
        vault_uri: The vault URL (e.g. https://myvault.vault.azure.net).

    Returns:
        tuple: (bool, dict) indicating success/failure and a message.
    """
    try:
        vault_uri = validate_vault_uri(vault_uri)

        # Build Phase secret map with name transformation
        phase_secrets = {}
        for key, value, _comment in secrets:
            kv_name = _transform_secret_name(key)
            if kv_name in phase_secrets:
                return False, {
                    "message": f"Name collision: multiple Phase secrets map to KV name '{kv_name}'"
                }
            phase_secrets[kv_name] = value

        credential = get_azure_client_credential(tenant_id, client_id, client_secret)
        client = get_kv_client(credential, vault_uri)

        # Get current state of the vault (all secrets with enabled status)
        existing_secrets = list_all_kv_secrets(client)
        deleted_secrets = set(list_deleted_kv_secrets(client))

        # Sync each Phase secret
        for kv_name, value in phase_secrets.items():
            if kv_name in deleted_secrets:
                _retry_on_rate_limit(recover_kv_secret, client, kv_name)
            _retry_on_rate_limit(set_kv_secret, client, kv_name, value)
            # Re-enable if it was previously disabled
            if kv_name in existing_secrets and not existing_secrets[kv_name]:
                _retry_on_rate_limit(enable_kv_secret, client, kv_name)

        # Disable KV secrets not in Phase (both enabled and disabled are tracked)
        for kv_name, is_enabled in existing_secrets.items():
            if kv_name not in phase_secrets and is_enabled:
                _retry_on_rate_limit(disable_kv_secret, client, kv_name)

        return True, {
            "message": f"Successfully synced {len(phase_secrets)} secrets to Azure Key Vault"
        }

    except HttpResponseError as e:
        logger.error("Azure KV individual sync error: %s", str(e))
        return False, {"message": f"Azure Key Vault sync failed (HTTP {e.status_code}). Check credentials and vault permissions."}
    except Exception as e:
        logger.error("Azure KV individual sync unexpected error: %s", str(e))
        return False, {"message": "An unexpected error occurred during Azure Key Vault sync."}


def sync_azure_kv_blob(
    secrets, tenant_id, client_id, client_secret, vault_uri, secret_name
):
    """Sync all secrets as a single JSON blob to Azure Key Vault.

    Args:
        secrets: List of (key, value, comment) tuples from Phase.
        tenant_id, client_id, client_secret: Azure credentials.
        vault_uri: The vault URL.
        secret_name: The name of the KV secret to store the blob in.

    Returns:
        tuple: (bool, dict) indicating success/failure and a message.
    """
    try:
        vault_uri = validate_vault_uri(vault_uri)

        secrets_dict = {k: v for k, v, _ in secrets}
        blob = json.dumps(secrets_dict)

        credential = get_azure_client_credential(tenant_id, client_id, client_secret)
        client = get_kv_client(credential, vault_uri)

        # Check if the secret is in deleted state and recover it
        deleted_secrets = set(list_deleted_kv_secrets(client))
        if secret_name in deleted_secrets:
            _retry_on_rate_limit(recover_kv_secret, client, secret_name)

        _retry_on_rate_limit(
            set_kv_secret,
            client,
            secret_name,
            blob,
            content_type="application/json",
        )

        return True, {
            "message": f"Successfully synced {len(secrets_dict)} secrets as JSON blob to '{secret_name}'"
        }

    except HttpResponseError as e:
        logger.error("Azure KV blob sync error: %s", str(e))
        return False, {"message": f"Azure Key Vault sync failed (HTTP {e.status_code}). Check credentials and vault permissions."}
    except Exception as e:
        logger.error("Azure KV blob sync unexpected error: %s", str(e))
        return False, {"message": "An unexpected error occurred during Azure Key Vault sync."}
