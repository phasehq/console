from api.utils.crypto import encrypt_asymmetric, get_server_keypair
from api.services import Providers
from django.apps import apps


def store_oauth_token(provider_id, access_token, org_id):
    Organisation = apps.get_model("api", "Organisation")
    ProviderCredentials = apps.get_model("api", "ProviderCredentials")

    pk, _ = get_server_keypair()

    encrypted_access_token = encrypt_asymmetric(access_token, pk.hex())

    provider = Providers.get_provider_config(provider_id)

    credentials = {
        "access_token": encrypted_access_token,
    }

    org = Organisation.objects.get(id=org_id)

    provider_name = provider["name"]

    name = f"{provider_name} OAuth credentials"

    credential = ProviderCredentials.objects.create(
        organisation=org,
        name=name,
        provider=provider_id,
        credentials=credentials,
    )

    return credential
