"""OpenAI rotation provider that mints project-scoped service-account API keys."""

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

OPENAI_API_BASE = "https://api.openai.com/v1"

_PROVIDER_ID_SEP = ":"


def _encode_provider_id(project_id: str, sa_id: str) -> str:
    return f"{project_id}{_PROVIDER_ID_SEP}{sa_id}"


def _decode_provider_id(provider_credential_id: str) -> tuple[str, str]:
    if _PROVIDER_ID_SEP not in provider_credential_id:
        raise RotationProviderConfigError(
            f"Malformed provider credential id: {provider_credential_id!r}",
            user_message=(
                "This credential's provider id is missing the project scope. "
                "It may have been created before the project-aware revoke "
                "format existed — revoke manually at the OpenAI dashboard."
            ),
        )
    project_id, sa_id = provider_credential_id.split(_PROVIDER_ID_SEP, 1)
    return project_id, sa_id


class OpenAIRotationProvider(RotationProvider):
    id = "openai"
    name = "OpenAI"

    credential_schema = [
        CredentialSchemaField(
            id="admin_api_key",
            label="Admin API Key",
            required=True,
            masked=True,
            help_text=(
                "An OpenAI organization admin key with permission to manage "
                "project service accounts. Minted keys are scoped to the "
                "project you pick below, not to the admin key itself."
            ),
        ),
    ]

    config_schema = [
        ConfigSchemaField(
            id="project_id",
            label="Project",
            required=True,
            help_text=(
                "The OpenAI project that minted service accounts will be "
                "created in. The minted key is scoped to this project only."
            ),
        ),
        ConfigSchemaField(
            id="name_template",
            label="Service Account Name Template",
            required=False,
            default="phase-rs-{id}",
            help_text=(
                "Template for the minted service account's name. {id} is "
                "replaced with the rotating-secret id and a timestamp."
            ),
        ),
    ]

    # Order: identifiers first, the actual secret last (matches the dynamic-
    # secret convention so the sensitive value sits at the bottom of UIs).
    output_schema = [
        OutputSchemaField(
            id="key_id",
            label="Key ID",
            masked=False,
            help_text="The OpenAI-side api_key id.",
        ),
        OutputSchemaField(
            id="service_account_id",
            label="Service Account ID",
            masked=False,
            help_text="The OpenAI-side service-account id used for revocation.",
        ),
        OutputSchemaField(
            id="api_key",
            label="API Key",
            masked=True,
            help_text="The secret API key consumers use against OpenAI.",
        ),
    ]

    @classmethod
    def validate_config(cls, config: dict) -> None:
        project_id = config.get("project_id")
        if not project_id or not isinstance(project_id, str):
            raise RotationProviderConfigError(
                "project_id is required and must be a string",
                user_message="Pick an OpenAI project to mint service accounts in.",
            )
        template = config.get("name_template", "phase-rs-{id}")
        if not isinstance(template, str):
            raise RotationProviderConfigError(
                "name_template must be a string",
                user_message="Service account name template must be a string.",
            )
        if "{id}" not in template:
            # Without {id}, every rotation would try to mint a service account
            # with the same name — OpenAI rejects the duplicate and rotation
            # breaks silently.
            raise RotationProviderConfigError(
                "name_template must contain '{id}'",
                user_message="Service account name template must include {id}.",
            )

    @classmethod
    def validate_root_credentials(cls, root_creds: dict) -> bool:
        headers = {"Authorization": f"Bearer {root_creds['admin_api_key']}"}
        try:
            request(
                "GET",
                f"{OPENAI_API_BASE}/organization/projects",
                headers=headers,
                params={"limit": 1},
            )
            return True
        except Exception:
            return False

    @classmethod
    def list_projects(cls, root_creds: dict) -> list[dict[str, Any]]:
        headers = {"Authorization": f"Bearer {root_creds['admin_api_key']}"}
        projects: list[dict[str, Any]] = []
        after: str | None = None
        # Hard ceiling on pagination so a misbehaving server can't loop forever.
        for _ in range(50):
            params: dict[str, Any] = {"limit": 100}
            if after:
                params["after"] = after
            response = request(
                "GET",
                f"{OPENAI_API_BASE}/organization/projects",
                headers=headers,
                params=params,
            )
            try:
                body = response.json()
            except ValueError as e:
                raise RotationProviderConfigError(
                    "Unexpected OpenAI projects list response",
                    user_message="OpenAI returned an unexpected response shape.",
                    raw={"body": response.text[:512]},
                ) from e
            data = body.get("data") or []
            for proj in data:
                if proj.get("status") == "archived":
                    continue
                projects.append(
                    {
                        "id": proj.get("id"),
                        "name": proj.get("name") or proj.get("id"),
                        "status": proj.get("status"),
                    }
                )
            if not body.get("has_more"):
                break
            after = body.get("last_id") or (data[-1].get("id") if data else None)
            if not after:
                break
        return projects

    @classmethod
    def mint(
        cls,
        root_creds: dict,
        config: dict,
        *,
        rotating_secret_id: str,
    ) -> MintResult:
        project_id = config["project_id"]
        headers = {"Authorization": f"Bearer {root_creds['admin_api_key']}"}
        template = config.get("name_template", "phase-rs-{id}")
        name = template.format(id=f"{rotating_secret_id}-{int(time.time())}")

        response = request(
            "POST",
            f"{OPENAI_API_BASE}/organization/projects/{project_id}/service_accounts",
            headers=headers,
            json={"name": name},
        )
        try:
            body = response.json()
            sa_id = body["id"]
            api_key_obj = body["api_key"]
            api_key_value = api_key_obj["value"]
            api_key_id = api_key_obj["id"]
        except (KeyError, ValueError) as e:
            raise RotationProviderConfigError(
                f"Unexpected OpenAI mint response: {response.text[:256]}",
                user_message=(
                    "OpenAI returned an unexpected response shape when minting "
                    "the service account."
                ),
                raw={"body": response.text[:512]},
            ) from e

        return MintResult(
            provider_credential_id=_encode_provider_id(project_id, sa_id),
            values={
                "api_key": api_key_value,
                "key_id": api_key_id,
                "service_account_id": sa_id,
            },
            metadata={
                "name": name,
                "project_id": project_id,
                "service_account_id": sa_id,
                "api_key_id": api_key_id,
                "call": call_summary(response),
                "provider_response": {
                    "id": body.get("id"),
                    "object": body.get("object"),
                    "name": body.get("name"),
                    "role": body.get("role"),
                    "created_at": body.get("created_at"),
                },
            },
        )

    @classmethod
    def revoke(cls, root_creds: dict, provider_credential_id: str) -> dict | None:
        project_id, sa_id = _decode_provider_id(provider_credential_id)
        headers = {"Authorization": f"Bearer {root_creds['admin_api_key']}"}
        response = request(
            "DELETE",
            (
                f"{OPENAI_API_BASE}/organization/projects/{project_id}"
                f"/service_accounts/{sa_id}"
            ),
            headers=headers,
        )
        return {
            "project_id": project_id,
            "service_account_id": sa_id,
            "call": call_summary(response),
        }
