import re
from django.db import transaction
from django.apps import apps
import logging
from api.utils.crypto import (
    blake2b_digest,
    decrypt_asymmetric,
    env_keypair,
    get_server_keypair,
)
from api.utils.access.permissions import (
    service_account_can_access_environment,
    user_can_access_environment,
)

logger = logging.getLogger(__name__)


# Regex patterns to detect references.
# Note: The `(?!\{)` negative lookahead intentionally excludes double-brace syntax
# (for example, `${{...}}`) to avoid conflicting with Railway and similar third-party
# service variable references that use that format.
# The capture groups exclude `{` and `}` so a single reference can never span
# across an adjacent ${...} reference. Without this, a dot-less local ref placed
# before a dotted ref (e.g. "${LOCAL}-${env.KEY}") makes the dotted pattern's
# leading group greedily consume up to the later dot, producing a bogus match.
CROSS_APP_ENV_PATTERN = re.compile(r"\$\{(?!\{)([^{}]+?)::([^{}]+?)\.([^{}]+?)\}")
CROSS_ENV_PATTERN = re.compile(r"\$\{(?!\{)(?![^{}]*::)([^{}.]+?)\.([^{}]+?)\}")
LOCAL_REF_PATTERN = re.compile(r"\$\{(?!\{)([^{}.]+?)\}")

# Upper bound on how deep nested secret references are resolved. Cycles are
# already broken by the per-branch `_visited` set in decrypt_secret_value; this
# is an additional guard against pathologically deep (but acyclic) chains.
MAX_REFERENCE_DEPTH = 25


class SecretReferenceException(Exception):
    pass


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

    for i, segment in enumerate(path_segments):
        # For each folder except the first, the path includes its parent's name
        # For the first segment, current_path should remain "/" as its location

        if i > 0:
            current_path += (
                f"/{path_segments[i-1]}"
                if current_path != "/"
                else path_segments[i - 1]
            )

        # Check if the folder already exists at the current path and with the given name
        folder, _ = SecretFolder.objects.get_or_create(
            name=segment,
            environment=environment,
            folder=current_folder,
            path=current_path,
        )

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
    if path.endswith("/") and path != "/":
        path = path[:-1]

    return path


def check_for_duplicates_blind(secrets, environment):
    """
    Checks if a list of secrets contains any duplicates internally or in the target env + path by checking each secret's key_digest.
    Also checks key_map key_digest for DynamicSecret objects at the environment and path.

    Args:
        secrets (List[Dict]): The list of encrypted secrets to check for duplicates.
        environment (Environment): The environment where the secrets are being stored.

    Returns:
        bool: True if a duplicate is found, False otherwise.
    """
    Secret = apps.get_model("api", "Secret")
    DynamicSecret = apps.get_model("api", "DynamicSecret")

    processed_secrets = set()  # Set to store processed secrets

    # --- Collect digests from input secrets ---
    for secret in secrets:
        if "keyDigest" in secret:
            try:
                path = normalize_path_string(secret["path"])
            except:
                path = "/"
            processed_secrets.add((path, secret["keyDigest"]))

    # --- Check static secrets in DB ---
    for secret in secrets:
        if "keyDigest" in secret:
            try:
                path = normalize_path_string(secret["path"])
            except:
                path = "/"
            query_duplicates = Secret.objects.filter(
                environment=environment,
                path=path,
                key_digest=secret["keyDigest"],
                deleted_at=None,
            )
            if "id" in secret:
                query_duplicates = query_duplicates.exclude(id=secret["id"])
            if query_duplicates.exists():
                return True

    # --- Check dynamic secrets key_map in DB ---
    for secret in secrets:
        try:
            path = normalize_path_string(secret.get("path", "/"))
        except:
            path = "/"
        dynamic_secrets_qs = DynamicSecret.objects.filter(
            environment=environment,
            path=path,
            deleted_at=None,
        )
        exclude_id = secret.get("dynamic_secret_id")
        if exclude_id:
            dynamic_secrets_qs = dynamic_secrets_qs.exclude(id=exclude_id)
        for dyn_secret in dynamic_secrets_qs:
            key_map = dyn_secret.key_map or []
            for entry in key_map:
                key_digest = entry.get("key_digest")
                if key_digest and (path, key_digest) in processed_secrets:
                    return True

    return False


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


def get_environment_crypto_context(environment):
    """
    Retrieves the crypto context (salt, public key, private key) for a given environment.
    """
    ServerEnvironmentKey = apps.get_model("api", "ServerEnvironmentKey")
    pk, sk = get_server_keypair()

    server_env_key = ServerEnvironmentKey.objects.get(environment_id=environment.id)

    seed = decrypt_asymmetric(server_env_key.wrapped_seed, sk.hex(), pk.hex())
    salt = decrypt_asymmetric(server_env_key.wrapped_salt, sk.hex(), pk.hex())

    env_pubkey, env_privkey = env_keypair(seed)
    return salt, env_pubkey, env_privkey


def get_or_compute_crypto_context(environment, context_cache):
    """
    Retrieves the crypto context from the cache if available, otherwise computes it.
    """
    if context_cache is None:
        return None

    if environment.id in context_cache:
        return context_cache[environment.id]

    crypto_context = get_environment_crypto_context(environment)
    context_cache[environment.id] = crypto_context
    return crypto_context


def check_environment_access(account, environment, require_resolved_references):
    """
    Checks if the account has access to the environment.
    Raises SecretReferenceException if no access and require_resolved_references is True.
    Returns True if access is granted, False otherwise.
    """
    ServiceAccount = apps.get_model("api", "ServiceAccount")

    if not account:
        return True

    if isinstance(account, ServiceAccount):
        has_access = service_account_can_access_environment(account.id, environment.id)
        error_msg = "This service account doesn't have permission to read secrets in one or more referenced environments."
    else:
        has_access = user_can_access_environment(account.userId, environment.id)
        error_msg = "You don't have permission to read secrets in one or more referenced environments."

    if not has_access:
        if require_resolved_references:
            raise SecretReferenceException(error_msg)
        return False
    return True


def resolve_secret_value(
    environment,
    path,
    key_name,
    crypto_context=None,
    require_resolved_references=False,
    account=None,
    context_cache=None,
    _visited=None,
):
    """
    Resolves a secret value from a given environment, path, and key name.

    The referenced secret is decrypted via decrypt_secret_value so that any
    references nested inside it (local, cross-env or cross-app) are themselves
    resolved recursively. The _visited set is threaded through to break
    reference cycles.
    """
    Secret = apps.get_model("api", "Secret")

    if crypto_context:
        salt, pubkey, privkey = crypto_context
    else:
        crypto_context = get_environment_crypto_context(environment)
        salt, pubkey, privkey = crypto_context

    key_digest = blake2b_digest(key_name, salt)

    secret = Secret.objects.get(
        environment=environment,
        path=path,
        key_digest=key_digest,
        deleted_at=None,
    )

    return decrypt_secret_value(
        secret,
        require_resolved_references=require_resolved_references,
        account=account,
        crypto_context=crypto_context,
        context_cache=context_cache,
        _visited=_visited,
    )


def decrypt_secret_value(
    secret,
    require_resolved_references=False,
    account=None,
    crypto_context=None,
    context_cache=None,
    _visited=None,
):
    """
    Decrypts the given secret's value and resolves all references.

    References are resolved recursively: a referenced value that itself contains
    references is fully resolved before being substituted in. Reference cycles
    (e.g. A -> B -> A) are detected via the per-branch _visited set and chains
    deeper than MAX_REFERENCE_DEPTH are rejected, so resolution always terminates.

    Args:
        secret (Secret): The secret instance to decrypt.
        require_resolved_references (bool): If True, raise an exception if any reference cannot be resolved.
        account: (OrganisationMember | ServiceAccount): The account attempting to decrypt the secret value.
        crypto_context (tuple): Optional pre-computed (salt, pubkey, privkey) for the environment.
        context_cache (dict): Optional dictionary to cache crypto contexts for referenced environments.
        _visited (set): Internal — identities of secrets already on the current resolution branch, used for cycle detection.

    Returns:
        value (str): Decrypted secret value, with all local and cross env/app references replaced inline.
    """
    Secret = apps.get_model("api", "Secret")
    Environment = apps.get_model("api", "Environment")
    App = apps.get_model("api", "App")
    ServerEnvironmentKey = apps.get_model("api", "ServerEnvironmentKey")

    # Cycle / depth guard. Identify this secret by (env, path, key_digest) and
    # refuse to resolve it again if it's already on the current branch.
    if _visited is None:
        _visited = set()

    secret_identity = (
        str(getattr(secret, "environment_id", None) or secret.environment.id),
        secret.path,
        secret.key_digest,
    )
    if secret_identity in _visited or len(_visited) >= MAX_REFERENCE_DEPTH:
        raise SecretReferenceException(
            "Circular or too-deeply-nested secret reference detected."
        )
    _visited = _visited | {secret_identity}

    # Pre-compute current env context
    if crypto_context:
        current_env_crypto_context = crypto_context
    elif context_cache is not None and secret.environment.id in context_cache:
        current_env_crypto_context = context_cache[secret.environment.id]
    else:
        current_env_crypto_context = get_environment_crypto_context(secret.environment)

    if context_cache is not None:
        context_cache[secret.environment.id] = current_env_crypto_context

    env_salt, env_pubkey, env_privkey = current_env_crypto_context

    # Decrypt secret value
    value = decrypt_asymmetric(secret.value, env_privkey, env_pubkey)

    # Resolve cross-app and cross-env references
    cross_app_env_matches = re.findall(CROSS_APP_ENV_PATTERN, value)
    unresolved_references = []

    for ref_app, ref_env, ref_key in cross_app_env_matches:
        try:
            path, key_name = decompose_path_and_key(ref_key)

            referenced_app = App.objects.get(
                name__iexact=ref_app, organisation=secret.environment.app.organisation
            )

            referenced_environment = Environment.objects.get(
                name__iexact=ref_env, app=referenced_app
            )

            if not check_environment_access(
                account, referenced_environment, require_resolved_references
            ):
                return value

            ref_crypto_context = get_or_compute_crypto_context(
                referenced_environment, context_cache
            )

            referenced_secret_value = resolve_secret_value(
                referenced_environment,
                path,
                key_name,
                crypto_context=ref_crypto_context,
                require_resolved_references=require_resolved_references,
                account=account,
                context_cache=context_cache,
                _visited=_visited,
            )

            value = value.replace(
                f"${{{ref_app}::{ref_env}.{ref_key}}}", referenced_secret_value
            )
        except App.DoesNotExist:
            unresolved_references.append(
                f"The referenced app '{ref_app}' does not exist"
            )
        except App.MultipleObjectsReturned:
            unresolved_references.append(
                f"Could not resolve a cross-app reference because two or more apps named '{ref_app}' exist!"
            )
        except ServerEnvironmentKey.DoesNotExist:
            unresolved_references.append(
                f"The referenced app '{ref_app}' does not have SSE (Server-Side Encryption) enabled."
            )
        except Environment.DoesNotExist:
            unresolved_references.append(
                f"The referenced environment '{ref_env}' does not exist"
            )
        except Secret.DoesNotExist:
            unresolved_references.append(
                f"The referenced secret does not exist in '{ref_app}::{ref_env}' at the requested path"
            )
        except Exception as ex:
            unresolved_references.append(str(ex))

    # Resolve cross-env references (same app)
    cross_env_matches = re.findall(CROSS_ENV_PATTERN, value)

    for ref_env, ref_key in cross_env_matches:
        try:
            path, key_name = decompose_path_and_key(ref_key)

            referenced_environment = Environment.objects.get(
                name__iexact=ref_env, app=secret.environment.app
            )

            if not check_environment_access(
                account, referenced_environment, require_resolved_references
            ):
                return value

            ref_crypto_context = get_or_compute_crypto_context(
                referenced_environment, context_cache
            )

            referenced_secret_value = resolve_secret_value(
                referenced_environment,
                path,
                key_name,
                crypto_context=ref_crypto_context,
                require_resolved_references=require_resolved_references,
                account=account,
                context_cache=context_cache,
                _visited=_visited,
            )

            value = value.replace(f"${{{ref_env}.{ref_key}}}", referenced_secret_value)
        except Environment.DoesNotExist:
            unresolved_references.append(
                f"The referenced environment '{ref_env}' does not exist"
            )
        except Secret.DoesNotExist:
            unresolved_references.append(
                f"The referenced secret does not exist in '{ref_env}' at the requested path"
            )
        except Exception as ex:
            unresolved_references.append(str(ex))

    if require_resolved_references and unresolved_references:
        raise SecretReferenceException("\n".join(unresolved_references))

    # Resolve local references
    local_ref_matches = re.findall(LOCAL_REF_PATTERN, value)
    unresolved_local_references = []

    for ref_key in local_ref_matches:
        try:
            path, key_name = decompose_path_and_key(ref_key)

            referenced_secret_value = resolve_secret_value(
                secret.environment,
                path,
                key_name,
                crypto_context=current_env_crypto_context,
                require_resolved_references=require_resolved_references,
                account=account,
                context_cache=context_cache,
                _visited=_visited,
            )

            value = value.replace(
                f"${{{ref_key}}}",
                referenced_secret_value,
            )
        except:
            unresolved_local_references.append(
                f"The referenced key {ref_key} does not exist in the {secret.environment.name} environment."
            )

    if require_resolved_references and unresolved_local_references:
        raise SecretReferenceException("\n".join(unresolved_local_references))

    return value


def get_referenced_environment_ids(source_env_id, name_ctx):
    """
    Returns the set of environment IDs that the secrets in source_env directly
    reference via cross-env (${ENV.KEY}) or cross-app (${APP::ENV.KEY}) references.

    Reference names are resolved to environment IDs using the pre-built name_ctx
    maps (so the caller can build a reference graph and follow chains transitively
    when deciding which syncs to trigger). Returns IDs as strings.

    Args:
        source_env_id: ID of the environment whose secrets to scan.
        name_ctx (dict): Pre-built org-wide lookups:
            - "apps_by_name": {lower app name: app_id} (unambiguous names only)
            - "ambiguous_apps": set of lower app names that occur more than once
            - "envs_by_app_name": {(str(app_id), lower env name): str(env_id)}

    Returns:
        set[str]: Environment IDs referenced by source_env's secrets.
    """
    Secret = apps.get_model("api", "Secret")
    ServerEnvironmentKey = apps.get_model("api", "ServerEnvironmentKey")
    Environment = apps.get_model("api", "Environment")

    try:
        source_env = Environment.objects.select_related("app").get(id=source_env_id)
    except Environment.DoesNotExist:
        return set()

    try:
        server_env_key = ServerEnvironmentKey.objects.get(environment_id=source_env_id)
    except ServerEnvironmentKey.DoesNotExist:
        return set()

    pk, sk = get_server_keypair()

    try:
        env_seed = decrypt_asymmetric(server_env_key.wrapped_seed, sk.hex(), pk.hex())
        env_pubkey, env_privkey = env_keypair(env_seed)
    except Exception:
        return set()

    apps_by_name = name_ctx["apps_by_name"]
    ambiguous_apps = name_ctx["ambiguous_apps"]
    envs_by_app_name = name_ctx["envs_by_app_name"]
    source_app_id = str(source_env.app_id)

    referenced = set()

    for secret in Secret.objects.filter(environment_id=source_env_id, deleted_at=None):
        try:
            value = decrypt_asymmetric(secret.value, env_privkey, env_pubkey)
        except Exception:
            continue

        # Cross-app references: ${APP::ENV.KEY}
        for ref_app, ref_env, _ in CROSS_APP_ENV_PATTERN.findall(value):
            app_key = ref_app.lower()
            if app_key in ambiguous_apps:
                # Can't unambiguously resolve which app is meant — skip.
                continue
            app_id = apps_by_name.get(app_key)
            if app_id is None:
                continue
            env_id = envs_by_app_name.get((str(app_id), ref_env.lower()))
            if env_id:
                referenced.add(env_id)

        # Cross-env references: ${ENV.KEY} (same app)
        for ref_env, _ in CROSS_ENV_PATTERN.findall(value):
            env_id = envs_by_app_name.get((source_app_id, ref_env.lower()))
            if env_id:
                referenced.add(env_id)

    return referenced
