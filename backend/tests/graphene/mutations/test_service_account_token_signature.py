from unittest.mock import MagicMock, patch

import pytest
from graphql import GraphQLError
from nacl.bindings import crypto_sign_ed25519_pk_to_curve25519, crypto_sign_seed_keypair
from nacl.signing import SigningKey

from api.utils.crypto import ed25519_pk_to_kx, ed25519_to_kx, verify_ed25519_signature

MUTATIONS = "backend.graphene.mutations.service_accounts"
TOKEN = "ab" * 32
WRAPPED_KEY_SHARE = "cd" * 56
ERROR = "Invalid service account token material"


def _info():
    info = MagicMock()
    info.context.user = MagicMock()
    return info


def _sa_keyring():
    """Real Ed25519 keypair: (signing_key, ed_public_hex, kx_public_hex)."""
    signing_key = SigningKey.generate()
    ed_public = signing_key.verify_key.encode()
    return (
        signing_key,
        ed_public.hex(),
        crypto_sign_ed25519_pk_to_curve25519(ed_public).hex(),
    )


def _sign(signing_key, token, identity_key, wrapped_key_share):
    message = f"{token}:{identity_key}:{wrapped_key_share}".encode("utf-8")
    return signing_key.sign(message).signature.hex()


def _service_account(ed_public_key):
    service_account = MagicMock()
    service_account.identity_key = ed_public_key
    service_account.name = "ci-bot"
    return service_account


@pytest.fixture
def mutation_env():
    with patch(f"{MUTATIONS}.ServiceAccount") as sa_model, patch(
        f"{MUTATIONS}.OrganisationMember"
    ), patch(f"{MUTATIONS}.ServiceAccountToken") as token_model, patch(
        f"{MUTATIONS}._check_sa_permission"
    ) as sa_permission, patch(f"{MUTATIONS}.log_audit_event"), patch(
        f"{MUTATIONS}.get_actor_info_from_graphql",
        return_value=("user", "member-1", {}),
    ), patch(
        f"{MUTATIONS}.get_resolver_request_meta",
        return_value=("127.0.0.1", "pytest"),
    ):
        yield sa_model, token_model, sa_permission


def _mutate(
    identity_key, signature, token=TOKEN, wrapped_key_share=WRAPPED_KEY_SHARE
):
    from backend.graphene.mutations.service_accounts import (
        CreateServiceAccountTokenMutation,
    )

    return CreateServiceAccountTokenMutation.mutate(
        None,
        _info(),
        service_account_id="sa-1",
        name="deploy",
        identity_key=identity_key,
        token=token,
        wrapped_key_share=wrapped_key_share,
        expiry=None,
        signature=signature,
    )


def test_valid_signature_creates_token(mutation_env):
    sa_model, token_model, sa_permission = mutation_env
    signing_key, ed_public, kx_public = _sa_keyring()
    service_account = _service_account(ed_public)
    sa_model.objects.get.return_value = service_account

    result = _mutate(kx_public, _sign(signing_key, TOKEN, kx_public, WRAPPED_KEY_SHARE))

    sa_permission.assert_called_once()
    assert sa_permission.call_args[0][1:] == (
        service_account,
        "create",
        "ServiceAccountTokens",
    )
    token_model.objects.create.assert_called_once()
    created = token_model.objects.create.call_args.kwargs
    assert created["identity_key"] == kx_public
    assert created["token"] == TOKEN
    assert created["wrapped_key_share"] == WRAPPED_KEY_SHARE
    assert result.token is token_model.objects.create.return_value


def test_signature_from_other_key_is_rejected(mutation_env):
    sa_model, token_model, _ = mutation_env
    _, ed_public, kx_public = _sa_keyring()
    sa_model.objects.get.return_value = _service_account(ed_public)
    other_signing_key, _, _ = _sa_keyring()

    with pytest.raises(GraphQLError, match=ERROR):
        _mutate(kx_public, _sign(other_signing_key, TOKEN, kx_public, WRAPPED_KEY_SHARE))

    token_model.objects.create.assert_not_called()


def test_tampered_material_is_rejected(mutation_env):
    sa_model, token_model, _ = mutation_env
    signing_key, ed_public, kx_public = _sa_keyring()
    sa_model.objects.get.return_value = _service_account(ed_public)
    signature = _sign(signing_key, TOKEN, kx_public, WRAPPED_KEY_SHARE)

    with pytest.raises(GraphQLError, match=ERROR):
        _mutate(kx_public, signature, token="ff" * 32)

    with pytest.raises(GraphQLError, match=ERROR):
        _mutate(kx_public, signature, wrapped_key_share="ee" * 56)

    token_model.objects.create.assert_not_called()


@pytest.mark.parametrize("signature", ["not-hex", "ab", "", "zz" * 64])
def test_malformed_signature_is_rejected(mutation_env, signature):
    sa_model, token_model, _ = mutation_env
    _, ed_public, kx_public = _sa_keyring()
    sa_model.objects.get.return_value = _service_account(ed_public)

    with pytest.raises(GraphQLError, match=ERROR):
        _mutate(kx_public, signature)

    token_model.objects.create.assert_not_called()


def test_identity_key_not_derived_from_sa_is_rejected(mutation_env):
    # Correctly signed by the SA key, but the row would carry a foreign kx key
    sa_model, token_model, _ = mutation_env
    signing_key, ed_public, _ = _sa_keyring()
    sa_model.objects.get.return_value = _service_account(ed_public)
    _, _, foreign_kx_public = _sa_keyring()

    with pytest.raises(GraphQLError, match=ERROR):
        _mutate(
            foreign_kx_public,
            _sign(signing_key, TOKEN, foreign_kx_public, WRAPPED_KEY_SHARE),
        )

    token_model.objects.create.assert_not_called()


@pytest.mark.parametrize("sa_identity_key", [None, "", "not-hex", "ab" * 16])
def test_sa_without_usable_identity_key_is_rejected(mutation_env, sa_identity_key):
    sa_model, token_model, _ = mutation_env
    signing_key, _, kx_public = _sa_keyring()
    sa_model.objects.get.return_value = _service_account(sa_identity_key)

    with pytest.raises(GraphQLError, match=ERROR):
        _mutate(kx_public, _sign(signing_key, TOKEN, kx_public, WRAPPED_KEY_SHARE))

    token_model.objects.create.assert_not_called()


def test_permission_guard_runs_before_signature_check(mutation_env):
    sa_model, token_model, sa_permission = mutation_env
    _, ed_public, kx_public = _sa_keyring()
    sa_model.objects.get.return_value = _service_account(ed_public)
    sa_permission.side_effect = GraphQLError("You don't have permission")

    with pytest.raises(GraphQLError, match="You don't have permission"):
        _mutate(kx_public, "not-hex")

    token_model.objects.create.assert_not_called()


def test_verify_ed25519_signature_round_trip():
    signing_key, ed_public, _ = _sa_keyring()
    message = b"hello"
    signature = signing_key.sign(message).signature.hex()

    assert verify_ed25519_signature(message, signature, ed_public)
    assert not verify_ed25519_signature(b"hellp", signature, ed_public)
    assert not verify_ed25519_signature(message, signature[:-2], ed_public)
    assert not verify_ed25519_signature(message, signature, "zz" * 32)
    assert not verify_ed25519_signature(message, signature, "ab" * 16)
    assert not verify_ed25519_signature(message, signature, None)


def test_ed25519_pk_to_kx_matches_server_mint_derivation():
    seed = bytes(SigningKey.generate())
    ed_public, ed_private = crypto_sign_seed_keypair(seed)

    kx_public, _ = ed25519_to_kx(ed_public.hex(), ed_private.hex())

    assert ed25519_pk_to_kx(ed_public.hex()) == kx_public
    with pytest.raises(ValueError):
        ed25519_pk_to_kx("not-hex")
    with pytest.raises(TypeError):
        ed25519_pk_to_kx(None)
