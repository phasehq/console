"""HashiCorp Nomad credential provider that mints client ACL tokens."""

from __future__ import annotations

import re
import time
from typing import Any

import requests

from .base import (
    ConfigSchemaField,
    CredentialProvider,
    CredentialSchemaField,
    MintResult,
    OutputSchemaField,
    ResourceOption,
)
from .exceptions import (
    ProviderAuthError,
    ProviderConfigError,
    ProviderError,
    ProviderNotFound,
)
from .http import call_summary, request

DEFAULT_NAME_TEMPLATE = "phase-rs-{id}"

# Nomad only issues and accepts UUID accessor IDs.
_ACCESSOR_ID_RE = re.compile(
    r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.IGNORECASE
)
# Go time.ParseDuration syntax, which Nomad uses to parse ExpirationTTL.
_DURATION_RE = re.compile(r"(?:\d+(?:\.\d+)?(?:ns|us|ms|s|m|h))+")
_RESOURCE_PATHS = {
    "acl_policy": "/v1/acl/policies",
    "acl_role": "/v1/acl/roles",
}
_MAX_PAGES = 50
_UNEXPECTED_TOKEN_RESPONSE = (
    "Nomad returned an unexpected response shape when creating the ACL token."
)


def _encode_provider_id(accessor_id: Any) -> str:
    # The accessor ID is enough: Nomad forwards global-token deletes itself.
    if not isinstance(accessor_id, str) or not _ACCESSOR_ID_RE.fullmatch(accessor_id):
        raise ProviderConfigError(
            "Nomad returned a malformed accessor ID",
            user_message=_UNEXPECTED_TOKEN_RESPONSE,
        )
    return accessor_id


def _decode_provider_id(provider_credential_id: str) -> str:
    if not isinstance(provider_credential_id, str) or not _ACCESSOR_ID_RE.fullmatch(
        provider_credential_id
    ):
        raise ProviderConfigError(
            f"Malformed provider credential ID: {provider_credential_id!r}",
            user_message=(
                "This credential's Nomad accessor ID is malformed. Delete the "
                "token in Nomad manually."
            ),
        )
    return provider_credential_id


def _names(config: dict, field: str) -> list[str]:
    value = config.get(field) or []
    if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
        raise ProviderConfigError(
            f"{field} must be a list of names",
            user_message=f"ACL {field} must be a list of names.",
        )
    return [v.strip() for v in value if v.strip()]


def _expiration_ttl(config: dict) -> str | None:
    value = config.get("expiration_ttl")
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    if not isinstance(value, str) or not _DURATION_RE.fullmatch(value.strip()):
        raise ProviderConfigError(
            f"expiration_ttl must be a Go duration, got {value!r}",
            user_message="Expiration TTL must be a duration such as 24h or 90m.",
        )
    return value.strip()


def _global_token(config: dict) -> bool:
    value = config.get("global_token")
    if value is None:
        return False
    if not isinstance(value, bool):
        raise ProviderConfigError(
            "global_token must be a boolean",
            user_message="Global token must be on or off.",
        )
    return value


def _base_url(root_creds: dict) -> str:
    return root_creds["nomad_addr"].strip().rstrip("/")


def _headers(root_creds: dict) -> dict:
    # Same auth header as the Nomad sync integration.
    return {"Authorization": f"Bearer {root_creds['nomad_token_secret'].strip()}"}


def _error_text(error: ProviderError) -> str:
    raw = error.raw if isinstance(error.raw, dict) else {}
    return " ".join(str(raw.get("body") or "").split())[:300]


def _call(method: str, root_creds: dict, path: str, **kwargs) -> requests.Response:
    try:
        return request(
            method,
            f"{_base_url(root_creds)}{path}",
            headers=_headers(root_creds),
            **kwargs,
        )
    except (ProviderAuthError, ProviderConfigError, ProviderNotFound) as e:
        # Nomad errors are plain text, and the shared helper only parses JSON.
        text = _error_text(e)
        if text and text[0] not in "{[<":
            hint = (
                " Rotation needs a valid Nomad management token."
                if isinstance(e, ProviderAuthError)
                else ""
            )
            e.user_message = (
                f"Nomad returned an error ({e.raw.get('status')}): "
                f"{text.rstrip('.')}.{hint}"
            )
        raise


def _list_all(root_creds: dict, path: str) -> list:
    items: list = []
    params: dict | None = None
    # Hard ceiling so a server that keeps paging can't loop forever.
    for _ in range(_MAX_PAGES):
        response = _call("GET", root_creds, path, params=params)
        try:
            page = response.json()
        except ValueError:
            page = None
        if not isinstance(page, list):
            raise ProviderConfigError(
                f"Unexpected Nomad response from GET {path}",
                user_message="Nomad returned an unexpected response shape.",
            )
        items.extend(page)
        next_token = response.headers.get("X-Nomad-Nexttoken")
        if not next_token:
            break
        params = {"next_token": next_token}
    return items


class NomadProvider(CredentialProvider):
    id = "hashicorp_nomad"
    name = "HashiCorp Nomad"
    key_name_prefix = "NOMAD"
    credential_id_label = "Accessor ID"

    credential_schema = [
        CredentialSchemaField(
            id="nomad_addr",
            label="Nomad Address",
            required=True,
            help_text=(
                "Base URL of the Nomad HTTP API, with scheme and port "
                "(e.g., https://nomad.example.com:4646)."
            ),
        ),
        CredentialSchemaField(
            id="nomad_token_secret",
            label="Management Token Secret ID",
            required=True,
            masked=True,
            help_text=(
                "Secret ID of a Nomad management token. Nomad only lets "
                "management tokens create and delete ACL tokens; no ACL policy "
                "can grant this to a client token."
            ),
        ),
    ]

    config_schema = [
        ConfigSchemaField(
            id="name_template",
            label="Token Name Template",
            required=False,
            default=DEFAULT_NAME_TEMPLATE,
            help_text=(
                "A template for the minted ACL token's name. {id} is replaced "
                "with the caller ID and a timestamp."
            ),
        ),
        ConfigSchemaField(
            id="policies",
            label="ACL Policies",
            required=False,
            field_type="list",
            default=[],
            resource_type="acl_policy",
            help_text=(
                "ACL policies to attach to each minted client token. Pick at "
                "least one policy or role."
            ),
        ),
        ConfigSchemaField(
            id="roles",
            label="ACL Roles",
            required=False,
            field_type="list",
            default=[],
            resource_type="acl_role",
            help_text=(
                "ACL roles to link to each minted client token (Nomad 1.4+). "
                "Pick at least one policy or role."
            ),
        ),
        ConfigSchemaField(
            id="expiration_ttl",
            label="Expiration TTL",
            required=False,
            help_url=(
                "https://developer.hashicorp.com/nomad/docs/configuration/acl"
                "#token_max_expiration_ttl"
            ),
            help_text=(
                "Optional token lifetime as a duration, e.g. 24h or 90m. Keep it "
                "longer than the rotation interval plus the revocation delay. "
                "Nomad rejects TTLs outside its token_min_expiration_ttl and "
                "token_max_expiration_ttl (1m and 24h by default). Leave empty "
                "for tokens that last until revoked."
            ),
        ),
        ConfigSchemaField(
            id="global_token",
            label="Global Token",
            required=False,
            field_type="bool",
            default=False,
            help_text=(
                "Replicate the token to all federated regions. Otherwise it "
                "only works in the region that created it."
            ),
        ),
    ]

    output_schema = [
        OutputSchemaField(
            id="accessor_id",
            label="Accessor ID",
            masked=False,
            help_text="The token's public accessor ID, used to revoke it.",
        ),
        OutputSchemaField(
            id="token",
            label="Token",
            masked=True,
            help_text=(
                "The token's secret ID. Consumers send it as NOMAD_TOKEN or in "
                "the X-Nomad-Token header."
            ),
        ),
    ]

    @classmethod
    def validate_config(cls, config: dict) -> None:
        template = config.get("name_template", DEFAULT_NAME_TEMPLATE)
        if not isinstance(template, str) or "{id}" not in template:
            raise ProviderConfigError(
                "name_template must be a string containing '{id}'",
                user_message="Token name template must include {id}.",
            )
        try:
            template.format(id="x")
        except (AttributeError, IndexError, KeyError, ValueError) as e:
            raise ProviderConfigError(
                f"name_template is not a valid template: {e}",
                user_message="Token name template can only use the {id} placeholder.",
            ) from e
        # Nomad rejects client tokens with neither policies nor roles.
        if not _names(config, "policies") and not _names(config, "roles"):
            raise ProviderConfigError(
                "At least one ACL policy or role is required",
                user_message="Pick at least one ACL policy or role for the token.",
            )
        _expiration_ttl(config)
        _global_token(config)

    @classmethod
    def validate_root_credentials(cls, root_creds: dict) -> bool:
        try:
            _call("GET", root_creds, "/v1/acl/token/self")
            return True
        except Exception:
            return False

    @classmethod
    def list_resources(
        cls,
        root_creds: dict,
        resource_type: str,
        config: dict | None = None,
    ) -> list[ResourceOption]:
        path = _RESOURCE_PATHS.get(resource_type)
        if path is None:
            return super().list_resources(root_creds, resource_type, config)
        options = [
            ResourceOption(
                id=item["Name"],
                name=item["Name"],
                description=str(item.get("Description") or ""),
            )
            for item in _list_all(root_creds, path)
            if isinstance(item, dict)
            and isinstance(item.get("Name"), str)
            and item["Name"]
        ]
        return sorted(options, key=lambda option: option.name.lower())

    @classmethod
    def mint(
        cls,
        root_creds: dict,
        config: dict,
        *,
        caller_id: str,
    ) -> MintResult:
        template = config.get("name_template", DEFAULT_NAME_TEMPLATE)
        name = template.format(id=f"{caller_id}-{int(time.time())}")
        policies = _names(config, "policies")
        roles = _names(config, "roles")
        global_token = _global_token(config)

        payload: dict[str, Any] = {
            "Name": name,
            "Type": "client",
            "Policies": policies,
            "Global": global_token,
        }
        if roles:
            # Nomad resolves role names to IDs when it creates the token.
            payload["Roles"] = [{"Name": role} for role in roles]
        ttl = _expiration_ttl(config)
        if ttl:
            payload["ExpirationTTL"] = ttl

        response = _call("POST", root_creds, "/v1/acl/token", json=payload)
        try:
            body = response.json()
            accessor_id = body["AccessorID"]
            secret_id = body["SecretID"]
            if not isinstance(secret_id, str) or not secret_id:
                raise ValueError("SecretID is empty")
        except (KeyError, TypeError, ValueError) as e:
            # No response body in the error: it holds the token's SecretID.
            raise ProviderConfigError(
                "Unexpected Nomad ACL token response",
                user_message=_UNEXPECTED_TOKEN_RESPONSE,
            ) from e
        expiration_time = body.get("ExpirationTime")

        return MintResult(
            provider_credential_id=_encode_provider_id(accessor_id),
            values={"accessor_id": accessor_id, "token": secret_id},
            metadata={
                "name": name,
                "policies": policies,
                "roles": roles,
                "expiration_time": (
                    expiration_time if isinstance(expiration_time, str) else None
                ),
                "global": global_token,
                "call": call_summary(response),
            },
        )

    @classmethod
    def revoke(cls, root_creds: dict, provider_credential_id: str) -> dict | None:
        accessor_id = _decode_provider_id(provider_credential_id)
        try:
            response = _call("DELETE", root_creds, f"/v1/acl/token/{accessor_id}")
        except ProviderNotFound as e:
            # Nomad never 404s on this route, so a 404 means a wrong address.
            raise ProviderConfigError(
                str(e),
                user_message=(
                    "Nomad's token endpoint returned 404, so the token was not "
                    "revoked. Check the Nomad address."
                ),
                raw=e.raw,
            ) from e
        except ProviderConfigError as e:
            # Nomad answers an unknown accessor with 400, not 404.
            if "cannot delete nonexistent tokens" in _error_text(e).lower():
                raise ProviderNotFound(
                    str(e),
                    user_message="ACL token not found in Nomad.",
                    raw=e.raw,
                ) from e
            raise
        return {"accessor_id": accessor_id, "call": call_summary(response)}
