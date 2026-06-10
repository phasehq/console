from __future__ import annotations

from django.apps import apps
from django.core.exceptions import ValidationError

from api.utils.crypto import decrypt_asymmetric
from api.utils.secrets import (
    check_for_duplicates_blind,
    compute_key_digest,
    get_environment_keys,
)
from .exceptions import RotationProviderConfigError
from .providers import get_provider


def validate_key_map(
    key_map: list[dict],
    provider_id: str,
    environment,
    path: str,
    rotating_secret_id: str | None = None,
) -> list[dict]:
    """Validate key_map entries, attaching digests and rejecting duplicates at the same path."""
    provider_cls = get_provider(provider_id)
    valid_output_ids = {f.id for f in provider_cls.output_schema}

    env_pubkey, env_privkey = get_environment_keys(environment.id)

    enriched = []
    for entry in key_map or []:
        if not isinstance(entry, dict):
            raise ValidationError(f"Invalid key_map entry (must be dict): {entry}")
        key_id = entry.get("id")
        encrypted_key_name = entry.get("key_name")
        if not key_id or not encrypted_key_name:
            raise ValidationError("key_map entries require id and key_name")
        if key_id not in valid_output_ids:
            raise ValidationError(
                f"Invalid key id '{key_id}' for provider '{provider_id}'"
            )
        decrypted = decrypt_asymmetric(encrypted_key_name, env_privkey, env_pubkey)
        digest = compute_key_digest(decrypted, environment.id)
        enriched.append(
            {
                "id": key_id,
                "key_name": encrypted_key_name,
                "key_digest": digest,
                "keyDigest": digest,
                "path": path,
                "rotating_secret_id": rotating_secret_id,
            }
        )

    seen_digests: set[str] = set()
    for e in enriched:
        if e["key_digest"] in seen_digests:
            raise ValidationError(
                "Two outputs share the same secret key. Pick a unique secret key for each output."
            )
        seen_digests.add(e["key_digest"])

    if check_for_duplicates_blind(enriched, environment):
        raise ValidationError("One or more secret keys already exist at this path")

    masked_map = {f.id: f.masked for f in provider_cls.output_schema}
    return [
        {
            "id": e["id"],
            "key_name": e["key_name"],
            "key_digest": e["key_digest"],
            "masked": masked_map.get(e["id"], True),
        }
        for e in enriched
    ]


def validate_provider_config(provider_id: str, config: dict) -> None:
    provider_cls = get_provider(provider_id)
    for field in provider_cls.config_schema:
        if field.required and field.id not in config:
            if field.default is None:
                raise RotationProviderConfigError(
                    f"Missing required config field: {field.id}",
                    user_message=f"'{field.label}' is required.",
                )
    provider_cls.validate_config(config)


def auto_enable_sse(app) -> None:
    from backend.api.kv import write  # noqa: F401  (only to keep dependency parity)

    if app.sse_enabled:
        return
    app.sse_enabled = True
    app.save(update_fields=["sse_enabled"])


def assert_sse_enabled(app) -> None:
    if not app.sse_enabled:
        raise ValidationError(
            "Server-Side Encryption must be enabled on this App before "
            "creating a rotating secret. Enable SSE on the App settings."
        )
