import re
from nacl.hash import blake2b
from nacl.utils import random
from base64 import b64encode, b64decode
from django.conf import settings
from nacl.bindings import (
    crypto_kx_seed_keypair,
    crypto_kx_keypair,
    crypto_aead_xchacha20poly1305_ietf_encrypt,
    crypto_aead_xchacha20poly1305_ietf_decrypt,
    crypto_kx_client_session_keys,
    crypto_kx_server_session_keys,
    crypto_secretbox_NONCEBYTES,
    crypto_generichash,
)
from nacl.encoding import RawEncoder
from typing import Tuple
from typing import List

PREFIX = "ph"
VERSION = 1


def get_server_keypair():
    """
    Derives the server key exchange keypair.

    Returns:
        Tuple[bytes, bytes]: A tuple of two bytes objects representing the public and
        private keys of the keypair.
    """
    seed = getattr(settings, "SERVER_SECRET")
    seed_bytes = bytes.fromhex(seed)
    pk, sk = crypto_kx_seed_keypair(seed_bytes)

    return pk, sk


def random_key_pair() -> Tuple[bytes, bytes]:
    """
    Generates a random key exchange keypair.

    Returns:
        Tuple[bytes, bytes]: A tuple of two bytes objects representing the public and
        private keys of the keypair.
    """
    keypair = crypto_kx_keypair()
    return keypair


def client_session_keys(ephemeral_key_pair, recipient_pub_key):
    client_public_key, client_private_key = ephemeral_key_pair
    return crypto_kx_client_session_keys(
        client_public_key, client_private_key, recipient_pub_key
    )


def server_session_keys(app_key_pair, data_pub_key):
    server_public_key, server_private_key = app_key_pair
    return crypto_kx_server_session_keys(
        server_public_key, server_private_key, data_pub_key
    )


def encrypt_asymmetric(plaintext, public_key_hex):
    public_key, private_key = random_key_pair()

    symmetric_keys = client_session_keys(
        (public_key, private_key), bytes.fromhex(public_key_hex)
    )

    ciphertext = encrypt_string(plaintext, symmetric_keys[1])

    return f"{PREFIX}:v{VERSION}:{public_key.hex()}:{ciphertext}"


def decrypt_asymmetric(ciphertext_string, private_key_hex, public_key_hex):
    ciphertext_segments = ciphertext_string.split(":")

    if len(ciphertext_segments) != 4:
        raise ValueError("Invalid ciphertext")

    public_key = bytes.fromhex(public_key_hex)
    private_key = bytes.fromhex(private_key_hex)

    session_keys = server_session_keys(
        (public_key, private_key), bytes.fromhex(ciphertext_segments[2])
    )

    plaintext = decrypt_string(ciphertext_segments[3], session_keys[0])

    return plaintext


def encrypt_raw(plaintext, key):
    nonce = random(crypto_secretbox_NONCEBYTES)
    ciphertext = crypto_aead_xchacha20poly1305_ietf_encrypt(
        plaintext.encode(), None, nonce, key
    )
    return bytearray(ciphertext + nonce)


def decrypt_raw(ct, key) -> bytes:
    try:
        nonce = ct[-24:]
        ciphertext = ct[:-24]
        plaintext_bytes = crypto_aead_xchacha20poly1305_ietf_decrypt(
            ciphertext, None, nonce, key
        )
        return plaintext_bytes
    except Exception as e:
        print(f"Exception during decryption: {e}")
        raise ValueError("Decryption error") from e


def encrypt_b64(plaintext, key_bytes) -> str:
    """
    Encrypts a string using a key. Returns ciphertext as a base64 string

    Args:
        plaintext (str): The plaintext to encrypt.
        key (bytes): The key to use for encryption.

    Returns:
        str: The ciphertext obtained by encrypting the string with the key, encoded with base64.
    """

    plaintext_bytes = bytes(plaintext, "utf-8")
    ciphertext = encrypt_raw(plaintext_bytes, key_bytes)
    return b64encode(ciphertext).decode("utf-8")


def decrypt_b64(ct, key) -> bytes:
    """
    Decrypts a base64 ciphertext using a key.

    Args:
        ct (str): The ciphertext to decrypt, as a base64 string.
        key (str): The key to use for decryption, as a hexadecimal string.

    Returns:
        str: The plaintext obtained by decrypting the ciphertext with the key.
    """

    ct_bytes = b64decode(ct)
    key_bytes = bytes.fromhex(key)

    plaintext_bytes = decrypt_raw(ct_bytes, key_bytes)

    return plaintext_bytes.decode("utf-8")


def encrypt_string(plaintext, key):
    return b64encode(encrypt_raw(plaintext, key)).decode()


def decrypt_string(cipherText, key):
    return decrypt_raw(b64decode(cipherText), key).decode()


def env_keypair(env_seed: str):
    """
    Derives an env keyring from the given seed

    :param env_seed: Env seed as a hex string
    :return: A dictionary containing the public and private keys in hex format
    """

    # Convert the hex seed to bytes
    seed_bytes = bytes.fromhex(env_seed)

    # Generate the key pair
    public_key, private_key = crypto_kx_seed_keypair(seed_bytes)

    # Convert the keys to hex format
    public_key_hex = public_key.hex()
    private_key_hex = private_key.hex()

    # Return the keys in a tuple
    return public_key_hex, private_key_hex


def blake2b_digest(input_str: str, salt: str) -> str:
    """
    Generate a BLAKE2b hash of the input string with a salt.

    Args:
        input_str (str): The input string to be hashed.
        salt (str): The salt (key) used for hashing.

    Returns:
        str: The hexadecimal representation of the hash.
    """
    hash_size = 32  # 32 bytes (256 bits)
    hashed = blake2b(
        input_str.encode("utf-8"),
        key=salt.encode("utf-8"),
        encoder=RawEncoder,
        digest_size=hash_size,
    )
    hex_encoded = hashed.hex()
    return hex_encoded


def validate_encrypted_string(encrypted_string):
    """
    Validates if the given string matches the phase encrypted data format.

    The expected format is: `ph:v1:<public_key>:<ciphertext>`
    where:
    - `ph` is the fixed prefix.
    - `v1` is the fixed version.
    - `<public_key>` is a hexadecimal string.
    - `<ciphertext>` is a Base64-encoded string.

    Parameters:
    encrypted_string (str): The encrypted string to validate.

    Returns:
    bool: True if the string matches the expected format, False otherwise.
    """
    if encrypted_string:
        # Define the regular expression pattern for an encrypted string
        pattern = re.compile(f"ph:v{VERSION}:[0-9a-fA-F]{{64}}:.+")

        # Match the string against the pattern
        match = re.match(pattern, encrypted_string)

        # Return True if it matches, otherwise False
        return bool(match)

    return True
