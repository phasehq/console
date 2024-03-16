from api.utils.crypto import decrypt_asymmetric, encrypt_asymmetric, get_server_keypair
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


def get_credentials(credential_id):
    ProviderCredentials = apps.get_model("api", "ProviderCredentials")

    cred_obj = ProviderCredentials.objects.get(id=credential_id)
    provider = Providers.get_provider_config(cred_obj.provider)

    pk, sk = get_server_keypair()

    authentication_credentials = {}
    for credential_key in provider["expected_credentials"] + provider.get(
        "optional_credentials", []
    ):
        credential_value = decrypt_asymmetric(
            cred_obj.credentials.get(credential_key), sk.hex(), pk.hex()
        )
        if credential_value is not None:
            authentication_credentials[credential_key] = credential_value

    return authentication_credentials
