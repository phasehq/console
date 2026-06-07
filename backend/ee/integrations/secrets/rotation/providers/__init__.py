from .base import RotationProvider
from .litellm import LiteLLMRotationProvider
from .openai import OpenAIRotationProvider
from ..exceptions import ProviderNotRegisteredError

ROTATION_PROVIDERS: dict[str, type[RotationProvider]] = {
    LiteLLMRotationProvider.id: LiteLLMRotationProvider,
    OpenAIRotationProvider.id: OpenAIRotationProvider,
}


def get_provider(provider_id: str) -> type[RotationProvider]:
    try:
        return ROTATION_PROVIDERS[provider_id]
    except KeyError as e:
        raise ProviderNotRegisteredError(
            f"Rotation provider '{provider_id}' is not registered"
        ) from e


def all_providers() -> list[type[RotationProvider]]:
    return list(ROTATION_PROVIDERS.values())
