from unittest.mock import MagicMock, patch

import pytest

from ee.integrations.secrets.providers.exceptions import (
    ProviderAuthError,
    ProviderConfigError,
    ProviderError,
    ProviderNotFound,
    ProviderTransientError,
)
from ee.integrations.secrets.rotation.providers import (
    ROTATION_PROVIDERS,
    all_providers,
    get_provider,
)
from ee.integrations.secrets.providers.litellm import LiteLLMProvider
from ee.integrations.secrets.providers.openai import (
    OPENAI_API_BASE,
    OpenAIProvider,
    _decode_provider_id,
    _encode_provider_id,
)


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------


def test_registry_contains_supported_providers():
    assert set(ROTATION_PROVIDERS.keys()) == {"litellm", "openai"}
    assert get_provider("litellm") is LiteLLMProvider
    assert get_provider("openai") is OpenAIProvider


def test_all_providers_returns_classes():
    providers = all_providers()
    assert LiteLLMProvider in providers
    assert OpenAIProvider in providers


def test_unknown_provider_raises():
    from ee.integrations.secrets.providers.exceptions import ProviderNotRegisteredError

    with pytest.raises(ProviderNotRegisteredError):
        get_provider("nope")


def test_providers_declare_required_protocol_attributes():
    for p in all_providers():
        assert isinstance(p.id, str)
        assert isinstance(p.name, str)
        assert isinstance(p.credential_schema, list)
        assert isinstance(p.config_schema, list)
        assert isinstance(p.output_schema, list)
        # Each provider must define mint and revoke as classmethods.
        assert callable(getattr(p, "mint", None))
        assert callable(getattr(p, "revoke", None))
        assert callable(getattr(p, "validate_config", None))
        assert callable(getattr(p, "validate_root_credentials", None))


# ---------------------------------------------------------------------------
# LiteLLM provider
# ---------------------------------------------------------------------------


def _mock_response(status=200, json_body=None, text=""):
    resp = MagicMock()
    resp.status_code = status
    resp.text = text
    resp.json.return_value = json_body or {}
    return resp


@patch("ee.integrations.secrets.providers.http.requests.request")
def test_litellm_mint_happy_path(mock_request):
    mock_request.return_value = _mock_response(
        200,
        {"key": "sk-litellm-xxxxxxxx", "token": "tok-1234"},
    )

    result = LiteLLMProvider.mint(
        {"gateway_url": "https://llm.example.com/", "api_key": "sk-master"},
        {"models": ["gpt-4o-mini"], "max_budget": 10},
        caller_id="rs-1",
    )
    assert result.provider_credential_id == "tok-1234"
    assert result.values == {"api_key": "sk-litellm-xxxxxxxx", "key_id": "tok-1234"}
    # Sent the right URL + payload shape
    args, kwargs = mock_request.call_args
    assert kwargs["method"] == "POST"
    assert kwargs["url"] == "https://llm.example.com/key/generate"
    assert "Authorization" in kwargs["headers"]
    assert kwargs["json"]["models"] == ["gpt-4o-mini"]
    assert kwargs["json"]["max_budget"] == 10
    assert kwargs["json"]["key_alias"].startswith("phase-rs-rs-1-")


@patch("ee.integrations.secrets.providers.http.requests.request")
def test_litellm_mint_passes_through_unknown_fields(mock_request):
    """Imported configs may include LiteLLM fields outside our manual form
    (metadata, aliases, permissions, etc). mint() must forward them all."""
    mock_request.return_value = _mock_response(
        200, {"key": "sk-x", "token": "tok-x"}
    )
    LiteLLMProvider.mint(
        {"gateway_url": "https://llm.example.com", "api_key": "sk"},
        {
            "models": ["gpt-4o"],
            "metadata": {"team": "platform"},
            "aliases": {"small": "gpt-4o-mini"},
            "permissions": {"allow_pii_unmasking": False},
            "allowed_cache_controls": ["no-cache"],
        },
        caller_id="rs-1",
    )
    _, kwargs = mock_request.call_args
    body = kwargs["json"]
    assert body["metadata"] == {"team": "platform"}
    assert body["aliases"] == {"small": "gpt-4o-mini"}
    assert body["permissions"] == {"allow_pii_unmasking": False}
    assert body["allowed_cache_controls"] == ["no-cache"]


@patch("ee.integrations.secrets.providers.http.requests.request")
def test_litellm_mint_strips_phase_managed_keys(mock_request):
    """Phase always owns key_alias and lifecycle fields; an imported config
    that includes them must not override Phase's own."""
    mock_request.return_value = _mock_response(
        200, {"key": "sk-x", "token": "tok-x"}
    )
    LiteLLMProvider.mint(
        {"gateway_url": "https://llm.example.com", "api_key": "sk"},
        {
            "key_alias": "imported-alias-should-be-ignored",
            "auto_rotate": True,
            "rotation_interval": "1d",
            "duration": "10m",
            "models": ["gpt-4o"],
        },
        caller_id="rs-7",
    )
    _, kwargs = mock_request.call_args
    body = kwargs["json"]
    assert body["key_alias"].startswith("phase-rs-rs-7-")
    assert "auto_rotate" not in body
    assert "rotation_interval" not in body
    assert "duration" not in body
    assert body["models"] == ["gpt-4o"]


@patch("ee.integrations.secrets.providers.http.requests.request")
def test_litellm_mint_4xx_auth_translates(mock_request):
    mock_request.return_value = _mock_response(401, {}, "unauthorized")
    with pytest.raises(ProviderAuthError):
        LiteLLMProvider.mint(
            {"gateway_url": "https://llm.example.com", "api_key": "bad"},
            {},
            caller_id="rs-1",
        )


@patch("ee.integrations.secrets.providers.http.requests.request")
def test_litellm_mint_5xx_transient(mock_request):
    mock_request.return_value = _mock_response(503, {}, "boom")
    with pytest.raises(ProviderTransientError):
        LiteLLMProvider.mint(
            {"gateway_url": "https://llm.example.com", "api_key": "x"},
            {},
            caller_id="rs-1",
        )


@patch("ee.integrations.secrets.providers.http.requests.request")
def test_litellm_revoke_calls_delete_endpoint(mock_request):
    mock_request.return_value = _mock_response(200, {"deleted": True})
    LiteLLMProvider.revoke(
        {"gateway_url": "https://llm.example.com", "api_key": "sk-master"},
        "tok-1234",
    )
    _, kwargs = mock_request.call_args
    assert kwargs["url"] == "https://llm.example.com/key/delete"
    assert kwargs["json"] == {"keys": ["tok-1234"]}


@patch("ee.integrations.secrets.providers.http.requests.request")
def test_litellm_revoke_404_raises_not_found(mock_request):
    mock_request.return_value = _mock_response(404, {}, "missing")
    with pytest.raises(ProviderNotFound):
        LiteLLMProvider.revoke(
            {"gateway_url": "https://llm.example.com", "api_key": "x"}, "tok-1234"
        )


def test_litellm_validate_config_rejects_bad_models():
    with pytest.raises(ProviderConfigError):
        LiteLLMProvider.validate_config({"models": "gpt-4"})


def test_litellm_validate_config_rejects_non_numeric_budget():
    with pytest.raises(ProviderConfigError):
        LiteLLMProvider.validate_config({"max_budget": "ten"})


@patch("ee.integrations.secrets.providers.http.requests.request")
def test_litellm_import_template_returns_full_config(mock_request):
    """Import surfaces the whole policy shape — including object fields the
    manual form doesn't render — and drops only Phase-managed identity
    fields plus null/empty values."""
    mock_request.return_value = _mock_response(
        200,
        {
            # /key/info typical shape — sometimes nested under "info", sometimes flat
            "key": "sk-litellm-xxx",
            "info": {
                "models": ["gpt-4o-mini", "gpt-4o"],
                "max_budget": 25,
                "tpm_limit": 1000,
                "rpm_limit": None,  # null → dropped
                "team_id": "team-1",
                "user_id": "user-1",
                # Object fields that the manual form doesn't render but mint
                # forwards to LiteLLM
                "metadata": {"team": "platform"},
                "permissions": {"allow_pii_unmasking": False},
                "aliases": {"small": "gpt-4o-mini"},
                "allowed_cache_controls": ["no-cache"],
                "model_max_budget": {},  # empty dict → dropped
                # Phase-managed → dropped
                "key_alias": "phase-rs-...",
                "spend": 4.2,
                "auto_rotate": True,
                "rotation_interval": "30d",
            },
        },
    )

    config = LiteLLMProvider.import_config_from_template(
        {"gateway_url": "https://llm.example.com", "api_key": "sk-master"},
        "sk-litellm-template",
    )

    _, kwargs = mock_request.call_args
    assert kwargs["method"] == "GET"
    assert kwargs["url"] == "https://llm.example.com/key/info"
    assert kwargs["params"] == {"key": "sk-litellm-template"}

    assert config == {
        "models": ["gpt-4o-mini", "gpt-4o"],
        "max_budget": 25,
        "tpm_limit": 1000,
        "team_id": "team-1",
        "user_id": "user-1",
        "metadata": {"team": "platform"},
        "permissions": {"allow_pii_unmasking": False},
        "aliases": {"small": "gpt-4o-mini"},
        "allowed_cache_controls": ["no-cache"],
    }


@patch("ee.integrations.secrets.providers.http.requests.request")
def test_litellm_import_template_handles_flat_response(mock_request):
    mock_request.return_value = _mock_response(
        200,
        {"models": ["gpt-4o-mini"], "max_budget": 5, "tpm_limit": None},
    )
    config = LiteLLMProvider.import_config_from_template(
        {"gateway_url": "https://llm.example.com", "api_key": "sk-master"},
        "tok-1234",
    )
    # None fields and empty lists/dicts get dropped
    assert config == {"models": ["gpt-4o-mini"], "max_budget": 5}


@patch("ee.integrations.secrets.providers.http.requests.request")
def test_litellm_import_template_404_raises_not_found(mock_request):
    from ee.integrations.secrets.providers.exceptions import ProviderNotFound

    mock_request.return_value = _mock_response(404, {}, "missing")
    with pytest.raises(ProviderNotFound):
        LiteLLMProvider.import_config_from_template(
            {"gateway_url": "https://llm.example.com", "api_key": "x"},
            "tok-missing",
        )


# ---------------------------------------------------------------------------
# validate_root_credentials — provider-level reachability checks. The UI
# calls these before storing ProviderCredentials so bad creds never reach
# the create flow. A regression here (e.g. wrong header, renamed field,
# different probe endpoint) would silently swallow the failure and let
# bogus creds through — these tests guard the contract.
# ---------------------------------------------------------------------------


@patch("ee.integrations.secrets.providers.http.requests.request")
def test_litellm_validate_root_credentials_happy(mock_request):
    mock_request.return_value = _mock_response(200, {"status": "ok"})
    assert (
        LiteLLMProvider.validate_root_credentials(
            {"gateway_url": "https://llm.example.com/", "api_key": "sk-master"}
        )
        is True
    )
    _, kwargs = mock_request.call_args
    assert kwargs["method"] == "GET"
    assert kwargs["url"] == "https://llm.example.com/health/readiness"
    assert kwargs["headers"]["Authorization"] == "Bearer sk-master"


@patch("ee.integrations.secrets.providers.http.requests.request")
def test_litellm_validate_root_credentials_returns_false_on_auth_error(mock_request):
    mock_request.return_value = _mock_response(401, {}, "unauthorized")
    assert (
        LiteLLMProvider.validate_root_credentials(
            {"gateway_url": "https://llm.example.com", "api_key": "bad"}
        )
        is False
    )


@patch("ee.integrations.secrets.providers.http.requests.request")
def test_litellm_validate_root_credentials_returns_false_on_network_error(mock_request):
    import requests

    mock_request.side_effect = requests.exceptions.ConnectionError("dns failure")
    assert (
        LiteLLMProvider.validate_root_credentials(
            {"gateway_url": "https://unreachable.example.com", "api_key": "sk"}
        )
        is False
    )


def test_litellm_validate_root_credentials_field_names_match_schema():
    """Regression guard: if `api_key` is ever renamed in credential_schema
    (e.g. back to `master_key`), the validation call would KeyError. This
    test pins the schema-to-impl alignment so a rename can't silently
    break credential pre-validation."""
    schema_ids = {f.id for f in LiteLLMProvider.credential_schema}
    assert "gateway_url" in schema_ids
    assert "api_key" in schema_ids


# ---------------------------------------------------------------------------
# OpenAI Project Service Account provider
# ---------------------------------------------------------------------------


def test_openai_sa_provider_id_codec_roundtrip():
    assert _decode_provider_id(_encode_provider_id("proj_a", "svc_acct_b")) == (
        "proj_a",
        "svc_acct_b",
    )


def test_openai_sa_provider_id_codec_rejects_malformed():
    from ee.integrations.secrets.providers.exceptions import ProviderConfigError

    with pytest.raises(ProviderConfigError):
        _decode_provider_id("svc_acct_no_project_scope")


def test_openai_sa_validate_config_requires_project():
    from ee.integrations.secrets.providers.exceptions import ProviderConfigError

    with pytest.raises(ProviderConfigError):
        OpenAIProvider.validate_config({})
    with pytest.raises(ProviderConfigError):
        OpenAIProvider.validate_config({"project_id": ""})
    # Happy path — should not raise
    OpenAIProvider.validate_config({"project_id": "proj_abc"})


@patch("ee.integrations.secrets.providers.http.requests.request")
def test_openai_sa_mint_happy_path(mock_request):
    mock_request.return_value = _mock_response(
        200,
        {
            "object": "organization.project.service_account",
            "id": "svc_acct_abc",
            "name": "phase-rs-rs-7-1234",
            "role": "member",
            "created_at": 1711471533,
            "api_key": {
                "object": "organization.project.service_account.api_key",
                "value": "sk-proj-xxxx",
                "name": "Secret Key",
                "created_at": 1711471533,
                "id": "key_abc",
            },
        },
    )
    result = OpenAIProvider.mint(
        {"admin_api_key": "sk-admin"},
        {"project_id": "proj_xyz", "name_template": "phase-rs-{id}"},
        caller_id="rs-7",
    )
    # provider_credential_id packs project + sa id so revoke can recover both
    assert result.provider_credential_id == "proj_xyz:svc_acct_abc"
    assert result.values["api_key"] == "sk-proj-xxxx"
    assert result.values["key_id"] == "key_abc"
    assert result.values["service_account_id"] == "svc_acct_abc"
    assert result.metadata["project_id"] == "proj_xyz"
    _, kwargs = mock_request.call_args
    assert kwargs["method"] == "POST"
    assert kwargs["url"] == (
        f"{OPENAI_API_BASE}/organization/projects/proj_xyz/service_accounts"
    )
    assert kwargs["json"]["name"].startswith("phase-rs-rs-7-")
    # Body must NOT include role/permissions/scopes — OpenAI rejects unknown
    # fields, and we promised the docstring we won't pretend to set them.
    assert set(kwargs["json"].keys()) == {"name"}


@patch("ee.integrations.secrets.providers.http.requests.request")
def test_openai_sa_mint_handles_missing_api_key_object(mock_request):
    """If OpenAI ever responds with the SA but without an api_key (e.g. a
    future API change or a partial response), surface a config error rather
    than crashing — and don't leak partial state."""
    mock_request.return_value = _mock_response(
        200,
        {"id": "svc_acct_abc", "name": "phase-rs-x"},
    )
    with pytest.raises(ProviderConfigError):
        OpenAIProvider.mint(
            {"admin_api_key": "sk-admin"},
            {"project_id": "proj_xyz"},
            caller_id="rs-7",
        )


@patch("ee.integrations.secrets.providers.http.requests.request")
def test_openai_sa_revoke_calls_delete_with_decoded_ids(mock_request):
    mock_request.return_value = _mock_response(
        200,
        {
            "object": "organization.project.service_account.deleted",
            "id": "svc_acct_abc",
            "deleted": True,
        },
    )
    summary = OpenAIProvider.revoke(
        {"admin_api_key": "sk-admin"}, "proj_xyz:svc_acct_abc"
    )
    _, kwargs = mock_request.call_args
    assert kwargs["method"] == "DELETE"
    assert kwargs["url"] == (
        f"{OPENAI_API_BASE}/organization/projects/proj_xyz"
        f"/service_accounts/svc_acct_abc"
    )
    assert summary["project_id"] == "proj_xyz"
    assert summary["service_account_id"] == "svc_acct_abc"


@patch("ee.integrations.secrets.providers.http.requests.request")
def test_openai_sa_revoke_404_raises_not_found(mock_request):
    from ee.integrations.secrets.providers.exceptions import ProviderNotFound

    mock_request.return_value = _mock_response(404, {}, "missing")
    with pytest.raises(ProviderNotFound):
        OpenAIProvider.revoke(
            {"admin_api_key": "sk-admin"}, "proj_xyz:svc_acct_abc"
        )


@patch("ee.integrations.secrets.providers.http.requests.request")
def test_openai_sa_validate_root_credentials_happy(mock_request):
    mock_request.return_value = _mock_response(
        200, {"object": "list", "data": [], "has_more": False}
    )
    assert (
        OpenAIProvider.validate_root_credentials(
            {"admin_api_key": "sk-admin"}
        )
        is True
    )
    _, kwargs = mock_request.call_args
    # Probes /organization/projects (NOT /admin_api_keys) — we need a working
    # admin key with project-management scopes, not key-management scopes.
    assert kwargs["url"] == f"{OPENAI_API_BASE}/organization/projects"
    assert kwargs["params"] == {"limit": 1}


@patch("ee.integrations.secrets.providers.http.requests.request")
def test_openai_sa_validate_root_credentials_returns_false_on_auth(mock_request):
    mock_request.return_value = _mock_response(401, {}, "unauthorized")
    assert (
        OpenAIProvider.validate_root_credentials(
            {"admin_api_key": "bad"}
        )
        is False
    )


@patch("ee.integrations.secrets.providers.http.requests.request")
def test_openai_sa_list_projects_skips_archived_and_paginates(mock_request):
    """OpenAI orgs can have many projects + an ``archived`` lifecycle. The
    UI dropdown should only surface active projects, and we must follow
    ``has_more``/``last_id`` cursors so big orgs aren't truncated."""
    page1 = _mock_response(
        200,
        {
            "object": "list",
            "data": [
                {"id": "proj_a", "name": "Live", "status": "active"},
                {"id": "proj_b", "name": "Old", "status": "archived"},
            ],
            "has_more": True,
            "last_id": "proj_b",
        },
    )
    page2 = _mock_response(
        200,
        {
            "object": "list",
            "data": [
                {"id": "proj_c", "name": "Other", "status": "active"},
            ],
            "has_more": False,
        },
    )
    mock_request.side_effect = [page1, page2]

    projects = OpenAIProvider.list_projects(
        {"admin_api_key": "sk-admin"}
    )

    assert [p["id"] for p in projects] == ["proj_a", "proj_c"]
    # Second call must include the after cursor from page 1
    assert mock_request.call_count == 2
    _, kwargs_p2 = mock_request.call_args_list[1]
    assert kwargs_p2["params"].get("after") == "proj_b"


def test_openai_sa_does_not_support_import():
    """The provider has no rich template config to import — verify the
    base-class default kicks in rather than us re-declaring a no-op."""
    assert (
        OpenAIProvider.import_config_from_template(
            {"admin_api_key": "sk"}, "key_abc"
        )
        is None
    )


def test_openai_sa_credential_schema_pins_admin_api_key():
    """Regression guard: ``validate_root_credentials`` indexes into
    ``root_creds['admin_api_key']`` — if the field id ever changes in the
    schema, the validator would KeyError. This pins the schema-to-impl
    alignment."""
    sa_ids = {f.id for f in OpenAIProvider.credential_schema}
    assert sa_ids == {"admin_api_key"}
