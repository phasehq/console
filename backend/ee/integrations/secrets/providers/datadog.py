"""Datadog credential provider that mints API keys or application keys."""

from __future__ import annotations

import time

from api.services import DATADOG_SITES, normalize_datadog_site

from .base import (
    ConfigSchemaField,
    CredentialProvider,
    CredentialSchemaField,
    MintResult,
    OutputSchemaField,
)
from .exceptions import ProviderConfigError
from .http import call_summary, request

DEFAULT_KEY_TYPE = "api_key"
DEFAULT_NAME_TEMPLATE = "phase-rs-{id}"

_KEY_RESOURCES = {
    "api_key": ("api_keys", "/api/v2/api_keys"),
    "application_key": (
        "application_keys",
        "/api/v2/current_user/application_keys",
    ),
}

_PROVIDER_ID_SEP = ":"


def _encode_provider_id(key_type: str, key_id: str) -> str:
    return f"{key_type}{_PROVIDER_ID_SEP}{key_id}"


def _decode_provider_id(provider_credential_id: str) -> tuple[str, str]:
    key_type, sep, key_id = (provider_credential_id or "").partition(_PROVIDER_ID_SEP)
    if not sep or key_type not in _KEY_RESOURCES or not key_id:
        raise ProviderConfigError(
            f"Malformed provider credential ID: {provider_credential_id!r}",
            user_message=(
                "This credential's provider ID is malformed. Delete the key "
                "manually in Datadog."
            ),
        )
    return key_type, key_id


def _api_base(root_creds: dict) -> str:
    # The site becomes the API host, so the allowlist doubles as an SSRF guard.
    site = normalize_datadog_site(root_creds.get("site") or "datadoghq.com")
    if site not in DATADOG_SITES:
        raise ProviderConfigError(
            f"Unknown Datadog site: {site!r}",
            user_message=(
                f"Unknown Datadog site '{site}'. Update the credentials with a "
                "supported Datadog site."
            ),
        )
    return f"https://api.{site}"


def _api_key(root_creds: dict) -> str:
    return (root_creds.get("api_key") or "").strip()


def _management_headers(root_creds: dict) -> dict:
    application_key = (root_creds.get("application_key") or "").strip()
    if not application_key:
        raise ProviderConfigError(
            "Datadog credentials have no application key",
            user_message=(
                "Add an application key to these Datadog credentials. "
                "Rotation needs one to manage keys."
            ),
        )
    return {
        "DD-API-KEY": _api_key(root_creds),
        "DD-APPLICATION-KEY": application_key,
    }


class DatadogProvider(CredentialProvider):
    id = "datadog"
    name = "Datadog"
    key_name_prefix = "DATADOG"
    credential_id_label = "Key ID"

    credential_schema = [
        CredentialSchemaField(
            id="api_key",
            label="API Key",
            required=True,
            masked=True,
            help_text="A Datadog API key. Phase checks it against your Datadog site.",
        ),
        CredentialSchemaField(
            id="site",
            label="Site",
            required=True,
            help_text=(
                "Your Datadog site, e.g. datadoghq.com, us3.datadoghq.com or "
                "datadoghq.eu."
            ),
        ),
        CredentialSchemaField(
            id="application_key",
            label="Application Key",
            required=False,
            masked=True,
            help_text=(
                "Needed for rotation only. Its owner needs the api_keys_write "
                "and api_keys_delete permissions to rotate API keys, or "
                "user_app_keys to rotate application keys. A scoped key needs "
                "the same scopes. Minted application keys belong to this "
                "key's owner."
            ),
        ),
    ]

    config_schema = [
        ConfigSchemaField(
            id="key_type",
            label="Key Type",
            required=True,
            default=DEFAULT_KEY_TYPE,
            choices=list(_KEY_RESOURCES),
            help_text=(
                "api_key mints organization API keys. application_key mints "
                "application keys owned by the root application key's owner."
            ),
            help_url="https://docs.datadoghq.com/account_management/api-app-keys/",
        ),
        ConfigSchemaField(
            id="name_template",
            label="Key Name Template",
            required=False,
            default=DEFAULT_NAME_TEMPLATE,
            help_text=(
                "A template for the minted key's name. {id} is replaced with "
                "the caller ID and a timestamp."
            ),
        ),
        ConfigSchemaField(
            id="scopes",
            label="Scopes",
            required=False,
            field_type="list",
            default=[],
            help_text=(
                "Application keys only. Datadog permission names to scope the "
                "key to, e.g. dashboards_read. Leave empty to give the key all "
                "of its owner's permissions."
            ),
            help_url="https://docs.datadoghq.com/account_management/api-app-keys/#scopes",
        ),
    ]

    output_schema = [
        OutputSchemaField(
            id="key_id",
            label="Key ID",
            masked=False,
            help_text="The Datadog key ID, used to revoke the key.",
        ),
        OutputSchemaField(
            id="key",
            label="Key",
            masked=True,
            help_text="The minted Datadog API key or application key.",
        ),
    ]

    @classmethod
    def validate_config(cls, config: dict) -> None:
        key_type = config.get("key_type", DEFAULT_KEY_TYPE)
        if not isinstance(key_type, str) or key_type not in _KEY_RESOURCES:
            raise ProviderConfigError(
                f"Unsupported key_type: {key_type!r}",
                user_message="Key type must be api_key or application_key.",
            )
        template = config.get("name_template", DEFAULT_NAME_TEMPLATE)
        if not isinstance(template, str):
            raise ProviderConfigError(
                "name_template must be a string",
                user_message="Key name template must be a string.",
            )
        if "{id}" not in template:
            # Datadog requires API key names to be unique in the org.
            raise ProviderConfigError(
                "name_template must contain '{id}'",
                user_message="Key name template must include {id}.",
            )
        try:
            template.format(id="0")
        except (AttributeError, IndexError, KeyError, ValueError) as e:
            raise ProviderConfigError(
                f"name_template is not a valid template: {e}",
                user_message="Key name template can only use the {id} placeholder.",
            ) from e
        scopes = config.get("scopes") or []
        if not isinstance(scopes, list) or not all(
            isinstance(scope, str) and scope.strip() for scope in scopes
        ):
            raise ProviderConfigError(
                "scopes must be a list of strings",
                user_message="Scopes must be a list of Datadog permission names.",
            )
        if scopes and key_type != "application_key":
            raise ProviderConfigError(
                "scopes only apply to application keys",
                user_message=(
                    "Scopes only apply to application keys. Clear them or set "
                    "the key type to application_key."
                ),
            )

    @classmethod
    def validate_root_credentials(cls, root_creds: dict) -> bool:
        # Same probe as the Datadog log stream; it checks only the API key.
        try:
            request(
                "GET",
                f"{_api_base(root_creds)}/api/v1/validate",
                headers={"DD-API-KEY": _api_key(root_creds)},
            )
            return True
        except Exception:
            return False

    @classmethod
    def mint(
        cls,
        root_creds: dict,
        config: dict,
        *,
        caller_id: str,
    ) -> MintResult:
        cls.validate_config(config)
        key_type = config.get("key_type", DEFAULT_KEY_TYPE)
        resource_type, path = _KEY_RESOURCES[key_type]
        base = _api_base(root_creds)
        headers = _management_headers(root_creds)
        template = config.get("name_template", DEFAULT_NAME_TEMPLATE)
        name = template.format(id=f"{caller_id}-{int(time.time())}")

        attributes: dict = {"name": name}
        scopes = config.get("scopes") or []
        if scopes:
            attributes["scopes"] = scopes

        response = request(
            "POST",
            f"{base}{path}",
            headers=headers,
            json={"data": {"type": resource_type, "attributes": attributes}},
        )
        try:
            data = response.json()["data"]
            key_id = data["id"]
            key = data["attributes"]["key"]
            if not all(isinstance(v, str) and v for v in (key_id, key)):
                raise ValueError("missing key or key ID")
        except (KeyError, TypeError, ValueError) as e:
            # The body may hold the new key, so it stays out of the error.
            raise ProviderConfigError(
                "Unexpected Datadog key create response",
                user_message=(
                    f"Datadog returned an unexpected response when creating key "
                    f"'{name}'. Delete it in Datadog if it exists."
                ),
                raw=call_summary(response),
            ) from e

        return MintResult(
            provider_credential_id=_encode_provider_id(key_type, key_id),
            values={"key_id": key_id, "key": key},
            metadata={
                "name": name,
                "type": key_type,
                "key_id": key_id,
                "display_id": key_id,
                "call": call_summary(response),
            },
        )

    @classmethod
    def revoke(cls, root_creds: dict, provider_credential_id: str) -> dict | None:
        key_type, key_id = _decode_provider_id(provider_credential_id)
        _, path = _KEY_RESOURCES[key_type]
        response = request(
            "DELETE",
            f"{_api_base(root_creds)}{path}/{key_id}",
            headers=_management_headers(root_creds),
        )
        return {"type": key_type, "key_id": key_id, "call": call_summary(response)}
