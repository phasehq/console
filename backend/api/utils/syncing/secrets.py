from api.utils.crypto import decrypt_asymmetric, env_keypair, get_server_keypair

from django.apps import apps

# from backend.api.models import Secret, ServerEnvironmentKey


def get_environment_secrets(environment_sync):
    Secret = apps.get_model("api", "Secret")
    ServerEnvironmentKey = apps.get_model("api", "ServerEnvironmentKey")

    pk, sk = get_server_keypair()

    server_env_key = ServerEnvironmentKey.objects.get(
        environment_id=environment_sync.environment.id
    )

    env_seed = decrypt_asymmetric(server_env_key.wrapped_seed, sk.hex(), pk.hex())

    env_pubkey, env_privkey = env_keypair(env_seed)

    secrets = Secret.objects.filter(environment=environment_sync.environment)

    kv_pairs = []

    for secret in secrets:
        key = decrypt_asymmetric(secret.key, env_privkey, env_pubkey)
        value = decrypt_asymmetric(secret.value, env_privkey, env_pubkey)

        kv_pairs.append((key, value))

    return kv_pairs
