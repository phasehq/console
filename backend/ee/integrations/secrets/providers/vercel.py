"""Vercel credential provider that mints Vercel access tokens."""

from __future__ import annotations

import re
import time
from datetime import datetime, timezone
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

VERCEL_API_BASE = "https://api.vercel.com"

DEFAULT_NAME_TEMPLATE = "phase-rs-{id}"

_MS_PER_DAY = 86_400_000

_TOKEN_ID_RE = re.compile(r"[A-Za-z0-9_-]+")

_ROOT_TOKEN_HINT = "Vercel only lets Full Account tokens create tokens."


def _headers(root_creds: dict) -> dict[str, str]:
    return {"Authorization": f"Bearer {root_creds['api_token']}"}


def _is_token_id(value: Any) -> bool:
    # "current" is a reserved ID that would delete the root token itself.
    return (
        isinstance(value, str)
        and _TOKEN_ID_RE.fullmatch(value) is not None
        and value.lower() != "current"
    )


def _encode_provider_id(token_id: str) -> str:
    return token_id


def _decode_provider_id(provider_credential_id: str) -> str:
    if not _is_token_id(provider_credential_id):
        raise ProviderConfigError(
            f"Malformed provider credential ID: {provider_credential_id!r}",
            user_message=(
                "This credential's Vercel token ID is malformed. Delete the "
                "token manually under Vercel Account Settings > Tokens."
            ),
        )
    return provider_credential_id


def _name_template(config: dict) -> Any:
    template = config.get("name_template")
    return DEFAULT_NAME_TEMPLATE if template is None else template


def _render_name(template: str, unique_id: str) -> str:
    try:
        return template.format(id=unique_id)
    except (AttributeError, IndexError, KeyError, ValueError) as e:
        raise ProviderConfigError(
            f"Invalid name_template: {e}",
            user_message="Token name template can only use the {id} placeholder.",
        ) from e


def _team_id(config: dict) -> str | None:
    team_id = config.get("team_id")
    if isinstance(team_id, str) and team_id.strip():
        return team_id.strip()
    return None


def _token_team_ids(token: dict) -> set[str]:
    ids = {token.get("teamId")}
    for scope in token.get("scopes") or []:
        if isinstance(scope, dict) and scope.get("type") == "team":
            ids.add(scope.get("teamId"))
    return {i for i in ids if isinstance(i, str) and i}


def _iso_from_ms(value: Any) -> str | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        return datetime.fromtimestamp(value / 1000, tz=timezone.utc).isoformat()
    except (OverflowError, OSError, ValueError):
        return None


class VercelProvider(CredentialProvider):
    id = "vercel"
    name = "Vercel"
    key_name_prefix = "VERCEL"
    credential_id_label = "Token ID"

    credential_schema = [
        CredentialSchemaField(
            id="api_token",
            label="API Token",
            required=True,
            masked=True,
            help_text=(
                "A Vercel access token with Full Account scope, created under "
                "Account Settings > Tokens. Vercel only lets Full Account "
                "tokens create tokens: team- or project-scoped tokens work for "
                "syncs but can't rotate."
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
                "A template for the minted token's name. {id} is replaced "
                "with the caller ID and a timestamp."
            ),
        ),
        ConfigSchemaField(
            id="team_id",
            label="Team",
            required=False,
            resource_type="vercel_team",
            help_text=(
                "Scope minted tokens to this team. Leave empty to mint Full "
                "Account tokens with the same access as the root token."
            ),
        ),
        ConfigSchemaField(
            id="token_lifetime_days",
            label="Token Lifetime (days)",
            required=False,
            field_type="int",
            help_text=(
                "Optional expiry for each minted token. Keep it longer than the "
                "rotation interval plus the revocation delay, or tokens expire "
                "while still in use. Leave empty for tokens that don't expire."
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
            help_text="The Vercel-side token ID used for revocation.",
        ),
        OutputSchemaField(
            id="token",
            label="Access Token",
            masked=True,
            help_text="The Vercel access token consumers send as a Bearer token.",
        ),
    ]

    @classmethod
    def validate_config(cls, config: dict) -> None:
        template = _name_template(config)
        if not isinstance(template, str):
            raise ProviderConfigError(
                "name_template must be a string",
                user_message="Token name template must be a string.",
            )
        if "{id}" not in template:
            # Without {id}, rotated tokens are indistinguishable in Vercel.
            raise ProviderConfigError(
                "name_template must contain '{id}'",
                user_message="Token name template must include {id}.",
            )
        _render_name(template, "id")

        team_id = config.get("team_id")
        if team_id is not None and not isinstance(team_id, str):
            raise ProviderConfigError(
                "team_id must be a string",
                user_message="Pick a Vercel team, or leave Team empty.",
            )

        lifetime = config.get("token_lifetime_days")
        if lifetime is not None and (
            isinstance(lifetime, bool) or not isinstance(lifetime, int) or lifetime < 1
        ):
            raise ProviderConfigError(
                "token_lifetime_days must be a positive integer",
                user_message="Token lifetime must be a whole number of days.",
            )

    @classmethod
    def validate_root_credentials(cls, root_creds: dict) -> bool:
        try:
            request("GET", f"{VERCEL_API_BASE}/v2/user", headers=_headers(root_creds))
            return True
        except Exception:
            return False

    @classmethod
    def list_teams(cls, root_creds: dict) -> list[dict[str, Any]]:
        teams: list[dict[str, Any]] = []
        seen: set[str] = set()
        until: Any = None
        # Hard ceiling on pagination so a misbehaving server can't loop forever.
        for _ in range(50):
            params: dict[str, Any] = {"limit": 100}
            if until is not None:
                params["until"] = until
            response = request(
                "GET",
                f"{VERCEL_API_BASE}/v2/teams",
                headers=_headers(root_creds),
                params=params,
            )
            try:
                body = response.json()
            except ValueError:
                body = None
            page = body.get("teams") if isinstance(body, dict) else None
            if not isinstance(page, list):
                raise ProviderConfigError(
                    "Unexpected Vercel teams list response",
                    user_message="Vercel returned an unexpected response shape.",
                    raw={"body": response.text[:512]},
                )
            for team in page:
                team_id = team.get("id") if isinstance(team, dict) else None
                if not isinstance(team_id, str) or not team_id or team_id in seen:
                    continue
                seen.add(team_id)
                teams.append(
                    {
                        "id": team_id,
                        "name": team.get("name") or team.get("slug") or team_id,
                        "slug": team.get("slug") or "",
                    }
                )
            pagination = body.get("pagination")
            next_until = (
                pagination.get("next") if isinstance(pagination, dict) else None
            )
            if not page or next_until is None or next_until == until:
                break
            until = next_until
        return teams

    @classmethod
    def list_resources(
        cls,
        root_creds: dict,
        resource_type: str,
        config: dict | None = None,
    ) -> list[ResourceOption]:
        if resource_type != "vercel_team":
            return super().list_resources(root_creds, resource_type, config)
        return [
            ResourceOption(id=t["id"], name=t["name"], description=t["slug"])
            for t in cls.list_teams(root_creds)
        ]

    @classmethod
    def mint(
        cls,
        root_creds: dict,
        config: dict,
        *,
        caller_id: str,
    ) -> MintResult:
        cls.validate_config(config)
        now = time.time()
        name = _render_name(_name_template(config), f"{caller_id}-{int(now)}")
        team_id = _team_id(config)
        payload: dict[str, Any] = {"name": name}
        lifetime = config.get("token_lifetime_days")
        if lifetime is not None:
            payload["expiresAt"] = int(now * 1000) + lifetime * _MS_PER_DAY

        try:
            response = request(
                "POST",
                f"{VERCEL_API_BASE}/v3/user/tokens",
                headers=_headers(root_creds),
                params={"teamId": team_id} if team_id else None,
                json=payload,
            )
        except ProviderAuthError as e:
            raise ProviderAuthError(
                str(e), user_message=f"{e.user_message} {_ROOT_TOKEN_HINT}", raw=e.raw
            ) from e

        # The body holds the new bearer token, so errors never echo it.
        try:
            body = response.json()
            token = body["token"]
            token_id = token["id"]
            bearer_token = body["bearerToken"]
        except (KeyError, TypeError, ValueError) as e:
            raise ProviderConfigError(
                "Unexpected Vercel token response",
                user_message=(
                    "Vercel returned an unexpected response shape when "
                    "creating the token."
                ),
                raw=call_summary(response),
            ) from e
        if (
            not _is_token_id(token_id)
            or not bearer_token
            or not isinstance(bearer_token, str)
        ):
            raise ProviderConfigError(
                "Unexpected Vercel token response: invalid token ID or value",
                user_message="Vercel returned an unexpected token ID or value.",
                raw=call_summary(response),
            )

        if team_id and team_id not in _token_team_ids(token):
            # Never hand out a broader token than the config asked for.
            deleted = True
            try:
                cls.revoke(root_creds, _encode_provider_id(token_id))
            except ProviderNotFound:
                pass
            except ProviderError:
                deleted = False
            cleanup = (
                "Phase deleted it."
                if deleted
                else f"Delete token {token_id} in Vercel Account Settings > Tokens."
            )
            raise ProviderConfigError(
                f"Vercel did not scope token {token_id} to team {team_id}",
                user_message=f"Vercel didn't scope the token to the team. {cleanup}",
                raw={"token_id": token_id, "team_id": team_id, "deleted": deleted},
            )

        return MintResult(
            provider_credential_id=_encode_provider_id(token_id),
            values={"token_id": token_id, "token": bearer_token},
            metadata={
                "name": name,
                "token_id": token_id,
                "expires_at": _iso_from_ms(
                    token.get("expiresAt") or payload.get("expiresAt")
                ),
                "team_id": team_id,
                "call": call_summary(response),
            },
        )

    @classmethod
    def revoke(cls, root_creds: dict, provider_credential_id: str) -> dict | None:
        token_id = _decode_provider_id(provider_credential_id)
        response = request(
            "DELETE",
            f"{VERCEL_API_BASE}/v3/user/tokens/{token_id}",
            headers=_headers(root_creds),
        )
        return {"token_id": token_id, "call": call_summary(response)}
