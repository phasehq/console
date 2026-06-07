"""LiteLLM Gateway rotation provider."""

from __future__ import annotations

import time
from typing import Any

from ..exceptions import RotationProviderConfigError
from ..http import call_summary, request
from .base import (
    ConfigSchemaField,
    CredentialSchemaField,
    MintResult,
    OutputSchemaField,
    RotationProvider,
)


class LiteLLMRotationProvider(RotationProvider):
    id = "litellm"
    name = "LiteLLM"

    credential_schema = [
        CredentialSchemaField(
            id="gateway_url",
            label="Gateway URL",
            required=True,
            help_text="Base URL of your LiteLLM proxy (e.g. https://litellm.example.com).",
        ),
        CredentialSchemaField(
            id="api_key",
            label="Management API Key",
            required=True,
            masked=True,
            help_text=(
                "Bearer token used to mint and revoke virtual keys. Paste the "
                "`key` field returned by /key/generate (starts with `sk-`), "
                "not the `token` field. We recommend a scoped key over the "
                "master key — create a proxy-admin user, then mint a key for "
                "that user with allowed_routes restricted to /key/generate, "
                "/key/delete, /key/info, /health/readiness."
            ),
        ),
    ]

    config_schema = [
        ConfigSchemaField(
            id="models",
            label="Allowed Models",
            required=False,
            field_type="list",
            default=[],
            help_text="Models the rotated key is allowed to use. Empty = all models.",
        ),
        ConfigSchemaField(
            id="max_budget",
            label="Max Budget (USD)",
            required=False,
            field_type="int",
            help_text="Hard spend cap for the key.",
        ),
        ConfigSchemaField(
            id="soft_budget",
            label="Soft Budget (USD)",
            required=False,
            field_type="int",
            help_text="Soft spend threshold for alerting (below max_budget).",
        ),
        ConfigSchemaField(
            id="budget_duration",
            label="Budget Duration",
            required=False,
            help_text="Period the budget applies over, e.g. '30d', '7d', '24h'.",
        ),
        ConfigSchemaField(
            id="tpm_limit",
            label="TPM Limit",
            required=False,
            field_type="int",
            help_text="Optional tokens-per-minute limit.",
        ),
        ConfigSchemaField(
            id="rpm_limit",
            label="RPM Limit",
            required=False,
            field_type="int",
            help_text="Optional requests-per-minute limit.",
        ),
        ConfigSchemaField(
            id="max_parallel_requests",
            label="Max Parallel Requests",
            required=False,
            field_type="int",
            help_text="Concurrency cap for the key.",
        ),
        ConfigSchemaField(
            id="team_id",
            label="Team ID",
            required=False,
            help_text="Optional LiteLLM team id to scope the key to.",
        ),
        ConfigSchemaField(
            id="user_id",
            label="User ID",
            required=False,
            help_text="Optional LiteLLM user id to attribute the key to.",
        ),
        ConfigSchemaField(
            id="tags",
            label="Tags",
            required=False,
            field_type="list",
            default=[],
            help_text="Tags for cost attribution / filtering.",
        ),
        ConfigSchemaField(
            id="blocked",
            label="Blocked",
            required=False,
            field_type="bool",
            help_text="Block the key immediately on mint (kill switch).",
        ),
    ]

    output_schema = [
        OutputSchemaField(
            id="api_key",
            label="API Key",
            masked=True,
            help_text="The virtual API key consumers use against the LiteLLM proxy.",
        ),
        OutputSchemaField(
            id="key_id",
            label="Key ID",
            masked=False,
            help_text="The LiteLLM-side key identifier used for revocation.",
        ),
    ]

    @classmethod
    def validate_config(cls, config: dict) -> None:
        if "models" in config and not isinstance(config["models"], list):
            raise RotationProviderConfigError(
                "models must be a list of strings",
                user_message="Allowed models must be a list.",
            )
        for numeric in ("max_budget", "tpm_limit", "rpm_limit"):
            if numeric in config and config[numeric] is not None:
                if not isinstance(config[numeric], (int, float)):
                    raise RotationProviderConfigError(
                        f"{numeric} must be numeric",
                        user_message=f"{numeric} must be a number.",
                    )

    @classmethod
    def validate_root_credentials(cls, root_creds: dict) -> bool:
        gateway = root_creds["gateway_url"].rstrip("/")
        headers = {"Authorization": f"Bearer {root_creds['api_key']}"}
        try:
            request("GET", f"{gateway}/health/readiness", headers=headers)
            return True
        except Exception:
            return False

    _PHASE_MANAGED_KEYS = frozenset(
        {
            "key_alias",
            "key",
            "spend",
            "duration",
            "auto_rotate",
            "rotation_interval",
            "send_invite_email",
            "key_type",
        }
    )

    @classmethod
    def mint(
        cls,
        root_creds: dict,
        config: dict,
        *,
        rotating_secret_id: str,
    ) -> MintResult:
        gateway = root_creds["gateway_url"].rstrip("/")
        headers = {"Authorization": f"Bearer {root_creds['api_key']}"}

        payload: dict[str, Any] = {
            "key_alias": f"phase-rs-{rotating_secret_id}-{int(time.time())}",
        }
        for k, v in (config or {}).items():
            if k in cls._PHASE_MANAGED_KEYS:
                continue
            if v is None or v == "" or v == [] or v == {}:
                continue
            payload[k] = v

        response = request(
            "POST",
            f"{gateway}/key/generate",
            headers=headers,
            json=payload,
        )
        try:
            body = response.json()
            api_key = body["key"]
            key_id = body.get("token") or body.get("key_name") or body["key"]
        except (KeyError, ValueError) as e:
            raise RotationProviderConfigError(
                f"Unexpected LiteLLM mint response: {response.text[:256]}",
                user_message="LiteLLM returned an unexpected response shape.",
                raw={"body": response.text[:512]},
            ) from e

        metadata: dict[str, Any] = {
            "key_alias": payload["key_alias"],
            "key_id": key_id,
            "call": call_summary(response),
            "provider_response": {
                k: v
                for k, v in body.items()
                if k
                in (
                    "key_alias",
                    "models",
                    "max_budget",
                    "soft_budget",
                    "budget_duration",
                    "tpm_limit",
                    "rpm_limit",
                    "max_parallel_requests",
                    "team_id",
                    "user_id",
                    "tags",
                    "blocked",
                    "expires",
                    "created_at",
                )
            },
        }

        return MintResult(
            provider_credential_id=key_id,
            values={"api_key": api_key, "key_id": key_id},
            metadata=metadata,
        )

    @classmethod
    def revoke(cls, root_creds: dict, provider_credential_id: str) -> dict | None:
        gateway = root_creds["gateway_url"].rstrip("/")
        headers = {"Authorization": f"Bearer {root_creds['api_key']}"}
        response = request(
            "POST",
            f"{gateway}/key/delete",
            headers=headers,
            json={"keys": [provider_credential_id]},
        )
        try:
            body = response.json()
        except ValueError:
            body = None
        return {
            "call": call_summary(response),
            "deleted_keys": (body or {}).get("deleted_keys") if isinstance(body, dict) else None,
        }

    @classmethod
    def import_config_from_template(
        cls,
        root_creds: dict,
        template_ref: str,
    ) -> dict | None:
        """Fetch an existing LiteLLM key via /key/info and return its config dict."""
        if not template_ref:
            return None
        gateway = root_creds["gateway_url"].rstrip("/")
        headers = {"Authorization": f"Bearer {root_creds['api_key']}"}

        response = request(
            "GET",
            f"{gateway}/key/info",
            headers=headers,
            params={"key": template_ref},
        )
        try:
            body = response.json()
        except ValueError as e:
            raise RotationProviderConfigError(
                "Unexpected LiteLLM /key/info response",
                user_message="LiteLLM returned an unexpected response shape.",
                raw={"body": response.text[:512]},
            ) from e

        # /key/info returns key fields at top level (older) or nested under `info`.
        info = body.get("info") if isinstance(body.get("info"), dict) else body
        if not isinstance(info, dict):
            return None

        config: dict = {}
        for field, value in info.items():
            if field in cls._PHASE_MANAGED_KEYS:
                continue
            if value is None:
                continue
            if isinstance(value, (list, dict)) and not value:
                continue
            config[field] = value
        return config
