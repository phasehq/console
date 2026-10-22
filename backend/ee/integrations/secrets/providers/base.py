"""Credential-provider base class.

Generic over rotation / dynamic-secret callers — the provider only cares
about minting a credential and revoking it. The caller passes a free-form
`caller_id` it can use to build deterministic resource names at the
provider (rotation passes the rotating-secret id; a lease would pass the
lease id).
"""

import abc
from dataclasses import dataclass, field
from typing import Any, ClassVar

from .exceptions import ProviderConfigError


@dataclass
class CredentialSchemaField:
    id: str
    label: str
    required: bool = True
    masked: bool = False
    help_text: str = ""


@dataclass
class ConfigSchemaField:
    id: str
    label: str
    required: bool = True
    field_type: str = "string"
    default: Any = None
    help_text: str = ""
    help_url: str = ""
    choices: list[str] = field(default_factory=list)
    # Options are loaded from the provider via list_resources(resource_type).
    resource_type: str = ""
    # Config fields whose values list_resources needs to scope the options.
    depends_on: list[str] = field(default_factory=list)


@dataclass
class OutputSchemaField:
    id: str
    label: str
    masked: bool = True
    help_text: str = ""


@dataclass
class ResourceOption:
    id: str
    name: str
    description: str = ""


@dataclass
class TemplateImportSpec:
    label: str
    help_text: str = ""


@dataclass
class MintResult:
    provider_credential_id: str
    values: dict[str, str]
    metadata: dict[str, Any] = field(default_factory=dict)


class CredentialProvider(abc.ABC):
    id: ClassVar[str]
    name: ClassVar[str]
    credential_schema: ClassVar[list[CredentialSchemaField]] = []
    config_schema: ClassVar[list[ConfigSchemaField]] = []
    output_schema: ClassVar[list[OutputSchemaField]] = []
    # Prefills the output -> secret key mapping, e.g. OPEN_AI_API_KEY.
    key_name_prefix: ClassVar[str] = ""
    # What provider_credential_id is called in the provider's own UI.
    credential_id_label: ClassVar[str] = "Credential ID"
    template_import: ClassVar[TemplateImportSpec | None] = None
    # Other ProviderCredentials.provider types usable as root credentials.
    extra_credential_providers: ClassVar[tuple[str, ...]] = ()

    @classmethod
    @abc.abstractmethod
    def validate_config(cls, config: dict) -> None:
        """Raise ProviderConfigError if the per-secret config is invalid."""

    @classmethod
    @abc.abstractmethod
    def validate_root_credentials(cls, root_creds: dict) -> bool:
        """Lightweight check that root creds work. Returns True/False."""

    @classmethod
    @abc.abstractmethod
    def mint(
        cls,
        root_creds: dict,
        config: dict,
        *,
        caller_id: str,
    ) -> MintResult:
        """Create a new credential at the provider. Raises ProviderError on failure."""

    @classmethod
    @abc.abstractmethod
    def revoke(
        cls,
        root_creds: dict,
        provider_credential_id: str,
    ) -> dict | None:
        """Revoke a credential by its provider-side ID. 404 must raise ProviderNotFound."""

    @classmethod
    def accepts_credentials(cls, credential_provider: str) -> bool:
        """Whether a ProviderCredentials.provider type can serve as root credentials."""
        return (
            credential_provider == cls.id
            or credential_provider in cls.extra_credential_providers
        )

    @classmethod
    def import_config_from_template(
        cls,
        root_creds: dict,
        template_ref: str,
    ) -> dict | None:
        """Return a config dict shaped like mint() accepts, or None if unsupported."""
        return None

    @classmethod
    def list_resources(
        cls,
        root_creds: dict,
        resource_type: str,
        config: dict | None = None,
    ) -> list[ResourceOption]:
        """List options for config fields that declare this resource_type."""
        raise ProviderConfigError(
            f"{cls.name} does not list '{resource_type}' resources",
            user_message=f"{cls.name} can't list these options.",
        )
