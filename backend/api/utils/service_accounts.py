"""
Server-side utilities for creating service accounts with server-managed
cryptographic keys.

This generates an Ed25519 signing keypair for the service account, wraps it
with the server's public key (asymmetric encryption), and stores it as
``server_wrapped_keyring`` — enabling the server to later unwrap the keys
for operations like minting tokens or wrapping environment secrets.
"""

import json

from nacl.bindings import crypto_sign_keypair, crypto_sign_seed_keypair

from api.utils.crypto import decrypt_asymmetric, encrypt_asymmetric, get_server_keypair

INVALID_SA_KEYRING = "Invalid service account keyring"


def generate_server_managed_sa_keys() -> tuple[str, str, str]:
    """
    Generate a new Ed25519 keypair and wrap it for server-side key management.

    Returns:
        A tuple of ``(identity_key, server_wrapped_keyring, server_wrapped_recovery)``:

        - **identity_key**: The Ed25519 public key as a hex string.
        - **server_wrapped_keyring**: The JSON-encoded keyring
          ``{"publicKey": ..., "privateKey": ...}`` encrypted with the server's
          public key in ``ph:v1:...`` format.
        - **server_wrapped_recovery**: Same payload encrypted a second time as
          the recovery copy.
    """
    # Generate a random Ed25519 signing keypair
    ed_pub, ed_priv = crypto_sign_keypair()

    identity_key = ed_pub.hex()

    # Build the keyring JSON that mirrors the client-side format
    keyring_json = json.dumps(
        {
            "publicKey": ed_pub.hex(),
            "privateKey": ed_priv.hex(),
        }
    )

    # Wrap with the server's public key
    server_pk, _server_sk = get_server_keypair()
    server_wrapped_keyring = encrypt_asymmetric(keyring_json, server_pk.hex())
    server_wrapped_recovery = encrypt_asymmetric(keyring_json, server_pk.hex())

    return identity_key, server_wrapped_keyring, server_wrapped_recovery


def unwrap_server_wrapped(ciphertext: str) -> str:
    """
    Decrypt a ``ph:v1:...`` payload that was wrapped for the server keypair.

    Raises:
        ValueError: on any malformed or undecryptable input, so callers fail closed.
    """
    # A server-key fault must surface as a server error, not a rejected keyring
    server_pk, server_sk = get_server_keypair()
    try:
        return decrypt_asymmetric(ciphertext, server_sk.hex(), server_pk.hex())
    except Exception as e:
        raise ValueError(INVALID_SA_KEYRING) from e


def unwrap_server_managed_sa_keyring(
    server_wrapped_keyring: str, identity_key: str
) -> dict:
    """
    Decrypt a server-wrapped keyring and prove it belongs to the service
    account whose Ed25519 public key is ``identity_key``.

    The keyring's public key must equal ``identity_key`` and its private key
    must derive that public key, so neither a foreign keyring nor one with a
    swapped private half can ever mint tokens or receive wrapped secrets.

    Returns:
        The decoded ``{"publicKey": ..., "privateKey": ...}`` keyring.

    Raises:
        ValueError: on any decrypt/parse failure or mismatch, so callers fail closed.
    """
    try:
        keyring = json.loads(unwrap_server_wrapped(server_wrapped_keyring))
        public_key = bytes.fromhex(keyring["publicKey"])
        private_key = bytes.fromhex(keyring["privateKey"])
        derived_public_key, derived_private_key = crypto_sign_seed_keypair(
            private_key[:32]
        )
        valid = (
            public_key == bytes.fromhex(identity_key)
            and derived_public_key == public_key
            and derived_private_key == private_key
        )
    except Exception:
        valid = False
    if not valid:
        raise ValueError(INVALID_SA_KEYRING)
    return keyring
