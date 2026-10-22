import json
from unittest.mock import MagicMock, patch

import pytest
import requests

from api.services import Providers
from ee.integrations.secrets.providers.exceptions import (
    ProviderAuthError,
    ProviderConfigError,
    ProviderNotFound,
)
from ee.integrations.secrets.providers.sanitize import sanitize
from ee.integrations.secrets.providers.vercel import (
    VERCEL_API_BASE,
    VercelProvider,
    _decode_provider_id,
    _encode_provider_id,
)
from ee.integrations.secrets.rotation.providers import all_providers, get_provider
from ee.integrations.secrets.rotation.utils import validate_provider_config

HTTP = "ee.integrations.secrets.providers.http.requests.request"
CLOCK = "ee.integrations.secrets.providers.vercel.time.time"

ROOT = {"api_token": "root-vercel-token"}
NOW = 1_700_000_000.0
TOKEN_ID = "tok_abc123"
BEARER = "vcp_minted0000secret0000value"


def _response(status=200, body=None, text=None):
    resp = MagicMock()
    resp.status_code = status
    resp.json.return_value = {} if body is None else body
    resp.text = json.dumps(body) if text is None else text
    return resp


def _token_response(**token_fields):
    return _response(
        200,
        {
            "token": {"id": TOKEN_ID, "name": "n", "type": "token", **token_fields},
            "bearerToken": BEARER,
        },
    )


# ---------------------------------------------------------------------------
# Registry and schemas
# ---------------------------------------------------------------------------


def test_registry_returns_vercel_provider():
    assert get_provider("vercel") is VercelProvider
    assert VercelProvider in all_providers()


def test_credential_schema_matches_sync_credentials():
    fields = {f.id: f for f in VercelProvider.credential_schema}
    expected = Providers.VERCEL["expected_credentials"]
    optional = Providers.VERCEL["optional_credentials"]
    assert set(fields) == set(expected) | set(optional)
    assert all(fields[f].required for f in expected)
    assert not any(fields[f].required for f in optional)
    assert fields["api_token"].masked is True


def test_schemas_expose_console_metadata():
    assert VercelProvider.key_name_prefix == "VERCEL"
    assert VercelProvider.credential_id_label == "Token ID"
    assert [(f.id, f.masked) for f in VercelProvider.output_schema] == [
        ("token_id", False),
        ("token", True),
    ]
    config = {f.id: f for f in VercelProvider.config_schema}
    assert config["name_template"].default == "phase-rs-{id}"
    assert config["team_id"].resource_type == "vercel_team"
    assert config["token_lifetime_days"].field_type == "int"
    assert not any(f.required for f in config.values())


# ---------------------------------------------------------------------------
# validate_config
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "config",
    [
        {},
        {"name_template": "phase-app-dev-{id}"},
        {"name_template": "x-{id}", "team_id": "team_abc", "token_lifetime_days": 90},
        {"team_id": "", "token_lifetime_days": None},
    ],
)
def test_validate_config_accepts(config):
    VercelProvider.validate_config(config)
    validate_provider_config("vercel", config)


@pytest.mark.parametrize(
    "config",
    [
        {"name_template": "no-placeholder"},
        {"name_template": ""},
        {"name_template": 123},
        {"name_template": "phase-{id}-{env}"},
        {"name_template": "phase-{id}-{"},
        {"team_id": ["team_abc"]},
        {"token_lifetime_days": 0},
        {"token_lifetime_days": -5},
        {"token_lifetime_days": "30"},
        {"token_lifetime_days": 1.5},
        {"token_lifetime_days": True},
    ],
)
def test_validate_config_rejects(config):
    with pytest.raises(ProviderConfigError):
        VercelProvider.validate_config(config)


# ---------------------------------------------------------------------------
# mint
# ---------------------------------------------------------------------------


@patch(CLOCK, return_value=NOW)
@patch(HTTP)
def test_mint_creates_full_account_token_by_default(mock_request, _clock):
    mock_request.return_value = _token_response()

    result = VercelProvider.mint(ROOT, {}, caller_id="rs-1")

    _, kwargs = mock_request.call_args
    assert kwargs["method"] == "POST"
    assert kwargs["url"] == f"{VERCEL_API_BASE}/v3/user/tokens"
    assert kwargs["headers"] == {"Authorization": "Bearer root-vercel-token"}
    assert kwargs["params"] is None
    assert kwargs["json"] == {"name": "phase-rs-rs-1-1700000000"}

    assert result.provider_credential_id == TOKEN_ID
    assert result.values == {"token_id": TOKEN_ID, "token": BEARER}
    assert list(result.values) == [f.id for f in VercelProvider.output_schema]
    assert result.metadata["name"] == "phase-rs-rs-1-1700000000"
    assert result.metadata["token_id"] == TOKEN_ID
    assert result.metadata["team_id"] is None
    assert result.metadata["expires_at"] is None
    assert result.metadata["call"]["endpoint"] == "POST api.vercel.com/v3/user/tokens"


@patch(CLOCK, return_value=NOW)
@patch(HTTP)
def test_mint_scopes_token_to_team_with_expiry(mock_request, _clock):
    expires_at = int(NOW * 1000) + 30 * 86_400_000
    mock_request.return_value = _token_response(teamId="team_abc", expiresAt=expires_at)

    result = VercelProvider.mint(
        ROOT,
        {
            "name_template": "phase-app-{id}",
            "team_id": "team_abc",
            "token_lifetime_days": 30,
        },
        caller_id="rs-2",
    )

    _, kwargs = mock_request.call_args
    assert kwargs["params"] == {"teamId": "team_abc"}
    assert kwargs["json"] == {
        "name": "phase-app-rs-2-1700000000",
        "expiresAt": expires_at,
    }
    assert result.metadata["team_id"] == "team_abc"
    assert result.metadata["expires_at"] == "2023-12-14T22:13:20+00:00"


@patch(HTTP)
def test_mint_accepts_team_scope_listed_in_scopes(mock_request):
    mock_request.return_value = _token_response(
        scopes=[{"type": "team", "teamId": "team_abc", "createdAt": 1}]
    )

    result = VercelProvider.mint(ROOT, {"team_id": "team_abc"}, caller_id="rs-3")

    assert result.metadata["team_id"] == "team_abc"


@pytest.mark.parametrize(
    "cleanup_status, deleted", [(200, True), (404, True), (500, False)]
)
@patch(HTTP)
def test_mint_deletes_token_that_vercel_did_not_scope_to_team(
    mock_request, cleanup_status, deleted
):
    mock_request.side_effect = [
        _token_response(scopes=[{"type": "user", "createdAt": 1}]),
        _response(cleanup_status, {"tokenId": TOKEN_ID}),
    ]

    with pytest.raises(ProviderConfigError) as exc:
        VercelProvider.mint(ROOT, {"team_id": "team_abc"}, caller_id="rs-4")

    cleanup = mock_request.call_args_list[1].kwargs
    assert cleanup["method"] == "DELETE"
    assert cleanup["url"] == f"{VERCEL_API_BASE}/v3/user/tokens/{TOKEN_ID}"
    err = exc.value
    assert err.raw == {"token_id": TOKEN_ID, "team_id": "team_abc", "deleted": deleted}
    assert ("Phase deleted it." in err.user_message) is deleted
    assert (f"Delete token {TOKEN_ID}" in err.user_message) is not deleted
    assert BEARER not in f"{err} {err.user_message} {err.raw}"


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"bearerToken": BEARER},
        {"token": {"name": "n"}, "bearerToken": BEARER},
        {"token": {"id": TOKEN_ID}},
        {"token": TOKEN_ID, "bearerToken": BEARER},
        [BEARER],
        {"token": {"id": "current"}, "bearerToken": BEARER},
        {"token": {"id": "../user"}, "bearerToken": BEARER},
        {"token": {"id": TOKEN_ID}, "bearerToken": ""},
        {"token": {"id": TOKEN_ID}, "bearerToken": 123},
    ],
)
@patch(HTTP)
def test_mint_rejects_unexpected_response_without_leaking_token(mock_request, body):
    mock_request.return_value = _response(200, body)

    with pytest.raises(ProviderConfigError) as exc:
        VercelProvider.mint(ROOT, {}, caller_id="rs-5")

    err = exc.value
    assert BEARER not in f"{err} {err.user_message} {err.raw}"
    assert mock_request.call_count == 1


@patch(HTTP)
def test_mint_rejects_non_json_response(mock_request):
    resp = _response(200, text="<html>oops</html>")
    resp.json.side_effect = ValueError("not json")
    mock_request.return_value = resp

    with pytest.raises(ProviderConfigError):
        VercelProvider.mint(ROOT, {}, caller_id="rs-6")


@patch(HTTP)
def test_mint_auth_error_explains_root_token_scope(mock_request):
    mock_request.return_value = _response(
        403,
        {
            "error": {
                "code": "forbidden",
                "message": 'To create a token you must be authenticated to scope "x"',
            }
        },
    )

    with pytest.raises(ProviderAuthError) as exc:
        VercelProvider.mint(ROOT, {}, caller_id="rs-7")

    assert "To create a token you must be authenticated" in exc.value.user_message
    assert "Full Account" in exc.value.user_message


@patch(HTTP)
def test_mint_rejects_invalid_config_before_calling_vercel(mock_request):
    with pytest.raises(ProviderConfigError):
        VercelProvider.mint(ROOT, {"name_template": "static"}, caller_id="rs-8")
    mock_request.assert_not_called()


@patch(HTTP)
def test_mint_metadata_holds_no_secret_values(mock_request):
    mock_request.return_value = _token_response(teamId="team_abc", expiresAt=1)

    result = VercelProvider.mint(
        ROOT, {"team_id": "team_abc", "token_lifetime_days": 7}, caller_id="rs-9"
    )

    assert set(result.metadata) == {"name", "token_id", "expires_at", "team_id", "call"}
    dumped = json.dumps(result.metadata)
    assert BEARER not in dumped
    assert ROOT["api_token"] not in dumped
    # Identifiers survive the sanitizer the engine applies before storing metadata.
    sanitized = sanitize(result.metadata)
    assert sanitized["token_id"] == TOKEN_ID
    assert sanitized["team_id"] == "team_abc"


# ---------------------------------------------------------------------------
# revoke and provider IDs
# ---------------------------------------------------------------------------


@patch(HTTP)
def test_revoke_deletes_token(mock_request):
    mock_request.return_value = _response(200, {"tokenId": TOKEN_ID})

    summary = VercelProvider.revoke(ROOT, TOKEN_ID)

    _, kwargs = mock_request.call_args
    assert kwargs["method"] == "DELETE"
    assert kwargs["url"] == f"{VERCEL_API_BASE}/v3/user/tokens/{TOKEN_ID}"
    assert kwargs["headers"] == {"Authorization": "Bearer root-vercel-token"}
    assert kwargs["params"] is None
    assert summary["token_id"] == TOKEN_ID
    assert summary["call"]["status"] == 200


@patch(HTTP)
def test_revoke_already_deleted_token_raises_not_found(mock_request):
    mock_request.return_value = _response(
        404,
        {
            "error": {
                "code": "not_found",
                "message": "Token not found with the requested tokenId.",
            }
        },
    )

    with pytest.raises(ProviderNotFound):
        VercelProvider.revoke(ROOT, TOKEN_ID)


@patch(HTTP)
def test_revoke_never_deletes_the_root_token(mock_request):
    with pytest.raises(ProviderConfigError):
        VercelProvider.revoke(ROOT, "current")
    mock_request.assert_not_called()


@pytest.mark.parametrize(
    "token_id",
    [TOKEN_ID, "5d9f2ebd38ddca62e5d51e9c1704c72530bdc8bfdd41e782a6687c48399e8391"],
)
def test_provider_id_codec_roundtrip(token_id):
    assert _decode_provider_id(_encode_provider_id(token_id)) == token_id


@pytest.mark.parametrize(
    "bad_id",
    [
        "",
        "current",
        "CURRENT",
        "..",
        "../user",
        "tok/abc",
        "team_x:tok_abc",
        "tok abc",
        None,
    ],
)
def test_decode_provider_id_rejects_malformed(bad_id):
    with pytest.raises(ProviderConfigError):
        _decode_provider_id(bad_id)


# ---------------------------------------------------------------------------
# validate_root_credentials
# ---------------------------------------------------------------------------


@patch(HTTP)
def test_validate_root_credentials_probes_user_endpoint(mock_request):
    mock_request.return_value = _response(200, {"user": {"id": "user_1"}})

    assert VercelProvider.validate_root_credentials(ROOT) is True

    _, kwargs = mock_request.call_args
    assert kwargs["method"] == "GET"
    assert kwargs["url"] == f"{VERCEL_API_BASE}/v2/user"
    assert kwargs["headers"] == {"Authorization": "Bearer root-vercel-token"}


@pytest.mark.parametrize("status", [302, 401, 403, 500])
@patch(HTTP)
def test_validate_root_credentials_false_on_non_2xx(mock_request, status):
    mock_request.return_value = _response(
        status, {"error": {"code": "forbidden", "message": "Not authorized"}}
    )
    assert VercelProvider.validate_root_credentials(ROOT) is False


@patch(HTTP)
def test_validate_root_credentials_false_on_network_error(mock_request):
    mock_request.side_effect = requests.exceptions.ConnectionError("dns failure")
    assert VercelProvider.validate_root_credentials(ROOT) is False


def test_validate_root_credentials_false_without_token():
    assert VercelProvider.validate_root_credentials({}) is False


# ---------------------------------------------------------------------------
# list_resources
# ---------------------------------------------------------------------------


@patch(HTTP)
def test_list_resources_paginates_teams(mock_request):
    mock_request.side_effect = [
        _response(
            200,
            {
                "teams": [
                    {"id": "team_a", "name": "Alpha", "slug": "alpha"},
                    {"id": "team_b", "name": None, "slug": "beta"},
                ],
                "pagination": {"count": 2, "next": 1700000000000, "prev": None},
            },
        ),
        _response(
            200,
            {
                "teams": [
                    {"id": "team_b", "name": "Beta", "slug": "beta"},
                    {"id": "team_c", "slug": "gamma", "limited": True},
                    {"name": "missing id"},
                ],
                "pagination": {"count": 3, "next": None, "prev": 1},
            },
        ),
    ]

    resources = VercelProvider.list_resources(ROOT, "vercel_team", {})

    assert [(r.id, r.name, r.description) for r in resources] == [
        ("team_a", "Alpha", "alpha"),
        ("team_b", "beta", "beta"),
        ("team_c", "gamma", "gamma"),
    ]
    first, second = (c.kwargs for c in mock_request.call_args_list)
    assert first["method"] == "GET"
    assert first["url"] == f"{VERCEL_API_BASE}/v2/teams"
    assert first["params"] == {"limit": 100}
    assert second["params"] == {"limit": 100, "until": 1700000000000}


@patch(HTTP)
def test_list_teams_single_page_without_pagination(mock_request):
    mock_request.return_value = _response(
        200, {"teams": [{"id": "team_a", "slug": "a"}]}
    )

    assert [t["id"] for t in VercelProvider.list_teams(ROOT)] == ["team_a"]
    assert mock_request.call_count == 1


@patch(HTTP)
def test_list_teams_stops_at_page_ceiling(mock_request):
    def page(**_kwargs):
        n = mock_request.call_count
        return _response(
            200, {"teams": [{"id": f"team_{n}"}], "pagination": {"next": n}}
        )

    mock_request.side_effect = page

    teams = VercelProvider.list_teams(ROOT)

    assert mock_request.call_count == 50
    assert len(teams) == 50


@patch(HTTP)
def test_list_teams_stops_when_cursor_does_not_advance(mock_request):
    mock_request.return_value = _response(
        200, {"teams": [{"id": "team_a"}], "pagination": {"next": 5}}
    )

    teams = VercelProvider.list_teams(ROOT)

    assert mock_request.call_count == 2
    assert [t["id"] for t in teams] == ["team_a"]


@pytest.mark.parametrize("body", [[], {}, {"teams": "nope"}])
@patch(HTTP)
def test_list_teams_rejects_unexpected_shape(mock_request, body):
    mock_request.return_value = _response(200, body)
    with pytest.raises(ProviderConfigError):
        VercelProvider.list_teams(ROOT)


def test_list_resources_rejects_unknown_type():
    with pytest.raises(ProviderConfigError):
        VercelProvider.list_resources(ROOT, "project")
