import json
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest
from azure.core.credentials import AccessToken
from azure.core.exceptions import ClientAuthenticationError, ServiceRequestError

from api.services import Providers
from ee.integrations.secrets.providers.azure import (
    GRAPH_API_BASE,
    GRAPH_SCOPE,
    AzureProvider,
    _decode_provider_id,
    _encode_provider_id,
)
from ee.integrations.secrets.providers.exceptions import (
    ProviderAuthError,
    ProviderConfigError,
    ProviderNotFound,
    ProviderTransientError,
)
from ee.integrations.secrets.providers.sanitize import sanitize
from ee.integrations.secrets.rotation.providers import ROTATION_PROVIDERS, get_provider
from ee.integrations.secrets.rotation.utils import validate_provider_config

TENANT_ID = "11111111-1111-1111-1111-111111111111"
ROOT_CLIENT_ID = "22222222-2222-2222-2222-222222222222"
ROOT_SECRET = "root8Q~rootsecretvalue-0123456789abcdefgh"
APP_ID = "33333333-3333-3333-3333-333333333333"
KEY_ID = "44444444-4444-4444-4444-444444444444"
SECRET_TEXT = "new8Q~mintedsecretvalue-0123456789abcdefg"

ROOT_CREDS = {
    "tenant_id": TENANT_ID,
    "client_id": ROOT_CLIENT_ID,
    "client_secret": ROOT_SECRET,
}
APP_URL = f"{GRAPH_API_BASE}/applications(appId='{APP_ID}')"


def _resp(status=200, body=None):
    resp = MagicMock()
    resp.status_code = status
    if body is None:
        resp.text = ""
        resp.json.side_effect = ValueError("no body")
    else:
        resp.text = json.dumps(body)
        resp.json.return_value = body
    return resp


def _graph_error(status, code, message):
    return _resp(status, {"error": {"code": code, "message": message}})


def _add_password_body(**overrides):
    body = {
        "customKeyIdentifier": None,
        "displayName": "phase-rs-rs-1-1700000000",
        "endDateTime": "2027-10-22T15:00:00Z",
        "hint": "new",
        "keyId": KEY_ID,
        "secretText": SECRET_TEXT,
        "startDateTime": "2026-10-22T15:00:00Z",
    }
    body.update(overrides)
    return body


@pytest.fixture
def credential_cls():
    with patch("api.utils.syncing.azure.auth.ClientSecretCredential") as cls:
        cls.return_value.get_token.return_value = AccessToken("graph-token", 4102444800)
        yield cls


@pytest.fixture
def http():
    with patch("ee.integrations.secrets.providers.http.requests.request") as mock:
        yield mock


# ---------------------------------------------------------------------------
# Registry and schemas
# ---------------------------------------------------------------------------


def test_registry_lookup():
    assert get_provider("azure") is AzureProvider
    assert ROTATION_PROVIDERS["azure"] is AzureProvider
    assert AzureProvider.name == "Azure"


def test_credential_schema_mirrors_stored_azure_credentials():
    fields = {f.id: f for f in AzureProvider.credential_schema}
    expected = Providers.AZURE["expected_credentials"]
    optional = Providers.AZURE["optional_credentials"]
    assert set(fields) == set(expected) | set(optional)
    assert all(fields[i].required for i in expected)
    assert all(not fields[i].required for i in optional)
    assert fields["client_secret"].masked is True
    assert fields["tenant_id"].masked is False
    assert fields["client_id"].masked is False


def test_config_and_output_schema():
    config = {f.id: f for f in AzureProvider.config_schema}
    assert config["application_id"].required is True
    assert config["application_id"].resource_type == "entra_application"
    assert config["name_template"].default == "phase-rs-{id}"
    assert config["secret_lifetime_days"].field_type == "int"
    assert config["secret_lifetime_days"].default == 365
    assert config["secret_lifetime_days"].required is False

    outputs = AzureProvider.output_schema
    assert [o.id for o in outputs] == [
        "tenant_id",
        "client_id",
        "secret_id",
        "client_secret",
    ]
    assert [o.masked for o in outputs] == [False, False, False, True]
    assert AzureProvider.key_name_prefix == "AZURE"
    assert AzureProvider.credential_id_label == "Secret ID"


# ---------------------------------------------------------------------------
# validate_config
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "config",
    [
        {"application_id": APP_ID},
        {"application_id": f"  {APP_ID.upper()} "},
        {"application_id": APP_ID, "name_template": "rotated-{id}"},
        {"application_id": APP_ID, "secret_lifetime_days": 1},
        {"application_id": APP_ID, "secret_lifetime_days": 730},
        {"application_id": APP_ID, "secret_lifetime_days": None},
    ],
)
def test_validate_config_accepts(config):
    AzureProvider.validate_config(config)


@pytest.mark.parametrize(
    "config",
    [
        {},
        {"application_id": ""},
        {"application_id": "not-a-guid"},
        {"application_id": f"{APP_ID}')/owners"},
        {"application_id": 123},
        {"application_id": APP_ID, "name_template": "no-placeholder"},
        {"application_id": APP_ID, "name_template": "{other}-{id}"},
        {"application_id": APP_ID, "name_template": "{id"},
        {"application_id": APP_ID, "name_template": 5},
        {"application_id": APP_ID, "secret_lifetime_days": 0},
        {"application_id": APP_ID, "secret_lifetime_days": 731},
        {"application_id": APP_ID, "secret_lifetime_days": "365"},
        {"application_id": APP_ID, "secret_lifetime_days": 365.5},
        {"application_id": APP_ID, "secret_lifetime_days": True},
    ],
)
def test_validate_config_rejects(config):
    with pytest.raises(ProviderConfigError):
        AzureProvider.validate_config(config)


def test_validate_provider_config_requires_application_and_applies_defaults():
    with pytest.raises(ProviderConfigError) as exc:
        validate_provider_config("azure", {})
    assert "App registration" in exc.value.user_message
    validate_provider_config("azure", {"application_id": APP_ID})


# ---------------------------------------------------------------------------
# Provider ID codec
# ---------------------------------------------------------------------------


def test_provider_id_roundtrip():
    encoded = _encode_provider_id(APP_ID, KEY_ID)
    assert encoded == f"{APP_ID}:{KEY_ID}"
    assert _decode_provider_id(encoded) == (APP_ID, KEY_ID)


@pytest.mark.parametrize(
    "value",
    [
        "",
        None,
        KEY_ID,
        f"{APP_ID}:",
        f":{KEY_ID}",
        f"{APP_ID}:not-a-guid",
        f"app:{KEY_ID}",
        f"{APP_ID}:{KEY_ID}:extra",
    ],
)
def test_provider_id_rejects_malformed(value):
    with pytest.raises(ProviderConfigError):
        _decode_provider_id(value)


# ---------------------------------------------------------------------------
# Token acquisition and validate_root_credentials
# ---------------------------------------------------------------------------


def test_validate_root_credentials_true_when_token_issued(credential_cls, http):
    assert AzureProvider.validate_root_credentials(ROOT_CREDS) is True
    credential_cls.assert_called_once_with(
        tenant_id=TENANT_ID, client_id=ROOT_CLIENT_ID, client_secret=ROOT_SECRET
    )
    credential_cls.return_value.get_token.assert_called_once_with(GRAPH_SCOPE)
    credential_cls.return_value.close.assert_called_once()
    # A token alone is enough, so Key Vault-only credentials still validate.
    http.assert_not_called()


@pytest.mark.parametrize(
    "error",
    [
        ClientAuthenticationError(message="AADSTS7000215: Invalid client secret."),
        ServiceRequestError("dns failure"),
        RuntimeError("unexpected"),
    ],
)
def test_validate_root_credentials_false_on_token_errors(credential_cls, error):
    credential_cls.return_value.get_token.side_effect = error
    assert AzureProvider.validate_root_credentials(ROOT_CREDS) is False


def test_validate_root_credentials_false_on_bad_input(credential_cls):
    credential_cls.side_effect = ValueError("Invalid tenant ID provided.")
    assert AzureProvider.validate_root_credentials(ROOT_CREDS) is False
    assert AzureProvider.validate_root_credentials({"tenant_id": TENANT_ID}) is False


def test_token_auth_error_is_auth_error_and_redacts_root_secret(credential_cls, http):
    credential_cls.return_value.get_token.side_effect = ClientAuthenticationError(
        message=f"AADSTS700016: Application with identifier '{ROOT_SECRET}' was not found."
    )
    with pytest.raises(ProviderAuthError) as exc:
        AzureProvider.mint(ROOT_CREDS, {"application_id": APP_ID}, caller_id="rs-1")
    assert "AADSTS700016" in exc.value.user_message
    assert ROOT_SECRET not in exc.value.user_message
    assert ROOT_SECRET not in str(exc.value)
    http.assert_not_called()


def _wrapped(cause):
    """Mimic azure-identity's wrap_exceptions decorator."""
    try:
        try:
            raise cause
        except Exception as inner:
            raise ClientAuthenticationError(
                message=f"Authentication failed: {inner}"
            ) from inner
    except ClientAuthenticationError as outer:
        return outer


class _MsalServiceError(Exception):
    """Stands in for msal's MsalServiceError, raised on Entra 5xx responses."""


@pytest.mark.parametrize(
    "error",
    [
        ServiceRequestError("connection refused"),
        _wrapped(ServiceRequestError("connection refused")),
        _wrapped(_MsalServiceError("HTTP Error: 503")),
    ],
)
def test_token_transport_errors_are_transient(credential_cls, http, error):
    credential_cls.return_value.get_token.side_effect = error
    with pytest.raises(ProviderTransientError):
        AzureProvider.mint(ROOT_CREDS, {"application_id": APP_ID}, caller_id="rs-1")
    http.assert_not_called()


def test_token_unknown_tenant_is_auth_error(credential_cls, http):
    credential_cls.return_value.get_token.side_effect = _wrapped(
        ValueError("Unable to get authority configuration for the tenant.")
    )
    with pytest.raises(ProviderAuthError) as exc:
        AzureProvider.mint(ROOT_CREDS, {"application_id": APP_ID}, caller_id="rs-1")
    assert "Unable to get authority configuration" in exc.value.user_message
    http.assert_not_called()


def test_token_entra_server_error_is_transient(credential_cls):
    response = MagicMock()
    response.status_code = 503
    response.reason = "Service Unavailable"
    credential_cls.return_value.get_token.side_effect = ClientAuthenticationError(
        message="Unexpected response from Microsoft Entra ID", response=response
    )
    with pytest.raises(ProviderTransientError):
        AzureProvider.revoke(ROOT_CREDS, f"{APP_ID}:{KEY_ID}")


# ---------------------------------------------------------------------------
# mint
# ---------------------------------------------------------------------------


def test_mint_request_shape_and_result(credential_cls, http):
    http.return_value = _resp(200, _add_password_body())

    before = datetime.now(timezone.utc)
    result = AzureProvider.mint(
        ROOT_CREDS, {"application_id": APP_ID}, caller_id="rs-1"
    )

    _, kwargs = http.call_args
    assert kwargs["method"] == "POST"
    assert kwargs["url"] == f"{APP_URL}/addPassword"
    assert kwargs["headers"] == {"Authorization": "Bearer graph-token"}
    credential = kwargs["json"]["passwordCredential"]
    assert set(credential) == {"displayName", "endDateTime"}
    assert credential["displayName"].startswith("phase-rs-rs-1-")
    end = datetime.strptime(credential["endDateTime"], "%Y-%m-%dT%H:%M:%SZ").replace(
        tzinfo=timezone.utc
    )
    assert abs(end - (before + timedelta(days=365))) < timedelta(minutes=1)

    assert result.provider_credential_id == f"{APP_ID}:{KEY_ID}"
    assert set(result.values) == {o.id for o in AzureProvider.output_schema}
    assert result.values == {
        "tenant_id": TENANT_ID,
        "client_id": APP_ID,
        "secret_id": KEY_ID,
        "client_secret": SECRET_TEXT,
    }
    assert result.metadata["display_name"] == credential["displayName"]
    assert result.metadata["end_date_time"] == "2027-10-22T15:00:00Z"
    assert result.metadata["application_id"] == APP_ID
    assert result.metadata["display_id"] == KEY_ID
    assert result.metadata["call"]["status"] == 200


def test_mint_metadata_holds_no_secret_values(credential_cls, http):
    http.return_value = _resp(200, _add_password_body())
    result = AzureProvider.mint(
        ROOT_CREDS, {"application_id": APP_ID}, caller_id="rs-1"
    )
    assert set(result.metadata) == {
        "display_name",
        "end_date_time",
        "application_id",
        "display_id",
        "call",
    }
    dumped = json.dumps(result.metadata)
    assert SECRET_TEXT not in dumped
    assert ROOT_SECRET not in dumped
    assert "hint" not in dumped
    # Nothing is redacted, so display_id stays searchable in the console.
    assert sanitize(result.metadata) == result.metadata


def test_mint_uses_template_and_lifetime(credential_cls, http):
    http.return_value = _resp(200, _add_password_body())
    before = datetime.now(timezone.utc)
    AzureProvider.mint(
        ROOT_CREDS,
        {
            "application_id": f" {APP_ID} ",
            "name_template": "ci-{id}",
            "secret_lifetime_days": 30,
        },
        caller_id="rs-9",
    )
    _, kwargs = http.call_args
    assert kwargs["url"] == f"{APP_URL}/addPassword"
    credential = kwargs["json"]["passwordCredential"]
    assert credential["displayName"].startswith("ci-rs-9-")
    end = datetime.strptime(credential["endDateTime"], "%Y-%m-%dT%H:%M:%SZ").replace(
        tzinfo=timezone.utc
    )
    assert abs(end - (before + timedelta(days=30))) < timedelta(minutes=1)


@pytest.mark.parametrize(
    "body",
    [
        {"secretText": SECRET_TEXT},
        {"keyId": KEY_ID, "hint": "new"},
        {"keyId": "not-a-guid", "secretText": SECRET_TEXT},
        {"keyId": KEY_ID, "secretText": ""},
        ["unexpected"],
        None,
    ],
)
def test_mint_unexpected_response_shape(credential_cls, http, body):
    http.return_value = _resp(200, body)
    with pytest.raises(ProviderConfigError) as exc:
        AzureProvider.mint(ROOT_CREDS, {"application_id": APP_ID}, caller_id="rs-1")
    for text in (str(exc.value), exc.value.user_message, repr(exc.value.raw)):
        assert SECRET_TEXT not in text


def test_mint_rejects_invalid_config_without_calling_azure(credential_cls, http):
    with pytest.raises(ProviderConfigError):
        AzureProvider.mint(ROOT_CREDS, {"application_id": "nope"}, caller_id="rs-1")
    credential_cls.assert_not_called()
    http.assert_not_called()


def test_mint_app_not_found_is_config_error(credential_cls, http):
    http.return_value = _graph_error(
        404, "Request_ResourceNotFound", "Resource does not exist."
    )
    with pytest.raises(ProviderConfigError) as exc:
        AzureProvider.mint(ROOT_CREDS, {"application_id": APP_ID}, caller_id="rs-1")
    assert not isinstance(exc.value, ProviderNotFound)
    assert "App registration not found" in exc.value.user_message


def test_mint_forbidden_explains_permissions(credential_cls, http):
    http.return_value = _graph_error(
        403,
        "Authorization_RequestDenied",
        "Insufficient privileges to complete the operation.",
    )
    with pytest.raises(ProviderAuthError) as exc:
        AzureProvider.mint(ROOT_CREDS, {"application_id": APP_ID}, caller_id="rs-1")
    assert "Application.ReadWrite.OwnedBy" in exc.value.user_message
    assert "owner" in exc.value.user_message
    assert exc.value.raw["status"] == 403


def test_mint_throttled_is_transient(credential_cls, http):
    http.return_value = _graph_error(429, "TooManyRequests", "Slow down.")
    with pytest.raises(ProviderTransientError):
        AzureProvider.mint(ROOT_CREDS, {"application_id": APP_ID}, caller_id="rs-1")


# ---------------------------------------------------------------------------
# revoke
# ---------------------------------------------------------------------------


def _app_with_credentials(*key_ids):
    return _resp(
        200,
        {
            "id": "55555555-5555-5555-5555-555555555555",
            "passwordCredentials": [
                {"keyId": k, "hint": "abc", "secretText": None} for k in key_ids
            ],
        },
    )


def test_revoke_request_shape(credential_cls, http):
    http.return_value = _resp(204)
    summary = AzureProvider.revoke(ROOT_CREDS, f"{APP_ID}:{KEY_ID}")

    http.assert_called_once()
    _, kwargs = http.call_args
    assert kwargs["method"] == "POST"
    assert kwargs["url"] == f"{APP_URL}/removePassword"
    assert kwargs["headers"] == {"Authorization": "Bearer graph-token"}
    assert kwargs["json"] == {"keyId": KEY_ID}
    assert summary["application_id"] == APP_ID
    assert summary["key_id"] == KEY_ID
    assert summary["call"]["status"] == 204


MISSING_SECRET_SIGNALS = ["http_404", "bad_request_400"]


def _missing_secret_response(signal):
    if signal == "http_404":
        return _graph_error(404, "Request_ResourceNotFound", "Resource does not exist.")
    return _graph_error(
        400,
        "Request_BadRequest",
        f"No password credential found with keyId '{KEY_ID}'.",
    )


@pytest.mark.parametrize("signal", MISSING_SECRET_SIGNALS)
def test_revoke_not_found_when_app_visible_and_key_absent(credential_cls, http, signal):
    other_key = "66666666-6666-6666-6666-666666666666"
    http.side_effect = [
        _missing_secret_response(signal),
        _app_with_credentials(other_key),
    ]

    with pytest.raises(ProviderNotFound):
        AzureProvider.revoke(ROOT_CREDS, f"{APP_ID}:{KEY_ID}")

    assert http.call_count == 2
    _, check = http.call_args_list[1]
    assert check["method"] == "GET"
    assert check["url"] == APP_URL
    assert check["params"] == {"$select": "id,passwordCredentials"}
    assert check["headers"] == {"Authorization": "Bearer graph-token"}
    # One token covers both calls.
    credential_cls.return_value.get_token.assert_called_once()


@pytest.mark.parametrize("signal", MISSING_SECRET_SIGNALS)
@pytest.mark.parametrize(
    "status, code",
    [
        (404, "Request_ResourceNotFound"),
        (403, "Authorization_RequestDenied"),
        (401, "InvalidAuthenticationToken"),
    ],
)
def test_revoke_not_found_but_app_not_visible_is_auth_error(
    credential_cls, http, signal, status, code
):
    http.side_effect = [
        _missing_secret_response(signal),
        _graph_error(status, code, "Phase can't read this app."),
    ]
    with pytest.raises(ProviderAuthError) as exc:
        AzureProvider.revoke(ROOT_CREDS, f"{APP_ID}:{KEY_ID}")
    assert not isinstance(exc.value, ProviderNotFound)
    assert "can no longer see this app registration" in exc.value.user_message
    assert "may still be valid" in exc.value.user_message


@pytest.mark.parametrize("signal", MISSING_SECRET_SIGNALS)
def test_revoke_not_found_but_key_still_listed_is_retried(credential_cls, http, signal):
    http.side_effect = [
        _missing_secret_response(signal),
        _app_with_credentials(KEY_ID.upper()),
    ]
    with pytest.raises(ProviderTransientError) as exc:
        AzureProvider.revoke(ROOT_CREDS, f"{APP_ID}:{KEY_ID}")
    assert not isinstance(exc.value, ProviderNotFound)


def test_revoke_not_found_check_with_unexpected_shape(credential_cls, http):
    http.side_effect = [
        _graph_error(404, "Request_ResourceNotFound", "Resource does not exist."),
        _resp(200, {"id": "55555555-5555-5555-5555-555555555555"}),
    ]
    with pytest.raises(ProviderConfigError) as exc:
        AzureProvider.revoke(ROOT_CREDS, f"{APP_ID}:{KEY_ID}")
    assert not isinstance(exc.value, ProviderNotFound)


def test_revoke_not_found_check_transient_error_propagates(credential_cls, http):
    http.side_effect = [
        _graph_error(404, "Request_ResourceNotFound", "Resource does not exist."),
        _graph_error(503, "ServiceUnavailable", "Try later."),
    ]
    with pytest.raises(ProviderTransientError):
        AzureProvider.revoke(ROOT_CREDS, f"{APP_ID}:{KEY_ID}")


def test_revoke_other_bad_request_is_not_treated_as_missing(credential_cls, http):
    http.return_value = _graph_error(
        400, "Request_BadRequest", "Invalid value specified for property 'keyId'."
    )
    with pytest.raises(ProviderConfigError) as exc:
        AzureProvider.revoke(ROOT_CREDS, f"{APP_ID}:{KEY_ID}")
    assert not isinstance(exc.value, ProviderNotFound)
    http.assert_called_once()


def test_revoke_forbidden_warns_secret_may_be_valid(credential_cls, http):
    http.return_value = _graph_error(
        403,
        "Authorization_RequestDenied",
        "Insufficient privileges to complete the operation.",
    )
    with pytest.raises(ProviderAuthError) as exc:
        AzureProvider.revoke(ROOT_CREDS, f"{APP_ID}:{KEY_ID}")
    assert "may still be valid" in exc.value.user_message
    http.assert_called_once()


def test_revoke_malformed_id_makes_no_calls(credential_cls, http):
    with pytest.raises(ProviderConfigError):
        AzureProvider.revoke(ROOT_CREDS, KEY_ID)
    credential_cls.assert_not_called()
    http.assert_not_called()


# ---------------------------------------------------------------------------
# list_resources
# ---------------------------------------------------------------------------


def test_list_resources_paginates_and_maps_apps(credential_cls, http):
    next_link = f"{GRAPH_API_BASE}/applications?$select=id,appId,displayName&$top=100&$skiptoken=abc"
    http.side_effect = [
        _resp(
            200,
            {
                "value": [
                    {"id": "o1", "appId": "app-b", "displayName": "Billing"},
                    {"id": "o2", "appId": "app-n", "displayName": None},
                    {"id": "o3", "displayName": "No app id"},
                ],
                "@odata.nextLink": next_link,
            },
        ),
        _resp(200, {"value": [{"id": "o4", "appId": "app-a", "displayName": "api"}]}),
    ]

    resources = AzureProvider.list_resources(ROOT_CREDS, "entra_application")

    # Sorted by name, falling back to the appId; entries without an appId are skipped.
    assert [(r.id, r.name, r.description) for r in resources] == [
        ("app-a", "api", "app-a"),
        ("app-n", "app-n", "app-n"),
        ("app-b", "Billing", "app-b"),
    ]
    assert http.call_count == 2
    _, first = http.call_args_list[0]
    assert first["method"] == "GET"
    assert first["url"] == f"{GRAPH_API_BASE}/applications"
    assert first["params"] == {"$select": "id,appId,displayName", "$top": 100}
    assert first["headers"] == {"Authorization": "Bearer graph-token"}
    _, second = http.call_args_list[1]
    assert second["url"] == next_link
    assert second["params"] is None
    credential_cls.return_value.get_token.assert_called_once()


def test_list_resources_ignores_foreign_next_link(credential_cls, http):
    http.return_value = _resp(
        200,
        {
            "value": [{"appId": "app-a", "displayName": "A"}],
            "@odata.nextLink": "https://attacker.example.com/applications?page=2",
        },
    )
    resources = AzureProvider.list_resources(ROOT_CREDS, "entra_application")
    assert [r.id for r in resources] == ["app-a"]
    http.assert_called_once()


def test_list_resources_page_ceiling(credential_cls, http):
    http.return_value = _resp(
        200,
        {
            "value": [],
            "@odata.nextLink": f"{GRAPH_API_BASE}/applications?$skiptoken=loop",
        },
    )
    assert AzureProvider.list_resources(ROOT_CREDS, "entra_application") == []
    assert http.call_count == 50


def test_list_resources_forbidden_explains_permissions(credential_cls, http):
    http.return_value = _graph_error(
        403, "Authorization_RequestDenied", "Insufficient privileges."
    )
    with pytest.raises(ProviderAuthError) as exc:
        AzureProvider.list_resources(ROOT_CREDS, "entra_application")
    assert "Application.ReadWrite.OwnedBy" in exc.value.user_message


def test_list_resources_unexpected_shape(credential_cls, http):
    http.return_value = _resp(200, {"unexpected": True})
    with pytest.raises(ProviderConfigError):
        AzureProvider.list_resources(ROOT_CREDS, "entra_application")


def test_list_resources_rejects_unknown_type(credential_cls, http):
    with pytest.raises(ProviderConfigError):
        AzureProvider.list_resources(ROOT_CREDS, "subscription")
    credential_cls.assert_not_called()
    http.assert_not_called()
