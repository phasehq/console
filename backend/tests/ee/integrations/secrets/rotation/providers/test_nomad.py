import json
import re
from unittest.mock import MagicMock, patch

import pytest
import requests
from requests.structures import CaseInsensitiveDict

from api.services import Providers
from ee.integrations.secrets.providers.exceptions import (
    ProviderAuthError,
    ProviderConfigError,
    ProviderNotFound,
    ProviderTransientError,
)
from ee.integrations.secrets.providers.nomad import (
    _MAX_PAGES,
    NomadProvider,
    _decode_provider_id,
    _encode_provider_id,
)
from ee.integrations.secrets.providers.sanitize import sanitize
from ee.integrations.secrets.rotation.providers import all_providers, get_provider
from ee.integrations.secrets.rotation.utils import validate_provider_config

HTTP = "ee.integrations.secrets.providers.http.requests.request"
ADDR = "https://nomad.example.com:4646"
ROOT = {"nomad_addr": f"{ADDR}/", "nomad_token_secret": "root-secret-id"}
AUTH = {"Authorization": "Bearer root-secret-id"}
ACCESSOR = "aa534e09-6a07-0a45-2295-a7f77063d429"
SECRET = "8176afd3-772d-0b71-8f85-7fa5d903e9d4"
ROLE_ID = "77c50812-fcdd-701b-9f1a-6cf55387b09d"


def _response(status=200, body=None, *, text=None, headers=None):
    resp = MagicMock()
    resp.status_code = status
    resp.headers = CaseInsensitiveDict(headers or {})
    if text is None:
        resp.text = json.dumps(body)
        resp.json.return_value = body
    else:
        # Nomad writes error responses as plain text.
        resp.text = text
        resp.json.side_effect = ValueError("not JSON")
    return resp


def _token(**overrides):
    body = {
        "AccessorID": ACCESSOR,
        "SecretID": SECRET,
        "Name": "phase-rs-rs-1-1700000000",
        "Type": "client",
        "Policies": ["readonly"],
        "Roles": None,
        "Global": False,
        "CreateTime": "2026-10-22T10:00:00Z",
        "ExpirationTime": None,
        "CreateIndex": 52,
        "ModifyIndex": 52,
    }
    body.update(overrides)
    return body


# ---------------------------------------------------------------------------
# Registry and schemas
# ---------------------------------------------------------------------------


def test_registry_lookup():
    assert get_provider("hashicorp_nomad") is NomadProvider
    assert NomadProvider in all_providers()
    assert NomadProvider.name == "HashiCorp Nomad"
    assert NomadProvider.key_name_prefix == "NOMAD"
    assert NomadProvider.credential_id_label == "Accessor ID"


def test_credential_schema_matches_sync_credentials():
    spec = Providers.HASHICORP_NOMAD
    fields = {f.id: f for f in NomadProvider.credential_schema}
    assert spec["id"] == NomadProvider.id
    assert list(fields) == spec["expected_credentials"] + spec["optional_credentials"]
    assert all(fields[f].required for f in spec["expected_credentials"])
    assert fields["nomad_token_secret"].masked
    assert not fields["nomad_addr"].masked


def test_output_schema_lists_accessor_before_secret():
    assert [(f.id, f.masked) for f in NomadProvider.output_schema] == [
        ("accessor_id", False),
        ("token", True),
    ]


def test_resource_fields_declare_their_types():
    fields = {f.id: f for f in NomadProvider.config_schema}
    assert (fields["policies"].field_type, fields["policies"].resource_type) == (
        "list",
        "acl_policy",
    )
    assert (fields["roles"].field_type, fields["roles"].resource_type) == (
        "list",
        "acl_role",
    )
    assert fields["global_token"].field_type == "bool"
    assert fields["global_token"].default is False
    assert fields["name_template"].default == "phase-rs-{id}"


# ---------------------------------------------------------------------------
# validate_config
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "config",
    [
        {"policies": ["readonly"]},
        {"roles": ["deployers"]},
        {
            "name_template": "nomad-{id}",
            "policies": ["readonly"],
            "roles": ["deployers"],
            "expiration_ttl": "1h30m",
            "global_token": True,
        },
        {"policies": ["readonly"], "expiration_ttl": " ", "global_token": False},
        {"policies": ["readonly"], "roles": [], "expiration_ttl": None},
    ],
)
def test_validate_config_accepts(config):
    NomadProvider.validate_config(config)
    validate_provider_config("hashicorp_nomad", config)


@pytest.mark.parametrize(
    "config",
    [
        {},
        {"policies": [], "roles": []},
        {"policies": ["  "]},
        {"policies": "readonly"},
        {"roles": [1]},
        {"policies": ["readonly"], "name_template": "phase-rs"},
        {"policies": ["readonly"], "name_template": "{app}-{id}"},
        {"policies": ["readonly"], "name_template": 7},
        {"policies": ["readonly"], "expiration_ttl": "30d"},
        {"policies": ["readonly"], "expiration_ttl": "-1h"},
        {"policies": ["readonly"], "expiration_ttl": 3600},
        {"policies": ["readonly"], "global_token": "true"},
    ],
)
def test_validate_config_rejects(config):
    with pytest.raises(ProviderConfigError):
        NomadProvider.validate_config(config)


# ---------------------------------------------------------------------------
# mint
# ---------------------------------------------------------------------------


@patch(HTTP)
def test_mint_request_shape_and_result(mock_request):
    mock_request.return_value = _response(
        200,
        _token(
            Roles=[{"ID": ROLE_ID, "Name": ""}],
            Global=True,
            ExpirationTime="2026-10-23T10:00:00Z",
        ),
    )

    result = NomadProvider.mint(
        ROOT,
        {
            "policies": ["readonly", " ops "],
            "roles": ["deployers"],
            "expiration_ttl": " 24h ",
            "global_token": True,
        },
        caller_id="rs-1",
    )

    _, kwargs = mock_request.call_args
    assert kwargs["method"] == "POST"
    assert kwargs["url"] == f"{ADDR}/v1/acl/token"
    assert kwargs["headers"] == AUTH
    payload = dict(kwargs["json"])
    name = payload.pop("Name")
    assert re.fullmatch(r"phase-rs-rs-1-\d+", name)
    assert payload == {
        "Type": "client",
        "Policies": ["readonly", "ops"],
        "Roles": [{"Name": "deployers"}],
        "ExpirationTTL": "24h",
        "Global": True,
    }

    assert result.provider_credential_id == ACCESSOR
    assert result.values == {"accessor_id": ACCESSOR, "token": SECRET}
    assert set(result.values) == {f.id for f in NomadProvider.output_schema}
    assert result.metadata["name"] == name
    assert result.metadata["policies"] == ["readonly", "ops"]
    assert result.metadata["roles"] == ["deployers"]
    assert result.metadata["expiration_time"] == "2026-10-23T10:00:00Z"
    assert result.metadata["global"] is True
    assert result.metadata["call"]["status"] == 200


@patch(HTTP)
def test_mint_minimal_config_always_sends_a_client_token(mock_request):
    mock_request.return_value = _response(200, _token())

    NomadProvider.mint(
        ROOT, {"policies": ["readonly"], "type": "management"}, caller_id="rs-1"
    )

    payload = mock_request.call_args.kwargs["json"]
    assert payload["Type"] == "client"
    assert payload["Policies"] == ["readonly"]
    assert payload["Global"] is False
    assert "Roles" not in payload
    assert "ExpirationTTL" not in payload


@patch(HTTP)
def test_mint_roles_only_and_custom_name_template(mock_request):
    mock_request.return_value = _response(200, _token(Policies=None))

    NomadProvider.mint(
        ROOT,
        {"name_template": "ci-{id}-deploy", "roles": ["deployers"]},
        caller_id="rs-9",
    )

    payload = mock_request.call_args.kwargs["json"]
    assert re.fullmatch(r"ci-rs-9-\d+-deploy", payload["Name"])
    assert payload["Policies"] == []
    assert payload["Roles"] == [{"Name": "deployers"}]


@pytest.mark.parametrize(
    "response",
    [
        _response(200, {"AccessorID": ACCESSOR}),
        _response(200, {"AccessorID": ACCESSOR, "SecretID": ""}),
        _response(200, {"AccessorID": "not-a-uuid", "SecretID": SECRET}),
        _response(200, [_token()]),
        _response(200, text=f"<html>{SECRET}</html>"),
    ],
)
@patch(HTTP)
def test_mint_unexpected_response_shape(mock_request, response):
    mock_request.return_value = response

    with pytest.raises(ProviderConfigError) as exc:
        NomadProvider.mint(ROOT, {"policies": ["readonly"]}, caller_id="rs-1")

    error = exc.value
    for text in (str(error), error.user_message, json.dumps(error.raw)):
        assert SECRET not in text


@pytest.mark.parametrize(
    "status,text,expected",
    [
        (
            400,
            "cannot find role deployers",
            "Nomad returned an error (400): cannot find role deployers.",
        ),
        (
            400,
            "token 0 invalid: 1 error occurred:\n\t* expiration time cannot be "
            "more than 24h0m0s in the future (was 720h0m0s)\n\n",
            "Nomad returned an error (400): token 0 invalid: 1 error occurred: * "
            "expiration time cannot be more than 24h0m0s in the future (was "
            "720h0m0s).",
        ),
    ],
)
@patch(HTTP)
def test_mint_surfaces_nomad_plain_text_errors(mock_request, status, text, expected):
    mock_request.return_value = _response(status, text=text)

    with pytest.raises(ProviderConfigError) as exc:
        NomadProvider.mint(
            ROOT, {"roles": ["deployers"], "expiration_ttl": "720h"}, caller_id="rs-1"
        )

    assert exc.value.user_message == expected


@patch(HTTP)
def test_mint_permission_denied_points_at_management_token(mock_request):
    mock_request.return_value = _response(403, text="Permission denied")

    with pytest.raises(ProviderAuthError) as exc:
        NomadProvider.mint(ROOT, {"policies": ["readonly"]}, caller_id="rs-1")

    assert exc.value.user_message == (
        "Nomad returned an error (403): Permission denied. "
        "Rotation needs a valid Nomad management token."
    )


@patch(HTTP)
def test_mint_server_error_is_transient(mock_request):
    mock_request.return_value = _response(500, text="No cluster leader")

    with pytest.raises(ProviderTransientError):
        NomadProvider.mint(ROOT, {"policies": ["readonly"]}, caller_id="rs-1")


@patch(HTTP)
def test_metadata_never_contains_secret_values(mock_request):
    mock_request.return_value = _response(
        200, _token(ExpirationTime="2026-10-23T10:00:00Z")
    )

    result = NomadProvider.mint(
        ROOT, {"policies": ["readonly"], "expiration_ttl": "24h"}, caller_id="rs-1"
    )

    assert set(result.metadata) == {
        "name",
        "policies",
        "roles",
        "expiration_time",
        "global",
        "call",
    }
    # sanitize() keeps every field, so nothing relies on redaction.
    assert sanitize(result.metadata) == result.metadata
    dumped = json.dumps(result.metadata)
    assert SECRET not in dumped
    assert ROOT["nomad_token_secret"] not in dumped


# ---------------------------------------------------------------------------
# revoke
# ---------------------------------------------------------------------------


@patch(HTTP)
def test_revoke_deletes_token_by_accessor(mock_request):
    mock_request.return_value = _response(200, text="")

    summary = NomadProvider.revoke(ROOT, ACCESSOR)

    _, kwargs = mock_request.call_args
    assert kwargs["method"] == "DELETE"
    assert kwargs["url"] == f"{ADDR}/v1/acl/token/{ACCESSOR}"
    assert kwargs["headers"] == AUTH
    assert summary["accessor_id"] == ACCESSOR
    assert summary["call"]["status"] == 200
    assert ROOT["nomad_token_secret"] not in json.dumps(summary)


@patch(HTTP)
def test_revoke_unknown_token_raises_not_found(mock_request):
    # What Nomad returns for an unknown accessor.
    mock_request.return_value = _response(
        400, text=f"Cannot delete nonexistent tokens: {ACCESSOR}"
    )

    with pytest.raises(ProviderNotFound):
        NomadProvider.revoke(ROOT, ACCESSOR)


@patch(HTTP)
def test_revoke_404_is_not_reported_as_revoked(mock_request):
    # Nomad never 404s on this route, so the token may still be live.
    mock_request.return_value = _response(404, text="404 page not found")

    with pytest.raises(ProviderConfigError) as exc:
        NomadProvider.revoke(ROOT, ACCESSOR)

    assert "not revoked" in exc.value.user_message


@patch(HTTP)
def test_revoke_with_unknown_root_token_is_an_auth_error(mock_request):
    # "ACL token not found" is about the root token, not the revoked one.
    mock_request.return_value = _response(403, text="ACL token not found")

    with pytest.raises(ProviderAuthError):
        NomadProvider.revoke(ROOT, ACCESSOR)


@patch(HTTP)
def test_revoke_other_bad_request_is_not_treated_as_not_found(mock_request):
    mock_request.return_value = _response(400, text="ACL support disabled")

    with pytest.raises(ProviderConfigError) as exc:
        NomadProvider.revoke(ROOT, ACCESSOR)

    assert exc.value.user_message == (
        "Nomad returned an error (400): ACL support disabled."
    )


@pytest.mark.parametrize(
    "bad_id", ["", "not-a-uuid", f"{ACCESSOR}/../self", f"{ACCESSOR}\n", None]
)
@patch(HTTP)
def test_revoke_malformed_id_never_calls_nomad(mock_request, bad_id):
    with pytest.raises(ProviderConfigError):
        NomadProvider.revoke(ROOT, bad_id)
    mock_request.assert_not_called()


def test_provider_id_round_trip():
    assert _decode_provider_id(_encode_provider_id(ACCESSOR)) == ACCESSOR
    assert _decode_provider_id(ACCESSOR.upper()) == ACCESSOR.upper()


@pytest.mark.parametrize("bad_id", ["", "self", f"{ACCESSOR}:x", f" {ACCESSOR}", 42])
def test_provider_id_codec_rejects_malformed(bad_id):
    with pytest.raises(ProviderConfigError):
        _decode_provider_id(bad_id)
    with pytest.raises(ProviderConfigError):
        _encode_provider_id(bad_id)


# ---------------------------------------------------------------------------
# validate_root_credentials
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("token_type", ["management", "client"])
@patch(HTTP)
def test_validate_root_credentials_true(mock_request, token_type):
    # Client tokens work for the sync integration, so they must validate too.
    mock_request.return_value = _response(200, _token(Type=token_type))

    assert NomadProvider.validate_root_credentials(ROOT) is True

    _, kwargs = mock_request.call_args
    assert kwargs["method"] == "GET"
    assert kwargs["url"] == f"{ADDR}/v1/acl/token/self"
    assert kwargs["headers"] == AUTH


@pytest.mark.parametrize(
    "status,text",
    [
        (403, "ACL token not found"),
        (400, "ACL support disabled"),
        (500, "No cluster leader"),
    ],
)
@patch(HTTP)
def test_validate_root_credentials_false_on_error(mock_request, status, text):
    mock_request.return_value = _response(status, text=text)
    assert NomadProvider.validate_root_credentials(ROOT) is False


@patch(HTTP)
def test_validate_root_credentials_false_on_network_error(mock_request):
    mock_request.side_effect = requests.exceptions.ConnectionError("dns failure")
    assert NomadProvider.validate_root_credentials(ROOT) is False


def test_validate_root_credentials_false_on_missing_fields():
    assert NomadProvider.validate_root_credentials({}) is False


# ---------------------------------------------------------------------------
# list_resources
# ---------------------------------------------------------------------------


@patch(HTTP)
def test_list_resources_policies(mock_request):
    mock_request.return_value = _response(
        200,
        [
            {"Name": "readonly", "Description": "Read only", "CreateIndex": 12},
            {"Name": "deploy", "Description": "", "CreateIndex": 13},
            {"Name": "", "Description": "blank"},
            {"Description": "no name"},
            "junk",
        ],
    )

    options = NomadProvider.list_resources(ROOT, "acl_policy")

    assert [(o.id, o.name, o.description) for o in options] == [
        ("deploy", "deploy", ""),
        ("readonly", "readonly", "Read only"),
    ]
    _, kwargs = mock_request.call_args
    assert kwargs["method"] == "GET"
    assert kwargs["url"] == f"{ADDR}/v1/acl/policies"
    assert kwargs["headers"] == AUTH
    assert kwargs["params"] is None


@patch(HTTP)
def test_list_resources_roles_use_names(mock_request):
    mock_request.return_value = _response(
        200,
        [
            {
                "ID": ROLE_ID,
                "Name": "deployers",
                "Description": "CI deployers",
                "Policies": [{"Name": "deploy"}],
            }
        ],
    )

    options = NomadProvider.list_resources(ROOT, "acl_role")

    assert [(o.id, o.name, o.description) for o in options] == [
        ("deployers", "deployers", "CI deployers")
    ]
    assert mock_request.call_args.kwargs["url"] == f"{ADDR}/v1/acl/roles"


@patch(HTTP)
def test_list_resources_follows_next_token(mock_request):
    mock_request.side_effect = [
        _response(200, [{"Name": "a"}], headers={"X-Nomad-Nexttoken": "b"}),
        _response(200, [{"Name": "b"}]),
    ]

    options = NomadProvider.list_resources(ROOT, "acl_policy")

    assert [o.id for o in options] == ["a", "b"]
    assert mock_request.call_count == 2
    assert mock_request.call_args_list[1].kwargs["params"] == {"next_token": "b"}


@patch(HTTP)
def test_list_resources_stops_at_page_ceiling(mock_request):
    mock_request.side_effect = lambda **kwargs: _response(
        200, [], headers={"X-Nomad-Nexttoken": "again"}
    )

    assert NomadProvider.list_resources(ROOT, "acl_role") == []
    assert mock_request.call_count == _MAX_PAGES


@pytest.mark.parametrize(
    "response", [_response(200, {"Policies": []}), _response(200, text="<html>")]
)
@patch(HTTP)
def test_list_resources_rejects_unexpected_shape(mock_request, response):
    mock_request.return_value = response

    with pytest.raises(ProviderConfigError):
        NomadProvider.list_resources(ROOT, "acl_policy")


@patch(HTTP)
def test_list_resources_rejects_unknown_type(mock_request):
    with pytest.raises(ProviderConfigError):
        NomadProvider.list_resources(ROOT, "namespace")
    mock_request.assert_not_called()
