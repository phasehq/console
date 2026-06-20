"""
Server-side utilities for creating service accounts with server-managed
cryptographic keys.

This generates an Ed25519 signing keypair for the service account, wraps it
with the server's public key (asymmetric encryption), and stores it as
``server_wrapped_keyring`` — enabling the server to later unwrap the keys
for operations like minting tokens or wrapping environment secrets.
"""

import json

from nacl.bindings import crypto_sign_keypair

from api.utils.crypto import encrypt_asymmetric, get_server_keypair


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
