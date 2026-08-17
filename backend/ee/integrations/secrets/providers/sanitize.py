from __future__ import annotations

import re
from typing import Any

SENSITIVE_KEY_TOKENS = (
    "key",
    "secret",
    "token",
    "password",
    "passwd",
    "credential",
    "authorization",
    "auth",
)

# Identifier keys that match SENSITIVE_KEY_TOKENS but are safe to keep.
SAFE_KEY_NAMES = frozenset(
    {
        "key_id",
        "api_key_id",
        "key_name",
        "key_digest",
        "key_alias",
        "token_id",
        "deleted_keys",
        "provider_credential_id",
        "user_id",
        "team_id",
        "project_id",
        "agent_id",
        "organization_id",
        "budget_id",
    }
)

_VALUE_SECRET_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"(?i)(Bearer|Basic)\s+[A-Za-z0-9._\-/+=]{8,}"),
    re.compile(r"sk-(?:proj-|ant-|live-|test-|admin-)?[A-Za-z0-9_\-]{10,}"),
    re.compile(r"gh[psoru]_[A-Za-z0-9]{20,}"),
    re.compile(r"github_pat_[A-Za-z0-9_]{20,}"),
    re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"),
    re.compile(r"xox[abprs]-[A-Za-z0-9-]{10,}"),
    re.compile(r"eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}"),
    re.compile(r"ph:v\d+:[A-Za-z0-9+/=]{20,}:[A-Za-z0-9+/=]{20,}"),
)

REDACTED = "***"
MAX_EXCERPT_LEN = 512


def _looks_sensitive(key: str) -> bool:
    lowered = key.lower()
    if lowered in SAFE_KEY_NAMES:
        return False
    return any(token in lowered for token in SENSITIVE_KEY_TOKENS)


def _redact_value_patterns(text: str) -> str:
    out = text
    for pattern in _VALUE_SECRET_PATTERNS:
        out = pattern.sub(REDACTED, out)
    return out


def sanitize(value: Any, extra_sensitive_keys: list[str] | None = None) -> Any:
    """Recursively redact sensitive dict values, inline-redact credential-shaped substrings, and truncate strings."""
    extra = {k.lower() for k in (extra_sensitive_keys or [])}

    def _walk(node):
        if isinstance(node, dict):
            return {
                k: (
                    REDACTED
                    if (_looks_sensitive(k) or k.lower() in extra)
                    else _walk(v)
                )
                for k, v in node.items()
            }
        if isinstance(node, (list, tuple)):
            return [_walk(item) for item in node]
        if isinstance(node, str):
            return _redact_value_patterns(node)[:MAX_EXCERPT_LEN]
        return node

    return _walk(value)


def excerpt(response_text: str | None) -> str:
    """Bounded, redacted excerpt for raw response bodies."""
    if not response_text:
        return ""
    return _redact_value_patterns(response_text)[:MAX_EXCERPT_LEN]
