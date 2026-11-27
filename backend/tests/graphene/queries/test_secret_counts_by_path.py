"""secretCountsByPath: the per-path secret counts the sync path picker shows."""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from django.db.models import Count
from graphql import GraphQLError

import backend.schema as schema_module


def _make_info(user_id="actor-1"):
    return SimpleNamespace(
        context=SimpleNamespace(user=SimpleNamespace(userId=user_id))
    )


def _resolve(env_id="env-1", info=None):
    return schema_module.Query.resolve_secret_counts_by_path(
        None, info or _make_info(), env_id=env_id
    )


@pytest.fixture
def secret_model(monkeypatch):
    model = MagicMock()
    rows = [
        {"path": "/", "secret_count": 14},
        {"path": "/workers", "secret_count": 6},
    ]
    queryset = model.objects.filter.return_value
    queryset.values.return_value.annotate.return_value.order_by.return_value = rows
    monkeypatch.setattr(schema_module, "Secret", model)
    monkeypatch.setattr(
        schema_module, "user_can_access_environment", MagicMock(return_value=True)
    )
    return model


def test_requires_access_to_the_environment(monkeypatch, secret_model):
    access = MagicMock(return_value=False)
    monkeypatch.setattr(schema_module, "user_can_access_environment", access)

    with pytest.raises(
        GraphQLError, match="^You don't have access to this environment$"
    ):
        _resolve(env_id="env-1", info=_make_info("someone-else"))

    access.assert_called_once_with("someone-else", "env-1")
    secret_model.objects.filter.assert_not_called()


def test_counts_live_static_secrets_per_path(secret_model):
    result = _resolve(env_id="env-1")

    # The secrets a sync sends: this environment, not deleted, grouped by exact
    # path. Secret excludes dynamic secrets, which have their own model.
    secret_model.objects.filter.assert_called_once_with(
        environment_id="env-1", deleted_at=None
    )
    queryset = secret_model.objects.filter.return_value
    queryset.values.assert_called_once_with("path")
    queryset.values.return_value.annotate.assert_called_once_with(
        secret_count=Count("id")
    )

    assert [(row.path, row.secret_count) for row in result] == [
        ("/", 14),
        ("/workers", 6),
    ]


def test_schema_exposes_the_query():
    graphql_schema = schema_module.schema.graphql_schema
    field = graphql_schema.query_type.fields["secretCountsByPath"]

    assert str(field.args["envId"].type) == "ID!"
    assert str(field.type) == "[SecretPathCountType!]"
    count_type = graphql_schema.type_map["SecretPathCountType"]
    assert str(count_type.fields["path"].type) == "String!"
    assert str(count_type.fields["secretCount"].type) == "Int!"
