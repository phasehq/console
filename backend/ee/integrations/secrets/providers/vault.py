"""HashiCorp Vault credential provider that rotates AppRole secret IDs."""

from __future__ import annotations

import json
import re
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

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

DEFAULT_MOUNT_PATH = "approle"

# Vault routes AppRole role names through its GenericNameRegex.
_ROLE_NAME_RE = re.compile(r"\w(?:[\w.-]*\w)?", re.ASCII)
_MAX_ROLE_NAME_LEN = 4095
_MOUNT_PATH_RE = re.compile(r"[\w.-]+(?:/[\w.-]+)*", re.ASCII)
_TTL_RE = re.compile(r"(\d+)([smhd]?)", re.ASCII)
_TTL_UNIT_SECONDS = {"": 1, "s": 1, "m": 60, "h": 3600, "d": 86400}
# Vault answers 500 (or 403) instead of 404 once a secret ID or its role is gone.
_GONE_RE = re.compile(
    r"failed to find accessor entry|invalid secret id accessor|role \S+ does not exist"
)
_REVOKE_SELF_TIMEOUT = (5, 10)

_PROVIDER_ID_SEP = ":"


def _is_mount_path(mount: str) -> bool:
    return (
        bool(_MOUNT_PATH_RE.fullmatch(mount))
        and ".." not in mount
        and "." not in mount.split("/")
    )


def _is_role_name(role: str) -> bool:
    return len(role) <= _MAX_ROLE_NAME_LEN and bool(_ROLE_NAME_RE.fullmatch(role))


def _encode_provider_id(mount: str, role: str, accessor: str) -> str:
    return _PROVIDER_ID_SEP.join((mount, role, accessor))


def _decode_provider_id(provider_credential_id: str) -> tuple[str, str, str]:
    # Role names can't contain ":" and accessors are UUIDs.
    parts = provider_credential_id.rsplit(_PROVIDER_ID_SEP, 2)
    if (
        len(parts) != 3
        or not _is_mount_path(parts[0])
        or not _is_role_name(parts[1])
        or not parts[2]
    ):
        raise ProviderConfigError(
            f"Malformed provider credential ID: {provider_credential_id!r}",
            user_message=(
                "This credential's provider ID isn't in the mount:role:accessor "
                "format. Destroy the secret ID manually in Vault."
            ),
        )
    mount, role, accessor = parts
    return mount, role, accessor


def _mount_path(config: dict) -> str:
    mount = config.get("mount_path") or DEFAULT_MOUNT_PATH
    if isinstance(mount, str):
        mount = mount.strip().strip("/") or DEFAULT_MOUNT_PATH
        if _is_mount_path(mount):
            return mount
    raise ProviderConfigError(
        "Invalid mount_path",
        user_message=(
            "Mount path may only use letters, digits, '_', '-', '.' and '/', "
            "and can't contain '..'."
        ),
    )


def _role_name(config: dict) -> str:
    role = config.get("role_name")
    if isinstance(role, str) and _is_role_name(role.strip()):
        return role.strip()
    raise ProviderConfigError(
        "Invalid role_name",
        user_message=(
            "Pick an AppRole role. Role names use letters, digits, '_', '-' and "
            "'.', and start and end with a letter, digit or '_'."
        ),
    )


def _secret_id_ttl(config: dict) -> int | None:
    ttl = config.get("secret_id_ttl")
    if ttl is None or (isinstance(ttl, str) and not ttl.strip()):
        return None
    seconds = 0
    if isinstance(ttl, int) and not isinstance(ttl, bool):
        seconds = ttl
    elif isinstance(ttl, str) and (match := _TTL_RE.fullmatch(ttl.strip())):
        seconds = int(match[1]) * _TTL_UNIT_SECONDS[match[2]]
    if seconds < 1:
        raise ProviderConfigError(
            f"Invalid secret_id_ttl: {ttl!r}",
            user_message=(
                "Secret ID TTL must be a positive whole number with an optional "
                "s, m, h or d suffix, e.g. 720h."
            ),
        )
    return seconds


def _vault_addr(root_creds: dict) -> str:
    addr = (root_creds.get("vault_addr") or "").strip().rstrip("/")
    if not addr:
        raise ProviderConfigError(
            "vault_addr is missing",
            user_message="The Vault address is missing from the root credentials.",
        )
    return addr


def _headers(root_creds: dict, token: str | None = None) -> dict:
    headers = {}
    namespace = (root_creds.get("vault_namespace") or "").strip()
    if namespace:
        headers["X-Vault-Namespace"] = namespace
    if token:
        headers["X-Vault-Token"] = token
    return headers


def _vault_error(error: ProviderError) -> str:
    """Vault's error messages from a failed call's body, or '' if there are none."""
    body = error.raw.get("body") if isinstance(error.raw, dict) else None
    try:
        messages = json.loads(body)["errors"]
    except (KeyError, TypeError, ValueError):
        return ""
    if not isinstance(messages, list):
        return ""
    return "; ".join(" ".join(str(m).split()) for m in messages)


def _login(addr: str, root_creds: dict) -> str:
    try:
        response = request(
            "POST",
            f"{addr}/v1/auth/{DEFAULT_MOUNT_PATH}/login",
            headers=_headers(root_creds),
            json={
                "role_id": root_creds.get("vault_role_id") or "",
                "secret_id": root_creds.get("vault_secret_id") or "",
            },
        )
    except ProviderError as e:
        # A login 404 must not reach revoke(), which treats ProviderNotFound as done.
        if e.retryable or not isinstance(e.raw, dict) or "status" not in e.raw:
            raise
        detail = _vault_error(e) or f"HTTP {e.raw['status']}"
        raise ProviderAuthError(
            f"Vault AppRole login failed: {e}",
            user_message=(
                f"Vault rejected Phase's AppRole login ({detail}). Update the "
                "root credentials and resume rotation."
            ),
            raw=e.raw,
        ) from e
    try:
        token = response.json()["auth"]["client_token"]
    except (KeyError, TypeError, ValueError):
        token = None
    if not isinstance(token, str) or not token:
        raise ProviderConfigError(
            "Vault AppRole login returned no client token",
            user_message="Vault's AppRole login returned no token.",
        )
    return token


@contextmanager
def _session(root_creds: dict) -> Iterator[tuple[str, dict]]:
    addr = _vault_addr(root_creds)
    headers = _headers(root_creds, _login(addr, root_creds))
    try:
        yield addr, headers
    finally:
        # Best effort, so Phase's login tokens don't linger until their TTL.
        try:
            request(
                "POST",
                f"{addr}/v1/auth/token/revoke-self",
                headers=headers,
                timeout=_REVOKE_SELF_TIMEOUT,
            )
        except Exception:
            pass


def _vault_call(
    method: str, addr: str, path: str, headers: dict, capability: str, **kwargs
):
    try:
        return request(method, f"{addr}/v1/{path}", headers=headers, **kwargs)
    except ProviderAuthError as e:
        raise ProviderAuthError(
            str(e),
            user_message=(
                f"Vault denied {capability} on {path}. Add it to Phase's AppRole "
                "policy."
            ),
            raw=e.raw,
        ) from e


def _fields(response, action: str, *keys: str) -> list[str]:
    try:
        data = response.json()["data"]
        values = [data[key] for key in keys]
    except (KeyError, TypeError, ValueError):
        values = []
    if len(values) != len(keys) or not all(isinstance(v, str) and v for v in values):
        # Never echo the body: it may hold the secret ID.
        raise ProviderConfigError(
            f"Unexpected Vault response when {action}",
            user_message=f"Vault returned an unexpected response when {action}.",
        )
    return values


class VaultProvider(CredentialProvider):
    id = "hashicorp_vault"
    name = "HashiCorp Vault"
    key_name_prefix = "VAULT"
    credential_id_label = "Secret ID accessor"

    credential_schema = [
        CredentialSchemaField(
            id="vault_addr",
            label="Vault Address",
            required=True,
            help_text="Base URL of your Vault server, e.g. https://vault.example.com:8200.",
        ),
        CredentialSchemaField(
            id="vault_role_id",
            label="Role ID",
            required=True,
            help_text=(
                "Role ID of the AppRole Phase logs in with at auth/approle. To "
                "rotate a role's secret IDs, its policy needs update on "
                "auth/<mount>/role/<role>/secret-id and "
                "auth/<mount>/role/<role>/secret-id-accessor/destroy, read on "
                "auth/<mount>/role/<role>/role-id, and list on "
                "auth/<mount>/role for the role picker."
            ),
        ),
        CredentialSchemaField(
            id="vault_secret_id",
            label="Secret ID",
            required=True,
            masked=True,
            help_text=(
                "Secret ID for Phase's AppRole. Phase logs in once per operation, "
                "so use a secret ID without a TTL or use limit, or replace it "
                "before it runs out."
            ),
        ),
        CredentialSchemaField(
            id="vault_namespace",
            label="Namespace",
            required=False,
            help_text=(
                "Vault Enterprise or HCP Vault namespace, e.g. admin. Leave empty "
                "for the root namespace."
            ),
        ),
    ]

    config_schema = [
        ConfigSchemaField(
            id="mount_path",
            label="Mount Path",
            required=False,
            default=DEFAULT_MOUNT_PATH,
            help_text=(
                "Path of the AppRole auth method that holds the role, without the "
                "auth/ prefix."
            ),
        ),
        ConfigSchemaField(
            id="role_name",
            label="Role",
            required=True,
            resource_type="approle_role",
            depends_on=["mount_path"],
            help_text=(
                "The AppRole role whose secret IDs Phase rotates. Apps log in with "
                "its role ID and the current secret ID."
            ),
        ),
        ConfigSchemaField(
            id="secret_id_ttl",
            label="Secret ID TTL",
            required=False,
            help_text=(
                "Lifetime of each secret ID, e.g. 720h or 30d. It must outlive the "
                "rotation interval plus the revocation delay. The role's "
                "secret_id_ttl caps it: Vault rejects longer values. Leave empty "
                "to use the role's secret_id_ttl. Needs Vault 1.12+; older "
                "versions ignore it."
            ),
        ),
    ]

    output_schema = [
        OutputSchemaField(
            id="role_id",
            label="Role ID",
            masked=False,
            help_text="Role ID of the rotated role. It stays the same across rotations.",
        ),
        OutputSchemaField(
            id="secret_id_accessor",
            label="Secret ID Accessor",
            masked=False,
            help_text="Accessor of the current secret ID, used to look it up or destroy it.",
        ),
        OutputSchemaField(
            id="secret_id",
            label="Secret ID",
            masked=True,
            help_text="The secret ID apps use with the role ID to log in to Vault.",
        ),
    ]

    @classmethod
    def validate_config(cls, config: dict) -> None:
        _mount_path(config)
        _role_name(config)
        _secret_id_ttl(config)

    @classmethod
    def validate_root_credentials(cls, root_creds: dict) -> bool:
        try:
            with _session(root_creds):
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
        if resource_type != "approle_role":
            return super().list_resources(root_creds, resource_type, config)
        mount = _mount_path(config or {})
        with _session(root_creds) as (addr, headers):
            try:
                # Vault returns every role in one response; LIST isn't paginated.
                response = _vault_call(
                    "GET",
                    addr,
                    f"auth/{mount}/role",
                    headers,
                    "list",
                    params={"list": "true"},
                )
            except ProviderNotFound as e:
                # An empty LIST is a 404 with no error message.
                if not _vault_error(e):
                    return []
                raise ProviderConfigError(
                    str(e),
                    user_message=f"Vault has no AppRole auth method at auth/{mount}.",
                    raw=e.raw,
                ) from e
        try:
            keys = response.json()["data"]["keys"]
        except (KeyError, TypeError, ValueError):
            keys = None
        if not isinstance(keys, list):
            raise ProviderConfigError(
                "Unexpected Vault role list response",
                user_message="Vault returned an unexpected response when listing roles.",
            )
        return [ResourceOption(id=k, name=k) for k in keys if isinstance(k, str) and k]

    @classmethod
    def mint(
        cls,
        root_creds: dict,
        config: dict,
        *,
        caller_id: str,
    ) -> MintResult:
        mount = _mount_path(config)
        role = _role_name(config)
        ttl = _secret_id_ttl(config)
        role_path = f"auth/{mount}/role/{role}"
        # Vault copies this onto tokens issued with the secret ID and into audit logs.
        payload: dict[str, Any] = {
            "metadata": json.dumps({"phase_rotating_secret": caller_id})
        }
        if ttl:
            payload["ttl"] = ttl

        with _session(root_creds) as (addr, headers):
            try:
                (role_id,) = _fields(
                    _vault_call("GET", addr, f"{role_path}/role-id", headers, "read"),
                    "reading the role ID",
                    "role_id",
                )
                response = _vault_call(
                    "POST",
                    addr,
                    f"{role_path}/secret-id",
                    headers,
                    "update",
                    json=payload,
                )
            except ProviderNotFound as e:
                raise ProviderConfigError(
                    str(e),
                    user_message=f"Vault has no AppRole role '{role}' at auth/{mount}.",
                    raw=e.raw,
                ) from e

        secret_id, accessor = _fields(
            response, "generating a secret ID", "secret_id", "secret_id_accessor"
        )
        body = response.json()
        metadata: dict[str, Any] = {
            "mount_path": mount,
            "role_name": role,
            "accessor": accessor,
            "display_id": accessor,
            "ttl": body["data"].get("secret_id_ttl"),
            "num_uses": body["data"].get("secret_id_num_uses"),
            "call": call_summary(response),
        }
        # Vault before 1.12 ignores `ttl` and says so in a warning.
        if body.get("warnings"):
            metadata["warnings"] = body["warnings"]

        return MintResult(
            provider_credential_id=_encode_provider_id(mount, role, accessor),
            values={
                "role_id": role_id,
                "secret_id_accessor": accessor,
                "secret_id": secret_id,
            },
            metadata=metadata,
        )

    @classmethod
    def revoke(cls, root_creds: dict, provider_credential_id: str) -> dict | None:
        mount, role, accessor = _decode_provider_id(provider_credential_id)
        path = f"auth/{mount}/role/{role}/secret-id-accessor/destroy"
        with _session(root_creds) as (addr, headers):
            try:
                response = _vault_call(
                    "POST",
                    addr,
                    path,
                    headers,
                    "update",
                    json={"secret_id_accessor": accessor},
                )
            except ProviderError as e:
                if not _GONE_RE.search(_vault_error(e)):
                    raise
                raise ProviderNotFound(
                    str(e),
                    user_message="The secret ID no longer exists in Vault.",
                    raw=e.raw,
                ) from e
        return {
            "mount_path": mount,
            "role_name": role,
            "accessor": accessor,
            "call": call_summary(response),
        }
