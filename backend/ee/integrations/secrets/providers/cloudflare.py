"""Cloudflare credential provider that mints account-owned or user-owned API tokens."""

from __future__ import annotations

import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any, NamedTuple

from .base import (
    ConfigSchemaField,
    CredentialProvider,
    CredentialSchemaField,
    MintResult,
    OutputSchemaField,
    TemplateImportSpec,
)
from .exceptions import (
    ProviderAuthError,
    ProviderConfigError,
    ProviderError,
    ProviderNotFound,
    ProviderTransientError,
)
from .http import call_summary, request

CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4"

TOKEN_OWNERS = ("account", "user")
DEFAULT_NAME_TEMPLATE = "phase-rs-{id}"
MAX_NAME_LENGTH = 120
# Phase's sanity cap, not a Cloudflare limit.
MAX_LIFETIME_DAYS = 3650
# What {id} renders to at mint: a rotating-secret UUID, a dash and a Unix timestamp.
_SAMPLE_ID = f"{'0' * 36}-{'0' * 10}"
# IDs are at most 32 characters and token values at least 40, so a pasted value fails.
_TOKEN_ID_RE = re.compile(r"[A-Za-z0-9]{1,32}")

_PROVIDER_ID_SEP = ":"


class _TokenRef(NamedTuple):
    owner: str
    account_id: str | None
    token_id: str
    # The root token that minted this one; a different root may not see the token.
    root_token_id: str


def _encode_provider_id(ref: _TokenRef) -> str:
    if ref.owner == "account":
        parts = ("account", ref.account_id, ref.token_id, ref.root_token_id)
    else:
        parts = ("user", ref.token_id, ref.root_token_id)
    return _PROVIDER_ID_SEP.join(parts)


def _decode_provider_id(provider_credential_id: str) -> _TokenRef:
    parts = provider_credential_id.split(_PROVIDER_ID_SEP)
    if len(parts) == 4 and parts[0] == "account" and all(parts[1:]):
        return _TokenRef("account", parts[1], parts[2], parts[3])
    if len(parts) == 3 and parts[0] == "user" and all(parts[1:]):
        return _TokenRef("user", None, parts[1], parts[2])
    raise ProviderConfigError(
        f"Malformed provider credential ID: {provider_credential_id!r}",
        user_message=(
            "This credential's provider ID isn't a Cloudflare token reference. "
            "Revoke the token in the Cloudflare dashboard."
        ),
    )


def _headers(root_creds: dict) -> dict:
    return {"Authorization": f"Bearer {root_creds['access_token'].strip()}"}


def _tokens_url(owner: str, account_id: str | None) -> str:
    if owner == "account":
        return f"{CLOUDFLARE_API_BASE}/accounts/{account_id}/tokens"
    return f"{CLOUDFLARE_API_BASE}/user/tokens"


def _result(response, action: str) -> Any:
    try:
        body = response.json()
    except ValueError:
        body = None
    if not isinstance(body, dict) or body.get("success") is not True:
        # Never attach the body: a create response carries the token value.
        raise ProviderConfigError(
            f"Unexpected Cloudflare response when {action}",
            user_message=f"Cloudflare returned an unexpected response when {action}.",
            raw=call_summary(response),
        )
    return body.get("result")


def _is_empty(value: Any) -> bool:
    if isinstance(value, dict):
        return all(_is_empty(v) for v in value.values())
    if isinstance(value, list):
        return not value
    return value is None or value == ""


def _policy_for_create(policy: dict) -> dict:
    # Policy IDs and permission group names and meta come from Cloudflare.
    return {
        "effect": policy.get("effect"),
        "permission_groups": [
            {"id": group["id"]}
            for group in policy.get("permission_groups") or []
            if isinstance(group, dict) and group.get("id")
        ],
        "resources": policy.get("resources"),
    }


def _unconfirmed(ref: _TokenRef, user_message: str) -> ProviderAuthError:
    return ProviderAuthError(
        f"Could not confirm Cloudflare token {ref.token_id} is revoked",
        user_message=user_message,
    )


class CloudflareProvider(CredentialProvider):
    id = "cloudflare"
    name = "Cloudflare"
    key_name_prefix = "CLOUDFLARE"
    credential_id_label = "Token ID"
    template_import = TemplateImportSpec(
        label="Cloudflare API token ID",
        help_text=(
            "Create a token in the Cloudflare dashboard with the permissions and "
            "IP filtering you want, then paste its token ID (not its secret value) "
            "to copy its policies and IP restrictions. The token's verify request "
            "returns the ID as result.id."
        ),
    )

    credential_schema = [
        CredentialSchemaField(
            id="account_id",
            label="Account ID",
            required=True,
            help_text=(
                "Your Cloudflare account ID. Account-owned tokens are created in "
                "this account."
            ),
        ),
        CredentialSchemaField(
            id="access_token",
            label="API Token",
            required=True,
            masked=True,
            help_text=(
                "A Cloudflare API token, sent as a Bearer token. To mint "
                "account-owned tokens it needs Account > Account API Tokens > Edit. "
                "To mint user-owned tokens, create it from the 'Create additional "
                "tokens' template (User > API Tokens > Edit). Cloudflare rejects "
                "policies that exceed what the token's owner may grant."
            ),
        ),
    ]

    config_schema = [
        ConfigSchemaField(
            id="token_owner",
            label="Token Owner",
            required=True,
            default="account",
            choices=list(TOKEN_OWNERS),
            help_text=(
                "Who owns the minted tokens. Account-owned tokens aren't tied to a "
                "person, so they keep working when people leave (recommended). A "
                "few products, such as Page Rules and Registrar, don't accept them "
                "yet. User-owned tokens act as the root token's user."
            ),
        ),
        ConfigSchemaField(
            id="name_template",
            label="Token Name Template",
            required=False,
            default=DEFAULT_NAME_TEMPLATE,
            help_text=(
                "A template for each minted token's name (up to 120 characters). "
                "{id} is replaced with the caller ID and a timestamp."
            ),
        ),
        ConfigSchemaField(
            id="policies",
            label="Policies",
            required=True,
            field_type="json",
            help_url=(
                "https://developers.cloudflare.com/fundamentals/api/how-to/"
                "create-via-api/"
            ),
            help_text=(
                "The token's access policies as a JSON array in Cloudflare's API "
                'format, e.g. [{"effect": "allow", "permission_groups": [{"id": '
                '"<permission group ID>"}], "resources": '
                '{"com.cloudflare.api.account.<account ID>": "*"}}]. Use Import '
                "config to copy them from an existing token."
            ),
        ),
        ConfigSchemaField(
            id="condition",
            label="IP Restrictions",
            required=False,
            field_type="json",
            help_url=(
                "https://developers.cloudflare.com/fundamentals/api/how-to/"
                "restrict-tokens/"
            ),
            help_text=(
                'Optional client IP filter, e.g. {"request_ip": {"in": '
                '["192.0.2.0/24"], "not_in": []}}. Addresses use CIDR notation.'
            ),
        ),
        ConfigSchemaField(
            id="token_lifetime_days",
            label="Token Lifetime (days)",
            required=False,
            field_type="int",
            help_text=(
                "Optional. Each minted token expires this many days after it's "
                "created. Keep it longer than the rotation interval plus the "
                "revocation delay."
            ),
        ),
    ]

    output_schema = [
        OutputSchemaField(
            id="token_id",
            label="Token ID",
            masked=False,
            help_text="The Cloudflare API token ID.",
        ),
        OutputSchemaField(
            id="api_token",
            label="API Token",
            masked=True,
            help_text="The secret API token consumers send as a Bearer token.",
        ),
    ]

    @classmethod
    def validate_config(cls, config: dict) -> None:
        if config.get("token_owner", "account") not in TOKEN_OWNERS:
            raise ProviderConfigError(
                "token_owner must be 'account' or 'user'",
                user_message="Token owner must be 'account' or 'user'.",
            )

        template = config.get("name_template", DEFAULT_NAME_TEMPLATE)
        if not isinstance(template, str) or "{id}" not in template:
            raise ProviderConfigError(
                "name_template must be a string containing '{id}'",
                user_message="Token name template must include {id}.",
            )
        try:
            sample_name = template.format(id=_SAMPLE_ID)
        except (IndexError, KeyError, ValueError) as e:
            raise ProviderConfigError(
                f"name_template is not a valid template: {e}",
                user_message=(
                    "Token name template can't contain braces other than {id}."
                ),
            ) from e
        if len(sample_name) > MAX_NAME_LENGTH:
            raise ProviderConfigError(
                f"name_template renders longer than {MAX_NAME_LENGTH} characters",
                user_message=(
                    f"Token name template is too long. Cloudflare allows "
                    f"{MAX_NAME_LENGTH} characters and {{id}} adds "
                    f"{len(_SAMPLE_ID)}."
                ),
            )

        policies = config.get("policies")
        if (
            not isinstance(policies, list)
            or not policies
            or not all(isinstance(p, dict) for p in policies)
        ):
            raise ProviderConfigError(
                "policies must be a non-empty list of objects",
                user_message=(
                    "Policies must be a non-empty JSON array of Cloudflare policy "
                    "objects."
                ),
            )

        condition = config.get("condition")
        if condition and not (
            isinstance(condition, dict)
            and all(isinstance(v, dict) for v in condition.values())
        ):
            raise ProviderConfigError(
                "condition must be an object of condition objects",
                user_message=(
                    "IP restrictions must be a JSON object such as "
                    '{"request_ip": {"in": ["192.0.2.0/24"]}}.'
                ),
            )

        lifetime = config.get("token_lifetime_days")
        if lifetime is not None and (
            isinstance(lifetime, bool)
            or not isinstance(lifetime, int)
            or not 1 <= lifetime <= MAX_LIFETIME_DAYS
        ):
            raise ProviderConfigError(
                "token_lifetime_days must be an integer in range",
                user_message=(
                    "Token lifetime must be a whole number of days from 1 to "
                    f"{MAX_LIFETIME_DAYS}."
                ),
            )

    @classmethod
    def _root_token_id(cls, root_creds: dict) -> str | None:
        """Return the root token's ID if Cloudflare verifies it as active."""
        headers = _headers(root_creds)
        # Account-owned tokens only verify on the account endpoint.
        for url in (
            f"{CLOUDFLARE_API_BASE}/accounts/{root_creds['account_id']}/tokens/verify",
            f"{CLOUDFLARE_API_BASE}/user/tokens/verify",
        ):
            try:
                result = _result(
                    request("GET", url, headers=headers), "verifying the API token"
                )
            except ProviderTransientError:
                raise
            except ProviderError:
                continue
            if (
                isinstance(result, dict)
                and result.get("status") == "active"
                and result.get("id")
            ):
                return str(result["id"])
        return None

    @classmethod
    def validate_root_credentials(cls, root_creds: dict) -> bool:
        try:
            return cls._root_token_id(root_creds) is not None
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
        root_token_id = cls._root_token_id(root_creds)
        if not root_token_id:
            raise ProviderAuthError(
                "Cloudflare did not verify the root API token",
                user_message=(
                    "Cloudflare didn't verify the root API token for this account. "
                    "Check the token and the account ID."
                ),
            )

        owner = config.get("token_owner", "account")
        account_id = root_creds["account_id"] if owner == "account" else None
        template = config.get("name_template", DEFAULT_NAME_TEMPLATE)
        name = template.format(id=f"{caller_id}-{int(time.time())}")
        payload: dict[str, Any] = {"name": name, "policies": config["policies"]}
        if config.get("condition"):
            payload["condition"] = config["condition"]
        lifetime = config.get("token_lifetime_days")
        if lifetime:
            expires_on = datetime.now(timezone.utc) + timedelta(days=lifetime)
            payload["expires_on"] = expires_on.strftime("%Y-%m-%dT%H:%M:%SZ")

        response = request(
            "POST",
            _tokens_url(owner, account_id),
            headers=_headers(root_creds),
            json=payload,
        )
        result = _result(response, "creating the API token")
        token_id = result.get("id") if isinstance(result, dict) else None
        value = result.get("value") if isinstance(result, dict) else None
        if not (
            isinstance(token_id, str) and token_id and isinstance(value, str) and value
        ):
            raise ProviderConfigError(
                "Unexpected Cloudflare create-token response",
                user_message=(
                    "Cloudflare returned an unexpected response when creating the "
                    "API token."
                ),
                raw=call_summary(response),
            )

        ref = _TokenRef(owner, account_id, token_id, root_token_id)
        return MintResult(
            provider_credential_id=_encode_provider_id(ref),
            values={"token_id": token_id, "api_token": value},
            metadata={
                "name": result.get("name") or name,
                # Not "token_owner": sanitize() redacts keys containing "token".
                "owner": owner,
                "token_id": token_id,
                "status": result.get("status"),
                "expires_on": result.get("expires_on") or payload.get("expires_on"),
                "display_id": token_id,
                "call": call_summary(response),
            },
        )

    @classmethod
    def revoke(cls, root_creds: dict, provider_credential_id: str) -> dict | None:
        ref = _decode_provider_id(provider_credential_id)
        try:
            response = request(
                "DELETE",
                f"{_tokens_url(ref.owner, ref.account_id)}/{ref.token_id}",
                headers=_headers(root_creds),
            )
        except ProviderNotFound:
            cls._confirm_missing(root_creds, ref)
            raise
        _result(response, "deleting the API token")
        return {
            "owner": ref.owner,
            "token_id": ref.token_id,
            "call": call_summary(response),
        }

    @classmethod
    def _confirm_missing(cls, root_creds: dict, ref: _TokenRef) -> None:
        """Raise ProviderAuthError unless a 404 on delete means the token is gone."""
        # A root also gets a 404 for live tokens it can't see, like another user's.
        if not cls._same_principal(root_creds, ref):
            raise _unconfirmed(
                ref,
                f"Cloudflare didn't find token {ref.token_id} with the current root "
                "credential, which isn't the one that minted it. Check the token in "
                "the Cloudflare dashboard and delete it if it still exists.",
            )

        headers = _headers(root_creds)
        tokens_url = _tokens_url(ref.owner, ref.account_id)
        try:
            request("GET", f"{tokens_url}/{ref.token_id}", headers=headers)
        except ProviderNotFound:
            pass
        else:
            raise _unconfirmed(
                ref,
                f"Cloudflare token {ref.token_id} still exists, but the root "
                "credential can't delete it. Give it permission to edit API tokens "
                "or delete the token in the Cloudflare dashboard.",
            )

        # A working list shows the 404s weren't a masked permission error.
        try:
            request("GET", tokens_url, headers=headers, params={"per_page": 5})
        except ProviderNotFound as e:
            raise _unconfirmed(
                ref,
                f"Cloudflare didn't find token {ref.token_id}, but the root "
                "credential can't list API tokens there, so Phase can't confirm "
                "it's gone. Check the token in the Cloudflare dashboard.",
            ) from e

    @classmethod
    def _same_principal(cls, root_creds: dict, ref: _TokenRef) -> bool:
        current = cls._root_token_id(root_creds)
        if current == ref.root_token_id:
            return True
        if not current:
            return False
        # A user token is visible under /user/tokens only to its own user.
        try:
            request(
                "GET",
                f"{CLOUDFLARE_API_BASE}/user/tokens/{ref.root_token_id}",
                headers=_headers(root_creds),
            )
        except ProviderTransientError:
            raise
        except ProviderError:
            return False
        return True

    @classmethod
    def import_config_from_template(
        cls,
        root_creds: dict,
        template_ref: str,
    ) -> dict | None:
        """Copy an existing token's owner, policies and IP restrictions."""
        token_id = (template_ref or "").strip()
        if not token_id:
            return None
        if not _TOKEN_ID_RE.fullmatch(token_id):
            raise ProviderConfigError(
                "Template reference is not a Cloudflare token ID",
                user_message="Paste the token's ID, not its secret value.",
            )

        headers = _headers(root_creds)
        errors: list[ProviderError] = []
        for owner in TOKEN_OWNERS:
            url = f"{_tokens_url(owner, root_creds['account_id'])}/{token_id}"
            try:
                response = request("GET", url, headers=headers)
            except ProviderTransientError:
                raise
            except ProviderError as e:
                errors.append(e)
                continue
            token = _result(response, "reading the API token")
            if not isinstance(token, dict):
                raise ProviderConfigError(
                    "Unexpected Cloudflare token details response",
                    user_message=(
                        "Cloudflare returned an unexpected response when reading "
                        "the API token."
                    ),
                    raw=call_summary(response),
                )
            config: dict[str, Any] = {
                "token_owner": owner,
                "policies": [
                    _policy_for_create(p)
                    for p in token.get("policies") or []
                    if isinstance(p, dict)
                ],
            }
            if not _is_empty(token.get("condition")):
                config["condition"] = token["condition"]
            return config

        if any(isinstance(e, ProviderNotFound) for e in errors):
            raise ProviderNotFound(
                f"Cloudflare token {token_id} not found",
                user_message=(
                    f"No Cloudflare API token with ID {token_id} was found in "
                    f"account {root_creds['account_id']} or for the root token's "
                    "user."
                ),
            )
        raise errors[0]
