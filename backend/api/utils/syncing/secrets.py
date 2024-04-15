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
    A list of (key, value) tuples is returned.

    Args:
        environment (Environment): The environment instance.
        path (str): The path string

    Returns:
        List[Tuple[str, str]]: A list of tuples containing all secrets' keys and values
    """

    Secret = apps.get_model("api", "Secret")

    ServerEnvironmentKey = apps.get_model("api", "ServerEnvironmentKey")

    pk, sk = get_server_keypair()

    server_env_key = ServerEnvironmentKey.objects.get(environment_id=environment.id)

    # Decrypt environment seed
    env_seed = decrypt_asymmetric(server_env_key.wrapped_seed, sk.hex(), pk.hex())

    # Compute environment keypair
    env_pubkey, env_privkey = env_keypair(env_seed)

    # Get Secrets from DB
    secrets = Secret.objects.filter(
        environment=environment,
        path=path,
        deleted_at=None,
    )

    kv_pairs = []

    # Decrypt key and value for each secret
    for secret in secrets:
        key = decrypt_asymmetric(secret.key, env_privkey, env_pubkey)
        value = decrypt_secret_value(secret)

        kv_pairs.append((key, value))

    return kv_pairs
