from api.utils.crypto import (
    decrypt_asymmetric,
    env_keypair,
    get_server_keypair,
)

from django.apps import apps
from api.utils.secrets import decrypt_secret_value


def get_environment_secrets(environment, path):
    """
    Decrypts and resolves key, value pairs in the given environment, at the given path.
    If target_secret is provided, only that secret's (key,value) tuple is returned.
    Otherwise, a list of (key, value) tuples is returned.

    Args:
        environment: The environment instance.
        path: The path string
        target_secret (optional): Specific secret instance to return

    Returns:
        key, value (tuple): A tuple containing the target secret key and value.
        OR
        [(key, value)]: A list of tuples containing all secrets' keys and values
    """

    Secret = apps.get_model("api", "Secret")

    ServerEnvironmentKey = apps.get_model("api", "ServerEnvironmentKey")

    pk, sk = get_server_keypair()

    server_env_key = ServerEnvironmentKey.objects.get(environment_id=environment.id)

    env_seed = decrypt_asymmetric(server_env_key.wrapped_seed, sk.hex(), pk.hex())

    env_pubkey, env_privkey = env_keypair(env_seed)

    secrets = Secret.objects.filter(
        environment=environment,
        path=path,
        deleted_at=None,
    )

    kv_pairs = []

    secrets = Secret.objects.filter(
        environment=environment,
        path=path,
        deleted_at=None,
    )

    for secret in secrets:
        key = decrypt_asymmetric(secret.key, env_privkey, env_pubkey)
        value = decrypt_secret_value(secret)

        kv_pairs.append((key, value))

    return kv_pairs
