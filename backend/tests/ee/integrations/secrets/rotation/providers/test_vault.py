import json
from unittest.mock import MagicMock, patch

import pytest
import requests
from django.core.exceptions import ValidationError

from api.services import Providers
from ee.integrations.secrets.providers.exceptions import (
    ProviderAuthError,
    ProviderConfigError,
    ProviderNotFound,
    ProviderTransientError,
)
from ee.integrations.secrets.providers.sanitize import sanitize
from ee.integrations.secrets.providers.vault import (
    VaultProvider,
    _decode_provider_id,
    _encode_provider_id,
)
from ee.integrations.secrets.rotation.providers import all_providers, get_provider

HTTP = "ee.integrations.secrets.providers.http.requests.request"

ADDR = "https://vault.example.com:8200"
ROOT = {
    "vault_addr": f"{ADDR}/",
    "vault_role_id": "phase-role-id",
    "vault_secret_id": "phase-root-secret-id",
    "vault_namespace": "admin",
}
TOKEN = "hvs.phase-login-token"
ROLE_ID = "e5a7b66e-5d08-da9c-7075-71984634b882"
SECRET_ID = "841771dc-11c9-bbc7-bcac-6a3945a69cd9"
ACCESSOR = "84896a0c-1347-aa90-a4f6-aca8b7558780"
CONFIG = {
    "mount_path": "/team/approle/",
    "role_name": "billing-api",
    "secret_id_ttl": "30d",
}
ROLE_URL = f"{ADDR}/v1/auth/team/approle/role/billing-api"
PROVIDER_ID = f"team/approle:billing-api:{ACCESSOR}"
AUTHED = {"X-Vault-Namespace": "admin", "X-Vault-Token": TOKEN}


def _response(status=200, body=None):
    resp = MagicMock()
    resp.status_code = status
    resp.text = "" if body is None else json.dumps(body)
    if body is None:
        resp.json.side_effect = ValueError("no body")
    else:
        resp.json.return_value = body
    return resp


def _errors(status, *messages):
    return _response(status, {"errors": list(messages)})


def _login_ok():
    return _response(200, {"auth": {"client_token": TOKEN, "accessor": "tok-acc"}})


def _role_id_ok():
    return _response(200, {"data": {"role_id": ROLE_ID}})


def _secret_id_ok(**extra):
    data = {
        "secret_id": SECRET_ID,
        "secret_id_accessor": ACCESSOR,
        "secret_id_ttl": 2592000,
        "secret_id_num_uses": 0,
    }
    return _response(200, {"data": data, **extra})


def _calls(mock_request):
    return [c.kwargs for c in mock_request.call_args_list]


# ---------------------------------------------------------------------------
# Registry and schemas
# ---------------------------------------------------------------------------


def test_registry_lookup():
    assert get_provider("hashicorp_vault") is VaultProvider
    assert VaultProvider in all_providers()


def test_credential_schema_mirrors_sync_credentials():
    spec = Providers.HASHICORP_VAULT
    fields = {f.id: f for f in VaultProvider.credential_schema}
    assert list(fields) == spec["expected_credentials"] + spec["optional_credentials"]
    assert all(fields[k].required for k in spec["expected_credentials"])
    assert not any(fields[k].required for k in spec["optional_credentials"])
    assert [k for k, f in fields.items() if f.masked] == ["vault_secret_id"]


def test_console_schemas():
    fields = {f.id: f for f in VaultProvider.config_schema}
    assert fields["role_name"].resource_type == "approle_role"
    assert fields["role_name"].depends_on == ["mount_path"]
    assert fields["mount_path"].default == "approle"
    assert [(f.id, f.masked) for f in VaultProvider.output_schema] == [
        ("role_id", False),
        ("secret_id_accessor", False),
        ("secret_id", True),
    ]
    assert VaultProvider.key_name_prefix == "VAULT"
    assert VaultProvider.credential_id_label == "Secret ID accessor"


# ---------------------------------------------------------------------------
# validate_config
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "config",
    [
        {"role_name": "billing-api"},
        {"role_name": "svc_1.prod", "mount_path": "", "secret_id_ttl": ""},
        {"role_name": "a", "mount_path": "/team/approle/", "secret_id_ttl": "720h"},
        {"role_name": "a", "secret_id_ttl": "3600"},
        {"role_name": "a", "secret_id_ttl": "30d"},
        {"role_name": "a", "secret_id_ttl": 600},
    ],
)
def test_validate_config_accepts(config):
    VaultProvider.validate_config(config)


@pytest.mark.parametrize(
    "config",
    [
        {},
        {"role_name": ""},
        {"role_name": "has space"},
        {"role_name": "-leading"},
        {"role_name": "trailing."},
        {"role_name": "a:b"},
        {"role_name": "a/b"},
        {"role_name": ["a"]},
        {"role_name": "a" * 4096},
        {"role_name": "a", "mount_path": "../sys"},
        {"role_name": "a", "mount_path": "team/../sys"},
        {"role_name": "a", "mount_path": "team/./approle"},
        {"role_name": "a", "mount_path": "a//b"},
        {"role_name": "a", "mount_path": "app role"},
        {"role_name": "a", "mount_path": 5},
        {"role_name": "a", "secret_id_ttl": "abc"},
        {"role_name": "a", "secret_id_ttl": "1h30m"},
        {"role_name": "a", "secret_id_ttl": "-1h"},
        {"role_name": "a", "secret_id_ttl": "0h"},
        {"role_name": "a", "secret_id_ttl": 0},
        {"role_name": "a", "secret_id_ttl": True},
    ],
)
def test_validate_config_rejects(config):
    with pytest.raises(ProviderConfigError):
        VaultProvider.validate_config(config)


# ---------------------------------------------------------------------------
# mint
# ---------------------------------------------------------------------------


@patch(HTTP)
def test_mint_generates_secret_id_on_target_role(mock_request):
    mock_request.side_effect = [
        _login_ok(),
        _role_id_ok(),
        _secret_id_ok(),
        _response(204),
    ]

    result = VaultProvider.mint(ROOT, CONFIG, caller_id="rs-7")

    login, read_role_id, generate, revoke_self = _calls(mock_request)
    assert login["method"] == "POST"
    assert login["url"] == f"{ADDR}/v1/auth/approle/login"
    assert login["json"] == {
        "role_id": "phase-role-id",
        "secret_id": "phase-root-secret-id",
    }
    assert login["headers"] == {"X-Vault-Namespace": "admin"}
    assert read_role_id["method"] == "GET"
    assert read_role_id["url"] == f"{ROLE_URL}/role-id"
    assert read_role_id["headers"] == AUTHED
    assert generate["method"] == "POST"
    assert generate["url"] == f"{ROLE_URL}/secret-id"
    assert generate["headers"] == AUTHED
    assert generate["json"]["ttl"] == 30 * 86400
    # Vault takes metadata as a JSON-encoded string, not an object.
    assert json.loads(generate["json"]["metadata"]) == {"phase_rotating_secret": "rs-7"}
    assert revoke_self["method"] == "POST"
    assert revoke_self["url"] == f"{ADDR}/v1/auth/token/revoke-self"
    assert revoke_self["headers"] == AUTHED

    assert result.provider_credential_id == PROVIDER_ID
    assert result.values == {
        "role_id": ROLE_ID,
        "secret_id_accessor": ACCESSOR,
        "secret_id": SECRET_ID,
    }
    assert set(result.values) == {f.id for f in VaultProvider.output_schema}
    assert result.metadata["mount_path"] == "team/approle"
    assert result.metadata["display_id"] == ACCESSOR
    assert result.metadata["ttl"] == 2592000


@patch(HTTP)
def test_mint_defaults_mount_and_omits_optional_fields(mock_request):
    mock_request.side_effect = [
        _login_ok(),
        _role_id_ok(),
        _secret_id_ok(),
        _response(204),
    ]
    root = {k: v for k, v in ROOT.items() if k != "vault_namespace"}

    VaultProvider.mint(root, {"role_name": "billing-api"}, caller_id="rs-7")

    login, read_role_id, generate, _ = _calls(mock_request)
    assert login["headers"] == {}
    assert read_role_id["url"] == f"{ADDR}/v1/auth/approle/role/billing-api/role-id"
    assert set(generate["json"]) == {"metadata"}


@patch(HTTP)
def test_mint_metadata_holds_no_secret_values(mock_request):
    warning = "Endpoint ignored these unrecognized parameters: [ttl]"
    mock_request.side_effect = [
        _login_ok(),
        _role_id_ok(),
        _secret_id_ok(warnings=[warning]),
        _response(204),
    ]

    result = VaultProvider.mint(ROOT, CONFIG, caller_id="rs-7")

    stored = sanitize(result.metadata)
    dumped = json.dumps(stored)
    for secret in (SECRET_ID, TOKEN, "phase-root-secret-id"):
        assert secret not in dumped
    # Neutral key names survive the sanitizer.
    assert stored["accessor"] == stored["display_id"] == ACCESSOR
    assert stored["role_name"] == "billing-api"
    assert stored["ttl"] == 2592000
    assert stored["warnings"] == [warning]


@patch(HTTP)
def test_mint_rejects_unexpected_secret_id_response(mock_request):
    mock_request.side_effect = [
        _login_ok(),
        _role_id_ok(),
        _response(200, {"data": {"secret_id": SECRET_ID}}),
        _response(204),
    ]

    with pytest.raises(ProviderConfigError) as exc:
        VaultProvider.mint(ROOT, CONFIG, caller_id="rs-7")

    assert SECRET_ID not in f"{exc.value} {exc.value.user_message} {exc.value.raw}"
    assert _calls(mock_request)[-1]["url"] == f"{ADDR}/v1/auth/token/revoke-self"


@patch(HTTP)
def test_mint_checks_role_id_before_generating(mock_request):
    mock_request.side_effect = [
        _login_ok(),
        _response(200, {"data": {}}),
        _response(204),
    ]

    with pytest.raises(ProviderConfigError):
        VaultProvider.mint(ROOT, CONFIG, caller_id="rs-7")

    assert [c["url"] for c in _calls(mock_request)][1:] == [
        f"{ROLE_URL}/role-id",
        f"{ADDR}/v1/auth/token/revoke-self",
    ]


@patch(HTTP)
def test_mint_missing_role_is_a_config_error(mock_request):
    mock_request.side_effect = [_login_ok(), _errors(404), _response(204)]

    with pytest.raises(ProviderConfigError) as exc:
        VaultProvider.mint(ROOT, CONFIG, caller_id="rs-7")

    assert "billing-api" in exc.value.user_message
    assert mock_request.call_count == 3


@patch(HTTP)
def test_mint_permission_denied_names_the_capability(mock_request):
    mock_request.side_effect = [
        _login_ok(),
        _role_id_ok(),
        _errors(403, "1 error occurred:\n\t* permission denied\n\n"),
        _response(204),
    ]

    with pytest.raises(ProviderAuthError) as exc:
        VaultProvider.mint(ROOT, CONFIG, caller_id="rs-7")

    assert exc.value.user_message == (
        "Vault denied update on auth/team/approle/role/billing-api/secret-id. "
        "Add it to Phase's AppRole policy."
    )


@patch(HTTP)
def test_mint_surfaces_role_ttl_cap(mock_request):
    mock_request.side_effect = [
        _login_ok(),
        _role_id_ok(),
        _errors(400, "ttl cannot be longer than the role's secret_id_ttl"),
        _response(204),
    ]

    with pytest.raises(ProviderConfigError) as exc:
        VaultProvider.mint(ROOT, CONFIG, caller_id="rs-7")

    assert (
        "ttl cannot be longer than the role's secret_id_ttl" in exc.value.user_message
    )


@patch(HTTP)
def test_mint_ignores_revoke_self_failure(mock_request):
    mock_request.side_effect = [
        _login_ok(),
        _role_id_ok(),
        _secret_id_ok(),
        requests.ConnectionError("reset"),
    ]

    result = VaultProvider.mint(ROOT, CONFIG, caller_id="rs-7")

    assert result.values["secret_id"] == SECRET_ID
    assert _calls(mock_request)[-1]["timeout"] == (5, 10)


@patch("ee.integrations.secrets.providers.http.validate_url_is_safe")
@patch("ee.integrations.secrets.providers.http.settings")
@patch(HTTP)
def test_cloud_mode_blocks_private_vault_address(
    mock_request, mock_settings, mock_validate
):
    mock_settings.APP_HOST = "cloud"
    mock_validate.side_effect = ValidationError("private IP")

    with pytest.raises(ProviderConfigError) as exc:
        VaultProvider.mint(
            {**ROOT, "vault_addr": "http://10.0.0.5:8200"}, CONFIG, caller_id="rs-7"
        )

    assert "not reachable" in exc.value.user_message
    mock_request.assert_not_called()


# ---------------------------------------------------------------------------
# Login
# ---------------------------------------------------------------------------


@patch(HTTP)
def test_login_rejection_is_an_auth_error(mock_request):
    mock_request.side_effect = [_errors(400, "invalid role or secret ID")]

    with pytest.raises(ProviderAuthError) as exc:
        VaultProvider.mint(ROOT, CONFIG, caller_id="rs-7")

    assert "invalid role or secret ID" in exc.value.user_message
    assert "phase-root-secret-id" not in f"{exc.value} {exc.value.user_message}"
    # No token was issued, so there's nothing to revoke.
    assert mock_request.call_count == 1


@patch(HTTP)
def test_login_404_is_not_read_as_already_revoked(mock_request):
    mock_request.side_effect = [
        _errors(
            404, 'no handler for route "auth/approle/login". route entry not found.'
        )
    ]

    with pytest.raises(ProviderAuthError):
        VaultProvider.revoke(ROOT, PROVIDER_ID)


@patch(HTTP)
def test_login_sealed_vault_is_transient(mock_request):
    mock_request.side_effect = [_errors(503, "Vault is sealed")]

    with pytest.raises(ProviderTransientError):
        VaultProvider.revoke(ROOT, PROVIDER_ID)


@patch(HTTP)
def test_login_without_client_token_is_a_config_error(mock_request):
    mock_request.side_effect = [_response(200, {"auth": None})]

    with pytest.raises(ProviderConfigError):
        VaultProvider.mint(ROOT, CONFIG, caller_id="rs-7")


# ---------------------------------------------------------------------------
# revoke
# ---------------------------------------------------------------------------


@patch(HTTP)
def test_revoke_destroys_secret_id_by_accessor(mock_request):
    mock_request.side_effect = [_login_ok(), _response(204), _response(204)]

    summary = VaultProvider.revoke(ROOT, PROVIDER_ID)

    _, destroy, revoke_self = _calls(mock_request)
    assert destroy["method"] == "POST"
    assert destroy["url"] == f"{ROLE_URL}/secret-id-accessor/destroy"
    assert destroy["json"] == {"secret_id_accessor": ACCESSOR}
    assert destroy["headers"] == AUTHED
    assert revoke_self["url"] == f"{ADDR}/v1/auth/token/revoke-self"
    assert summary["mount_path"] == "team/approle"
    assert summary["role_name"] == "billing-api"
    assert summary["accessor"] == ACCESSOR
    assert summary["call"]["status"] == 204


@pytest.mark.parametrize(
    "status, message",
    [
        # Unknown accessor.
        (
            500,
            "1 error occurred:\n\t* failed to find accessor entry for "
            f'secret_id_accessor: "{ACCESSOR}"\n\n',
        ),
        # Deleting a role flushes its secret IDs.
        (500, '1 error occurred:\n\t* role "billing-api" does not exist\n\n'),
        # The accessor index outlived its secret ID.
        (403, "invalid secret id accessor"),
        # The auth mount was disabled.
        (
            404,
            'no handler for route "auth/team/approle/role/billing-api". route entry not found.',
        ),
    ],
)
@patch(HTTP)
def test_revoke_gone_secret_id_raises_not_found(mock_request, status, message):
    mock_request.side_effect = [_login_ok(), _errors(status, message), _response(204)]

    with pytest.raises(ProviderNotFound):
        VaultProvider.revoke(ROOT, PROVIDER_ID)

    assert _calls(mock_request)[-1]["url"] == f"{ADDR}/v1/auth/token/revoke-self"


@pytest.mark.parametrize(
    "status, message, error",
    [
        (
            500,
            "1 error occurred:\n\t* failed to delete secret_id: storage unavailable\n\n",
            ProviderTransientError,
        ),
        (403, "1 error occurred:\n\t* permission denied\n\n", ProviderAuthError),
    ],
)
@patch(HTTP)
def test_revoke_other_errors_are_not_masked(mock_request, status, message, error):
    mock_request.side_effect = [_login_ok(), _errors(status, message), _response(204)]

    with pytest.raises(error) as exc:
        VaultProvider.revoke(ROOT, PROVIDER_ID)

    assert not isinstance(exc.value, ProviderNotFound)


@patch(HTTP)
def test_revoke_ignores_revoke_self_failure(mock_request):
    mock_request.side_effect = [
        _login_ok(),
        _response(204),
        _errors(403, "permission denied"),
    ]

    assert VaultProvider.revoke(ROOT, PROVIDER_ID)["accessor"] == ACCESSOR


@patch(HTTP)
def test_revoke_malformed_id_makes_no_calls(mock_request):
    with pytest.raises(ProviderConfigError):
        VaultProvider.revoke(ROOT, "not-a-vault-id")
    mock_request.assert_not_called()


# ---------------------------------------------------------------------------
# validate_root_credentials
# ---------------------------------------------------------------------------


@patch(HTTP)
def test_validate_root_credentials_logs_in_and_revokes_token(mock_request):
    mock_request.side_effect = [_login_ok(), _response(204)]

    assert VaultProvider.validate_root_credentials(ROOT) is True

    login, revoke_self = _calls(mock_request)
    assert login["url"] == f"{ADDR}/v1/auth/approle/login"
    assert revoke_self["url"] == f"{ADDR}/v1/auth/token/revoke-self"


@pytest.mark.parametrize(
    "login",
    [
        lambda: _errors(400, "invalid role or secret ID"),
        lambda: _response(200, {"auth": {"client_token": ""}}),
        lambda: requests.ConnectionError("dns failure"),
    ],
)
@patch(HTTP)
def test_validate_root_credentials_false_when_login_fails(mock_request, login):
    mock_request.side_effect = [login()]
    assert VaultProvider.validate_root_credentials(ROOT) is False


def test_validate_root_credentials_false_without_address():
    assert (
        VaultProvider.validate_root_credentials(
            {"vault_role_id": "r", "vault_secret_id": "s"}
        )
        is False
    )


# ---------------------------------------------------------------------------
# list_resources
# ---------------------------------------------------------------------------


@patch(HTTP)
def test_list_resources_lists_roles_on_mount(mock_request):
    mock_request.side_effect = [
        _login_ok(),
        _response(200, {"data": {"keys": ["billing-api", "worker"]}}),
        _response(204),
    ]

    resources = VaultProvider.list_resources(
        ROOT, "approle_role", {"mount_path": "team/approle"}
    )

    assert [(r.id, r.name) for r in resources] == [
        ("billing-api", "billing-api"),
        ("worker", "worker"),
    ]
    # Vault's role LIST isn't paginated, so one request returns every role.
    _, listing, revoke_self = _calls(mock_request)
    assert listing["method"] == "GET"
    assert listing["url"] == f"{ADDR}/v1/auth/team/approle/role"
    assert listing["params"] == {"list": "true"}
    assert listing["headers"] == AUTHED
    assert revoke_self["url"] == f"{ADDR}/v1/auth/token/revoke-self"


@patch(HTTP)
def test_list_resources_empty_list_returns_nothing(mock_request):
    mock_request.side_effect = [_login_ok(), _errors(404), _response(204)]

    assert VaultProvider.list_resources(ROOT, "approle_role") == []
    assert _calls(mock_request)[1]["url"] == f"{ADDR}/v1/auth/approle/role"


@patch(HTTP)
def test_list_resources_missing_mount_is_a_config_error(mock_request):
    mock_request.side_effect = [
        _login_ok(),
        _errors(404, 'no handler for route "auth/nope/role/". route entry not found.'),
        _response(204),
    ]

    with pytest.raises(ProviderConfigError) as exc:
        VaultProvider.list_resources(ROOT, "approle_role", {"mount_path": "nope"})

    assert "auth/nope" in exc.value.user_message


@patch(HTTP)
def test_list_resources_permission_denied_names_the_capability(mock_request):
    mock_request.side_effect = [
        _login_ok(),
        _errors(403, "1 error occurred:\n\t* permission denied\n\n"),
        _response(204),
    ]

    with pytest.raises(ProviderAuthError) as exc:
        VaultProvider.list_resources(ROOT, "approle_role", {})

    assert "list on auth/approle/role" in exc.value.user_message


@patch(HTTP)
def test_list_resources_rejects_unexpected_shape(mock_request):
    mock_request.side_effect = [
        _login_ok(),
        _response(200, {"data": {"keys": "billing-api"}}),
        _response(204),
    ]

    with pytest.raises(ProviderConfigError):
        VaultProvider.list_resources(ROOT, "approle_role")


@patch(HTTP)
def test_list_resources_rejects_unknown_type_and_bad_mount(mock_request):
    with pytest.raises(ProviderConfigError):
        VaultProvider.list_resources(ROOT, "policy")
    with pytest.raises(ProviderConfigError):
        VaultProvider.list_resources(ROOT, "approle_role", {"mount_path": "../sys"})
    mock_request.assert_not_called()


# ---------------------------------------------------------------------------
# provider_credential_id codec
# ---------------------------------------------------------------------------


def test_provider_id_round_trip():
    encoded = _encode_provider_id("team/approle", "billing-api", ACCESSOR)
    assert encoded == PROVIDER_ID
    assert _decode_provider_id(encoded) == ("team/approle", "billing-api", ACCESSOR)


@pytest.mark.parametrize(
    "provider_credential_id",
    [
        "",
        ACCESSOR,
        f"billing-api:{ACCESSOR}",
        "approle:billing-api:",
        f"../sys:billing-api:{ACCESSOR}",
        f"approle:bad role:{ACCESSOR}",
    ],
)
def test_decode_provider_id_rejects_malformed(provider_credential_id):
    with pytest.raises(ProviderConfigError):
        _decode_provider_id(provider_credential_id)
