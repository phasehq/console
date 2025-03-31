import re
from django.db import transaction
from django.apps import apps
from django.core.exceptions import MultipleObjectsReturned

# from api.models import SecretFolder, Secret, ServerEnvironmentKey

from api.utils.crypto import (
    blake2b_digest,
    decrypt_asymmetric,
    env_keypair,
    get_server_keypair,
)


def get_environment_keys(environment_id):
    """
    Returns a tuple of environment public and private keys.

    Args:
        environment_id (str): The ID of the environment to get the keys for.

    Returns:
        env_pubkey, env_privkey (tuple): A tuple containing the environment's public key and private key.
    """
    ServerEnvironmentKey = apps.get_model("api", "ServerEnvironmentKey")

    server_env_key = ServerEnvironmentKey.objects.get(environment_id=environment_id)

    pk, sk = get_server_keypair()

    env_seed = decrypt_asymmetric(server_env_key.wrapped_seed, sk.hex(), pk.hex())

    return env_keypair(env_seed)


def compute_key_digest(key, environment_id):
    """
    Computes a blake2b hash of the given key using a salt from the specified environment.

    Args:
        key (str): The secret key to be hashed.
        environment_id (str): The ID of the environment, required to make sure the correct salt is used when hashing.

    Returns:
        key_digest (sstr): The blake2b-hashed output as a hex-encoded string.
    """
    ServerEnvironmentKey = apps.get_model("api", "ServerEnvironmentKey")

    server_env_key = ServerEnvironmentKey.objects.get(environment_id=environment_id)

    pk, sk = get_server_keypair()

    salt = decrypt_asymmetric(server_env_key.wrapped_salt, sk.hex(), pk.hex())

    key_digest = blake2b_digest(key.upper(), salt)

    return key_digest


def create_environment_folder_structure(complete_path, environment_id):
    """
    Correctly creates a nested folder structure based on a given the complete_path within a specified environment.

    Parameters:
    - complete_path (str): The complete path string representing the nested folder structure to create.
    - environment_id (int): The ID of the `Environment` instance where the folder structure will be created.

    Returns:
    - SecretFolder: The last `SecretFolder` instance created or retrieved, representing the deepest
                    level in the provided path structure.
    """
    Environment = apps.get_model("api", "Environment")
    SecretFolder = apps.get_model("api", "SecretFolder")

    # Ensure the path_segments list does not include empty segments caused by leading or trailing slashes
    path_segments = [segment for segment in complete_path.split("/") if segment]

    current_folder = None
    # The initial current_path should correctly represent the root
    current_path = "/"

    environment = Environment.objects.get(id=environment_id)

    with transaction.atomic():
        for i, segment in enumerate(path_segments):
            # For each folder except the first, the path includes its parent's name
            # For the first segment, current_path should remain "/" as its location

            if i > 0:
                current_path += (
                    f"/{path_segments[i-1]}"
                    if current_path != "/"
                    else path_segments[i - 1]
                )

            try:
                # Try to get or create the folder first using get to handle duplicates
                try:
                    folder = SecretFolder.objects.get(
                        name=segment,
                        environment=environment,
                        folder=current_folder,
                        path=current_path,
                    )
                except SecretFolder.DoesNotExist:
                    # If it doesn't exist, try to create it
                    try:
                        folder = SecretFolder.objects.create(
                            name=segment,
                            environment=environment,
                            folder=current_folder,
                            path=current_path,
                        )
                    except:
                        # If creation failed due to race condition, get the first matching folder
                        folder = SecretFolder.objects.filter(
                            name=segment,
                            environment=environment,
                            folder=current_folder,
                            path=current_path,
                        ).first()
            except MultipleObjectsReturned:
                # If MultipleObjectsReturned, it means the folder was created concurrently.
                # Simply get the first matching folder and continue
                folder = SecretFolder.objects.filter(
                    name=segment,
                    environment=environment,
                    folder=current_folder,
                    path=current_path,
                ).first()

            # Update the current_folder to the folder that was just created or found
            current_folder = folder

    return current_folder


def normalize_path_string(path):
    """
    Ensures the given string is a valid path string following specific rules.

    Args:
    - path (str): The input string to be normalized as a path.

    Returns:
    - str: The normalized path string.
    """
    if path == "/":
        return path

    # Ensure the string doesn't contain repeated "/"s
    while "//" in path:
        path = path.replace("//", "/")

    # Ensure the string has a leading "/"
    if not path.startswith("/"):
        path = "/" + path

    # Remove trailing slash if present
    if path.endswith("/"):
        path = path[:-1]

    return path


def check_for_duplicates_blind(secrets, environment):
    """
    Checks if a list of secrets contains any duplicates internally or in the target env + path by checking each secret's key_digest

    Args:
        secrets (List[Dict]): The list of encrypted secrets to check for duplicates.
        environment (Environment): The environment where the secrets are being stored.

    Returns:
        bool: True if a duplicate is found, False otherwise.
    """
    Secret = apps.get_model("api", "Secret")

    processed_secrets = set()  # Set to store processed secrets

    for secret in secrets:
        if "keyDigest" in secret:
            try:
                path = normalize_path_string(secret["path"])
            except:
                path = "/"

            # Check if the secret is already processed
            if (path, secret["keyDigest"]) in processed_secrets:
                return True  # Found a duplicate within the list

            # Check if the secret already exists in the database
            query_duplicates = Secret.objects.filter(
                environment=environment,
                path=path,
                key_digest=secret["keyDigest"],
                deleted_at=None,
            )

            if "id" in secret:
                query_duplicates = query_duplicates.exclude(id=secret["id"])

            if query_duplicates.exists():
                return True  # Found a duplicate in the database

            # Add the processed secret to the set
            processed_secrets.add((path, secret["keyDigest"]))

    return False  # No duplicates found


def decompose_path_and_key(composed_key):
    """
    Splits the given composed key string into its path and key name components.

    Args:
        composed_key (str): The input composed key string to be decomposed.

    Returns:
        tuple: A tuple containing two strings, where the first string is the path component and the second string is the key name component.
    """
    last_slash_index = composed_key.rfind("/")
    if last_slash_index != -1:
        path = composed_key[:last_slash_index]
        key_name = composed_key[last_slash_index + 1 :]
    else:
        path = "/"
        key_name = composed_key

    return normalize_path_string(path), key_name


def decrypt_secret_value(secret):
    """
    Decrypts the given secret's value and resolves all references.

    Args:
        secret (Secret): The secret instance to decrypt.

    Returns:
        value (str): Decrypted secret value, with all local and cross env references replace inline.
    """
    Secret = apps.get_model("api", "Secret")
    Environment = apps.get_model("api", "Environment")
    ServerEnvironmentKey = apps.get_model("api", "ServerEnvironmentKey")

    # Regex patterns to detect refernces
    cross_env_pattern = re.compile(r"\$\{(.+?)\.(.+?)\}")
    local_ref_pattern = re.compile(r"\$\{([^.]+?)\}")

    pk, sk = get_server_keypair()

    server_env_key = ServerEnvironmentKey.objects.get(
        environment_id=secret.environment.id
    )

    app = server_env_key.environment.app

    # Decrypt environment seed and salt
    env_seed = decrypt_asymmetric(server_env_key.wrapped_seed, sk.hex(), pk.hex())
    env_salt = decrypt_asymmetric(server_env_key.wrapped_salt, sk.hex(), pk.hex())

    # Compute environment keypair
    env_pubkey, env_privkey = env_keypair(env_seed)

    # Decrypt secret value
    value = decrypt_asymmetric(secret.value, env_privkey, env_pubkey)

    # Resolve cross-env references
    cross_env_matches = re.findall(cross_env_pattern, value)

    for ref_env, ref_key in cross_env_matches:

        try:
            path, key_name = decompose_path_and_key(ref_key)

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

            key_digest = blake2b_digest(key_name, salt)

            referenced_env_pubkey, referenced_env_privkey = env_keypair(seed)

            referenced_secret = Secret.objects.get(
                environment=referenced_environment,
                path=path,
                key_digest=key_digest,
                deleted_at=None,
            )

            referenced_secret_value = decrypt_asymmetric(
                referenced_secret.value,
                referenced_env_privkey,
                referenced_env_pubkey,
            )

            value = value.replace(f"${{{ref_env}.{ref_key}}}", referenced_secret_value)
        except:
            print(
                f"Warning: The referenced environment or key either does not exist or the server does not have access to it."
            )
            pass

    # Resolve local references
    local_ref_matches = re.findall(local_ref_pattern, value)

    for ref_key in local_ref_matches:

        try:
            path, key_name = decompose_path_and_key(ref_key)

            key_digest = blake2b_digest(key_name, env_salt)

            referenced_secret = Secret.objects.get(
                environment=secret.environment,
                path=path,
                key_digest=key_digest,
                deleted_at=None,
            )

            referenced_secret_value = decrypt_asymmetric(
                referenced_secret.value,
                env_privkey,
                env_pubkey,
            )

            value = value.replace(
                f"${{{ref_key}}}",
                referenced_secret_value,
            )
        except:
            print(
                f"Warning: The referenced environment or key either does not exist or the server does not have access to it."
            )
            pass

    return value
