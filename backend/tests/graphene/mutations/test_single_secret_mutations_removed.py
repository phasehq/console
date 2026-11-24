"""The single-secret create/edit/delete GraphQL mutations were removed; the
console and SDKs use the bulk mutations exclusively. These assert the schema
no longer exposes the single fields (so the per-environment gap on the dead
create path cannot return) while the bulk fields remain.
"""

import pytest


@pytest.fixture(scope="module")
def mutation_fields():
    from backend.schema import schema

    gql_schema = getattr(schema, "graphql_schema", schema)
    return set(gql_schema.mutation_type.fields)


@pytest.mark.parametrize("field", ["createSecret", "editSecret", "deleteSecret"])
def test_single_secret_mutation_is_removed(mutation_fields, field):
    assert field not in mutation_fields


@pytest.mark.parametrize("field", ["createSecrets", "editSecrets", "deleteSecrets"])
def test_bulk_secret_mutation_is_present(mutation_fields, field):
    assert field in mutation_fields


def test_single_secret_mutation_classes_are_gone():
    import backend.graphene.mutations.environment as env

    for name in (
        "CreateSecretMutation",
        "EditSecretMutation",
        "DeleteSecretMutation",
    ):
        assert not hasattr(env, name)
