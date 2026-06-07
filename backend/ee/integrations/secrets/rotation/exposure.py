from __future__ import annotations

from typing import Iterable

from django.apps import apps


def _normalize_path(path: str | None) -> str | None:
    if path is None:
        return None
    if not path:
        return "/"
    return path


def _key_map_entries_with_envelopes(rotating_secret) -> Iterable[tuple[str, str]]:
    for entry in rotating_secret.key_map or []:
        if not isinstance(entry, dict):
            continue
        yield entry.get("id"), entry


def build_rotating_secret_rows(environment, path: str | None = None) -> list:
    """Return unsaved Secret instances synthesized from the ACTIVE credential of every active RotatingSecret in the environment."""
    Secret = apps.get_model("api", "Secret")
    RotatingSecret = apps.get_model("api", "RotatingSecret")
    RotatingSecretCredential = apps.get_model("api", "RotatingSecretCredential")

    qs = RotatingSecret.objects.filter(
        environment=environment,
        deleted_at__isnull=True,
    ).prefetch_related("credentials")
    normalized = _normalize_path(path)
    if normalized is not None:
        qs = qs.filter(path=normalized)

    rows: list = []
    for rs in qs:
        active = (
            rs.credentials.filter(status=RotatingSecretCredential.ACTIVE)
            .order_by("-created_at")
            .first()
        )
        if active is None:
            continue
        encrypted_values = active.encrypted_values or {}
        for output_id, entry in _key_map_entries_with_envelopes(rs):
            encrypted_value = encrypted_values.get(output_id)
            if encrypted_value is None:
                continue
            key_name = entry.get("key_name") or entry.get("key") or ""
            key_digest = entry.get("key_digest") or entry.get("keyDigest") or ""
            row = Secret(
                path=rs.path,
                key=key_name,
                key_digest=key_digest,
                value=encrypted_value,
                version=1,
                comment="",
                type="secret",
                created_at=active.created_at,
                updated_at=active.created_at,
            )
            row.id = f"rs:{active.id}:{output_id}"
            # Assign FK by *_id to bypass Django's ForeignKey instance-type check while the row stays unsaved.
            row.environment_id = getattr(environment, "id", None)
            row.folder_id = getattr(rs.folder, "id", None) if rs.folder else None
            row._rotating_secret_id = rs.id
            row._rotating_credential_id = active.id
            rows.append(row)
    return rows


def parse_synthetic_id(synthetic_id: str) -> tuple[str, str] | None:
    """Parse ``rs:<cred_id>:<output_id>`` into (cred_id, output_id), or None."""
    if not isinstance(synthetic_id, str) or not synthetic_id.startswith("rs:"):
        return None
    parts = synthetic_id.split(":", 2)
    if len(parts) != 3:
        return None
    return parts[1], parts[2]


def build_synthetic_secret_for_cred_output(credential, output_id: str):
    """Return one unsaved Secret instance for the (credential, output) pair, or None if no longer valid."""
    Secret = apps.get_model("api", "Secret")
    rs = credential.rotating_secret
    entry = next(
        (e for e in (rs.key_map or []) if isinstance(e, dict) and e.get("id") == output_id),
        None,
    )
    if entry is None:
        return None
    encrypted_value = (credential.encrypted_values or {}).get(output_id)
    if encrypted_value is None:
        return None
    row = Secret(
        path=rs.path,
        key=entry.get("key_name") or entry.get("key") or "",
        key_digest=entry.get("key_digest") or entry.get("keyDigest") or "",
        value=encrypted_value,
        version=1,
        comment="",
        type="secret",
        created_at=credential.created_at,
        updated_at=credential.created_at,
    )
    row.id = f"rs:{credential.id}:{output_id}"
    row.environment_id = rs.environment_id
    row.environment = rs.environment
    row.folder_id = rs.folder_id
    if rs.folder is not None:
        row.folder = rs.folder
    row._rotating_secret_id = rs.id
    row._rotating_credential_id = credential.id
    return row


def find_active_credential_for_digest(environment, key_digest: str, path: str | None = None):
    """Return (RotatingSecret, RotatingSecretCredential, encrypted_value) for a key_digest in the env/path, or None."""
    RotatingSecret = apps.get_model("api", "RotatingSecret")
    RotatingSecretCredential = apps.get_model("api", "RotatingSecretCredential")

    qs = RotatingSecret.objects.filter(
        environment=environment,
        deleted_at__isnull=True,
    )
    normalized = _normalize_path(path)
    if normalized is not None:
        qs = qs.filter(path=normalized)

    for rs in qs:
        for entry in rs.key_map or []:
            digest = entry.get("key_digest") or entry.get("keyDigest")
            if digest != key_digest:
                continue
            active = (
                rs.credentials.filter(status=RotatingSecretCredential.ACTIVE)
                .order_by("-created_at")
                .first()
            )
            if active is None:
                return None
            encrypted_value = (active.encrypted_values or {}).get(entry.get("id"))
            if encrypted_value is None:
                return None
            return rs, active, encrypted_value
    return None
