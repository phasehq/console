"""Rotation provider base class."""

import abc
from dataclasses import dataclass, field
from typing import Any, ClassVar


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


@dataclass
class OutputSchemaField:
    id: str
    label: str
    masked: bool = True
    help_text: str = ""


@dataclass
class MintResult:
    provider_credential_id: str
    values: dict[str, str]
    metadata: dict[str, Any] = field(default_factory=dict)


class RotationProvider(abc.ABC):
    id: ClassVar[str]
    name: ClassVar[str]
    credential_schema: ClassVar[list[CredentialSchemaField]] = []
    config_schema: ClassVar[list[ConfigSchemaField]] = []
    output_schema: ClassVar[list[OutputSchemaField]] = []

    @classmethod
    @abc.abstractmethod
    def validate_config(cls, config: dict) -> None:
        """Raise RotationProviderConfigError if the per-secret config is invalid."""

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
        rotating_secret_id: str,
    ) -> MintResult:
        """Create a new credential at the provider. Raises RotationProviderError on failure."""

    @classmethod
    @abc.abstractmethod
    def revoke(
        cls,
        root_creds: dict,
        provider_credential_id: str,
    ) -> dict | None:
        """Revoke a credential by its provider-side id. 404 must raise RotationProviderNotFound."""

    @classmethod
    def import_config_from_template(
        cls,
        root_creds: dict,
        template_ref: str,
    ) -> dict | None:
        """Return a config dict shaped like mint() accepts, or None if unsupported."""
        return None
