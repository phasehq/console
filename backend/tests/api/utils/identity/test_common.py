import json
from unittest.mock import MagicMock, patch

import pytest
from nacl.bindings import (
    crypto_kx_seed_keypair,
    crypto_sign_ed25519_pk_to_curve25519,
    crypto_sign_keypair,
)

from api.utils.crypto import encrypt_asymmetric
from api.utils.identity.common import mint_service_account_token

SA_UTILS = "api.utils.service_accounts"
ERROR = "Invalid service account keyring"
SERVER_PK, SERVER_SK = crypto_kx_seed_keypair(b"\x01" * 32)


def _keyring():
    public_key, private_key = crypto_sign_keypair()
    return {"publicKey": public_key.hex(), "privateKey": private_key.hex()}


def _kx_public(keyring):
    return crypto_sign_ed25519_pk_to_curve25519(
        bytes.fromhex(keyring["publicKey"])
    ).hex()


def _wrap(keyring):
    return encrypt_asymmetric(json.dumps(keyring), SERVER_PK.hex())


def _service_account(identity_key, stored_keyring):
    service_account = MagicMock()
    service_account.id = "sa-1"
    service_account.identity_key = identity_key
    service_account.server_wrapped_keyring = _wrap(stored_keyring)
    return service_account


def _identity(default_ttl=600, max_ttl=3600, token_name_pattern=None):
    identity = MagicMock()
    identity.default_ttl_seconds = default_ttl
    identity.max_ttl_seconds = max_ttl
    identity.token_name_pattern = token_name_pattern
    return identity


@pytest.fixture(autouse=True)
def server_keypair():
    with patch(f"{SA_UTILS}.get_server_keypair", return_value=(SERVER_PK, SERVER_SK)):
        yield


@patch("api.models.ServiceAccountToken")
def test_mint_refuses_stored_keyring_of_another_sa(mock_token_model):
    service_account = _service_account(_keyring()["publicKey"], _keyring())

    with pytest.raises(ValueError, match=ERROR):
        mint_service_account_token(service_account, _identity(), 600, "aws-iam")

    mock_token_model.objects.create.assert_not_called()


@patch("api.models.ServiceAccountToken")
def test_mint_refuses_stored_keyring_with_swapped_private_key(mock_token_model):
    own, foreign = _keyring(), _keyring()
    planted = {"publicKey": own["publicKey"], "privateKey": foreign["privateKey"]}
    service_account = _service_account(own["publicKey"], planted)

    with pytest.raises(ValueError, match=ERROR):
        mint_service_account_token(service_account, _identity(), 600, "azure-entra")

    mock_token_model.objects.create.assert_not_called()


@patch("api.models.ServiceAccountToken")
def test_mint_issues_token_for_sa_own_keyring(mock_token_model):
    keyring = _keyring()
    service_account = _service_account(keyring["publicKey"], keyring)

    auth = mint_service_account_token(
        service_account, _identity(max_ttl=900), 3600, "aws-iam"
    )

    created = mock_token_model.objects.create.call_args.kwargs
    assert created["service_account"] is service_account
    assert created["identity_key"] == _kx_public(keyring)
    assert created["name"] == "aws-iam"
    assert auth["tokenType"] == "ServiceAccount"
    assert auth["token"].split(":")[3] == _kx_public(keyring)
    assert auth["bearerToken"] == f"ServiceAccount {created['token']}"
    assert auth["TTL"] == 900
    assert auth["maxTTL"] == 900
