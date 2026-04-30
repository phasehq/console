import logging
from django.conf import settings
from api.utils.crypto import decrypt_asymmetric, get_server_keypair
from azure.identity import ClientSecretCredential
from azure.keyvault.secrets import SecretClient

# Suppress verbose Azure SDK HTTP logging unless in debug mode
if not settings.DEBUG:
    logging.getLogger("azure").setLevel(logging.WARNING)


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
