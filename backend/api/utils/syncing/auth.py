from api.utils.crypto import decrypt_asymmetric, encrypt_asymmetric, get_server_keypair
from api.services import Providers
from django.apps import apps


def store_oauth_token(
    provider_id, credential_name, access_token, host_url, api_url, org_id
):
    Organisation = apps.get_model("api", "Organisation")
    ProviderCredentials = apps.get_model("api", "ProviderCredentials")

    pk, _ = get_server_keypair()

    encrypted_access_token = encrypt_asymmetric(access_token, pk.hex())
    encrypted_host_url = encrypt_asymmetric(host_url, pk.hex())
    encrypted_api_url = encrypt_asymmetric(api_url, pk.hex())

    provider = Providers.get_provider_config(provider_id)

    credentials = {
        "access_token": encrypted_access_token,
        "host_url": encrypted_host_url,
        "api_url": encrypted_api_url,
    }

    org = Organisation.objects.get(id=org_id)

    credential = ProviderCredentials.objects.create(
        organisation=org,
        name=credential_name,
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
        encrypted_value = cred_obj.credentials.get(credential_key)
        if encrypted_value is not None:
            credential_value = decrypt_asymmetric(
                cred_obj.credentials.get(credential_key), sk.hex(), pk.hex()
            )
            if credential_value is not None:
                authentication_credentials[credential_key] = credential_value

    return authentication_credentials
