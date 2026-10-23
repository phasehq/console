from unittest.mock import MagicMock, patch

import pytest
import requests

from api.services import Providers
from ee.integrations.secrets.providers.datadog import (
    DatadogProvider,
    _decode_provider_id,
    _encode_provider_id,
)
from ee.integrations.secrets.providers.exceptions import (
    ProviderAuthError,
    ProviderConfigError,
    ProviderNotFound,
)
from ee.integrations.secrets.providers.sanitize import sanitize
from ee.integrations.secrets.rotation.providers import ROTATION_PROVIDERS, get_provider
from ee.integrations.secrets.rotation.utils import validate_provider_config

HTTP = "ee.integrations.secrets.providers.http.requests.request"

ROOT_API_KEY = "rootapikey0123456789abcdef012345"
ROOT_APP_KEY = "rootappkey0123456789abcdef0123456789abcd"
MINTED_KEY = "mintedkey0123456789abcdef0123456"
ROOT = {
    "api_key": ROOT_API_KEY,
    "site": "datadoghq.com",
    "application_key": ROOT_APP_KEY,
}
KEY_ID = "3f9a1c2e-1b2c-4d5e-8f90-0123456789ab"


def _mock_response(status=200, json_body=None, text=""):
    resp = MagicMock()
    resp.status_code = status
    resp.text = text
    resp.json.return_value = json_body or {}
    return resp


def _created(resource_type, key_id=KEY_ID, key=MINTED_KEY, **attributes):
    return _mock_response(
        201,
        {
            "data": {
                "type": resource_type,
                "id": key_id,
                "attributes": {"key": key, "last4": key[-4:], **attributes},
            }
        },
    )


# ---------------------------------------------------------------------------
# Registry and schemas
# ---------------------------------------------------------------------------


def test_registry_contains_datadog():
    assert ROTATION_PROVIDERS["datadog"] is DatadogProvider
    assert get_provider("datadog") is DatadogProvider


def test_credential_schema_mirrors_stored_datadog_credentials():
    fields = {f.id: f for f in DatadogProvider.credential_schema}
    expected = Providers.DATADOG["expected_credentials"]
    optional = Providers.DATADOG["optional_credentials"]
    assert set(fields) == set(expected) | set(optional)
    assert all(fields[f].required for f in expected)
    # Log stream credentials without an application key must still validate.
    assert not any(fields[f].required for f in optional)
    assert fields["api_key"].masked and fields["application_key"].masked
    assert not fields["site"].masked


def test_output_schema_lists_identifier_before_secret():
    assert [(f.id, f.masked) for f in DatadogProvider.output_schema] == [
        ("key_id", False),
        ("key", True),
    ]


def test_config_schema_declares_no_resource_pickers():
    assert not any(f.resource_type for f in DatadogProvider.config_schema)


def test_list_resources_rejects_any_type():
    with pytest.raises(ProviderConfigError):
        DatadogProvider.list_resources(ROOT, "scope")


# ---------------------------------------------------------------------------
# validate_config
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "config",
    [
        {},
        {"key_type": "api_key"},
        {"key_type": "api_key", "scopes": []},
        {"key_type": "application_key"},
        {"key_type": "application_key", "scopes": ["dashboards_read"]},
        {"key_type": "api_key", "name_template": "phase-app-dev-{id}"},
    ],
)
def test_validate_config_accepts(config):
    DatadogProvider.validate_config(config)
    validate_provider_config("datadog", config)


@pytest.mark.parametrize(
    "config",
    [
        {"key_type": "client_token"},
        {"key_type": None},
        {"key_type": ["api_key"]},
        {"name_template": "phase-rs"},
        {"name_template": ""},
        {"name_template": None},
        {"name_template": "phase-{env}-{id}"},
        {"name_template": "phase-{id}-}"},
        {"key_type": "api_key", "scopes": ["dashboards_read"]},
        {"scopes": ["dashboards_read"]},
        {"key_type": "application_key", "scopes": "dashboards_read"},
        {"key_type": "application_key", "scopes": ["dashboards_read", " "]},
        {"key_type": "application_key", "scopes": [1]},
    ],
)
def test_validate_config_rejects(config):
    with pytest.raises(ProviderConfigError):
        DatadogProvider.validate_config(config)


# ---------------------------------------------------------------------------
# mint
# ---------------------------------------------------------------------------


@patch(HTTP)
def test_mint_api_key(mock_request):
    mock_request.return_value = _created("api_keys", name="phase-rs-x")

    result = DatadogProvider.mint(ROOT, {}, caller_id="rs-1")

    _, kwargs = mock_request.call_args
    assert kwargs["method"] == "POST"
    assert kwargs["url"] == "https://api.datadoghq.com/api/v2/api_keys"
    assert kwargs["headers"] == {
        "DD-API-KEY": ROOT_API_KEY,
        "DD-APPLICATION-KEY": ROOT_APP_KEY,
    }
    body = kwargs["json"]
    assert body["data"]["type"] == "api_keys"
    assert set(body["data"]["attributes"]) == {"name"}
    name = body["data"]["attributes"]["name"]
    assert name.startswith("phase-rs-rs-1-")
    assert name.rsplit("-", 1)[1].isdigit()

    assert result.provider_credential_id == f"api_key:{KEY_ID}"
    assert result.values == {"key_id": KEY_ID, "key": MINTED_KEY}
    assert set(result.values) == {f.id for f in DatadogProvider.output_schema}
    assert result.metadata["name"] == name
    assert result.metadata["type"] == "api_key"
    assert result.metadata["key_id"] == KEY_ID
    assert result.metadata["display_id"] == KEY_ID
    assert (
        result.metadata["call"]["endpoint"] == "POST api.datadoghq.com/api/v2/api_keys"
    )


@patch(HTTP)
def test_mint_scoped_application_key_on_regional_site(mock_request):
    mock_request.return_value = _created("application_keys")

    result = DatadogProvider.mint(
        {**ROOT, "site": "https://US3.datadoghq.com/"},
        {
            "key_type": "application_key",
            "name_template": "phase-app-{id}",
            "scopes": ["dashboards_read", "monitors_read"],
        },
        caller_id="rs-2",
    )

    _, kwargs = mock_request.call_args
    assert kwargs["url"] == (
        "https://api.us3.datadoghq.com/api/v2/current_user/application_keys"
    )
    attributes = kwargs["json"]["data"]["attributes"]
    assert kwargs["json"]["data"]["type"] == "application_keys"
    assert attributes["scopes"] == ["dashboards_read", "monitors_read"]
    assert attributes["name"].startswith("phase-app-rs-2-")
    assert result.provider_credential_id == f"application_key:{KEY_ID}"
    assert result.metadata["type"] == "application_key"


@patch(HTTP)
def test_mint_unscoped_application_key_omits_scopes(mock_request):
    mock_request.return_value = _created("application_keys")

    DatadogProvider.mint(
        ROOT, {"key_type": "application_key", "scopes": []}, caller_id="rs-3"
    )

    _, kwargs = mock_request.call_args
    assert "scopes" not in kwargs["json"]["data"]["attributes"]


@patch(HTTP)
def test_mint_metadata_holds_no_secrets(mock_request):
    mock_request.return_value = _created("api_keys")

    result = DatadogProvider.mint(ROOT, {}, caller_id="rs-1")

    # Neutral key names: nothing is redacted, and no secret is present.
    assert sanitize(result.metadata) == result.metadata
    dumped = str(result.metadata)
    for secret in (MINTED_KEY, ROOT_API_KEY, ROOT_APP_KEY):
        assert secret not in dumped


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"data": None},
        {"data": {"attributes": {"key": MINTED_KEY}}},
        {"data": {"id": KEY_ID, "attributes": {}}},
        {"data": {"id": KEY_ID, "attributes": {"key": ""}}},
        {"errors": ["unexpected"]},
    ],
)
@patch(HTTP)
def test_mint_unexpected_response_shape(mock_request, body):
    mock_request.return_value = _mock_response(201, body, text=str(body))

    with pytest.raises(ProviderConfigError) as excinfo:
        DatadogProvider.mint(ROOT, {}, caller_id="rs-1")

    err = excinfo.value
    # The response may carry the new key, so it must not leak into the error.
    assert MINTED_KEY not in f"{err} {err.user_message} {err.raw}"
    assert "phase-rs-rs-1-" in err.user_message


@pytest.mark.parametrize("application_key", [None, "", "   "])
@patch(HTTP)
def test_mint_requires_application_key(mock_request, application_key):
    root = {"api_key": ROOT_API_KEY, "site": "datadoghq.com"}
    if application_key is not None:
        root["application_key"] = application_key

    with pytest.raises(ProviderConfigError) as excinfo:
        DatadogProvider.mint(root, {}, caller_id="rs-1")

    assert excinfo.value.user_message == (
        "Add an application key to these Datadog credentials. "
        "Rotation needs one to manage keys."
    )
    mock_request.assert_not_called()


@patch(HTTP)
def test_mint_rejects_unknown_site(mock_request):
    with pytest.raises(ProviderConfigError):
        DatadogProvider.mint(
            {**ROOT, "site": "attacker.example.com"}, {}, caller_id="rs-1"
        )
    mock_request.assert_not_called()


@patch(HTTP)
def test_mint_rejects_invalid_config_before_calling_datadog(mock_request):
    with pytest.raises(ProviderConfigError):
        DatadogProvider.mint(ROOT, {"scopes": ["dashboards_read"]}, caller_id="rs-1")
    mock_request.assert_not_called()


@patch(HTTP)
def test_mint_surfaces_datadog_error_messages(mock_request):
    body = {"errors": ["Forbidden"]}
    mock_request.return_value = _mock_response(403, body, text=str(body))
    with pytest.raises(ProviderAuthError) as excinfo:
        DatadogProvider.mint(ROOT, {}, caller_id="rs-1")
    assert "Forbidden" in excinfo.value.user_message

    body = {"errors": ["Invalid scope: not_a_scope"]}
    mock_request.return_value = _mock_response(400, body, text=str(body))
    with pytest.raises(ProviderConfigError) as excinfo:
        DatadogProvider.mint(
            ROOT,
            {"key_type": "application_key", "scopes": ["not_a_scope"]},
            caller_id="rs-1",
        )
    assert "Invalid scope: not_a_scope" in excinfo.value.user_message


# ---------------------------------------------------------------------------
# revoke
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "key_type, path",
    [
        ("api_key", "/api/v2/api_keys"),
        ("application_key", "/api/v2/current_user/application_keys"),
    ],
)
@patch(HTTP)
def test_revoke_deletes_key(mock_request, key_type, path):
    mock_request.return_value = _mock_response(204)

    summary = DatadogProvider.revoke(
        {**ROOT, "site": "datadoghq.eu"}, f"{key_type}:{KEY_ID}"
    )

    _, kwargs = mock_request.call_args
    assert kwargs["method"] == "DELETE"
    assert kwargs["url"] == f"https://api.datadoghq.eu{path}/{KEY_ID}"
    assert kwargs["headers"] == {
        "DD-API-KEY": ROOT_API_KEY,
        "DD-APPLICATION-KEY": ROOT_APP_KEY,
    }
    assert summary["type"] == key_type
    assert summary["key_id"] == KEY_ID
    assert summary["call"]["status"] == 204
    assert sanitize(summary) == summary


@patch(HTTP)
def test_revoke_404_raises_not_found(mock_request):
    body = {"errors": ["API key not found"]}
    mock_request.return_value = _mock_response(404, body, text=str(body))
    with pytest.raises(ProviderNotFound):
        DatadogProvider.revoke(ROOT, f"api_key:{KEY_ID}")


@patch(HTTP)
def test_revoke_requires_application_key(mock_request):
    with pytest.raises(ProviderConfigError):
        DatadogProvider.revoke(
            {"api_key": ROOT_API_KEY, "site": "datadoghq.com"}, f"api_key:{KEY_ID}"
        )
    mock_request.assert_not_called()


@patch(HTTP)
def test_revoke_rejects_malformed_provider_id(mock_request):
    with pytest.raises(ProviderConfigError):
        DatadogProvider.revoke(ROOT, KEY_ID)
    mock_request.assert_not_called()


# ---------------------------------------------------------------------------
# Provider ID codec
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("key_type", ["api_key", "application_key"])
def test_provider_id_roundtrip(key_type):
    encoded = _encode_provider_id(key_type, KEY_ID)
    assert encoded == f"{key_type}:{KEY_ID}"
    assert _decode_provider_id(encoded) == (key_type, KEY_ID)


@pytest.mark.parametrize(
    "provider_credential_id",
    ["", KEY_ID, "api_key:", f":{KEY_ID}", f"client_token:{KEY_ID}"],
)
def test_provider_id_rejects_malformed(provider_credential_id):
    with pytest.raises(ProviderConfigError):
        _decode_provider_id(provider_credential_id)


# ---------------------------------------------------------------------------
# validate_root_credentials
# ---------------------------------------------------------------------------


@patch(HTTP)
def test_validate_root_credentials_checks_api_key(mock_request):
    mock_request.return_value = _mock_response(200, {"valid": True})

    # Log stream credentials have no application key; they must still pass.
    assert (
        DatadogProvider.validate_root_credentials(
            {"api_key": ROOT_API_KEY, "site": "datadoghq.eu"}
        )
        is True
    )

    _, kwargs = mock_request.call_args
    assert kwargs["method"] == "GET"
    assert kwargs["url"] == "https://api.datadoghq.eu/api/v1/validate"
    assert kwargs["headers"] == {"DD-API-KEY": ROOT_API_KEY}


@patch(HTTP)
def test_validate_root_credentials_defaults_site_like_log_stream(mock_request):
    mock_request.return_value = _mock_response(200, {"valid": True})
    assert DatadogProvider.validate_root_credentials({"api_key": ROOT_API_KEY})
    _, kwargs = mock_request.call_args
    assert kwargs["url"] == "https://api.datadoghq.com/api/v1/validate"


@patch(HTTP)
def test_validate_root_credentials_false_when_rejected(mock_request):
    body = {"errors": ["Forbidden"]}
    mock_request.return_value = _mock_response(403, body, text=str(body))
    assert DatadogProvider.validate_root_credentials(ROOT) is False


@patch(HTTP)
def test_validate_root_credentials_false_on_network_error(mock_request):
    mock_request.side_effect = requests.exceptions.ConnectionError("dns failure")
    assert DatadogProvider.validate_root_credentials(ROOT) is False


@patch(HTTP)
def test_validate_root_credentials_false_on_unknown_site(mock_request):
    assert (
        DatadogProvider.validate_root_credentials({**ROOT, "site": "169.254.169.254"})
        is False
    )
    mock_request.assert_not_called()
