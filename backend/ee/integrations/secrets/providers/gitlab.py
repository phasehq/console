"""GitLab credential provider that mints project and group access tokens."""

from __future__ import annotations

import time
from datetime import date, datetime, timedelta, timezone
from string import Formatter
from typing import Any
from urllib.parse import quote

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
    ProviderTransientError,
)
from .http import call_summary, request

TARGET_TYPES = ("project", "group")
_COLLECTIONS = {"project": "projects", "group": "groups"}

ACCESS_LEVELS = {
    "guest": 10,
    "planner": 15,
    "reporter": 20,
    "security_manager": 25,
    "developer": 30,
    "maintainer": 40,
    "owner": 50,
}

PROJECT_SCOPES = (
    "api",
    "read_api",
    "read_repository",
    "write_repository",
    "read_registry",
    "write_registry",
    "create_runner",
    "manage_runner",
    "ai_features",
    "k8s_proxy",
    "self_rotate",
)
GROUP_SCOPES = PROJECT_SCOPES + ("read_virtual_registry", "write_virtual_registry")

DEFAULT_NAME_TEMPLATE = "phase-rs-{id}"
DEFAULT_LIFETIME_DAYS = 365
# GitLab caps lifetimes at 365 days, or 400 with buffered_token_expiration_limit.
MAX_LIFETIME_DAYS = 400

_PROVIDER_ID_SEP = ":"
_MAX_PAGES = 50


def _is_digits(value: str) -> bool:
    return value.isascii() and value.isdigit()


def _encode_provider_id(target_type: str, target_id: str, token_id: str) -> str:
    return _PROVIDER_ID_SEP.join((target_type, target_id, token_id))


def _decode_provider_id(provider_credential_id: str) -> tuple[str, str, str]:
    parts = provider_credential_id.split(_PROVIDER_ID_SEP, 2)
    if (
        len(parts) != 3
        or parts[0] not in TARGET_TYPES
        or not parts[1]
        or not _is_digits(parts[2])
    ):
        raise ProviderConfigError(
            f"Malformed provider credential ID: {provider_credential_id!r}",
            user_message=(
                "This credential's provider ID isn't in the "
                "<project|group>:<ID or path>:<token ID> format. Revoke the "
                "token manually in GitLab."
            ),
        )
    return parts[0], parts[1], parts[2]


def _api_base(root_creds: dict) -> str:
    return f"{root_creds['gitlab_host'].rstrip('/')}/api/v4"


def _headers(root_creds: dict) -> dict:
    return {"PRIVATE-TOKEN": root_creds["gitlab_token"]}


def _target_url(root_creds: dict, target_type: str, target_id: str) -> str:
    # Namespaced paths must be URL-encoded, e.g. group%2Fproject.
    return (
        f"{_api_base(root_creds)}/{_COLLECTIONS[target_type]}/"
        f"{quote(target_id, safe='')}"
    )


def _target_type(config: dict) -> str:
    return config.get("target_type") or "project"


def _template_is_valid(template: str) -> bool:
    try:
        placeholders = [
            (field_name, spec, conversion)
            for _, field_name, spec, conversion in Formatter().parse(template)
            if field_name is not None
        ]
    except ValueError:
        return False
    return bool(placeholders) and all(p == ("id", "", None) for p in placeholders)


def _utc_today() -> date:
    # GitLab checks the lifetime cap against its own date, which is UTC by default.
    return datetime.now(timezone.utc).date()


def _unexpected_mint_response(body: Any) -> ProviderConfigError:
    # The body can hold the new token, so report only its shape.
    shape = sorted(body) if isinstance(body, dict) else type(body).__name__
    return ProviderConfigError(
        f"Unexpected GitLab access token response: {shape}",
        user_message=(
            "GitLab returned an unexpected response shape when creating the "
            "access token."
        ),
        raw={"response_fields": shape},
    )


class GitLabProvider(CredentialProvider):
    id = "gitlab"
    name = "GitLab"
    key_name_prefix = "GITLAB"
    credential_id_label = "Access token ID"

    credential_schema = [
        CredentialSchemaField(
            id="gitlab_host",
            label="GitLab Host",
            required=True,
            help_text=(
                "Base URL of your GitLab instance, including the scheme "
                "(e.g., https://gitlab.com or https://gitlab.example.com)."
            ),
        ),
        CredentialSchemaField(
            id="gitlab_token",
            label="GitLab Token",
            required=True,
            masked=True,
            help_text=(
                "A personal or service account access token with the api scope. "
                "Its user needs the Maintainer or Owner role on target projects "
                "and the Owner role on target groups. Project and group access "
                "tokens can't create other tokens. On GitLab.com, project and "
                "group access tokens need a Premium or Ultimate plan."
            ),
        ),
    ]

    config_schema = [
        ConfigSchemaField(
            id="target_type",
            label="Token Type",
            required=True,
            default="project",
            choices=list(TARGET_TYPES),
            help_text="Mint project access tokens or group access tokens.",
        ),
        ConfigSchemaField(
            id="target_id",
            label="Project or group",
            required=True,
            resource_type="gitlab_target",
            depends_on=["target_type"],
            help_text=(
                "The project or group that owns the access tokens. Lists "
                "projects where the root token's user is a Maintainer and "
                "groups where it is an Owner."
            ),
        ),
        ConfigSchemaField(
            id="name_template",
            label="Token Name Template",
            required=False,
            default=DEFAULT_NAME_TEMPLATE,
            help_text=(
                "A template for the access token's name. {id} is replaced with "
                "the caller ID and a timestamp."
            ),
        ),
        ConfigSchemaField(
            id="scopes",
            label="Scopes",
            required=True,
            field_type="list",
            choices=list(GROUP_SCOPES),
            help_text=(
                "Scopes granted to each token. read_virtual_registry and "
                "write_virtual_registry are for group tokens only."
            ),
            help_url="https://docs.gitlab.com/security/tokens/access_token_scopes/",
        ),
        ConfigSchemaField(
            id="access_level",
            label="Role",
            required=True,
            choices=list(ACCESS_LEVELS),
            help_text=(
                "The role of each token's bot user. It can't be higher than the "
                "root token user's role, and only Owners can assign planner or "
                "security_manager."
            ),
        ),
        ConfigSchemaField(
            id="token_lifetime_days",
            label="Token Lifetime (days)",
            required=False,
            field_type="int",
            default=DEFAULT_LIFETIME_DAYS,
            help_text=(
                "Days until GitLab expires each token. Keep it longer than the "
                "rotation interval plus the revocation delay. GitLab allows up "
                "to 365 days (400 with the extended limit) unless an admin set "
                "a lower limit."
            ),
            help_url=(
                "https://docs.gitlab.com/user/project/settings/"
                "project_access_tokens/#access-token-expiration"
            ),
        ),
    ]

    # Order: identifiers first, the actual secret last (matches the dynamic-
    # secret convention so the sensitive value sits at the bottom of UIs).
    output_schema = [
        OutputSchemaField(
            id="token_id",
            label="Token ID",
            masked=False,
            help_text="The GitLab access token ID used for revocation.",
        ),
        OutputSchemaField(
            id="token",
            label="Access Token",
            masked=True,
            help_text="The project or group access token consumers use against GitLab.",
        ),
    ]

    @classmethod
    def validate_config(cls, config: dict) -> None:
        target_type = _target_type(config)
        if target_type not in TARGET_TYPES:
            raise ProviderConfigError(
                f"Invalid target_type: {target_type!r}",
                user_message="Token type must be 'project' or 'group'.",
            )

        target_id = config.get("target_id")
        if not isinstance(target_id, str) or not target_id.strip():
            raise ProviderConfigError(
                "target_id is required and must be a string",
                user_message=f"Pick a GitLab {target_type} to mint access tokens in.",
            )
        if _PROVIDER_ID_SEP in target_id:
            # The ID is packed into provider_credential_id, which splits on ':'.
            raise ProviderConfigError(
                "target_id must not contain ':'",
                user_message=f"The GitLab {target_type} ID or path can't contain ':'.",
            )

        template = config.get("name_template", DEFAULT_NAME_TEMPLATE)
        if not isinstance(template, str):
            raise ProviderConfigError(
                "name_template must be a string",
                user_message="Token name template must be a string.",
            )
        if not _template_is_valid(template):
            raise ProviderConfigError(
                "name_template must contain '{id}' and no other placeholders",
                user_message=(
                    "Token name template must include {id} and no other "
                    "{placeholders}."
                ),
            )

        scopes = config.get("scopes")
        if not isinstance(scopes, list) or not scopes:
            raise ProviderConfigError(
                "scopes must be a non-empty list",
                user_message="Pick at least one scope for the access token.",
            )
        allowed = GROUP_SCOPES if target_type == "group" else PROJECT_SCOPES
        invalid = [scope for scope in scopes if scope not in allowed]
        if invalid:
            raise ProviderConfigError(
                f"Invalid scopes for a {target_type} access token: {invalid!r}",
                user_message=(
                    f"These scopes aren't available for GitLab {target_type} "
                    f"access tokens: {', '.join(map(str, invalid))}."
                ),
            )

        access_level = config.get("access_level")
        if not isinstance(access_level, str) or access_level not in ACCESS_LEVELS:
            raise ProviderConfigError(
                f"Invalid access_level: {access_level!r}",
                user_message=f"Role must be one of: {', '.join(ACCESS_LEVELS)}.",
            )

        lifetime = config.get("token_lifetime_days")
        if lifetime is not None and (
            isinstance(lifetime, bool)
            or not isinstance(lifetime, int)
            or not 1 <= lifetime <= MAX_LIFETIME_DAYS
        ):
            raise ProviderConfigError(
                f"Invalid token_lifetime_days: {lifetime!r}",
                user_message=(
                    "Token lifetime must be a whole number of days from 1 to "
                    f"{MAX_LIFETIME_DAYS}."
                ),
            )

    @classmethod
    def validate_root_credentials(cls, root_creds: dict) -> bool:
        try:
            request(
                "GET",
                f"{_api_base(root_creds)}/user",
                headers=_headers(root_creds),
            )
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
        if resource_type != "gitlab_target":
            return super().list_resources(root_creds, resource_type, config)

        if _target_type(config or {}) == "group":
            collection, path_field = "groups", "full_path"
            params: dict[str, Any] = {"min_access_level": ACCESS_LEVELS["owner"]}
        else:
            collection, path_field = "projects", "path_with_namespace"
            params = {
                "membership": "true",
                "min_access_level": ACCESS_LEVELS["maintainer"],
                "simple": "true",
            }
        params["per_page"] = 100

        options: list[ResourceOption] = []
        # Hard ceiling on pagination so a misbehaving server can't loop forever.
        for _ in range(_MAX_PAGES):
            response = request(
                "GET",
                f"{_api_base(root_creds)}/{collection}",
                headers=_headers(root_creds),
                params=params,
            )
            try:
                items = response.json()
            except ValueError as e:
                raise ProviderConfigError(
                    f"Unexpected GitLab {collection} list response",
                    user_message="GitLab returned an unexpected response shape.",
                    raw={"body": response.text[:512]},
                ) from e
            if not isinstance(items, list):
                raise ProviderConfigError(
                    f"Unexpected GitLab {collection} list response",
                    user_message="GitLab returned an unexpected response shape.",
                    raw={"body": response.text[:512]},
                )
            for item in items:
                if not isinstance(item, dict) or item.get("id") is None:
                    continue
                item_id = str(item["id"])
                options.append(
                    ResourceOption(
                        id=item_id,
                        name=item.get(path_field) or item_id,
                        description=item.get("name") or "",
                    )
                )
            next_page = (response.headers.get("X-Next-Page") or "").strip()
            if not _is_digits(next_page):
                break
            params = {**params, "page": next_page}
        return options

    @classmethod
    def mint(
        cls,
        root_creds: dict,
        config: dict,
        *,
        caller_id: str,
    ) -> MintResult:
        target_type = _target_type(config)
        target_id = config["target_id"].strip()
        template = config.get("name_template", DEFAULT_NAME_TEMPLATE)
        name = template.format(id=f"{caller_id}-{int(time.time())}")
        scopes = list(config["scopes"])
        access_level = config["access_level"]
        lifetime = config.get("token_lifetime_days")
        if lifetime is None:
            lifetime = DEFAULT_LIFETIME_DAYS
        expires_at = (_utc_today() + timedelta(days=lifetime)).isoformat()

        response = request(
            "POST",
            f"{_target_url(root_creds, target_type, target_id)}/access_tokens",
            headers=_headers(root_creds),
            json={
                "name": name,
                "scopes": scopes,
                "access_level": ACCESS_LEVELS[access_level],
                "expires_at": expires_at,
            },
        )
        try:
            body = response.json()
        except ValueError as e:
            raise _unexpected_mint_response(None) from e
        if not isinstance(body, dict):
            raise _unexpected_mint_response(body)
        token_id = str(body.get("id"))
        token = body.get("token")
        if not _is_digits(token_id) or not isinstance(token, str) or not token:
            raise _unexpected_mint_response(body)

        return MintResult(
            provider_credential_id=_encode_provider_id(
                target_type, target_id, token_id
            ),
            values={"token_id": token_id, "token": token},
            metadata={
                "name": name,
                "target_type": target_type,
                "target_id": target_id,
                "token_id": token_id,
                "scopes": scopes,
                "access_level": access_level,
                "expires_at": body.get("expires_at") or expires_at,
                "display_id": token_id,
                "call": call_summary(response),
            },
        )

    @classmethod
    def revoke(cls, root_creds: dict, provider_credential_id: str) -> dict | None:
        target_type, target_id, token_id = _decode_provider_id(provider_credential_id)
        target_url = _target_url(root_creds, target_type, target_id)
        try:
            response = request(
                "DELETE",
                f"{target_url}/access_tokens/{token_id}",
                headers=_headers(root_creds),
            )
        except ProviderNotFound:
            # GitLab also returns 404 for projects and groups the caller can't see.
            cls._ensure_target_visible(root_creds, target_type, target_id, token_id)
            raise
        except ProviderConfigError:
            # Older GitLab versions can return 400 for revoked or expired tokens.
            cls._raise_if_token_inactive(root_creds, target_type, target_id, token_id)
            raise
        return {
            "target_type": target_type,
            "target_id": target_id,
            "token_id": token_id,
            "call": call_summary(response),
        }

    @classmethod
    def _ensure_target_visible(
        cls, root_creds: dict, target_type: str, target_id: str, token_id: str
    ) -> None:
        try:
            request(
                "GET",
                _target_url(root_creds, target_type, target_id),
                headers=_headers(root_creds),
                # Stops GET /groups/:id from embedding every project in the group.
                params={"with_projects": "false"} if target_type == "group" else None,
            )
        except (ProviderAuthError, ProviderNotFound) as e:
            raise ProviderAuthError(
                f"GitLab {target_type} {target_id} is not visible to the root token",
                user_message=(
                    f"Phase can no longer see GitLab {target_type} {target_id}, "
                    f"so access token {token_id} may still be active. Restore "
                    "the root token's access or revoke the token in GitLab."
                ),
                raw=e.raw,
            ) from e

    @classmethod
    def _raise_if_token_inactive(
        cls, root_creds: dict, target_type: str, target_id: str, token_id: str
    ) -> None:
        target_url = _target_url(root_creds, target_type, target_id)
        try:
            response = request(
                "GET",
                f"{target_url}/access_tokens/{token_id}",
                headers=_headers(root_creds),
            )
        except ProviderNotFound:
            cls._ensure_target_visible(root_creds, target_type, target_id, token_id)
            raise
        except ProviderTransientError:
            raise
        except ProviderError:
            return
        try:
            body = response.json()
        except ValueError:
            return
        if isinstance(body, dict) and (
            body.get("revoked") is True or body.get("active") is False
        ):
            raise ProviderNotFound(
                f"GitLab access token {token_id} is already inactive",
                user_message=(
                    f"GitLab access token {token_id} is already revoked or expired."
                ),
                raw={
                    "revoked": body.get("revoked"),
                    "active": body.get("active"),
                    "call": call_summary(response),
                },
            )
