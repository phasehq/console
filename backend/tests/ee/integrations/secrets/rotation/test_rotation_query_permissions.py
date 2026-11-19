"""Rotation picker queries use stored provider credentials, so they share the
sync queries' credential authorization."""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from graphql import GraphQLError

from backend.graphene.queries import syncing as syncing_queries
from ee.integrations.secrets.providers.base import ConfigSchemaField, ResourceOption
from ee.integrations.secrets.providers.exceptions import (
    ProviderAuthError,
    ProviderNotRegisteredError,
)
from ee.integrations.secrets.rotation.graphene import queries

PERMISSION_ERROR = "^You don't have permission to access these credentials$"

READ_CREDENTIALS = ("read", "IntegrationCredentials", False)
CREATE_ROTATING_SECRETS = ("create", "RotatingSecrets", True)


def _make_info(user_id="actor-1"):
    return SimpleNamespace(
        context=SimpleNamespace(user=SimpleNamespace(userId=user_id))
    )


def _patch(
    monkeypatch,
    *,
    provider,
    granted=(READ_CREDENTIALS, CREATE_ROTATING_SECRETS),
    exists=True,
):
    org = SimpleNamespace(id="org-1")
    credential = SimpleNamespace(id="cred-1", organisation=org, provider=provider)

    mock_creds_model = MagicMock()
    lookup = mock_creds_model.objects.filter.return_value.select_related.return_value
    lookup.first.return_value = credential if exists else None
    monkeypatch.setattr(syncing_queries, "ProviderCredentials", mock_creds_model)

    def has_permission(user, action, resource, org, is_app_resource=False, app=None):
        grant = (action, resource, is_app_resource)
        return org is credential.organisation and app is None and grant in granted

    mock_permission = MagicMock(side_effect=has_permission)
    monkeypatch.setattr(syncing_queries, "user_has_permission", mock_permission)
    monkeypatch.setattr(queries, "user_has_permission", mock_permission)

    mock_get_credentials = MagicMock(return_value={"api_key": "decrypted"})
    monkeypatch.setattr(queries, "get_credentials", mock_get_credentials)

    mock_list_resources = MagicMock(
        return_value=[ResourceOption(id="proj-1", name="Demo")]
    )
    openai = SimpleNamespace(
        id="openai",
        name="OpenAI",
        config_schema=[
            ConfigSchemaField(
                id="project_id",
                label="Project",
                resource_type="project",
                depends_on=["region"],
            ),
            ConfigSchemaField(id="name_template", label="Name template"),
        ],
        list_resources=mock_list_resources,
    )

    mock_importer = MagicMock(return_value={"models": []})
    litellm = SimpleNamespace(
        id="litellm", name="LiteLLM", import_config_from_template=mock_importer
    )
    providers = {"litellm": litellm, "openai": openai}

    def get_provider(provider_id):
        if provider_id not in providers:
            raise ProviderNotRegisteredError(f"'{provider_id}' is not registered")
        return providers[provider_id]

    monkeypatch.setattr(queries, "get_provider", get_provider)

    return SimpleNamespace(
        credential=credential,
        permission=mock_permission,
        used_credential=[mock_get_credentials, mock_list_resources, mock_importer],
        list_resources=mock_list_resources,
        importer=mock_importer,
    )


def _list_resources(
    info=None, provider_id="openai", resource_type="project", config=None
):
    return queries.resolve_rotation_provider_resources(
        None,
        info or _make_info(),
        provider_id=provider_id,
        authentication_id="cred-1",
        resource_type=resource_type,
        config=config,
    )


def _import_template(info=None, provider_id="litellm"):
    return queries.resolve_rotation_provider_import_template(
        None,
        info or _make_info(),
        provider_id=provider_id,
        authentication_id="cred-1",
        template_ref="team-1",
    )


# (resolve, accepted provider, other rotation provider, service name)
RESOLVER_CASES = [
    (_list_resources, "openai", "litellm", "OpenAI"),
    (_import_template, "litellm", "openai", "LiteLLM"),
]
CASE_PARAMS = ("resolve", "provider", "other_provider", "service_name")
CASE_IDS = ["list_resources", "import_template"]


def _assert_credential_unused(mocks):
    for mock in mocks.used_credential:
        mock.assert_not_called()


@pytest.mark.parametrize(CASE_PARAMS, RESOLVER_CASES, ids=CASE_IDS)
def test_rejects_caller_without_integration_credentials_read(
    monkeypatch, resolve, provider, other_provider, service_name
):
    mocks = _patch(monkeypatch, provider=provider, granted=(CREATE_ROTATING_SECRETS,))
    info = _make_info()

    with pytest.raises(GraphQLError, match=PERMISSION_ERROR):
        resolve(info)

    # Org-level check: no app context, so team overrides can't grant it.
    mocks.permission.assert_any_call(
        info.context.user,
        "read",
        "IntegrationCredentials",
        mocks.credential.organisation,
    )
    _assert_credential_unused(mocks)


@pytest.mark.parametrize(CASE_PARAMS, RESOLVER_CASES, ids=CASE_IDS)
def test_rejects_unknown_credential_with_same_error(
    monkeypatch, resolve, provider, other_provider, service_name
):
    mocks = _patch(monkeypatch, provider=provider, exists=False)

    with pytest.raises(GraphQLError, match=PERMISSION_ERROR):
        resolve()

    _assert_credential_unused(mocks)


@pytest.mark.parametrize(CASE_PARAMS, RESOLVER_CASES, ids=CASE_IDS)
def test_hides_provider_from_caller_without_permission(
    monkeypatch, resolve, provider, other_provider, service_name
):
    mocks = _patch(
        monkeypatch, provider=other_provider, granted=(CREATE_ROTATING_SECRETS,)
    )

    with pytest.raises(GraphQLError, match=PERMISSION_ERROR):
        resolve()

    _assert_credential_unused(mocks)


@pytest.mark.parametrize(CASE_PARAMS, RESOLVER_CASES, ids=CASE_IDS)
@pytest.mark.parametrize("wrong_provider", ["other_rotation_provider", "datadog"])
def test_rejects_other_provider_credential(
    monkeypatch, resolve, provider, other_provider, service_name, wrong_provider
):
    if wrong_provider == "other_rotation_provider":
        wrong_provider = other_provider
    mocks = _patch(monkeypatch, provider=wrong_provider)

    with pytest.raises(
        GraphQLError, match=f"^These credentials can't be used with {service_name}$"
    ):
        resolve()

    _assert_credential_unused(mocks)


@pytest.mark.parametrize(CASE_PARAMS, RESOLVER_CASES, ids=CASE_IDS)
def test_still_requires_rotating_secrets_create(
    monkeypatch, resolve, provider, other_provider, service_name
):
    mocks = _patch(monkeypatch, provider=provider, granted=(READ_CREDENTIALS,))

    with pytest.raises(GraphQLError, match="permission to"):
        resolve()

    _assert_credential_unused(mocks)


@pytest.mark.parametrize(CASE_PARAMS, RESOLVER_CASES, ids=CASE_IDS)
def test_rejects_rotating_secrets_read_only(
    monkeypatch, resolve, provider, other_provider, service_name
):
    mocks = _patch(
        monkeypatch,
        provider=provider,
        granted=(READ_CREDENTIALS, ("read", "RotatingSecrets", True)),
    )

    with pytest.raises(GraphQLError, match="permission to"):
        resolve()

    _assert_credential_unused(mocks)


def test_list_resources_lists_with_permissions(monkeypatch):
    mocks = _patch(monkeypatch, provider="openai")
    info = _make_info()

    resources = _list_resources(info)

    mocks.permission.assert_any_call(
        info.context.user,
        "create",
        "RotatingSecrets",
        mocks.credential.organisation,
        True,
    )
    mocks.list_resources.assert_called_once_with(
        {"api_key": "decrypted"}, "project", {}
    )
    assert [(r.id, r.name, r.description) for r in resources] == [
        ("proj-1", "Demo", "")
    ]


def test_list_resources_passes_only_declared_dependencies(monkeypatch):
    mocks = _patch(monkeypatch, provider="openai")

    _list_resources(config={"region": "us", "name_template": "x-{id}", "secret": "s"})

    mocks.list_resources.assert_called_once_with(
        {"api_key": "decrypted"}, "project", {"region": "us"}
    )


@pytest.mark.parametrize("resource_type", ["", "users", "name_template"])
def test_list_resources_rejects_undeclared_resource_type(monkeypatch, resource_type):
    mocks = _patch(monkeypatch, provider="openai")

    with pytest.raises(GraphQLError, match="has no"):
        _list_resources(resource_type=resource_type)

    mocks.permission.assert_not_called()
    _assert_credential_unused(mocks)


def test_list_resources_surfaces_provider_error_message(monkeypatch):
    mocks = _patch(monkeypatch, provider="openai")
    mocks.list_resources.side_effect = ProviderAuthError(
        "401 from GET https://api.example.com: body", user_message="Bad admin key."
    )

    with pytest.raises(GraphQLError, match="^Bad admin key.$"):
        _list_resources()


def test_list_resources_rejects_unregistered_provider(monkeypatch):
    mocks = _patch(monkeypatch, provider="openai")

    with pytest.raises(GraphQLError, match="not registered"):
        _list_resources(provider_id="unknown")

    mocks.permission.assert_not_called()
    _assert_credential_unused(mocks)


def test_import_template_imports_with_permissions(monkeypatch):
    mocks = _patch(monkeypatch, provider="litellm")
    info = _make_info()

    assert _import_template(info) == {"models": []}

    mocks.permission.assert_any_call(
        info.context.user,
        "create",
        "RotatingSecrets",
        mocks.credential.organisation,
        True,
    )
    mocks.importer.assert_called_once_with({"api_key": "decrypted"}, "team-1")


def test_import_template_rejects_unregistered_provider(monkeypatch):
    mocks = _patch(monkeypatch, provider="litellm")

    with pytest.raises(GraphQLError, match="not registered"):
        _import_template(provider_id="unknown")

    mocks.permission.assert_not_called()
    _assert_credential_unused(mocks)
