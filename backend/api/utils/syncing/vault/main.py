from api.utils.crypto import decrypt_asymmetric, get_server_keypair
from hvac import Client as VaultClient, exceptions as hvac_exceptions
from django.apps import apps
import graphene
import json


class VaultMountType(graphene.ObjectType):
    name = graphene.String()
    description = graphene.String()
    id = graphene.ID()


def list_vault_deployments(credential_id):
    """List all KV secrets mount points."""
    ProviderCredentials = apps.get_model("api", "ProviderCredentials")

    pk, sk = get_server_keypair()

    credential = ProviderCredentials.objects.get(id=credential_id)

    VAULT_URL = decrypt_asymmetric(
        credential.credentials["vault_host"], sk.hex(), pk.hex()
    )

    VAULT_TOKEN = decrypt_asymmetric(
        credential.credentials["vault_token"], sk.hex(), pk.hex()
    )

    client = VaultClient(url=VAULT_URL, token=VAULT_TOKEN)
    mount_points = []

    try:
        mounts = client.sys.list_mounted_secrets_engines()["data"]

        mount_points = [
            {
                "name": mount,
                "description": details["description"],
                "id": details["uuid"],
            }
            for mount, details in mounts.items()
            if details["type"] == "kv"
        ]
        return mount_points
    except hvac_exceptions.VaultError:
        raise Exception(
            "Error listing Vault mount points. Please check your credentials and verify that your Vault instance is up."
        )
    except Exception:
        raise Exception("Error listing Vault mount points.")
