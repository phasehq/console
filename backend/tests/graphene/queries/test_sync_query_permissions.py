"""Authorization checks on sync queries that use stored provider credentials,
and on the sync lists that expose which credentials a sync uses."""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from graphql import GraphQLError

from api.models import OrganisationMember
from api.utils.access.permissions import user_has_permission
from backend.graphene import types
from backend.graphene.queries import syncing as queries

# Anchored: missing and forbidden credentials must produce the exact same message.
PERMISSION_ERROR = "^You don't have permission to access these credentials$"


def _make_info(user_id="actor-1"):
    return SimpleNamespace(
        context=SimpleNamespace(user=SimpleNamespace(userId=user_id))
    )


# (resolver, extra kwargs, accepted provider, outbound callables the resolver uses)
CREDENTIAL_QUERY_CASES = [
    ("resolve_cloudflare_pages_projects", {}, "cloudflare", ["list_cloudflare_pages"]),
    ("resolve_cloudflare_workers", {}, "cloudflare", ["list_cloudflare_workers"]),
    ("resolve_aws_secret_manager_secrets", {}, "aws", ["list_aws_secrets"]),
    ("resolve_gh_repos", {}, "github", ["list_repos"]),
    (
        "resolve_github_environments",
        {"owner": "demo-owner", "repo_name": "demo-repo"},
        "github",
        ["list_environments"],
    ),
    ("resolve_gh_orgs", {}, "github", ["list_orgs"]),
    ("resolve_test_vault_creds", {}, "hashicorp_vault", ["test_vault_creds"]),
    ("resolve_test_nomad_creds", {}, "hashicorp_nomad", ["test_nomad_creds"]),
    ("resolve_gitlab_projects", {}, "gitlab", ["list_gitlab_projects"]),
    ("resolve_gitlab_groups", {}, "gitlab", ["list_gitlab_groups"]),
    ("resolve_railway_projects", {}, "railway", ["fetch_railway_projects"]),
    ("resolve_supabase_projects", {}, "supabase", ["list_supabase_projects"]),
    ("resolve_render_services", {}, "render", ["list_render_services"]),
    ("resolve_render_envgroups", {}, "render", ["list_render_environment_groups"]),
    (
        "resolve_vercel_projects",
        {},
        "vercel",
        ["test_vercel_creds", "list_vercel_projects"],
    ),
    (
        "resolve_azure_kv_secrets",
        {"vault_uri": "https://demo.vault.azure.net"},
        "azure",
        [
            "api.utils.syncing.azure.auth.get_azure_client_credential",
            "api.utils.syncing.azure.auth.get_kv_client",
            "api.utils.syncing.azure.key_vault.validate_vault_uri",
            "api.utils.syncing.azure.key_vault.list_kv_secrets",
        ],
    ),
    (
        "resolve_gcp_secret_manager_secrets",
        {"project_id": "my-project", "location": "global"},
        "gcp",
        ["get_gcp_credentials", "list_gcp_secrets"],
    ),
]

CASE_IDS = [case[0] for case in CREDENTIAL_QUERY_CASES]


def _patch_credential_query(
    monkeypatch, outbound, *, provider, permission=True, exists=True
):
    org = SimpleNamespace(id="org-1")
    credential = MagicMock(id="cred-1", organisation=org, provider=provider)

    mock_creds_model = MagicMock()
    lookup = mock_creds_model.objects.filter.return_value.select_related.return_value
    lookup.first.return_value = credential if exists else None
    monkeypatch.setattr(queries, "ProviderCredentials", mock_creds_model)

    mock_permission = MagicMock(return_value=permission)
    monkeypatch.setattr(queries, "user_has_permission", mock_permission)

    mock_keypair = MagicMock(return_value=(MagicMock(), MagicMock()))
    monkeypatch.setattr(queries, "get_server_keypair", mock_keypair)
    mock_decrypt = MagicMock(return_value="decrypted")
    monkeypatch.setattr(queries, "decrypt_asymmetric", mock_decrypt)

    outbound_mocks = []
    for target in outbound:
        mock = MagicMock()
        if "." in target:
            monkeypatch.setattr(target, mock)
        else:
            monkeypatch.setattr(queries, target, mock)
        outbound_mocks.append(mock)

    return SimpleNamespace(
        credential=credential,
        creds_model=mock_creds_model,
        permission=mock_permission,
        used_credential=[mock_keypair, mock_decrypt, *outbound_mocks],
        outbound=outbound_mocks,
    )


def _assert_credential_unused(mocks):
    for mock in mocks.used_credential:
        mock.assert_not_called()


@pytest.mark.parametrize(
    ("resolver_name", "kwargs", "provider", "outbound"),
    CREDENTIAL_QUERY_CASES,
    ids=CASE_IDS,
)
def test_credential_query_rejects_caller_without_read_permission(
    monkeypatch, resolver_name, kwargs, provider, outbound
):
    mocks = _patch_credential_query(
        monkeypatch, outbound, provider=provider, permission=False
    )
    info = _make_info()

    with pytest.raises(GraphQLError, match=PERMISSION_ERROR):
        getattr(queries, resolver_name)(None, info, credential_id="cred-1", **kwargs)

    # Org-level check: no app context, so team overrides can't grant it.
    mocks.permission.assert_called_once_with(
        info.context.user,
        "read",
        "IntegrationCredentials",
        mocks.credential.organisation,
    )
    _assert_credential_unused(mocks)


@pytest.mark.parametrize(
    ("resolver_name", "kwargs", "provider", "outbound"),
    CREDENTIAL_QUERY_CASES,
    ids=CASE_IDS,
)
def test_credential_query_rejects_unknown_credential_with_same_error(
    monkeypatch, resolver_name, kwargs, provider, outbound
):
    mocks = _patch_credential_query(
        monkeypatch, outbound, provider=provider, exists=False
    )

    with pytest.raises(GraphQLError, match=PERMISSION_ERROR):
        getattr(queries, resolver_name)(
            None, _make_info(), credential_id="missing", **kwargs
        )

    _assert_credential_unused(mocks)


@pytest.mark.parametrize(
    ("resolver_name", "kwargs", "provider", "outbound"),
    CREDENTIAL_QUERY_CASES,
    ids=CASE_IDS,
)
def test_credential_query_rejects_other_provider_credential(
    monkeypatch, resolver_name, kwargs, provider, outbound
):
    mocks = _patch_credential_query(monkeypatch, outbound, provider="datadog")

    with pytest.raises(GraphQLError, match="can't be used with"):
        getattr(queries, resolver_name)(
            None, _make_info(), credential_id="cred-1", **kwargs
        )

    _assert_credential_unused(mocks)


@pytest.mark.parametrize(
    ("resolver_name", "kwargs", "provider", "outbound"),
    CREDENTIAL_QUERY_CASES,
    ids=CASE_IDS,
)
def test_credential_query_hides_provider_from_caller_without_permission(
    monkeypatch, resolver_name, kwargs, provider, outbound
):
    mocks = _patch_credential_query(
        monkeypatch, outbound, provider="datadog", permission=False
    )

    with pytest.raises(GraphQLError, match=PERMISSION_ERROR):
        getattr(queries, resolver_name)(
            None, _make_info(), credential_id="cred-1", **kwargs
        )

    _assert_credential_unused(mocks)


@pytest.mark.parametrize(
    ("resolver_name", "kwargs", "provider", "outbound"),
    CREDENTIAL_QUERY_CASES,
    ids=CASE_IDS,
)
def test_credential_query_uses_credential_when_permitted(
    monkeypatch, resolver_name, kwargs, provider, outbound
):
    mocks = _patch_credential_query(monkeypatch, outbound, provider=provider)

    getattr(queries, resolver_name)(
        None, _make_info(), credential_id="cred-1", **kwargs
    )

    mocks.creds_model.objects.filter.assert_called_once_with(
        id="cred-1", deleted_at=None
    )
    for mock in mocks.outbound:
        mock.assert_called_once()


def test_credential_query_rejects_non_member(monkeypatch):
    """user_has_permission treats a caller outside the credential's org as denied."""
    mocks = _patch_credential_query(
        monkeypatch, ["list_render_services"], provider="render"
    )
    monkeypatch.setattr(queries, "user_has_permission", user_has_permission)
    mock_members = MagicMock()
    mock_members.get.side_effect = OrganisationMember.DoesNotExist
    monkeypatch.setattr(OrganisationMember, "objects", mock_members)

    with pytest.raises(GraphQLError, match=PERMISSION_ERROR):
        queries.resolve_render_services(None, _make_info(), credential_id="cred-1")

    _assert_credential_unused(mocks)


def test_aws_query_accepts_assume_role_credentials(monkeypatch):
    mocks = _patch_credential_query(
        monkeypatch, ["list_aws_secrets"], provider="aws_assume_role"
    )

    queries.resolve_aws_secret_manager_secrets(
        None, _make_info(), credential_id="cred-1"
    )

    mocks.outbound[0].assert_called_once()


def test_every_credential_query_field_is_covered():
    """New credential-taking query fields must be added to the cases above."""
    from backend.schema import Query

    bound = set()
    for name, field in Query._meta.fields.items():
        if "credential_id" not in field.args:
            continue
        resolver = getattr(Query, f"resolve_{name}", None)
        if resolver is not None:
            bound.add(resolver.__name__)

    assert bound == set(CASE_IDS)


def _patch_env_syncs(monkeypatch, *, env_access=True, permission=True):
    env = MagicMock(id="env-1")
    mock_env_model = MagicMock()
    mock_env_model.objects.get.return_value = env
    monkeypatch.setattr(queries, "Environment", mock_env_model)

    mock_sync_model = MagicMock()
    monkeypatch.setattr(queries, "EnvironmentSync", mock_sync_model)

    monkeypatch.setattr(
        queries, "user_can_access_environment", MagicMock(return_value=env_access)
    )
    mock_permission = MagicMock(return_value=permission)
    monkeypatch.setattr(queries, "user_has_permission", mock_permission)

    return SimpleNamespace(
        env=env, sync_model=mock_sync_model, permission=mock_permission
    )


def test_env_syncs_requires_environment_access(monkeypatch):
    mocks = _patch_env_syncs(monkeypatch, env_access=False)

    with pytest.raises(GraphQLError, match="access to this environment"):
        queries.resolve_env_syncs(None, _make_info(), env_id="env-1")

    mocks.sync_model.objects.filter.assert_not_called()


def test_env_syncs_returns_empty_without_integrations_read(monkeypatch):
    mocks = _patch_env_syncs(monkeypatch, permission=False)
    info = _make_info()

    assert queries.resolve_env_syncs(None, info, env_id="env-1") == []

    mocks.permission.assert_called_once_with(
        info.context.user,
        "read",
        "Integrations",
        mocks.env.app.organisation,
        True,
        app=mocks.env.app,
    )
    mocks.sync_model.objects.filter.assert_not_called()


def test_env_syncs_lists_syncs_with_access_and_permission(monkeypatch):
    mocks = _patch_env_syncs(monkeypatch)

    queries.resolve_env_syncs(None, _make_info(), env_id="env-1")

    mocks.sync_model.objects.filter.assert_called_once_with(
        environment_id="env-1", deleted_at=None
    )


def _make_env(env_id, app_id):
    org = SimpleNamespace(id="org-1")
    app = SimpleNamespace(id=app_id, organisation=org)
    return SimpleNamespace(id=env_id, app_id=app_id, app=app)


def _patch_environment_type(monkeypatch, *, key_env_ids=("env-1",), permission=True):
    mock_sync_model = MagicMock()
    monkeypatch.setattr(types, "EnvironmentSync", mock_sync_model)

    mock_key_model = MagicMock()
    mock_key_model.objects.filter.return_value.values_list.return_value = list(
        key_env_ids
    )
    monkeypatch.setattr(types, "EnvironmentKey", mock_key_model)
    mock_permission = MagicMock(return_value=permission)
    monkeypatch.setattr(types, "user_has_permission", mock_permission)

    return SimpleNamespace(
        sync_model=mock_sync_model,
        key_model=mock_key_model,
        permission=mock_permission,
    )


def test_environment_syncs_empty_without_environment_access(monkeypatch):
    """Reachable through other members' app memberships, so the caller's keys count."""
    mocks = _patch_environment_type(monkeypatch, key_env_ids=("other-env",))
    env = _make_env("env-1", "app-1")

    assert types.EnvironmentType.resolve_syncs(env, _make_info("actor-1")) == []

    mocks.key_model.objects.filter.assert_called_once_with(
        user__user_id="actor-1", user__deleted_at=None, deleted_at=None
    )
    mocks.permission.assert_not_called()
    mocks.sync_model.objects.filter.assert_not_called()


def test_environment_syncs_empty_without_integrations_read(monkeypatch):
    mocks = _patch_environment_type(monkeypatch, permission=False)
    env = _make_env("env-1", "app-1")
    info = _make_info()

    assert types.EnvironmentType.resolve_syncs(env, info) == []

    mocks.permission.assert_called_once_with(
        info.context.user,
        "read",
        "Integrations",
        env.app.organisation,
        True,
        app=env.app,
    )
    mocks.sync_model.objects.filter.assert_not_called()


def test_environment_syncs_lists_syncs_with_access_and_permission(monkeypatch):
    mocks = _patch_environment_type(monkeypatch)
    env = _make_env("env-1", "app-1")

    types.EnvironmentType.resolve_syncs(env, _make_info())

    mocks.sync_model.objects.filter.assert_called_once_with(
        environment=env, deleted_at=None
    )


def test_environment_syncs_memoizes_access_checks_per_request(monkeypatch):
    mocks = _patch_environment_type(
        monkeypatch, key_env_ids=("env-1", "env-2", "env-3")
    )
    info = _make_info()

    for env in (
        _make_env("env-1", "app-1"),
        _make_env("env-2", "app-1"),
        _make_env("env-3", "app-2"),
    ):
        types.EnvironmentType.resolve_syncs(env, info)

    mocks.key_model.objects.filter.assert_called_once()
    assert mocks.permission.call_count == 2
    assert mocks.sync_model.objects.filter.call_count == 3
