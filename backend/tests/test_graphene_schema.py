"""Schema-shape guards for fields with withholding resolvers."""

from graphql import GraphQLNonNull

from backend.schema import schema


def test_provider_credentials_field_is_nullable():
    """resolve_credentials returns None for users without
    IntegrationCredentials read — the field must stay nullable, or the
    withholding becomes a hard GraphQL error that nulls the surrounding
    payload."""
    field = schema.graphql_schema.type_map["ProviderCredentialsType"].fields[
        "credentials"
    ]
    assert not isinstance(field.type, GraphQLNonNull)
