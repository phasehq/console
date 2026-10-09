"""Dynamic secret reads and deletes are scoped to environments the caller holds
keys for; app-level access alone is not enough."""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from graphql import GraphQLError

from api.models import OrganisationMember
from ee.integrations.secrets.dynamic.graphene import mutations, queries, types

ACCESSIBLE_ENV_IDS = ["env-dev"]


def _make_info(user_id="actor-1"):
    return SimpleNamespace(
        context=SimpleNamespace(user=SimpleNamespace(userId=user_id))
    )


@pytest.fixture
def query_mocks(monkeypatch):
    mock_secret_model = MagicMock()
    monkeypatch.setattr(queries, "DynamicSecret", mock_secret_model)

    mock_env_ids = MagicMock(return_value=set(ACCESSIBLE_ENV_IDS))
    monkeypatch.setattr(queries, "accessible_environment_ids", mock_env_ids)

    app = SimpleNamespace(id="app-1", organisation=SimpleNamespace(id="org-1"))
    mock_app_model = MagicMock()
    mock_app_model.objects.get.return_value = app
    monkeypatch.setattr(queries, "App", mock_app_model)

    mock_org_model = MagicMock()
    monkeypatch.setattr(queries, "Organisation", mock_org_model)

    mock_env_model = MagicMock()
    mock_env_model.objects.get.return_value = SimpleNamespace(id="env-prod", app=app)
    monkeypatch.setattr(queries, "Environment", mock_env_model)

    monkeypatch.setattr(queries, "user_has_permission", MagicMock(return_value=True))
    monkeypatch.setattr(queries, "user_can_access_app", MagicMock(return_value=True))
    mock_env_access = MagicMock(return_value=True)
    monkeypatch.setattr(queries, "user_can_access_environment", mock_env_access)

    return SimpleNamespace(
        secret_model=mock_secret_model,
        env_ids=mock_env_ids,
        env_access=mock_env_access,
    )


def _filters(query_mocks):
    return query_mocks.secret_model.objects.filter.call_args.kwargs


def test_app_scoped_query_limits_to_environments_with_keys(query_mocks):
    queries.resolve_dynamic_secrets(None, _make_info(), app_id="app-1")

    assert _filters(query_mocks) == {
        "deleted_at": None,
        "environment__app__id": "app-1",
        "environment_id__in": set(ACCESSIBLE_ENV_IDS),
    }
    query_mocks.env_ids.assert_called_once_with("actor-1", environment__app_id="app-1")


def test_org_scoped_query_limits_to_environments_with_keys(query_mocks):
    queries.resolve_dynamic_secrets(None, _make_info(), org_id="org-1")

    assert _filters(query_mocks) == {
        "deleted_at": None,
        "environment__app__organisation_id": "org-1",
        "environment_id__in": set(ACCESSIBLE_ENV_IDS),
    }
    query_mocks.env_ids.assert_called_once_with(
        "actor-1", environment__app__organisation_id="org-1"
    )


def test_env_scoped_query_still_requires_environment_access(query_mocks):
    query_mocks.env_access.return_value = False

    with pytest.raises(GraphQLError, match="access to this environment"):
        queries.resolve_dynamic_secrets(None, _make_info(), env_id="env-prod")

    query_mocks.secret_model.objects.filter.assert_not_called()


def _dynamic_secret():
    org = SimpleNamespace(id="org-1")
    app = SimpleNamespace(id="app-1", organisation=org)
    env = SimpleNamespace(id="env-prod", app=app)
    return SimpleNamespace(
        environment=env, environment_id="env-prod", leases=MagicMock()
    )


def test_leases_are_empty_without_environment_access(monkeypatch):
    monkeypatch.setattr(
        types, "request_accessible_env_ids", MagicMock(return_value={"env-dev"})
    )
    mock_permission = MagicMock(return_value=True)
    monkeypatch.setattr(types, "user_has_permission", mock_permission)
    secret = _dynamic_secret()

    result = types.DynamicSecretType.resolve_leases(secret, _make_info())

    assert result is secret.leases.none.return_value
    secret.leases.filter.assert_not_called()
    mock_permission.assert_not_called()


def test_leases_are_listed_with_environment_access(monkeypatch):
    monkeypatch.setattr(
        types, "request_accessible_env_ids", MagicMock(return_value={"env-prod"})
    )
    monkeypatch.setattr(types, "user_has_permission", MagicMock(return_value=True))
    secret = _dynamic_secret()

    types.DynamicSecretType.resolve_leases(secret, _make_info())

    secret.leases.filter.assert_called_once_with()


def test_leases_for_non_reader_use_the_active_membership(monkeypatch):
    monkeypatch.setattr(
        types, "request_accessible_env_ids", MagicMock(return_value={"env-prod"})
    )
    monkeypatch.setattr(types, "user_has_permission", MagicMock(return_value=False))
    active_member = SimpleNamespace(id="member-active")

    def member_get(**kwargs):
        # Re-invited users keep their soft-deleted membership rows.
        if "deleted_at" not in kwargs:
            raise OrganisationMember.MultipleObjectsReturned
        return active_member

    member_model = MagicMock()
    member_model.objects.get.side_effect = member_get
    monkeypatch.setattr(types, "OrganisationMember", member_model)
    secret = _dynamic_secret()

    types.DynamicSecretType.resolve_leases(secret, _make_info())

    secret.leases.filter.assert_called_once_with(organisation_member=active_member)


@pytest.fixture
def delete_mocks(monkeypatch):
    org = SimpleNamespace(id="org-1")
    app = SimpleNamespace(id="app-1", organisation=org)
    secret = MagicMock(environment_id="env-prod")
    secret.environment = SimpleNamespace(id="env-prod", app=app)

    mock_secret_model = MagicMock()
    mock_secret_model.objects.get.return_value = secret
    monkeypatch.setattr(mutations, "DynamicSecret", mock_secret_model)
    monkeypatch.setattr(mutations, "user_has_permission", MagicMock(return_value=True))
    mock_env_access = MagicMock(return_value=True)
    monkeypatch.setattr(mutations, "user_can_access_environment", mock_env_access)

    return SimpleNamespace(secret=secret, env_access=mock_env_access)


def test_delete_rejects_environment_without_access(delete_mocks):
    delete_mocks.env_access.return_value = False

    with pytest.raises(GraphQLError, match="access to this environment"):
        mutations.DeleteDynamicSecretMutation.mutate(
            None, _make_info(), secret_id="ds-1"
        )

    delete_mocks.secret.delete.assert_not_called()


def test_delete_succeeds_with_environment_access(delete_mocks):
    mutations.DeleteDynamicSecretMutation.mutate(None, _make_info(), secret_id="ds-1")

    delete_mocks.env_access.assert_called_once_with("actor-1", "env-prod")
    delete_mocks.secret.delete.assert_called_once()
