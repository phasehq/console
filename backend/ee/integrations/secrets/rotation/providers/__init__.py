"""Rotation provider registry.

The provider classes themselves live in `ee.integrations.secrets.providers`
so dynamic-secret leases and other consumers can reuse them. This module
only maps provider ids onto the classes the rotation engine should pick.
"""

from ee.integrations.secrets.providers.base import CredentialProvider
from ee.integrations.secrets.providers.exceptions import ProviderNotRegisteredError
from ee.integrations.secrets.providers.litellm import LiteLLMProvider
from ee.integrations.secrets.providers.openai import OpenAIProvider

ROTATION_PROVIDERS: dict[str, type[CredentialProvider]] = {
    LiteLLMProvider.id: LiteLLMProvider,
    OpenAIProvider.id: OpenAIProvider,
}


def get_provider(provider_id: str) -> type[CredentialProvider]:
    try:
        return ROTATION_PROVIDERS[provider_id]
    except KeyError as e:
        raise ProviderNotRegisteredError(
            f"Rotation provider '{provider_id}' is not registered"
        ) from e


def all_providers() -> list[type[CredentialProvider]]:
    return list(ROTATION_PROVIDERS.values())
