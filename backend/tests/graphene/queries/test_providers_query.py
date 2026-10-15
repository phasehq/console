"""The providers query builds a ProviderType from every entry in api.services,
so a provider key the type doesn't declare breaks the whole query."""

from types import SimpleNamespace

from backend.schema import schema

QUERY = """
{
  providers {
    id
    name
    expectedCredentials
    optionalCredentials
    nonSensitiveCredentials
    endpointCredentials
    authScheme
  }
}
"""


def test_every_provider_resolves_through_the_providers_query():
    result = schema.execute(
        QUERY, context_value=SimpleNamespace(user=SimpleNamespace(userId="user-1"))
    )

    assert result.errors is None
    gcp = next(p for p in result.data["providers"] if p["id"] == "gcp")
    assert "private_key" in gcp["expectedCredentials"]
    assert "private_key" not in gcp["nonSensitiveCredentials"]
    assert gcp["endpointCredentials"] == []
