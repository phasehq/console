import json
from datetime import date
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
from ee.integrations.secrets.providers.gitlab import (
    GROUP_SCOPES,
    PROJECT_SCOPES,
    GitLabProvider,
    _decode_provider_id,
    _encode_provider_id,
)
from ee.integrations.secrets.providers.sanitize import sanitize
from ee.integrations.secrets.rotation.providers import all_providers, get_provider
from ee.integrations.secrets.rotation.utils import validate_provider_config

REQUEST = "ee.integrations.secrets.providers.http.requests.request"
TODAY = "ee.integrations.secrets.providers.gitlab._utc_today"

ROOT = {
    "gitlab_host": "https://gitlab.example.com/",
    "gitlab_token": "glpat-root-token-value",
}
API = "https://gitlab.example.com/api/v4"
HEADERS = {"PRIVATE-TOKEN": "glpat-root-token-value"}
MINTED_TOKEN = "glpat-minted-token-value"


def _response(status=200, body=None, headers=None):
    resp = MagicMock()
    resp.status_code = status
    resp.json.return_value = body
    resp.text = "" if body is None else json.dumps(body)
    resp.headers = CaseInsensitiveDict(headers or {})
    return resp


def _config(**overrides):
    config = {
        "target_type": "project",
        "target_id": "123",
        "scopes": ["read_api", "read_repository"],
        "access_level": "developer",
    }
    config.update(overrides)
    return config


def _token_response(**overrides):
    body = {
        "id": 58,
        "name": "phase-rs-rs-1",
        "scopes": ["read_api", "read_repository"],
        "access_level": 30,
        "expires_at": "2027-10-22",
        "active": True,
        "revoked": False,
        "user_id": 166,
        "token": MINTED_TOKEN,
    }
    body.update(overrides)
    return _response(201, body)


# ---------------------------------------------------------------------------
# Registry and schemas
# ---------------------------------------------------------------------------


def test_registry_returns_gitlab_provider():
    assert get_provider("gitlab") is GitLabProvider
    assert GitLabProvider in all_providers()


def test_provider_id_matches_stored_credentials_provider():
    # The create mutation requires authentication.provider == provider.id.
    assert GitLabProvider.id == Providers.GITLAB["id"]


def test_credential_schema_mirrors_sync_provider_fields():
    expected = set(Providers.GITLAB["expected_credentials"])
    optional = set(Providers.GITLAB["optional_credentials"])
    fields = {f.id: f for f in GitLabProvider.credential_schema}
    assert set(fields) == expected | optional
    assert all(fields[f].required for f in expected)
    assert not any(fields[f].required for f in optional)
    assert fields["gitlab_token"].masked
    assert not fields["gitlab_host"].masked


def test_config_schema_shape():
    fields = {f.id: f for f in GitLabProvider.config_schema}
    assert fields["target_type"].choices == ["project", "group"]
    assert fields["target_type"].default == "project"
    assert fields["target_id"].resource_type == "gitlab_target"
    assert fields["target_id"].depends_on == ["target_type"]
    assert fields["target_id"].label == "Project or group"
    assert fields["scopes"].field_type == "list"
    assert fields["scopes"].choices == list(GROUP_SCOPES)
    assert fields["access_level"].required
    assert fields["access_level"].default is None
    assert fields["access_level"].choices == [
        "guest",
        "planner",
        "reporter",
        "security_manager",
        "developer",
        "maintainer",
        "owner",
    ]
    assert fields["token_lifetime_days"].field_type == "int"
    assert fields["token_lifetime_days"].default == 365


def test_output_schema_lists_identifier_before_secret():
    assert [(f.id, f.masked) for f in GitLabProvider.output_schema] == [
        ("token_id", False),
        ("token", True),
    ]
    assert GitLabProvider.key_name_prefix == "GITLAB"
    assert GitLabProvider.credential_id_label == "Access token ID"


def test_virtual_registry_scopes_are_group_only():
    assert set(GROUP_SCOPES) - set(PROJECT_SCOPES) == {
        "read_virtual_registry",
        "write_virtual_registry",
    }


# ---------------------------------------------------------------------------
# validate_config
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "config",
    [
        _config(),
        {k: v for k, v in _config().items() if k != "target_type"},
        _config(target_id="group/sub/project", name_template="ci-{id}"),
        _config(
            target_type="group",
            target_id="acme/platform",
            scopes=["api", "read_virtual_registry", "write_virtual_registry"],
            access_level="owner",
        ),
        _config(token_lifetime_days=1),
        _config(token_lifetime_days=400),
        _config(token_lifetime_days=None),
    ],
)
def test_validate_config_accepts(config):
    GitLabProvider.validate_config(config)


@pytest.mark.parametrize(
    "overrides",
    [
        {"target_type": "user"},
        {"target_id": ""},
        {"target_id": "   "},
        {"target_id": 123},
        {"target_id": "group:project"},
        {"name_template": 5},
        {"name_template": "static-name"},
        {"name_template": "{{id}}"},
        {"name_template": "{id}-{env}"},
        {"name_template": "{id:>99999999}"},
        {"name_template": "{id!r}"},
        {"scopes": []},
        {"scopes": "api"},
        {"scopes": ["api", "sudo"]},
        {"scopes": ["read_user"]},
        {"scopes": ["read_virtual_registry"]},
        {"access_level": "admin"},
        {"access_level": 30},
        {"token_lifetime_days": 0},
        {"token_lifetime_days": 401},
        {"token_lifetime_days": 30.5},
        {"token_lifetime_days": "30"},
        {"token_lifetime_days": True},
    ],
)
def test_validate_config_rejects(overrides):
    with pytest.raises(ProviderConfigError):
        GitLabProvider.validate_config(_config(**overrides))


@pytest.mark.parametrize("missing", ["target_id", "scopes", "access_level"])
def test_validate_config_rejects_missing_required_fields(missing):
    config = _config()
    del config[missing]
    with pytest.raises(ProviderConfigError):
        GitLabProvider.validate_config(config)


def test_validate_config_names_unknown_scopes():
    with pytest.raises(ProviderConfigError) as exc:
        GitLabProvider.validate_config(_config(scopes=["api", "sudo"]))
    assert "sudo" in exc.value.user_message


def test_validate_provider_config_applies_schema_rules():
    validate_provider_config(
        "gitlab",
        {"target_id": "123", "scopes": ["api"], "access_level": "maintainer"},
    )
    with pytest.raises(ProviderConfigError):
        validate_provider_config(
            "gitlab", {"scopes": ["api"], "access_level": "maintainer"}
        )


# ---------------------------------------------------------------------------
# Provider credential ID
# ---------------------------------------------------------------------------


def test_provider_id_round_trips_namespaced_paths():
    encoded = _encode_provider_id("project", "group/sub/project", "58")
    assert encoded == "project:group/sub/project:58"
    assert _decode_provider_id(encoded) == ("project", "group/sub/project", "58")
    assert _decode_provider_id("group:42:7") == ("group", "42", "7")


@pytest.mark.parametrize(
    "provider_credential_id",
    [
        "58",
        "project:123",
        "user:123:58",
        "project::58",
        "project:123:",
        "project:123:abc",
        "project:a:b:58",
    ],
)
def test_provider_id_rejects_malformed(provider_credential_id):
    with pytest.raises(ProviderConfigError):
        _decode_provider_id(provider_credential_id)


# ---------------------------------------------------------------------------
# validate_root_credentials
# ---------------------------------------------------------------------------


@patch(REQUEST)
def test_validate_root_credentials_probes_current_user(mock_request):
    mock_request.return_value = _response(200, {"id": 1, "username": "rohan"})
    assert GitLabProvider.validate_root_credentials(ROOT) is True
    _, kwargs = mock_request.call_args
    assert kwargs["method"] == "GET"
    assert kwargs["url"] == f"{API}/user"
    assert kwargs["headers"] == HEADERS


@patch(REQUEST)
def test_validate_root_credentials_returns_false_on_auth_error(mock_request):
    mock_request.return_value = _response(401, {"message": "401 Unauthorized"})
    assert GitLabProvider.validate_root_credentials(ROOT) is False


@patch(REQUEST)
def test_validate_root_credentials_returns_false_on_network_error(mock_request):
    mock_request.side_effect = requests.exceptions.ConnectionError("dns failure")
    assert GitLabProvider.validate_root_credentials(ROOT) is False


def test_validate_root_credentials_returns_false_on_missing_fields():
    assert GitLabProvider.validate_root_credentials({}) is False


# ---------------------------------------------------------------------------
# list_resources
# ---------------------------------------------------------------------------


@patch(REQUEST)
def test_list_resources_paginates_projects(mock_request):
    mock_request.side_effect = [
        _response(
            200,
            [{"id": 1, "name": "API", "path_with_namespace": "acme/api"}],
            {"x-next-page": "2"},
        ),
        _response(
            200,
            [
                {"id": 2, "name": "Web", "path_with_namespace": "acme/web"},
                {"name": "missing id"},
            ],
            {"X-Next-Page": ""},
        ),
    ]

    resources = GitLabProvider.list_resources(
        ROOT, "gitlab_target", {"target_type": "project"}
    )

    assert [(r.id, r.name, r.description) for r in resources] == [
        ("1", "acme/api", "API"),
        ("2", "acme/web", "Web"),
    ]
    first, second = mock_request.call_args_list
    assert first.kwargs["method"] == "GET"
    assert first.kwargs["url"] == f"{API}/projects"
    assert first.kwargs["headers"] == HEADERS
    assert first.kwargs["params"] == {
        "membership": "true",
        "min_access_level": 40,
        "simple": "true",
        "per_page": 100,
    }
    assert second.kwargs["params"]["page"] == "2"


@patch(REQUEST)
def test_list_resources_lists_owned_groups(mock_request):
    mock_request.return_value = _response(
        200, [{"id": 9, "name": "Platform", "full_path": "acme/platform"}]
    )

    resources = GitLabProvider.list_resources(
        ROOT, "gitlab_target", {"target_type": "group"}
    )

    assert [(r.id, r.name, r.description) for r in resources] == [
        ("9", "acme/platform", "Platform")
    ]
    _, kwargs = mock_request.call_args
    assert kwargs["url"] == f"{API}/groups"
    assert kwargs["params"] == {"min_access_level": 50, "per_page": 100}


@patch(REQUEST)
def test_list_resources_defaults_to_projects(mock_request):
    mock_request.return_value = _response(200, [])
    assert GitLabProvider.list_resources(ROOT, "gitlab_target") == []
    assert mock_request.call_args.kwargs["url"] == f"{API}/projects"


@patch(REQUEST)
def test_list_resources_stops_at_page_ceiling(mock_request):
    mock_request.side_effect = lambda **_: _response(
        200, [{"id": 1, "path_with_namespace": "acme/api"}], {"X-Next-Page": "2"}
    )
    resources = GitLabProvider.list_resources(ROOT, "gitlab_target", {})
    assert mock_request.call_count == 50
    assert len(resources) == 50


@patch(REQUEST)
def test_list_resources_rejects_unexpected_shape(mock_request):
    mock_request.return_value = _response(200, {"message": "not a list"})
    with pytest.raises(ProviderConfigError):
        GitLabProvider.list_resources(ROOT, "gitlab_target", {})


def test_list_resources_rejects_unknown_type():
    with pytest.raises(ProviderConfigError):
        GitLabProvider.list_resources(ROOT, "project")


# ---------------------------------------------------------------------------
# mint
# ---------------------------------------------------------------------------


@patch(TODAY, return_value=date(2026, 10, 22))
@patch(REQUEST)
def test_mint_creates_project_access_token(mock_request, _today):
    mock_request.return_value = _token_response()

    result = GitLabProvider.mint(
        ROOT, _config(target_id="group/sub/project"), caller_id="rs-1"
    )

    _, kwargs = mock_request.call_args
    assert kwargs["method"] == "POST"
    assert kwargs["url"] == f"{API}/projects/group%2Fsub%2Fproject/access_tokens"
    assert kwargs["headers"] == HEADERS
    payload = kwargs["json"]
    assert payload["name"].startswith("phase-rs-rs-1-")
    assert payload == {
        "name": payload["name"],
        "scopes": ["read_api", "read_repository"],
        "access_level": 30,
        "expires_at": "2027-10-22",
    }

    assert result.provider_credential_id == "project:group/sub/project:58"
    assert result.values == {"token_id": "58", "token": MINTED_TOKEN}
    assert set(result.values) == {f.id for f in GitLabProvider.output_schema}
    assert result.metadata["display_id"] == "58"
    assert result.metadata["token_id"] == "58"
    assert result.metadata["target_type"] == "project"
    assert result.metadata["target_id"] == "group/sub/project"
    assert result.metadata["access_level"] == "developer"
    assert result.metadata["expires_at"] == "2027-10-22"
    assert result.metadata["call"]["status"] == 201


@patch(TODAY, return_value=date(2026, 10, 22))
@patch(REQUEST)
def test_mint_creates_group_access_token(mock_request, _today):
    mock_request.return_value = _response(201, {"id": 7, "token": MINTED_TOKEN})

    result = GitLabProvider.mint(
        ROOT,
        _config(
            target_type="group",
            target_id="42",
            access_level="owner",
            name_template="ci-{id}",
            token_lifetime_days=30,
        ),
        caller_id="rs-2",
    )

    _, kwargs = mock_request.call_args
    assert kwargs["url"] == f"{API}/groups/42/access_tokens"
    assert kwargs["json"]["access_level"] == 50
    assert kwargs["json"]["expires_at"] == "2026-11-21"
    assert kwargs["json"]["name"].startswith("ci-rs-2-")
    assert result.provider_credential_id == "group:42:7"
    assert result.metadata["expires_at"] == "2026-11-21"


@patch(TODAY, return_value=date(2026, 10, 22))
@patch(REQUEST)
def test_mint_applies_defaults_for_omitted_fields(mock_request, _today):
    mock_request.return_value = _token_response()
    config = {"target_id": "123", "scopes": ["api"], "access_level": "reporter"}

    GitLabProvider.mint(ROOT, config, caller_id="rs-3")

    _, kwargs = mock_request.call_args
    assert kwargs["url"] == f"{API}/projects/123/access_tokens"
    assert kwargs["json"]["expires_at"] == "2027-10-22"
    assert kwargs["json"]["name"].startswith("phase-rs-rs-3-")
    assert kwargs["json"]["access_level"] == 20


@pytest.mark.parametrize(
    "body",
    [
        {"id": 58},
        {"token": MINTED_TOKEN},
        {"id": "abc", "token": MINTED_TOKEN},
        {"id": 58, "token": ""},
        [{"id": 58, "token": MINTED_TOKEN}],
        "created",
    ],
)
@patch(REQUEST)
def test_mint_rejects_unexpected_response_shape(mock_request, body):
    mock_request.return_value = _response(201, body)
    with pytest.raises(ProviderConfigError) as exc:
        GitLabProvider.mint(ROOT, _config(), caller_id="rs-1")
    for text in (str(exc.value), exc.value.user_message, repr(exc.value.raw)):
        assert MINTED_TOKEN not in text


@patch(REQUEST)
def test_mint_rejects_non_json_response(mock_request):
    resp = _response(201)
    resp.json.side_effect = ValueError("no json")
    mock_request.return_value = resp
    with pytest.raises(ProviderConfigError):
        GitLabProvider.mint(ROOT, _config(), caller_id="rs-1")


@patch(REQUEST)
def test_mint_surfaces_gitlab_validation_errors(mock_request):
    mock_request.return_value = _response(
        400, {"message": "400 Bad request - Expires at must be before 2027-10-22"}
    )
    with pytest.raises(ProviderConfigError) as exc:
        GitLabProvider.mint(ROOT, _config(), caller_id="rs-1")
    assert "must be before 2027-10-22" in exc.value.user_message


@patch(TODAY, return_value=date(2026, 10, 22))
@patch(REQUEST)
def test_mint_metadata_holds_no_secret_values(mock_request, _today):
    mock_request.return_value = _token_response()
    result = GitLabProvider.mint(ROOT, _config(), caller_id="rs-1")

    assert set(result.metadata) == {
        "name",
        "target_type",
        "target_id",
        "token_id",
        "scopes",
        "access_level",
        "expires_at",
        "display_id",
        "call",
    }
    for secret in (MINTED_TOKEN, ROOT["gitlab_token"]):
        assert secret not in repr(result.metadata)
    # sanitize() must keep every field so the console can show them.
    assert sanitize(result.metadata) == result.metadata


# ---------------------------------------------------------------------------
# revoke
# ---------------------------------------------------------------------------


@patch(REQUEST)
def test_revoke_deletes_token(mock_request):
    mock_request.return_value = _response(204)

    summary = GitLabProvider.revoke(ROOT, "project:group/project:58")

    assert mock_request.call_count == 1
    _, kwargs = mock_request.call_args
    assert kwargs["method"] == "DELETE"
    assert kwargs["url"] == f"{API}/projects/group%2Fproject/access_tokens/58"
    assert kwargs["headers"] == HEADERS
    assert summary["target_type"] == "project"
    assert summary["target_id"] == "group/project"
    assert summary["token_id"] == "58"
    assert summary["call"]["status"] == 204


@patch(REQUEST)
def test_revoke_deletes_group_token(mock_request):
    mock_request.return_value = _response(204)
    GitLabProvider.revoke(ROOT, "group:42:7")
    assert mock_request.call_args.kwargs["url"] == f"{API}/groups/42/access_tokens/7"


@patch(REQUEST)
def test_revoke_404_with_visible_project_is_not_found(mock_request):
    mock_request.side_effect = [
        _response(404, {"message": "404 project Access Token Not Found"}),
        _response(200, {"id": 123, "path_with_namespace": "acme/api"}),
    ]

    with pytest.raises(ProviderNotFound):
        GitLabProvider.revoke(ROOT, "project:123:58")

    _, kwargs = mock_request.call_args
    assert kwargs["method"] == "GET"
    assert kwargs["url"] == f"{API}/projects/123"
    assert kwargs["params"] is None


@pytest.mark.parametrize("status", [401, 403, 404])
@patch(REQUEST)
def test_revoke_404_with_hidden_target_is_auth_error(mock_request, status):
    mock_request.side_effect = [
        _response(404, {"message": "404 Group Not Found"}),
        _response(status, {"message": f"{status} Group Not Found"}),
    ]

    with pytest.raises(ProviderAuthError) as exc:
        GitLabProvider.revoke(ROOT, "group:acme/platform:58")

    assert "can no longer see GitLab group acme/platform" in exc.value.user_message
    assert "may still be active" in exc.value.user_message
    _, kwargs = mock_request.call_args
    assert kwargs["method"] == "GET"
    assert kwargs["url"] == f"{API}/groups/acme%2Fplatform"
    assert kwargs["params"] == {"with_projects": "false"}


@patch(REQUEST)
def test_revoke_404_retries_when_target_check_fails_transiently(mock_request):
    mock_request.side_effect = [
        _response(404, {"message": "404 Project Not Found"}),
        _response(503, {"message": "unavailable"}),
    ]
    with pytest.raises(ProviderTransientError):
        GitLabProvider.revoke(ROOT, "project:123:58")


@pytest.mark.parametrize(
    "token",
    [
        {"id": 58, "revoked": True, "active": False},
        {"id": 58, "revoked": False, "active": False},
    ],
)
@patch(REQUEST)
def test_revoke_400_for_inactive_token_is_not_found(mock_request, token):
    mock_request.side_effect = [
        _response(400, {"message": "400 Bad request - Failed to find bot user"}),
        _response(200, token),
    ]

    with pytest.raises(ProviderNotFound):
        GitLabProvider.revoke(ROOT, "project:123:58")

    _, kwargs = mock_request.call_args
    assert kwargs["method"] == "GET"
    assert kwargs["url"] == f"{API}/projects/123/access_tokens/58"


@patch(REQUEST)
def test_revoke_400_for_active_token_raises_original_error(mock_request):
    mock_request.side_effect = [
        _response(400, {"message": "400 Bad request - rohan cannot delete bot"}),
        _response(200, {"id": 58, "revoked": False, "active": True}),
    ]
    with pytest.raises(ProviderConfigError) as exc:
        GitLabProvider.revoke(ROOT, "project:123:58")
    assert "cannot delete bot" in exc.value.user_message


@patch(REQUEST)
def test_revoke_400_with_unreadable_token_raises_original_error(mock_request):
    mock_request.side_effect = [
        _response(400, {"message": "400 Bad request - rohan cannot delete bot"}),
        _response(401, {"message": "401 Unauthorized"}),
    ]
    with pytest.raises(ProviderConfigError) as exc:
        GitLabProvider.revoke(ROOT, "group:5:58")
    assert "cannot delete bot" in exc.value.user_message


@patch(REQUEST)
def test_revoke_400_retries_when_token_lookup_fails_transiently(mock_request):
    mock_request.side_effect = [
        _response(400, {"message": "400 Bad request - Failed to find bot user"}),
        _response(502, {"message": "bad gateway"}),
    ]
    with pytest.raises(ProviderTransientError):
        GitLabProvider.revoke(ROOT, "project:123:58")


@patch(REQUEST)
def test_revoke_400_then_missing_token_checks_target(mock_request):
    mock_request.side_effect = [
        _response(400, {"message": "400 Bad request - Failed to find bot user"}),
        _response(404, {"message": "404 project Access Token Not Found"}),
        _response(200, {"id": 123}),
    ]
    with pytest.raises(ProviderNotFound):
        GitLabProvider.revoke(ROOT, "project:123:58")
    assert mock_request.call_args.kwargs["url"] == f"{API}/projects/123"


@patch(REQUEST)
def test_revoke_400_then_hidden_target_is_auth_error(mock_request):
    mock_request.side_effect = [
        _response(400, {"message": "400 Bad request - Failed to find bot user"}),
        _response(404, {"message": "404 Project Not Found"}),
        _response(404, {"message": "404 Project Not Found"}),
    ]
    with pytest.raises(ProviderAuthError):
        GitLabProvider.revoke(ROOT, "project:123:58")


@patch(REQUEST)
def test_revoke_rejects_malformed_provider_id(mock_request):
    with pytest.raises(ProviderConfigError):
        GitLabProvider.revoke(ROOT, "58")
    mock_request.assert_not_called()
