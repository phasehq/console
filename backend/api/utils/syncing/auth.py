from api.utils.crypto import encrypt_asymmetric, get_server_keypair
from api.models import Organisation, ProviderCredentials
from api.services import Providers


def store_oauth_token(provider_id, access_token, refresh_token, org_id):
    pk, _ = get_server_keypair()

    encrypted_access_token = encrypt_asymmetric(access_token, pk.hex())
    encrypted_refresh_token = encrypt_asymmetric(refresh_token, pk.hex())

    provider = Providers.get_provider_config(provider_id)

    credentials = {
        "access_token": encrypted_access_token,
        "refresh_token": encrypted_refresh_token,
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
