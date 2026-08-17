import json
import pytest
from unittest.mock import MagicMock, patch, PropertyMock

from api.utils.environments import (
    _ed25519_pk_to_curve25519,
    _generate_env_salt,
    _generate_env_seed,
    _wrap_env_secrets_for_key,
    _wrap_for_server,
    _wrap_for_service_account,
    _wrap_for_user,
    create_environment,
    get_global_access_members,
    get_ssk_service_accounts_for_app,
    ENV_NAME_RE,
)


# ---------------------------------------------------------------------------
# ENV_NAME_RE
# ---------------------------------------------------------------------------


class TestEnvNameRegex:
    def test_valid_names(self):
        assert ENV_NAME_RE.match("Development")
        assert ENV_NAME_RE.match("staging-1")
        assert ENV_NAME_RE.match("prod_v2")
        assert ENV_NAME_RE.match("a")
        assert ENV_NAME_RE.match("A" * 64)

    def test_invalid_names(self):
        assert not ENV_NAME_RE.match("")
        assert not ENV_NAME_RE.match("has space")
        assert not ENV_NAME_RE.match("special!")
        assert not ENV_NAME_RE.match("A" * 65)
        assert not ENV_NAME_RE.match("env.name")


# ---------------------------------------------------------------------------
# Seed / salt generation
# ---------------------------------------------------------------------------


@patch("api.utils.environments.random_hex")
def test_generate_env_seed(mock_random_hex):
    mock_random_hex.return_value = "aa" * 32
    result = _generate_env_seed()
    mock_random_hex.assert_called_once_with(32)
    assert result == "aa" * 32


@patch("api.utils.environments.random_hex")
def test_generate_env_salt(mock_random_hex):
    mock_random_hex.return_value = "bb" * 32
    result = _generate_env_salt()
    mock_random_hex.assert_called_once_with(32)
    assert result == "bb" * 32


# ---------------------------------------------------------------------------
# Wrapping helpers
# ---------------------------------------------------------------------------


@patch("api.utils.environments.encrypt_asymmetric")
def test_wrap_env_secrets_for_key(mock_encrypt):
    mock_encrypt.side_effect = ["wrapped_seed_ct", "wrapped_salt_ct"]

    w_seed, w_salt = _wrap_env_secrets_for_key("seed_hex", "salt_hex", "pubkey_hex")

    assert w_seed == "wrapped_seed_ct"
    assert w_salt == "wrapped_salt_ct"
    assert mock_encrypt.call_count == 2
    mock_encrypt.assert_any_call("seed_hex", "pubkey_hex")
    mock_encrypt.assert_any_call("salt_hex", "pubkey_hex")


@patch("api.utils.environments._wrap_env_secrets_for_key")
@patch("api.utils.environments._ed25519_pk_to_curve25519")
def test_wrap_for_user(mock_to_curve, mock_wrap):
    mock_to_curve.return_value = "curve25519_pub"
    mock_wrap.return_value = ("w_seed", "w_salt")

    member = MagicMock()
    member.identity_key = "ed25519_pub_hex"

    result = _wrap_for_user("seed", "salt", member)

    mock_to_curve.assert_called_once_with("ed25519_pub_hex")
    mock_wrap.assert_called_once_with("seed", "salt", "curve25519_pub")
    assert result == ("w_seed", "w_salt")


@patch("api.utils.environments._wrap_env_secrets_for_key")
@patch("api.utils.environments.get_server_keypair")
def test_wrap_for_server(mock_keypair, mock_wrap):
    mock_keypair.return_value = (b"\x01" * 32, b"\x02" * 32)
    mock_wrap.return_value = ("server_w_seed", "server_w_salt")

    w_seed, w_salt, pk_hex = _wrap_for_server("seed", "salt")

    expected_pk = (b"\x01" * 32).hex()
    mock_wrap.assert_called_once_with("seed", "salt", expected_pk)
    assert w_seed == "server_w_seed"
    assert w_salt == "server_w_salt"
    assert pk_hex == expected_pk


@patch("api.utils.environments._wrap_env_secrets_for_key")
@patch("api.utils.environments._ed25519_pk_to_curve25519")
@patch("api.utils.environments.decrypt_asymmetric")
@patch("api.utils.environments.get_server_keypair")
def test_wrap_for_service_account_ssk_enabled(
    mock_keypair, mock_decrypt, mock_to_curve, mock_wrap
):
    mock_keypair.return_value = (b"\x01" * 32, b"\x02" * 32)
    keyring = {"publicKey": "sa_ed25519_pub", "privateKey": "sa_ed25519_priv"}
    mock_decrypt.return_value = json.dumps(keyring)
    mock_to_curve.return_value = "sa_curve25519_pub"
    mock_wrap.return_value = ("sa_w_seed", "sa_w_salt")

    sa = MagicMock()
    sa.server_wrapped_keyring = "encrypted_keyring"

    result = _wrap_for_service_account("seed", "salt", sa)

    assert result == ("sa_w_seed", "sa_w_salt")
    mock_to_curve.assert_called_once_with("sa_ed25519_pub")
    mock_wrap.assert_called_once_with("seed", "salt", "sa_curve25519_pub")


def test_wrap_for_service_account_ssk_not_enabled():
    sa = MagicMock()
    sa.server_wrapped_keyring = None

    result = _wrap_for_service_account("seed", "salt", sa)
    assert result is None


# ---------------------------------------------------------------------------
# Ed25519 → Curve25519 conversion
# ---------------------------------------------------------------------------


@patch("nacl.bindings.crypto_sign_ed25519_pk_to_curve25519")
def test_ed25519_pk_to_curve25519(mock_convert):
    mock_convert.return_value = b"\xab" * 32
    result = _ed25519_pk_to_curve25519("cd" * 32)
    mock_convert.assert_called_once_with(bytes.fromhex("cd" * 32))
    assert result == "ab" * 32


# ---------------------------------------------------------------------------
# Query helpers
# ---------------------------------------------------------------------------


@patch("api.utils.environments.OrganisationMember")
@patch("api.utils.environments.Role")
def test_get_global_access_members(mock_role_model, mock_member_model):
    org = MagicMock()

    mock_roles_qs = MagicMock()
    mock_role_model.objects.filter.return_value = mock_roles_qs

    member1 = MagicMock()
    member2 = MagicMock()
    mock_members_qs = MagicMock()
    mock_members_qs.select_related.return_value = [member1, member2]
    mock_member_model.objects.filter.return_value = mock_members_qs

    result = get_global_access_members(org)

    mock_role_model.objects.filter.assert_called_once()
    mock_member_model.objects.filter.assert_called_once()
    assert result == [member1, member2]


def test_get_ssk_service_accounts_for_app():
    app = MagicMock()
    sa1 = MagicMock()
    sa2 = MagicMock()
    app.service_accounts.filter.return_value = MagicMock()
    app.service_accounts.filter.return_value.__iter__ = MagicMock(
        return_value=iter([sa1, sa2])
    )

    # Calling list() on the mock queryset
    app.service_accounts.filter.return_value = [sa1, sa2]
    result = get_ssk_service_accounts_for_app(app)

    app.service_accounts.filter.assert_called_once_with(
        server_wrapped_keyring__isnull=False,
        deleted_at=None,
    )
    assert result == [sa1, sa2]


# ---------------------------------------------------------------------------
# create_environment (integration-style with mocks)
# ---------------------------------------------------------------------------


class TestCreateEnvironment:
    @patch("api.utils.environments.transaction")
    @patch("api.utils.environments.ServerEnvironmentKey")
    @patch("api.utils.environments.EnvironmentKey")
    @patch("api.utils.environments.Environment")
    @patch("api.utils.environments.get_ssk_service_accounts_for_app")
    @patch("api.utils.environments.get_global_access_members")
    @patch("api.utils.environments._wrap_for_server")
    @patch("api.utils.environments._wrap_for_user")
    @patch("api.utils.environments.env_keypair")
    @patch("api.utils.environments._generate_env_salt")
    @patch("api.utils.environments._generate_env_seed")
    def test_creates_environment_with_all_records(
        self,
        mock_seed,
        mock_salt,
        mock_keypair,
        mock_wrap_user,
        mock_wrap_server,
        mock_get_members,
        mock_get_ssk_sa,
        mock_env_model,
        mock_env_key_model,
        mock_server_key_model,
        mock_transaction,
    ):
        # Setup
        mock_seed.return_value = "aa" * 32
        mock_salt.return_value = "bb" * 32
        mock_keypair.return_value = ("env_pub_hex", "env_priv_hex")
        mock_wrap_server.return_value = ("srv_w_seed", "srv_w_salt", "srv_pk")

        owner = MagicMock()
        owner.id = "owner-id"
        owner.identity_key = "owner_ed25519"
        owner.role.name = "Owner"

        admin = MagicMock()
        admin.id = "admin-id"
        admin.identity_key = "admin_ed25519"
        admin.role.name = "Admin"

        mock_get_members.return_value = [owner, admin]
        mock_get_ssk_sa.return_value = []

        mock_wrap_user.side_effect = [
            ("owner_w_seed", "owner_w_salt"),
            ("admin_w_seed", "admin_w_salt"),
        ]

        app = MagicMock()
        app.organisation = MagicMock()

        mock_env_instance = MagicMock()
        mock_env_model.objects.filter.return_value.exists.return_value = False
        mock_env_model.objects.filter.return_value.aggregate.return_value = {
            "index__max": 2
        }
        mock_env_model.objects.create.return_value = mock_env_instance

        # Execute
        result = create_environment(app, "test-env", "custom")

        # Verify environment created
        mock_env_model.objects.create.assert_called_once()
        create_kwargs = mock_env_model.objects.create.call_args[1]
        assert create_kwargs["name"] == "test-env"
        assert create_kwargs["env_type"] == "custom"
        assert create_kwargs["identity_key"] == "env_pub_hex"
        assert create_kwargs["wrapped_seed"] == "owner_w_seed"
        assert create_kwargs["wrapped_salt"] == "owner_w_salt"
        assert create_kwargs["index"] == 3  # max_index(2) + 1

        # Verify EnvironmentKeys bulk created (owner + admin)
        mock_env_key_model.objects.bulk_create.assert_called_once()
        env_keys = mock_env_key_model.objects.bulk_create.call_args[0][0]
        assert len(env_keys) == 2

        # Verify ServerEnvironmentKey created
        mock_server_key_model.objects.create.assert_called_once_with(
            environment=mock_env_instance,
            identity_key="env_pub_hex",
            wrapped_seed="srv_w_seed",
            wrapped_salt="srv_w_salt",
        )

        assert result == mock_env_instance

    def test_rejects_invalid_name(self):
        app = MagicMock()
        with pytest.raises(ValueError, match="invalid"):
            create_environment(app, "has space!")

    @patch("api.utils.environments.Environment")
    def test_rejects_duplicate_name(self, mock_env_model):
        mock_env_model.objects.filter.return_value.exists.return_value = True

        app = MagicMock()
        with pytest.raises(ValueError, match="already exists"):
            create_environment(app, "staging")

    @patch("api.utils.environments.Environment")
    @patch("api.utils.environments.get_global_access_members")
    @patch("api.utils.environments._wrap_for_server")
    @patch("api.utils.environments.env_keypair")
    @patch("api.utils.environments._generate_env_salt")
    @patch("api.utils.environments._generate_env_seed")
    def test_raises_when_no_members_with_identity_keys(
        self,
        mock_seed,
        mock_salt,
        mock_keypair,
        mock_wrap_server,
        mock_get_members,
        mock_env_model,
    ):
        mock_seed.return_value = "aa" * 32
        mock_salt.return_value = "bb" * 32
        mock_keypair.return_value = ("pub", "priv")
        mock_wrap_server.return_value = ("ws", "wsa", "pk")
        mock_get_members.return_value = []
        mock_env_model.objects.filter.return_value.exists.return_value = False
        mock_env_model.objects.filter.return_value.aggregate.return_value = {
            "index__max": None
        }

        app = MagicMock()
        with pytest.raises(ValueError, match="no global-access members"):
            create_environment(app, "myenv")

    @patch("api.utils.environments.transaction")
    @patch("api.utils.environments.ServerEnvironmentKey")
    @patch("api.utils.environments.EnvironmentKey")
    @patch("api.utils.environments.Environment")
    @patch("api.utils.environments.get_ssk_service_accounts_for_app")
    @patch("api.utils.environments.get_global_access_members")
    @patch("api.utils.environments._wrap_for_service_account")
    @patch("api.utils.environments._wrap_for_server")
    @patch("api.utils.environments._wrap_for_user")
    @patch("api.utils.environments.env_keypair")
    @patch("api.utils.environments._generate_env_salt")
    @patch("api.utils.environments._generate_env_seed")
    def test_wraps_for_ssk_service_accounts(
        self,
        mock_seed,
        mock_salt,
        mock_keypair,
        mock_wrap_user,
        mock_wrap_server,
        mock_wrap_sa,
        mock_get_members,
        mock_get_ssk_sa,
        mock_env_model,
        mock_env_key_model,
        mock_server_key_model,
        mock_transaction,
    ):
        mock_seed.return_value = "aa" * 32
        mock_salt.return_value = "bb" * 32
        mock_keypair.return_value = ("env_pub", "env_priv")
        mock_wrap_server.return_value = ("srv_ws", "srv_wsa", "srv_pk")

        owner = MagicMock()
        owner.id = "owner-id"
        owner.identity_key = "owner_key"
        owner.role.name = "Owner"
        mock_get_members.return_value = [owner]
        mock_wrap_user.return_value = ("o_ws", "o_wsa")

        sa = MagicMock()
        sa.id = "sa-id"
        mock_get_ssk_sa.return_value = [sa]
        mock_wrap_sa.return_value = ("sa_ws", "sa_wsa")

        mock_env_instance = MagicMock()
        mock_env_model.objects.filter.return_value.exists.return_value = False
        mock_env_model.objects.filter.return_value.aggregate.return_value = {
            "index__max": None
        }
        mock_env_model.objects.create.return_value = mock_env_instance

        app = MagicMock()

        create_environment(app, "myenv")

        # Should have 2 env keys: 1 for owner + 1 for SA
        env_keys = mock_env_key_model.objects.bulk_create.call_args[0][0]
        assert len(env_keys) == 2

    @patch("api.utils.environments.transaction")
    @patch("api.utils.environments.ServerEnvironmentKey")
    @patch("api.utils.environments.EnvironmentKey")
    @patch("api.utils.environments.Environment")
    @patch("api.utils.environments.get_ssk_service_accounts_for_app")
    @patch("api.utils.environments.get_global_access_members")
    @patch("api.utils.environments._wrap_for_server")
    @patch("api.utils.environments._wrap_for_user")
    @patch("api.utils.environments.env_keypair")
    @patch("api.utils.environments._generate_env_salt")
    @patch("api.utils.environments._generate_env_seed")
    def test_requesting_user_gets_env_key_when_not_global(
        self,
        mock_seed,
        mock_salt,
        mock_keypair,
        mock_wrap_user,
        mock_wrap_server,
        mock_get_members,
        mock_get_ssk_sa,
        mock_env_model,
        mock_env_key_model,
        mock_server_key_model,
        mock_transaction,
    ):
        """A non-global-access user who creates the env should get an EnvironmentKey."""
        mock_seed.return_value = "aa" * 32
        mock_salt.return_value = "bb" * 32
        mock_keypair.return_value = ("env_pub", "env_priv")
        mock_wrap_server.return_value = ("srv_ws", "srv_wsa", "srv_pk")
        mock_get_ssk_sa.return_value = []

        owner = MagicMock()
        owner.id = "owner-id"
        owner.identity_key = "owner_key"
        owner.role.name = "Owner"
        mock_get_members.return_value = [owner]

        # requesting_user is NOT in global members
        requester = MagicMock()
        requester.id = "requester-id"
        requester.identity_key = "requester_key"

        mock_wrap_user.side_effect = [
            ("owner_ws", "owner_wsa"),
            ("req_ws", "req_wsa"),
        ]

        mock_env_instance = MagicMock()
        mock_env_model.objects.filter.return_value.exists.return_value = False
        mock_env_model.objects.filter.return_value.aggregate.return_value = {
            "index__max": None
        }
        mock_env_model.objects.create.return_value = mock_env_instance

        app = MagicMock()
        create_environment(app, "myenv", requesting_user=requester)

        # Should have 2 env keys: owner + requester
        env_keys = mock_env_key_model.objects.bulk_create.call_args[0][0]
        assert len(env_keys) == 2

    @patch("api.utils.environments.transaction")
    @patch("api.utils.environments.ServerEnvironmentKey")
    @patch("api.utils.environments.EnvironmentKey")
    @patch("api.utils.environments.Environment")
    @patch("api.utils.environments.get_ssk_service_accounts_for_app")
    @patch("api.utils.environments.get_global_access_members")
    @patch("api.utils.environments._wrap_for_server")
    @patch("api.utils.environments._wrap_for_user")
    @patch("api.utils.environments.env_keypair")
    @patch("api.utils.environments._generate_env_salt")
    @patch("api.utils.environments._generate_env_seed")
    def test_requesting_user_not_duplicated_when_global(
        self,
        mock_seed,
        mock_salt,
        mock_keypair,
        mock_wrap_user,
        mock_wrap_server,
        mock_get_members,
        mock_get_ssk_sa,
        mock_env_model,
        mock_env_key_model,
        mock_server_key_model,
        mock_transaction,
    ):
        """A global-access user who creates the env should NOT get a duplicate key."""
        mock_seed.return_value = "aa" * 32
        mock_salt.return_value = "bb" * 32
        mock_keypair.return_value = ("env_pub", "env_priv")
        mock_wrap_server.return_value = ("srv_ws", "srv_wsa", "srv_pk")
        mock_get_ssk_sa.return_value = []

        owner = MagicMock()
        owner.id = "owner-id"
        owner.identity_key = "owner_key"
        owner.role.name = "Owner"
        mock_get_members.return_value = [owner]

        mock_wrap_user.return_value = ("owner_ws", "owner_wsa")

        mock_env_instance = MagicMock()
        mock_env_model.objects.filter.return_value.exists.return_value = False
        mock_env_model.objects.filter.return_value.aggregate.return_value = {
            "index__max": None
        }
        mock_env_model.objects.create.return_value = mock_env_instance

        app = MagicMock()
        # requesting_user IS the owner (already in global members)
        create_environment(app, "myenv", requesting_user=owner)

        # Should still only have 1 env key (no duplicate)
        env_keys = mock_env_key_model.objects.bulk_create.call_args[0][0]
        assert len(env_keys) == 1

    @patch("api.utils.environments._ed25519_pk_to_curve25519")
    @patch("api.utils.environments._wrap_env_secrets_for_key")
    @patch("api.utils.environments.transaction")
    @patch("api.utils.environments.ServerEnvironmentKey")
    @patch("api.utils.environments.EnvironmentKey")
    @patch("api.utils.environments.Environment")
    @patch("api.utils.environments.get_ssk_service_accounts_for_app")
    @patch("api.utils.environments.get_global_access_members")
    @patch("api.utils.environments._wrap_for_server")
    @patch("api.utils.environments._wrap_for_user")
    @patch("api.utils.environments.env_keypair")
    @patch("api.utils.environments._generate_env_salt")
    @patch("api.utils.environments._generate_env_seed")
    def test_requesting_sa_gets_env_key_when_not_ssk(
        self,
        mock_seed,
        mock_salt,
        mock_keypair,
        mock_wrap_user,
        mock_wrap_server,
        mock_get_members,
        mock_get_ssk_sa,
        mock_env_model,
        mock_env_key_model,
        mock_server_key_model,
        mock_transaction,
        mock_wrap_key,
        mock_to_curve,
    ):
        """A non-SSK SA that creates the env should get an EnvironmentKey via identity_key."""
        mock_seed.return_value = "aa" * 32
        mock_salt.return_value = "bb" * 32
        mock_keypair.return_value = ("env_pub", "env_priv")
        mock_wrap_server.return_value = ("srv_ws", "srv_wsa", "srv_pk")
        mock_get_ssk_sa.return_value = []  # SA not in SSK list

        owner = MagicMock()
        owner.id = "owner-id"
        owner.identity_key = "owner_key"
        owner.role.name = "Owner"
        mock_get_members.return_value = [owner]
        mock_wrap_user.return_value = ("owner_ws", "owner_wsa")

        sa = MagicMock()
        sa.id = "sa-id"
        sa.identity_key = "sa_ed25519_pub"

        mock_to_curve.return_value = "sa_curve25519_pub"
        mock_wrap_key.return_value = ("sa_ws", "sa_wsa")

        mock_env_instance = MagicMock()
        mock_env_model.objects.filter.return_value.exists.return_value = False
        mock_env_model.objects.filter.return_value.aggregate.return_value = {
            "index__max": None
        }
        mock_env_model.objects.create.return_value = mock_env_instance

        app = MagicMock()
        create_environment(app, "myenv", requesting_sa=sa)

        # Should have 2 env keys: owner + requesting SA
        env_keys = mock_env_key_model.objects.bulk_create.call_args[0][0]
        assert len(env_keys) == 2

    @patch("api.utils.environments.transaction")
    @patch("api.utils.environments.ServerEnvironmentKey")
    @patch("api.utils.environments.EnvironmentKey")
    @patch("api.utils.environments.Environment")
    @patch("api.utils.environments.get_ssk_service_accounts_for_app")
    @patch("api.utils.environments.get_global_access_members")
    @patch("api.utils.environments._wrap_for_server")
    @patch("api.utils.environments._wrap_for_user")
    @patch("api.utils.environments.env_keypair")
    @patch("api.utils.environments._generate_env_salt")
    @patch("api.utils.environments._generate_env_seed")
    def test_env_type_indices(
        self,
        mock_seed,
        mock_salt,
        mock_keypair,
        mock_wrap_user,
        mock_wrap_server,
        mock_get_members,
        mock_get_ssk_sa,
        mock_env_model,
        mock_env_key_model,
        mock_server_key_model,
        mock_transaction,
    ):
        """Test that dev/staging/prod get indices 0/1/2."""
        mock_seed.return_value = "aa" * 32
        mock_salt.return_value = "bb" * 32
        mock_keypair.return_value = ("pub", "priv")
        mock_wrap_server.return_value = ("ws", "wsa", "pk")
        mock_get_ssk_sa.return_value = []

        owner = MagicMock()
        owner.id = "owner-id"
        owner.identity_key = "key"
        owner.role.name = "Owner"
        mock_get_members.return_value = [owner]
        mock_wrap_user.return_value = ("ws", "wsa")

        app = MagicMock()

        for env_type, expected_index in [("dev", 0), ("staging", 1), ("prod", 2)]:
            mock_env_model.objects.filter.return_value.exists.return_value = False
            mock_env_model.objects.create.return_value = MagicMock()

            create_environment(app, f"env-{env_type}", env_type)

            create_kwargs = mock_env_model.objects.create.call_args[1]
            assert create_kwargs["index"] == expected_index, (
                f"Expected index {expected_index} for {env_type}"
            )
