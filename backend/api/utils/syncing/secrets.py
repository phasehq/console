from api.utils.crypto import (
    blake2b_digest,
    decrypt_asymmetric,
    env_keypair,
    get_server_keypair,
)
import re
from django.apps import apps


cross_env_pattern = re.compile(r"\$\{(.+?)\.(.+?)\}")
local_ref_pattern = re.compile(r"\$\{(.+?)\}")


def get_environment_secrets(environment_sync):
    Secret = apps.get_model("api", "Secret")
    Environment = apps.get_model("api", "Environment")
    ServerEnvironmentKey = apps.get_model("api", "ServerEnvironmentKey")

    pk, sk = get_server_keypair()

    server_env_key = ServerEnvironmentKey.objects.get(
        environment_id=environment_sync.environment.id
    )

    app = server_env_key.environment.app

    env_seed = decrypt_asymmetric(server_env_key.wrapped_seed, sk.hex(), pk.hex())

    env_pubkey, env_privkey = env_keypair(env_seed)

    secrets = Secret.objects.filter(
        environment=environment_sync.environment, deleted_at=None
    )

    kv_pairs = []

    for secret in secrets:
        key = decrypt_asymmetric(secret.key, env_privkey, env_pubkey)
        value = decrypt_asymmetric(secret.value, env_privkey, env_pubkey)

        kv_pairs.append((key, value))

    # Create a dictionary from the fetched secrets for easy look-up
    secrets_dict = dict(kv_pairs)

    # Iterate through the secrets and resolve references
    for key, value in secrets_dict.items():
        # Handle cross environment references
        cross_env_matches = re.findall(cross_env_pattern, value)

        for ref_env, ref_key in cross_env_matches:
            try:
                referenced_environment = Environment.objects.get(
                    name__iexact=ref_env, app=app
                )
                referenced_environment_key = ServerEnvironmentKey.objects.get(
                    environment_id=referenced_environment.id
                )
                seed = decrypt_asymmetric(
                    referenced_environment_key.wrapped_seed, sk.hex(), pk.hex()
                )
                salt = decrypt_asymmetric(
                    referenced_environment_key.wrapped_salt, sk.hex(), pk.hex()
                )

                key_digest = blake2b_digest(ref_key, salt)

                referenced_env_pubkey, referenced_env_privkey = env_keypair(seed)

                referenced_secret = Secret.objects.get(
                    environment=referenced_environment,
                    key_digest=key_digest,
                    deleted_at=None,
                )

                referenced_secret_value = decrypt_asymmetric(
                    referenced_secret.value,
                    referenced_env_privkey,
                    referenced_env_pubkey,
                )

                # ref_secret = phase.get(env_name=ref_env, keys=[ref_key], app_name=phase_app)[0]
                value = value.replace(
                    f"${{{ref_env}.{ref_key}}}", referenced_secret_value
                )
            except ValueError as e:
                print(
                    f"Warning: The referenced environment or key either does not exist or the server does not have access to it."
                )
                value = value.replace(f"${{{ref_env}.{ref_key}}}", "")

        # Handle local references
        local_ref_matches = re.findall(local_ref_pattern, value)

        for ref_key in local_ref_matches:
            value = value.replace(
                f"${{{ref_key}}}",
                secrets_dict.get(
                    ref_key,
                    f"Warning: Local reference not found for key.",
                ),
            )

        secrets_dict[key] = value

    secrets_kv_pairs = list(secrets_dict.items())

    return secrets_kv_pairs
