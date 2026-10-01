import json
from unittest.mock import MagicMock, patch

import pytest
from graphql import GraphQLError
from nacl.bindings import (
    crypto_kx_seed_keypair,
    crypto_sign_ed25519_pk_to_curve25519,
    crypto_sign_keypair,
)
from nacl.signing import SigningKey

from api.utils.crypto import encrypt_asymmetric
from api.utils.service_accounts import (
    unwrap_server_managed_sa_keyring,
    unwrap_server_wrapped,
)

MUTATIONS = "backend.graphene.mutations.service_accounts"
SA_UTILS = "api.utils.service_accounts"
ERROR = "Invalid service account keyring"
SERVER_PK, SERVER_SK = crypto_kx_seed_keypair(b"\x01" * 32)
OTHER_SERVER_PK, _ = crypto_kx_seed_keypair(b"\x02" * 32)
MNEMONIC = "abandon ability able about above absent absorb abstract absurd abuse access accident"


class _DoesNotExist(Exception):
    pass


def _info():
    info = MagicMock()
    info.context.user = MagicMock()
    return info


def _keyring():
    """Real Ed25519 keyring in the client-side JSON shape."""
    public_key, private_key = crypto_sign_keypair()
    return {"publicKey": public_key.hex(), "privateKey": private_key.hex()}


def _kx_public(keyring):
    return crypto_sign_ed25519_pk_to_curve25519(
        bytes.fromhex(keyring["publicKey"])
    ).hex()


def _wrap(payload, server_pk=SERVER_PK):
    if not isinstance(payload, str):
        payload = json.dumps(payload)
    return encrypt_asymmetric(payload, server_pk.hex())


def _service_account(identity_key, server_wrapped_keyring=None):
    service_account = MagicMock()
    service_account.identity_key = identity_key
    service_account.name = "ci-bot"
    service_account.server_wrapped_keyring = server_wrapped_keyring
    service_account.server_wrapped_recovery = None
    return service_account


def _soft_deleted_lookup(service_account):
    """ORM stand-in for a soft-deleted row: only an unfiltered lookup returns it."""

    def get(**kwargs):
        if "deleted_at" in kwargs and kwargs["deleted_at"] is None:
            raise _DoesNotExist()
        return service_account

    return get


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
    ), patch(
        f"{SA_UTILS}.get_server_keypair", return_value=(SERVER_PK, SERVER_SK)
    ):
        sa_model.DoesNotExist = _DoesNotExist
        yield sa_model, token_model, sa_permission


def _enable_ssk(server_wrapped_keyring, server_wrapped_recovery=None):
    from backend.graphene.mutations.service_accounts import (
        EnableServiceAccountServerSideKeyManagementMutation,
    )

    return EnableServiceAccountServerSideKeyManagementMutation.mutate(
        None,
        _info(),
        service_account_id="sa-1",
        server_wrapped_keyring=server_wrapped_keyring,
        server_wrapped_recovery=server_wrapped_recovery,
    )


def _mint_server_side():
    from backend.graphene.mutations.service_accounts import (
        CreateServerSideServiceAccountTokenMutation,
    )

    return CreateServerSideServiceAccountTokenMutation.mutate(
        None, _info(), service_account_id="sa-1", name="deploy", expiry=None
    )


def _mint_client_side(keyring):
    from backend.graphene.mutations.service_accounts import (
        CreateServiceAccountTokenMutation,
    )

    signing_key = SigningKey(bytes.fromhex(keyring["privateKey"])[:32])
    identity_key = _kx_public(keyring)
    token, wrapped_key_share = "ab" * 32, "cd" * 56
    message = f"{token}:{identity_key}:{wrapped_key_share}".encode("utf-8")
    return CreateServiceAccountTokenMutation.mutate(
        None,
        _info(),
        service_account_id="sa-1",
        name="deploy",
        identity_key=identity_key,
        token=token,
        wrapped_key_share=wrapped_key_share,
        expiry=None,
        signature=signing_key.sign(message).signature.hex(),
    )


# --- EnableServiceAccountServerSideKeyManagement ---


def test_enable_ssk_stores_keyring_bound_to_sa(mutation_env):
    sa_model, _, sa_permission = mutation_env
    keyring = _keyring()
    service_account = _service_account(keyring["publicKey"])
    sa_model.objects.get.return_value = service_account
    wrapped_keyring, wrapped_recovery = _wrap(keyring), _wrap(MNEMONIC)

    result = _enable_ssk(wrapped_keyring, wrapped_recovery)

    sa_permission.assert_called_once()
    assert sa_permission.call_args[0][1:] == (
        service_account,
        "update",
        "ServiceAccounts",
    )
    assert service_account.server_wrapped_keyring == wrapped_keyring
    assert service_account.server_wrapped_recovery == wrapped_recovery
    service_account.save.assert_called_once()
    assert result.service_account is service_account


def test_enable_ssk_identity_key_comparison_is_hex_case_insensitive(mutation_env):
    sa_model, _, _ = mutation_env
    keyring = _keyring()
    service_account = _service_account(keyring["publicKey"].upper())
    sa_model.objects.get.return_value = service_account

    _enable_ssk(_wrap(keyring), _wrap(MNEMONIC))

    service_account.save.assert_called_once()


def test_enable_ssk_rejects_keyring_of_another_sa(mutation_env):
    sa_model, _, _ = mutation_env
    service_account = _service_account(_keyring()["publicKey"])
    sa_model.objects.get.return_value = service_account

    with pytest.raises(GraphQLError, match=ERROR):
        _enable_ssk(_wrap(_keyring()), _wrap(MNEMONIC))

    assert service_account.server_wrapped_keyring is None
    service_account.save.assert_not_called()


def test_enable_ssk_rejects_keyring_with_swapped_private_key(mutation_env):
    # Public half is the SA's own, private half belongs to someone else
    sa_model, _, _ = mutation_env
    own, foreign = _keyring(), _keyring()
    service_account = _service_account(own["publicKey"])
    sa_model.objects.get.return_value = service_account
    planted = {"publicKey": own["publicKey"], "privateKey": foreign["privateKey"]}

    with pytest.raises(GraphQLError, match=ERROR):
        _enable_ssk(_wrap(planted), _wrap(MNEMONIC))

    service_account.save.assert_not_called()


@pytest.mark.parametrize(
    "wrapped_keyring",
    [
        None,
        "",
        "not-a-ciphertext",
        "ph:v1:zz:zz",
        "ph:v1:" + "00" * 32 + ":deadbeef",
        _wrap("not json"),
        _wrap([]),
        _wrap({"publicKey": "aa" * 32}),
        _wrap({"publicKey": "aa" * 32, "privateKey": "not-hex"}),
        _wrap({"publicKey": "aa" * 32, "privateKey": "bb" * 32}),
        _wrap(_keyring(), server_pk=OTHER_SERVER_PK),
    ],
)
def test_enable_ssk_rejects_undecryptable_or_malformed_keyring(
    mutation_env, wrapped_keyring
):
    sa_model, _, _ = mutation_env
    service_account = _service_account("aa" * 32)
    sa_model.objects.get.return_value = service_account

    with pytest.raises(GraphQLError, match=ERROR):
        _enable_ssk(wrapped_keyring, _wrap(MNEMONIC))

    service_account.save.assert_not_called()


@pytest.mark.parametrize("wrapped_recovery", ["", "garbage", "ph:v1:zz:zz"])
def test_enable_ssk_rejects_undecryptable_recovery(mutation_env, wrapped_recovery):
    sa_model, _, _ = mutation_env
    keyring = _keyring()
    service_account = _service_account(keyring["publicKey"])
    sa_model.objects.get.return_value = service_account

    with pytest.raises(GraphQLError, match=ERROR):
        _enable_ssk(_wrap(keyring), wrapped_recovery)

    service_account.save.assert_not_called()


def test_enable_ssk_permission_guard_runs_before_keyring_check(mutation_env):
    sa_model, _, sa_permission = mutation_env
    service_account = _service_account(_keyring()["publicKey"])
    sa_model.objects.get.return_value = service_account
    sa_permission.side_effect = GraphQLError("You don't have permission")

    with pytest.raises(GraphQLError, match="You don't have permission"):
        _enable_ssk("garbage")

    service_account.save.assert_not_called()


def test_enable_ssk_refuses_soft_deleted_sa(mutation_env):
    sa_model, _, _ = mutation_env
    keyring = _keyring()
    service_account = _service_account(keyring["publicKey"])
    sa_model.objects.get.side_effect = _soft_deleted_lookup(service_account)

    with pytest.raises(_DoesNotExist):
        _enable_ssk(_wrap(keyring), _wrap(MNEMONIC))

    service_account.save.assert_not_called()


# --- CreateServerSideServiceAccountToken ---


def test_server_side_token_mints_from_sa_keyring(mutation_env):
    sa_model, token_model, sa_permission = mutation_env
    keyring = _keyring()
    service_account = _service_account(keyring["publicKey"], _wrap(keyring))
    sa_model.objects.get.return_value = service_account

    result = _mint_server_side()

    assert sa_permission.call_args[0][1:] == (
        service_account,
        "create",
        "ServiceAccountTokens",
    )
    created = token_model.objects.create.call_args.kwargs
    assert created["identity_key"] == _kx_public(keyring)
    assert result.token_string.split(":")[3] == _kx_public(keyring)
    assert result.token is token_model.objects.create.return_value


def test_server_side_token_refuses_stored_keyring_of_another_sa(mutation_env):
    sa_model, token_model, _ = mutation_env
    service_account = _service_account(_keyring()["publicKey"], _wrap(_keyring()))
    sa_model.objects.get.return_value = service_account

    with pytest.raises(GraphQLError, match=ERROR):
        _mint_server_side()

    token_model.objects.create.assert_not_called()


def test_server_side_token_refuses_stored_keyring_with_swapped_private_key(
    mutation_env,
):
    sa_model, token_model, _ = mutation_env
    own, foreign = _keyring(), _keyring()
    planted = {"publicKey": own["publicKey"], "privateKey": foreign["privateKey"]}
    sa_model.objects.get.return_value = _service_account(
        own["publicKey"], _wrap(planted)
    )

    with pytest.raises(GraphQLError, match=ERROR):
        _mint_server_side()

    token_model.objects.create.assert_not_called()


def test_server_side_token_refuses_corrupt_stored_keyring(mutation_env):
    sa_model, token_model, _ = mutation_env
    sa_model.objects.get.return_value = _service_account(
        _keyring()["publicKey"], "ph:v1:zz:zz"
    )

    with pytest.raises(GraphQLError, match=ERROR):
        _mint_server_side()

    token_model.objects.create.assert_not_called()


def test_server_side_token_refuses_soft_deleted_sa(mutation_env):
    sa_model, token_model, _ = mutation_env
    keyring = _keyring()
    service_account = _service_account(keyring["publicKey"], _wrap(keyring))
    sa_model.objects.get.side_effect = _soft_deleted_lookup(service_account)

    with pytest.raises(_DoesNotExist):
        _mint_server_side()

    token_model.objects.create.assert_not_called()


# --- CreateServiceAccountToken (client-side keyring) ---


def test_client_side_token_refuses_soft_deleted_sa(mutation_env):
    sa_model, token_model, _ = mutation_env
    keyring = _keyring()
    service_account = _service_account(keyring["publicKey"])
    sa_model.objects.get.side_effect = _soft_deleted_lookup(service_account)

    with pytest.raises(_DoesNotExist):
        _mint_client_side(keyring)

    token_model.objects.create.assert_not_called()


def test_client_side_token_mints_for_live_sa(mutation_env):
    # Control for the deleted-SA case: same material, live row, token created
    sa_model, token_model, _ = mutation_env
    keyring = _keyring()
    sa_model.objects.get.return_value = _service_account(keyring["publicKey"])

    result = _mint_client_side(keyring)

    assert sa_model.objects.get.call_args.kwargs["deleted_at"] is None
    assert result.token is token_model.objects.create.return_value


# --- CreateServiceAccount ---


def test_create_sa_rejects_foreign_server_keyring(mutation_env):
    from backend.graphene.mutations.service_accounts import (
        CreateServiceAccountMutation,
    )

    sa_model, _, _ = mutation_env
    own, foreign = _keyring(), _keyring()

    with patch(f"{MUTATIONS}.Organisation"), patch(f"{MUTATIONS}.Role"), patch(
        f"{MUTATIONS}.user_has_permission", return_value=True
    ), patch(f"{MUTATIONS}._validate_handler_members"), patch(
        f"{MUTATIONS}.role_has_global_access", return_value=False
    ), patch(f"{MUTATIONS}.role_assignment_error", return_value=None):
        with pytest.raises(GraphQLError, match=ERROR):
            CreateServiceAccountMutation.mutate(
                None,
                _info(),
                name="new-sa",
                organisation_id="org-1",
                role_id="role-1",
                handlers=[MagicMock()],
                identity_key=own["publicKey"],
                server_wrapped_keyring=_wrap(foreign),
                server_wrapped_recovery=_wrap(MNEMONIC),
            )

    sa_model.objects.create.assert_not_called()


def test_create_sa_rejects_recovery_without_keyring(mutation_env):
    # Half-supplied SSK material must never be stored
    from backend.graphene.mutations.service_accounts import (
        CreateServiceAccountMutation,
    )

    sa_model, _, _ = mutation_env

    with patch(f"{MUTATIONS}.Organisation"), patch(f"{MUTATIONS}.Role"), patch(
        f"{MUTATIONS}.user_has_permission", return_value=True
    ), patch(f"{MUTATIONS}._validate_handler_members"), patch(
        f"{MUTATIONS}.role_has_global_access", return_value=False
    ), patch(f"{MUTATIONS}.role_assignment_error", return_value=None):
        with pytest.raises(GraphQLError, match=ERROR):
            CreateServiceAccountMutation.mutate(
                None,
                _info(),
                name="new-sa",
                organisation_id="org-1",
                role_id="role-1",
                handlers=[MagicMock()],
                identity_key=_keyring()["publicKey"],
                server_wrapped_keyring=None,
                server_wrapped_recovery=_wrap(MNEMONIC),
            )

    sa_model.objects.create.assert_not_called()


# --- helper ---


def test_unwrap_server_managed_sa_keyring_round_trip():
    keyring = _keyring()
    with patch(f"{SA_UTILS}.get_server_keypair", return_value=(SERVER_PK, SERVER_SK)):
        assert (
            unwrap_server_managed_sa_keyring(_wrap(keyring), keyring["publicKey"])
            == keyring
        )
        assert unwrap_server_wrapped(_wrap(MNEMONIC)) == MNEMONIC

        with pytest.raises(ValueError, match=ERROR):
            unwrap_server_managed_sa_keyring(_wrap(keyring), _keyring()["publicKey"])
        with pytest.raises(ValueError, match=ERROR):
            unwrap_server_managed_sa_keyring(_wrap(keyring), None)
        with pytest.raises(ValueError, match=ERROR):
            unwrap_server_managed_sa_keyring(_wrap(keyring), "not-hex")
        with pytest.raises(ValueError, match=ERROR):
            unwrap_server_wrapped("garbage")
        with pytest.raises(ValueError, match=ERROR):
            unwrap_server_wrapped(None)
