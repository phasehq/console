from api.services import Providers
from backend.schema import schema


EXPECTED_NON_SENSITIVE_CREDENTIALS = {
    "cloudflare": {"account_id"},
    "aws": {"access_key_id", "region"},
    "aws_assume_role": {"role_arn", "region"},
    "postgres": {"username", "host", "port", "database"},
    "github": {"host_url", "api_url"},
    "gitlab": {"gitlab_host"},
    "hashicorp_vault": {"vault_addr", "vault_role_id", "vault_namespace"},
    "hashicorp_nomad": {"nomad_addr"},
    "railway": set(),
    "vercel": set(),
    "render": set(),
    "supabase": set(),
    "azure": {"tenant_id", "client_id"},
    "gcp": {"workload_identity_provider", "issuer", "subject", "key_id", "jwks"},
    "openai": set(),
    "litellm": {"gateway_url"},
    "datadog": {"site"},
}

# Fields that decide where the sealed values are sent. Datadog's site is an
# allowlist and the AWS region is validated by botocore, so neither can
# redirect a secret.
EXPECTED_ENDPOINT_CREDENTIALS = {
    "cloudflare": set(),
    "aws": set(),
    "aws_assume_role": {"role_arn"},
    "postgres": {"host", "port"},
    "github": {"host_url", "api_url"},
    "gitlab": {"gitlab_host"},
    "hashicorp_vault": {"vault_addr"},
    "hashicorp_nomad": {"nomad_addr"},
    "railway": set(),
    "vercel": set(),
    "render": set(),
    "supabase": set(),
    "azure": set(),
    "gcp": set(),
    "openai": set(),
    "litellm": {"gateway_url"},
    "datadog": set(),
}


def test_every_provider_explicitly_classifies_its_credentials():
    providers = {
        provider["id"]: provider
        for provider in Providers.__dict__.values()
        if isinstance(provider, dict)
    }

    assert set(providers) == set(EXPECTED_NON_SENSITIVE_CREDENTIALS)
    assert set(providers) == set(EXPECTED_ENDPOINT_CREDENTIALS)
    for provider_id, provider in providers.items():
        non_sensitive = set(provider["non_sensitive_credentials"])
        endpoints = set(provider["endpoint_credentials"])
        declared = provider["expected_credentials"] + provider["optional_credentials"]

        assert non_sensitive == EXPECTED_NON_SENSITIVE_CREDENTIALS[provider_id]
        assert endpoints == EXPECTED_ENDPOINT_CREDENTIALS[provider_id]
        assert non_sensitive <= set(declared)
        assert endpoints <= non_sensitive


def test_provider_query_exposes_credential_classification():
    result = schema.execute(
        """
        query ProviderCredentialMetadata {
          providers {
            id
            nonSensitiveCredentials
            endpointCredentials
          }
        }
        """
    )

    assert result.errors is None
    providers = result.data["providers"]
    assert {
        provider["id"]: set(provider["nonSensitiveCredentials"])
        for provider in providers
    } == EXPECTED_NON_SENSITIVE_CREDENTIALS
    assert {
        provider["id"]: set(provider["endpointCredentials"]) for provider in providers
    } == EXPECTED_ENDPOINT_CREDENTIALS
