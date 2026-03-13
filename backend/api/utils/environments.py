"""
Server-side utilities for creating environments and wrapping cryptographic
keys for users and service accounts.

This module mirrors the client-side ``createNewEnv`` flow
(frontend/utils/crypto/environments.ts) so that environments can be
provisioned entirely on the server — e.g. via the public REST API — without
requiring any client-side cryptography.

The high-level flow:

1. Generate a random env **seed** and **salt** (32 bytes each).
2. Derive the env keypair from the seed (``crypto_kx_seed_keypair``).
3. Wrap (asymmetrically encrypt) the seed and salt for:
   a. Every global-access user (Owner + Admin roles).
   b. Every SSK service account that has access to the parent app.
   c. The server itself (``ServerEnvironmentKey``).
4. Persist ``Environment``, ``EnvironmentKey`` (per-user & per-SA), and
   ``ServerEnvironmentKey`` records inside a single atomic transaction.
"""

from __future__ import annotations

import json
import logging
import re
from typing import List, Optional, Tuple

from django.db import transaction
from django.db.models import Max, Q

from api.models import (
    App,
    Environment,
    EnvironmentKey,
    OrganisationMember,
    Role,
    ServerEnvironmentKey,
    ServiceAccount,
)
from api.utils.crypto import (
    decrypt_asymmetric,
    encrypt_asymmetric,
    env_keypair,
    get_server_keypair,
    random_hex,
)

logger = logging.getLogger(__name__)

ENV_NAME_RE = re.compile(r"^[a-zA-Z0-9\-_]{1,64}$")


# ---------------------------------------------------------------------------
# Low-level helpers
# ---------------------------------------------------------------------------


def _generate_env_seed() -> str:
    """Return a random 32-byte hex seed for a new environment."""
    return random_hex(32)


def _generate_env_salt() -> str:
    """Return a random 32-byte hex salt for a new environment."""
    return random_hex(32)


def _wrap_env_secrets_for_key(
    seed: str,
    salt: str,
    public_key_hex: str,
) -> Tuple[str, str]:
    """
    Wrap (asymmetrically encrypt) an environment's seed and salt for a
    given public key.

    The *public_key_hex* must already be a Curve25519 (X25519) key-exchange
    public key.  For Ed25519 identity keys, call ``ed25519_to_kx`` first.

    Returns ``(wrapped_seed, wrapped_salt)``.
    """
    wrapped_seed = encrypt_asymmetric(seed, public_key_hex)
    wrapped_salt = encrypt_asymmetric(salt, public_key_hex)
    return wrapped_seed, wrapped_salt


def _wrap_for_user(
    seed: str,
    salt: str,
    member: OrganisationMember,
) -> Tuple[str, str]:
    """
    Wrap env secrets for an ``OrganisationMember`` whose ``identity_key``
    is stored as an Ed25519 public key.

    Returns ``(wrapped_seed, wrapped_salt)``.
    """
    kx_pub = _ed25519_pk_to_curve25519(member.identity_key)
    return _wrap_env_secrets_for_key(seed, salt, kx_pub)


def _ed25519_pk_to_curve25519(ed25519_pub_hex: str) -> str:
    """Convert an Ed25519 public key (hex) to a Curve25519 public key (hex)."""
    from nacl.bindings import crypto_sign_ed25519_pk_to_curve25519

    return crypto_sign_ed25519_pk_to_curve25519(
        bytes.fromhex(ed25519_pub_hex)
    ).hex()


def _wrap_for_server(seed: str, salt: str) -> Tuple[str, str, str]:
    """
    Wrap env secrets for the server.

    Returns ``(wrapped_seed, wrapped_salt, server_identity_key_hex)``.
    """
    pk, _sk = get_server_keypair()
    wrapped_seed, wrapped_salt = _wrap_env_secrets_for_key(seed, salt, pk.hex())
    return wrapped_seed, wrapped_salt, pk.hex()


def _wrap_for_service_account(
    seed: str,
    salt: str,
    service_account: ServiceAccount,
) -> Optional[Tuple[str, str]]:
    """
    Wrap env secrets for a service account that uses server-side key
    management (SSK).

    The SA's ``server_wrapped_keyring`` is decrypted to obtain the SA's
    Ed25519 public key, which is then converted to Curve25519 for wrapping.

    Returns ``(wrapped_seed, wrapped_salt)`` or ``None`` if the SA does not
    have SSK enabled.
    """
    if not service_account.server_wrapped_keyring:
        return None

    pk, sk = get_server_keypair()
    keyring_json = decrypt_asymmetric(
        service_account.server_wrapped_keyring, sk.hex(), pk.hex()
    )
    keyring = json.loads(keyring_json)
    kx_pub = _ed25519_pk_to_curve25519(keyring["publicKey"])
    return _wrap_env_secrets_for_key(seed, salt, kx_pub)


# ---------------------------------------------------------------------------
# Query helpers
# ---------------------------------------------------------------------------


def get_global_access_members(organisation) -> List[OrganisationMember]:
    """
    Return all active ``OrganisationMember`` records whose role grants
    global access (Owner, Admin, or any custom role with
    ``permissions.global_access == True``).
    """
    global_access_roles = Role.objects.filter(
        Q(organisation=organisation)
        & (
            Q(name__iexact="owner")
            | Q(name__iexact="admin")
            | Q(permissions__global_access=True)
        )
    )

    return list(
        OrganisationMember.objects.filter(
            organisation=organisation,
            role__in=global_access_roles,
            deleted_at=None,
        ).select_related("role")
    )


def get_ssk_service_accounts_for_app(app: App) -> List[ServiceAccount]:
    """
    Return service accounts associated with the given app that have
    server-side key management enabled (i.e. ``server_wrapped_keyring``
    is not null).
    """
    return list(
        app.service_accounts.filter(
            server_wrapped_keyring__isnull=False,
            deleted_at=None,
        )
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def create_environment(
    app: App,
    name: str,
    env_type: str = "custom",
    requesting_user: Optional[OrganisationMember] = None,
    requesting_sa: Optional[ServiceAccount] = None,
) -> Environment:
    """
    Create a new ``Environment`` entirely server-side, generating all
    cryptographic material and wrapping keys for every principal that
    needs access.

    This is the server-side equivalent of the frontend's ``createNewEnv``
    utility combined with the ``CreateEnvironmentMutation``.

    Args:
        app: The parent application.
        name: Environment display name (validated against ``ENV_NAME_RE``).
        env_type: One of ``dev``, ``staging``, ``prod``, ``custom``.
        requesting_user: The OrganisationMember making the request.
            If provided and not already a global-access member, an
            ``EnvironmentKey`` will be created for them.
        requesting_sa: The ServiceAccount making the request.
            If provided and not already covered by SSK wrapping, an
            ``EnvironmentKey`` will be created using the SA's identity key.

    Returns:
        The newly-created ``Environment`` instance.

    Raises:
        ValueError: If the name is invalid or already exists.
    """
    if not ENV_NAME_RE.match(name):
        raise ValueError(
            "Environment name is invalid. Only letters, numbers, hyphens "
            "and underscores are allowed (max 64 characters)."
        )

    if Environment.objects.filter(app=app, name__iexact=name).exists():
        raise ValueError(
            f"An environment named '{name}' already exists in this app."
        )

    # --- Cryptographic material ---
    seed = _generate_env_seed()
    salt = _generate_env_salt()
    env_pub, _env_priv = env_keypair(seed)

    # --- Determine environment index ---
    type_lower = env_type.lower()
    if type_lower == "dev":
        index = 0
    elif type_lower == "staging":
        index = 1
    elif type_lower == "prod":
        index = 2
    else:
        max_index = Environment.objects.filter(app=app).aggregate(
            Max("index")
        )["index__max"]
        index = (max_index + 1) if max_index is not None else 0

    # --- Wrap keys for the server ---
    server_wrapped_seed, server_wrapped_salt, server_pk_hex = _wrap_for_server(
        seed, salt
    )

    # --- Wrap keys for global-access members ---
    organisation = app.organisation
    global_members = get_global_access_members(organisation)

    member_wrapped: list[
        tuple[OrganisationMember, str, str]
    ] = []  # (member, wrapped_seed, wrapped_salt)

    for member in global_members:
        if not member.identity_key:
            logger.warning(
                "Skipping member %s — no identity_key set.", member.id
            )
            continue
        w_seed, w_salt = _wrap_for_user(seed, salt, member)
        member_wrapped.append((member, w_seed, w_salt))

    # --- Wrap keys for SSK service accounts ---
    sa_wrapped: list[
        tuple[ServiceAccount, str, str]
    ] = []  # (sa, wrapped_seed, wrapped_salt)

    ssk_accounts = get_ssk_service_accounts_for_app(app)
    for sa in ssk_accounts:
        result = _wrap_for_service_account(seed, salt, sa)
        if result is not None:
            sa_wrapped.append((sa, result[0], result[1]))

    # --- Ensure the requesting account gets access ---
    if requesting_user is not None:
        already_included = any(m.id == requesting_user.id for m, _, _ in member_wrapped)
        if not already_included and requesting_user.identity_key:
            w_seed, w_salt = _wrap_for_user(seed, salt, requesting_user)
            member_wrapped.append((requesting_user, w_seed, w_salt))

    if requesting_sa is not None:
        already_included = any(sa.id == requesting_sa.id for sa, _, _ in sa_wrapped)
        if not already_included and requesting_sa.identity_key:
            kx_pub = _ed25519_pk_to_curve25519(requesting_sa.identity_key)
            w_seed, w_salt = _wrap_env_secrets_for_key(seed, salt, kx_pub)
            sa_wrapped.append((requesting_sa, w_seed, w_salt))

    # --- Find the owner (for Environment.wrapped_seed / wrapped_salt) ---
    owner_member = next(
        (m for m, _, _ in member_wrapped if m.role and m.role.name.lower() == "owner"),
        None,
    )

    if owner_member is None:
        # Fallback: use the first global-access member
        if member_wrapped:
            owner_member = member_wrapped[0][0]
        else:
            raise ValueError(
                "Cannot create environment: no global-access members with "
                "identity keys found in the organisation."
            )

    owner_wrapped_seed, owner_wrapped_salt = next(
        (ws, wsa) for m, ws, wsa in member_wrapped if m.id == owner_member.id
    )

    # --- Persist everything atomically ---
    with transaction.atomic():
        environment = Environment.objects.create(
            app=app,
            name=name,
            env_type=type_lower,
            index=index,
            identity_key=env_pub,
            wrapped_seed=owner_wrapped_seed,
            wrapped_salt=owner_wrapped_salt,
        )

        # EnvironmentKey for each global-access member
        env_keys = []
        for member, w_seed, w_salt in member_wrapped:
            env_keys.append(
                EnvironmentKey(
                    environment=environment,
                    user=member,
                    identity_key=env_pub,
                    wrapped_seed=w_seed,
                    wrapped_salt=w_salt,
                )
            )

        # EnvironmentKey for each SSK service account
        for sa, w_seed, w_salt in sa_wrapped:
            env_keys.append(
                EnvironmentKey(
                    environment=environment,
                    service_account=sa,
                    identity_key=env_pub,
                    wrapped_seed=w_seed,
                    wrapped_salt=w_salt,
                )
            )

        EnvironmentKey.objects.bulk_create(env_keys)

        # ServerEnvironmentKey (always created for API-driven environments)
        ServerEnvironmentKey.objects.create(
            environment=environment,
            identity_key=env_pub,
            wrapped_seed=server_wrapped_seed,
            wrapped_salt=server_wrapped_salt,
        )

    return environment
