from api.utils.crypto import decrypt_asymmetric, get_server_keypair
from azure.identity import ClientSecretCredential
from azure.keyvault.secrets import SecretClient


def get_azure_credential(environment_sync):
    """Decrypt Azure credentials from an environment sync's authentication."""
    pk, sk = get_server_keypair()

    tenant_id = decrypt_asymmetric(
        environment_sync.authentication.credentials["tenant_id"], sk.hex(), pk.hex()
    )
    client_id = decrypt_asymmetric(
        environment_sync.authentication.credentials["client_id"], sk.hex(), pk.hex()
    )
    client_secret = decrypt_asymmetric(
        environment_sync.authentication.credentials["client_secret"],
        sk.hex(),
        pk.hex(),
    )

    return {
        "tenant_id": tenant_id,
        "client_id": client_id,
        "client_secret": client_secret,
    }


def get_azure_client_credential(tenant_id, client_id, client_secret):
    """Create an Azure ClientSecretCredential for authenticating with Azure services."""
    return ClientSecretCredential(
        tenant_id=tenant_id,
        client_id=client_id,
        client_secret=client_secret,
    )


def get_kv_client(credential, vault_uri):
    """Create an Azure Key Vault SecretClient from a pre-built credential."""
    return SecretClient(vault_url=vault_uri, credential=credential)


def validate_azure_credentials(credential_id, vault_uri):
    """Validate Azure credentials by attempting to list secrets in the vault."""
    from api.models import ProviderCredentials
    from api.utils.syncing.azure.key_vault import validate_vault_uri

    vault_uri = validate_vault_uri(vault_uri)

    pk, sk = get_server_keypair()
    cred = ProviderCredentials.objects.get(id=credential_id)

    tenant_id = decrypt_asymmetric(
        cred.credentials["tenant_id"], sk.hex(), pk.hex()
    )
    client_id = decrypt_asymmetric(
        cred.credentials["client_id"], sk.hex(), pk.hex()
    )
    client_secret = decrypt_asymmetric(
        cred.credentials["client_secret"], sk.hex(), pk.hex()
    )

    try:
        azure_cred = get_azure_client_credential(tenant_id, client_id, client_secret)
        client = get_kv_client(azure_cred, vault_uri)
        # Attempt to list one secret to validate access
        client.list_properties_of_secrets(max_page_size=1).__next__()
        return True
    except StopIteration:
        # Empty vault is still valid
        return True
    except Exception:
        return False
