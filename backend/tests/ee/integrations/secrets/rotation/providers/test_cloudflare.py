import json
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest
import requests

from api.services import Providers
from ee.integrations.secrets.providers.cloudflare import (
    CLOUDFLARE_API_BASE as BASE,
    CloudflareProvider,
    _TokenRef,
    _decode_provider_id,
    _encode_provider_id,
)
from ee.integrations.secrets.providers.exceptions import (
    ProviderAuthError,
    ProviderConfigError,
    ProviderNotFound,
    ProviderTransientError,
)
from ee.integrations.secrets.providers.sanitize import REDACTED, sanitize
from ee.integrations.secrets.rotation.providers import all_providers, get_provider
from ee.integrations.secrets.rotation.utils import validate_provider_config

HTTP = "ee.integrations.secrets.providers.http.requests.request"

ACCOUNT = "023e105f4ecef8ad9ca31a8372d0c353"
ROOT_ID = "f267e341f3dd4697bd3b9f71dd96247f"
OTHER_ROOT_ID = "1" * 32
TOKEN_ID = "ed17574386854bf78a67040be0a770b0"
TOKEN_VALUE = "cfat_" + "Q" * 40 + "0a1b2c3d"
ROOT_CREDS = {"account_id": ACCOUNT, "access_token": "root-secret-token"}
ACCOUNT_REF = f"account:{ACCOUNT}:{TOKEN_ID}:{ROOT_ID}"
USER_REF = f"user:{TOKEN_ID}:{ROOT_ID}"
POLICIES = [
    {
        "effect": "allow",
        "permission_groups": [{"id": "c8fed203ed3043cba015a93ad1616f1f"}],
        "resources": {f"com.cloudflare.api.account.{ACCOUNT}": "*"},
    }
]


def _resp(status, body):
    resp = MagicMock()
    resp.status_code = status
    resp.json.return_value = body
    resp.text = json.dumps(body)
    return resp


def _ok(result):
    return _resp(200, {"success": True, "errors": [], "messages": [], "result": result})


def _err(status, message="No route for the URI", code=7003):
    return _resp(
        status,
        {
            "success": False,
            "errors": [{"code": code, "message": message}],
            "messages": [],
            "result": None,
        },
    )


def _invalid_token():
    return _err(401, "Invalid API Token", 1000)


def _unauthorized():
    return _err(403, "Unauthorized to access requested resource", 9109)


def _verified(token_id=ROOT_ID):
    return _ok({"id": token_id, "status": "active"})


def _calls(mock_request):
    return [(c.kwargs["method"], c.kwargs["url"]) for c in mock_request.call_args_list]


# ---------------------------------------------------------------------------
# Registry and schemas
# ---------------------------------------------------------------------------


def test_registered_in_rotation_registry():
    assert get_provider("cloudflare") is CloudflareProvider
    assert CloudflareProvider in all_providers()


def test_credential_schema_mirrors_stored_cloudflare_credentials():
    expected = Providers.CLOUDFLARE["expected_credentials"]
    optional = Providers.CLOUDFLARE["optional_credentials"]
    fields = {f.id: f for f in CloudflareProvider.credential_schema}

    assert set(fields) == set(expected) | set(optional)
    assert all(fields[f].required for f in expected)
    assert not any(fields[f].required for f in optional)
    assert fields["access_token"].masked is True
    assert fields["account_id"].masked is False


def test_config_and_output_schema():
    config = {f.id: f for f in CloudflareProvider.config_schema}
    assert config["token_owner"].choices == ["account", "user"]
    assert config["token_owner"].default == "account"
    assert config["token_owner"].required is True
    assert "{id}" in config["name_template"].default
    assert config["policies"].field_type == "json"
    assert config["policies"].required is True
    assert config["condition"].field_type == "json"
    assert config["condition"].required is False
    assert config["token_lifetime_days"].field_type == "int"

    assert [(f.id, f.masked) for f in CloudflareProvider.output_schema] == [
        ("token_id", False),
        ("api_token", True),
    ]
    assert CloudflareProvider.key_name_prefix == "CLOUDFLARE"
    assert CloudflareProvider.credential_id_label == "Token ID"
    assert CloudflareProvider.template_import.label == "Cloudflare API token ID"


def test_list_resources_rejects_unknown_type():
    with pytest.raises(ProviderConfigError):
        CloudflareProvider.list_resources(ROOT_CREDS, "zone")


# ---------------------------------------------------------------------------
# validate_config
# ---------------------------------------------------------------------------


def test_validate_config_applies_defaults():
    CloudflareProvider.validate_config({"policies": POLICIES})


def test_validate_config_accepts_full_config():
    CloudflareProvider.validate_config(
        {
            "token_owner": "user",
            "name_template": "x" * 73 + "{id}",
            "policies": POLICIES,
            "condition": {"request_ip": {"in": ["192.0.2.0/24"], "not_in": []}},
            "token_lifetime_days": 30,
        }
    )


@pytest.mark.parametrize(
    "overrides",
    [
        {"token_owner": "organization"},
        {"name_template": "phase-rs"},
        {"name_template": 7},
        {"name_template": "phase-{env}-{id}"},
        {"name_template": "phase-{id}-{"},
        {"name_template": "x" * 74 + "{id}"},
        {"policies": []},
        {"policies": {"effect": "allow"}},
        {"policies": '[{"effect": "allow"}]'},
        {"policies": ["allow"]},
        {"condition": ["192.0.2.0/24"]},
        {"condition": {"in": ["192.0.2.0/24"]}},
        {"condition": "192.0.2.0/24"},
        {"token_lifetime_days": 0},
        {"token_lifetime_days": 3651},
        {"token_lifetime_days": 1.5},
        {"token_lifetime_days": "30"},
        {"token_lifetime_days": True},
    ],
)
def test_validate_config_rejects_bad_input(overrides):
    with pytest.raises(ProviderConfigError):
        CloudflareProvider.validate_config({"policies": POLICIES, **overrides})


def test_validate_provider_config_requires_policies():
    with pytest.raises(ProviderConfigError):
        validate_provider_config("cloudflare", {"token_owner": "account"})
    validate_provider_config("cloudflare", {"policies": POLICIES})


# ---------------------------------------------------------------------------
# validate_root_credentials
# ---------------------------------------------------------------------------


@patch(HTTP)
def test_validate_root_credentials_accepts_account_token(mock_request):
    mock_request.return_value = _verified()

    creds = {**ROOT_CREDS, "access_token": " root-secret-token\n"}
    assert CloudflareProvider.validate_root_credentials(creds) is True

    assert mock_request.call_count == 1
    kwargs = mock_request.call_args.kwargs
    assert kwargs["method"] == "GET"
    assert kwargs["url"] == f"{BASE}/accounts/{ACCOUNT}/tokens/verify"
    assert kwargs["headers"] == {"Authorization": "Bearer root-secret-token"}


@patch(HTTP)
def test_validate_root_credentials_falls_back_to_user_verify(mock_request):
    mock_request.side_effect = [_invalid_token(), _verified()]

    assert CloudflareProvider.validate_root_credentials(ROOT_CREDS) is True
    assert _calls(mock_request)[1] == ("GET", f"{BASE}/user/tokens/verify")


@pytest.mark.parametrize(
    "responses",
    [
        [_invalid_token(), _invalid_token()],
        [
            _ok({"id": ROOT_ID, "status": "disabled"}),
            _ok({"id": ROOT_ID, "status": "expired"}),
        ],
        [_unauthorized(), requests.exceptions.ConnectionError("dns failure")],
        [_resp(503, {})],
    ],
)
@patch(HTTP)
def test_validate_root_credentials_returns_false(mock_request, responses):
    mock_request.side_effect = responses
    assert CloudflareProvider.validate_root_credentials(ROOT_CREDS) is False


def test_validate_root_credentials_never_raises():
    assert CloudflareProvider.validate_root_credentials({}) is False


# ---------------------------------------------------------------------------
# mint
# ---------------------------------------------------------------------------


@patch(HTTP)
def test_mint_account_token(mock_request):
    mock_request.side_effect = [
        _verified(),
        _ok({"id": TOKEN_ID, "status": "active", "value": TOKEN_VALUE}),
    ]

    result = CloudflareProvider.mint(
        ROOT_CREDS,
        {"policies": POLICIES, "condition": {}, "token_lifetime_days": None},
        caller_id="rs-1",
    )

    verify, create = mock_request.call_args_list
    assert verify.kwargs["url"] == f"{BASE}/accounts/{ACCOUNT}/tokens/verify"
    assert create.kwargs["method"] == "POST"
    assert create.kwargs["url"] == f"{BASE}/accounts/{ACCOUNT}/tokens"
    assert create.kwargs["headers"] == {"Authorization": "Bearer root-secret-token"}
    body = create.kwargs["json"]
    assert set(body) == {"name", "policies"}
    assert body["name"].startswith("phase-rs-rs-1-")
    assert body["policies"] == POLICIES

    assert result.provider_credential_id == ACCOUNT_REF
    assert result.values == {"token_id": TOKEN_ID, "api_token": TOKEN_VALUE}
    assert set(result.values) == {f.id for f in CloudflareProvider.output_schema}
    assert result.metadata["name"] == body["name"]
    assert result.metadata["owner"] == "account"
    assert result.metadata["token_id"] == TOKEN_ID
    assert result.metadata["display_id"] == TOKEN_ID
    assert result.metadata["status"] == "active"
    assert result.metadata["call"]["status"] == 200


@patch(HTTP)
def test_mint_user_token_with_condition_and_expiry(mock_request):
    condition = {"request_ip": {"in": ["192.0.2.0/24"]}}
    mock_request.side_effect = [
        _invalid_token(),
        _verified(),
        _ok({"id": TOKEN_ID, "status": "active", "value": TOKEN_VALUE}),
    ]

    before = datetime.now(timezone.utc)
    result = CloudflareProvider.mint(
        ROOT_CREDS,
        {
            "token_owner": "user",
            "name_template": "ci-{id}",
            "policies": POLICIES,
            "condition": condition,
            "token_lifetime_days": 30,
        },
        caller_id="rs-2",
    )

    create = mock_request.call_args_list[2]
    assert create.kwargs["url"] == f"{BASE}/user/tokens"
    body = create.kwargs["json"]
    assert body["name"].startswith("ci-rs-2-")
    assert body["condition"] == condition
    expires_on = datetime.strptime(body["expires_on"], "%Y-%m-%dT%H:%M:%SZ")
    expires_on = expires_on.replace(tzinfo=timezone.utc)
    lifetime = timedelta(days=30)
    assert before + lifetime - timedelta(seconds=1) <= expires_on
    assert expires_on <= datetime.now(timezone.utc) + lifetime

    assert result.provider_credential_id == USER_REF
    assert result.metadata["owner"] == "user"
    assert result.metadata["expires_on"] == body["expires_on"]


@patch(HTTP)
def test_mint_metadata_holds_no_secrets_and_survives_sanitize(mock_request):
    mock_request.side_effect = [
        _verified(),
        _ok({"id": TOKEN_ID, "status": "active", "value": TOKEN_VALUE}),
    ]
    result = CloudflareProvider.mint(
        ROOT_CREDS, {"policies": POLICIES}, caller_id="rs-1"
    )

    stored = json.dumps(sanitize(result.metadata))
    for secret in (TOKEN_VALUE, ROOT_CREDS["access_token"]):
        assert secret not in json.dumps(result.metadata)
        assert secret not in stored
    assert REDACTED not in stored


@patch(HTTP)
def test_mint_fails_without_creating_when_root_token_is_not_verified(mock_request):
    mock_request.side_effect = [_invalid_token(), _invalid_token()]

    with pytest.raises(ProviderAuthError):
        CloudflareProvider.mint(ROOT_CREDS, {"policies": POLICIES}, caller_id="rs-1")
    assert [m for m, _ in _calls(mock_request)] == ["GET", "GET"]


@patch(HTTP)
def test_mint_surfaces_cloudflare_error_message(mock_request):
    mock_request.side_effect = [
        _verified(),
        _err(400, "Invalid permission group", 1001),
    ]

    with pytest.raises(ProviderConfigError) as exc:
        CloudflareProvider.mint(ROOT_CREDS, {"policies": POLICIES}, caller_id="rs-1")
    assert "Invalid permission group" in exc.value.user_message


@pytest.mark.parametrize(
    "create_response",
    [
        _ok({"id": TOKEN_ID, "status": "active"}),
        _ok({"value": TOKEN_VALUE}),
        _ok({"id": TOKEN_ID, "value": ""}),
        _ok(None),
        _resp(
            200, {"success": False, "result": {"id": TOKEN_ID, "value": TOKEN_VALUE}}
        ),
        _resp(200, ["unexpected"]),
    ],
)
@patch(HTTP)
def test_mint_rejects_unexpected_response_without_leaking_value(
    mock_request, create_response
):
    mock_request.side_effect = [_verified(), create_response]

    with pytest.raises(ProviderConfigError) as exc:
        CloudflareProvider.mint(ROOT_CREDS, {"policies": POLICIES}, caller_id="rs-1")
    assert TOKEN_VALUE not in str(exc.value)
    assert TOKEN_VALUE not in exc.value.user_message
    assert TOKEN_VALUE not in json.dumps(exc.value.raw)


# ---------------------------------------------------------------------------
# revoke
# ---------------------------------------------------------------------------


@patch(HTTP)
def test_revoke_account_token_uses_account_from_provider_id(mock_request):
    mock_request.return_value = _ok({"id": TOKEN_ID})

    summary = CloudflareProvider.revoke(
        {**ROOT_CREDS, "account_id": "b" * 32}, ACCOUNT_REF
    )

    assert _calls(mock_request) == [
        ("DELETE", f"{BASE}/accounts/{ACCOUNT}/tokens/{TOKEN_ID}")
    ]
    assert summary["owner"] == "account"
    assert summary["token_id"] == TOKEN_ID
    assert summary["call"]["status"] == 200


@patch(HTTP)
def test_revoke_user_token(mock_request):
    mock_request.return_value = _ok({"id": TOKEN_ID})

    summary = CloudflareProvider.revoke(ROOT_CREDS, USER_REF)

    assert _calls(mock_request) == [("DELETE", f"{BASE}/user/tokens/{TOKEN_ID}")]
    assert summary["owner"] == "user"


@patch(HTTP)
def test_revoke_not_found_is_confirmed_before_reporting_missing(mock_request):
    mock_request.side_effect = [_err(404), _verified(), _err(404), _ok([])]

    with pytest.raises(ProviderNotFound) as exc:
        CloudflareProvider.revoke(ROOT_CREDS, ACCOUNT_REF)

    tokens = f"{BASE}/accounts/{ACCOUNT}/tokens"
    assert _calls(mock_request) == [
        ("DELETE", f"{tokens}/{TOKEN_ID}"),
        ("GET", f"{tokens}/verify"),
        ("GET", f"{tokens}/{TOKEN_ID}"),
        ("GET", tokens),
    ]
    assert mock_request.call_args.kwargs["params"] == {"per_page": 5}
    # The delete's own not-found error is what reaches the engine.
    assert exc.value.raw["endpoint"].startswith("DELETE ")


@patch(HTTP)
def test_revoke_not_found_but_still_readable_is_auth_error(mock_request):
    mock_request.side_effect = [
        _err(404),
        _verified(),
        _ok({"id": TOKEN_ID, "status": "active"}),
    ]

    with pytest.raises(ProviderAuthError):
        CloudflareProvider.revoke(ROOT_CREDS, ACCOUNT_REF)


@patch(HTTP)
def test_revoke_not_found_with_a_different_root_user_is_auth_error(mock_request):
    mock_request.side_effect = [
        _err(404),
        _invalid_token(),
        _verified(OTHER_ROOT_ID),
        _err(404),
    ]

    with pytest.raises(ProviderAuthError):
        CloudflareProvider.revoke(ROOT_CREDS, USER_REF)
    assert _calls(mock_request)[-1] == ("GET", f"{BASE}/user/tokens/{ROOT_ID}")


@patch(HTTP)
def test_revoke_not_found_with_another_token_of_the_same_user(mock_request):
    mock_request.side_effect = [
        _err(404),
        _invalid_token(),
        _verified(OTHER_ROOT_ID),
        _ok({"id": ROOT_ID, "status": "active"}),
        _err(404),
        _ok([]),
    ]

    with pytest.raises(ProviderNotFound):
        CloudflareProvider.revoke(ROOT_CREDS, USER_REF)
    assert _calls(mock_request)[-2:] == [
        ("GET", f"{BASE}/user/tokens/{TOKEN_ID}"),
        ("GET", f"{BASE}/user/tokens"),
    ]


@pytest.mark.parametrize("list_response", [_unauthorized(), _err(404)])
@patch(HTTP)
def test_revoke_not_found_is_auth_error_when_root_cannot_list_tokens(
    mock_request, list_response
):
    mock_request.side_effect = [_err(404), _verified(), _err(404), list_response]

    with pytest.raises(ProviderAuthError):
        CloudflareProvider.revoke(ROOT_CREDS, ACCOUNT_REF)


@patch(HTTP)
def test_revoke_not_found_retries_when_confirmation_is_transient(mock_request):
    mock_request.side_effect = [_err(404), _resp(503, {})]

    with pytest.raises(ProviderTransientError):
        CloudflareProvider.revoke(ROOT_CREDS, ACCOUNT_REF)


@pytest.mark.parametrize(
    "response, error",
    [
        (_unauthorized(), ProviderAuthError),
        (_err(403, "Authentication error", 10000), ProviderAuthError),
        (_invalid_token(), ProviderAuthError),
        (_resp(503, {}), ProviderTransientError),
        (_resp(200, {"success": False, "result": None}), ProviderConfigError),
    ],
)
@patch(HTTP)
def test_revoke_failures_are_not_reported_as_revoked(mock_request, response, error):
    mock_request.return_value = response

    with pytest.raises(error):
        CloudflareProvider.revoke(ROOT_CREDS, ACCOUNT_REF)
    assert mock_request.call_count == 1


@patch(HTTP)
def test_revoke_malformed_provider_id_makes_no_request(mock_request):
    with pytest.raises(ProviderConfigError):
        CloudflareProvider.revoke(ROOT_CREDS, TOKEN_ID)
    mock_request.assert_not_called()


# ---------------------------------------------------------------------------
# Provider ID codec
# ---------------------------------------------------------------------------


def test_provider_id_formats():
    assert (
        _encode_provider_id(_TokenRef("account", ACCOUNT, TOKEN_ID, ROOT_ID))
        == ACCOUNT_REF
    )
    assert _encode_provider_id(_TokenRef("user", None, TOKEN_ID, ROOT_ID)) == USER_REF


@pytest.mark.parametrize("ref", [ACCOUNT_REF, USER_REF])
def test_provider_id_round_trip(ref):
    assert _encode_provider_id(_decode_provider_id(ref)) == ref


@pytest.mark.parametrize(
    "bad",
    [
        "",
        TOKEN_ID,
        f"user:{TOKEN_ID}",
        f"user:{TOKEN_ID}:",
        f"user:{TOKEN_ID}:{ROOT_ID}:extra",
        f"account:{ACCOUNT}:{TOKEN_ID}",
        f"account::{TOKEN_ID}:{ROOT_ID}",
        f"zone:{ACCOUNT}:{TOKEN_ID}:{ROOT_ID}",
    ],
)
def test_provider_id_rejects_malformed(bad):
    with pytest.raises(ProviderConfigError):
        _decode_provider_id(bad)


# ---------------------------------------------------------------------------
# import_config_from_template
# ---------------------------------------------------------------------------

TEMPLATE_RESOURCES = {
    f"com.cloudflare.api.account.{ACCOUNT}": {"com.cloudflare.api.account.zone.*": "*"}
}
TEMPLATE_TOKEN = {
    "id": TOKEN_ID,
    "name": "deploy",
    "status": "active",
    "issued_on": "2026-01-01T00:00:00Z",
    "policies": [
        {
            "id": "f267e341f3dd4697bd3b9f71dd96247f",
            "effect": "allow",
            "permission_groups": [
                {
                    "id": "c8fed203ed3043cba015a93ad1616f1f",
                    "name": "Zone Read",
                    "meta": {"label": "zone_read", "scopes": "com.cloudflare.api"},
                }
            ],
            "resources": TEMPLATE_RESOURCES,
        }
    ],
    "condition": {"request_ip": {"in": ["192.0.2.0/24"], "not_in": []}},
}


@patch(HTTP)
def test_import_copies_policies_and_condition_of_account_token(mock_request):
    mock_request.return_value = _ok(TEMPLATE_TOKEN)

    config = CloudflareProvider.import_config_from_template(
        ROOT_CREDS, f"  {TOKEN_ID}\n"
    )

    assert _calls(mock_request) == [
        ("GET", f"{BASE}/accounts/{ACCOUNT}/tokens/{TOKEN_ID}")
    ]
    assert config == {
        "token_owner": "account",
        "policies": [
            {
                "effect": "allow",
                "permission_groups": [{"id": "c8fed203ed3043cba015a93ad1616f1f"}],
                "resources": TEMPLATE_RESOURCES,
            }
        ],
        "condition": {"request_ip": {"in": ["192.0.2.0/24"], "not_in": []}},
    }
    # The console merges the import into a form seeded with a name template.
    CloudflareProvider.validate_config({**config, "name_template": "phase-app-{id}"})


@pytest.mark.parametrize("account_error", [_err(404), _unauthorized()])
@pytest.mark.parametrize(
    "condition", [None, {}, {"request_ip": {"in": [], "not_in": []}}]
)
@patch(HTTP)
def test_import_falls_back_to_user_token(mock_request, condition, account_error):
    mock_request.side_effect = [
        account_error,
        _ok({**TEMPLATE_TOKEN, "condition": condition}),
    ]

    config = CloudflareProvider.import_config_from_template(ROOT_CREDS, TOKEN_ID)

    assert _calls(mock_request)[1] == ("GET", f"{BASE}/user/tokens/{TOKEN_ID}")
    assert config["token_owner"] == "user"
    assert "condition" not in config


@patch(HTTP)
def test_import_unknown_token_raises_not_found(mock_request):
    mock_request.side_effect = [_err(404), _invalid_token()]

    with pytest.raises(ProviderNotFound) as exc:
        CloudflareProvider.import_config_from_template(ROOT_CREDS, TOKEN_ID)
    assert TOKEN_ID in exc.value.user_message


@patch(HTTP)
def test_import_without_token_read_permission_raises_auth_error(mock_request):
    mock_request.side_effect = [_unauthorized(), _unauthorized()]

    with pytest.raises(ProviderAuthError):
        CloudflareProvider.import_config_from_template(ROOT_CREDS, TOKEN_ID)


@patch(HTTP)
def test_import_transient_error_does_not_fall_back(mock_request):
    mock_request.return_value = _resp(503, {})

    with pytest.raises(ProviderTransientError):
        CloudflareProvider.import_config_from_template(ROOT_CREDS, TOKEN_ID)
    assert mock_request.call_count == 1


@pytest.mark.parametrize("ref", [TOKEN_VALUE, "Q" * 40, "not a token id"])
@patch(HTTP)
def test_import_rejects_refs_that_are_not_token_ids(mock_request, ref):
    with pytest.raises(ProviderConfigError):
        CloudflareProvider.import_config_from_template(ROOT_CREDS, ref)
    mock_request.assert_not_called()


def test_import_blank_ref_returns_none():
    assert CloudflareProvider.import_config_from_template(ROOT_CREDS, "  ") is None
