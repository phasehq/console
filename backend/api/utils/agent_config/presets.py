"""Provider presets for custom HTTP Connections.

A preset pre-fills the custom HTTP form for a well-known provider: its hosts,
where the secret goes, a suggested environment name and how its calls are
classified. It never holds a secret and uses no stored integration credential.
Presets are data files, validated when this module loads, so a broken one
fails at startup.
"""

from __future__ import annotations

from collections.abc import Mapping
from copy import deepcopy
import json
from pathlib import Path
import re
from typing import Any

from .http_definition import secret_field_names, validate_definition
from .registry import ConfigRegistryError


PRESET_SCHEMA_VERSION = 1
DEFAULT_PRESET_ROOT = Path(__file__).with_name("presets") / "v1"

CATEGORIES = frozenset(
    {
        "ai",
        "cloud",
        "communication",
        "mcp",
        "observability",
        "payments",
        "project-management",
        "source-control",
    }
)

_ID = re.compile(r"^[a-z][a-z0-9-]{0,31}$")
_KEYS = frozenset(
    {
        "schemaVersion",
        "id",
        "name",
        "description",
        "docsUrl",
        "category",
        "hostsEditable",
        "labels",
        "definition",
    }
)
_MAX_NAME_LENGTH = 64
_MAX_DESCRIPTION_LENGTH = 280
# Stands in for the hosts of a preset whose host the member enters.
_SAMPLE_HOSTS = [{"match": "exact", "value": "host.example.com", "port": 443}]


class PresetError(ConfigRegistryError):
    """A preset is invalid, unknown, or cannot be expanded as asked."""


def _text(value, maximum, location):
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise PresetError(f"{location}: expected 1 to {maximum} characters")
    return value


def _validate_preset(document: Any, path: Path) -> dict[str, Any]:
    location = f"preset[{path.stem}]"
    if not isinstance(document, Mapping):
        raise PresetError(f"{location}: expected an object")
    if set(document) != _KEYS:
        difference = sorted(set(document) ^ _KEYS)
        raise PresetError(
            f"{location}: missing or unknown field(s): {', '.join(difference)}"
        )
    if document["schemaVersion"] != PRESET_SCHEMA_VERSION:
        raise PresetError(f"{location}: unsupported schemaVersion")
    preset_id = document["id"]
    if (
        not isinstance(preset_id, str)
        or not _ID.fullmatch(preset_id)
        or preset_id != path.stem
    ):
        raise PresetError(f"{location}.id: expected the file's own name")
    if document["category"] not in CATEGORIES:
        raise PresetError(f"{location}.category: unknown category")
    docs_url = document["docsUrl"]
    if not isinstance(docs_url, str) or not docs_url.startswith("https://"):
        raise PresetError(f"{location}.docsUrl: expected an https URL")
    hosts_editable = document["hostsEditable"]
    if not isinstance(hosts_editable, bool):
        raise PresetError(f"{location}.hostsEditable: expected a boolean")

    definition = document["definition"]
    if not isinstance(definition, Mapping):
        raise PresetError(f"{location}.definition: expected an object")
    needs_hosts = definition.get("hosts") == []
    if needs_hosts and not hosts_editable:
        raise PresetError(
            f"{location}.definition.hosts: a preset without hosts must let "
            "them be entered"
        )
    try:
        checked = validate_definition(
            {**definition, "hosts": _SAMPLE_HOSTS} if needs_hosts else definition
        )
    except ConfigRegistryError as exc:
        raise PresetError(f"{location}.{exc}") from exc
    if needs_hosts:
        checked["hosts"] = []

    labels = document["labels"]
    secrets = set(secret_field_names(checked))
    if not isinstance(labels, Mapping) or set(labels) != secrets:
        raise PresetError(
            f"{location}.labels: expected one label for each secret field"
        )
    return {
        "id": preset_id,
        "name": _text(document["name"], _MAX_NAME_LENGTH, f"{location}.name"),
        "description": _text(
            document["description"],
            _MAX_DESCRIPTION_LENGTH,
            f"{location}.description",
        ),
        "docsUrl": docs_url,
        "category": document["category"],
        "hostsEditable": hosts_editable,
        "labels": {
            name: _text(label, _MAX_NAME_LENGTH, f"{location}.labels.{name}")
            for name, label in labels.items()
        },
        "definition": checked,
    }


def load_presets(root: Path | str = DEFAULT_PRESET_ROOT) -> dict[str, dict[str, Any]]:
    """Load and validate every preset in a versioned directory."""

    directory = Path(root)
    if not directory.is_dir():
        raise PresetError(f"Missing preset directory: {directory}")
    presets = {}
    for path in sorted(directory.glob("*.json")):
        try:
            document = json.loads(path.read_text(encoding="utf-8"))
        except ValueError as exc:
            raise PresetError(f"preset[{path.stem}]: invalid JSON") from exc
        preset = _validate_preset(document, path)
        presets[preset["id"]] = preset
    if not presets:
        raise PresetError(f"No presets found in {directory}")
    return presets


PRESETS = load_presets()


def list_presets() -> list[dict[str, Any]]:
    """Every preset in full, ordered by name."""

    return deepcopy(sorted(PRESETS.values(), key=lambda preset: preset["name"].lower()))


def preset_summaries() -> list[dict[str, Any]]:
    """What a client needs to offer a preset: no definition, no labels."""

    return [
        {
            "id": preset["id"],
            "name": preset["name"],
            "description": preset["description"],
            "hosts": preset["definition"]["hosts"],
            "category": preset["category"],
        }
        for preset in list_presets()
    ]


def get_preset(preset_id: Any) -> dict[str, Any]:
    preset = PRESETS.get(preset_id) if isinstance(preset_id, str) else None
    if preset is None:
        raise PresetError(f"Unknown preset {preset_id!r}")
    return deepcopy(preset)


def expand_preset(preset_id: Any, hosts: Any = None) -> dict[str, Any]:
    """The full definition a preset stands for, validated.

    ``hosts`` replaces the preset's own, and is accepted only for a preset
    whose hosts may be changed.
    """

    preset = get_preset(preset_id)
    definition = preset["definition"]
    if hosts is not None:
        if not preset["hostsEditable"]:
            raise PresetError(
                f"The {preset['name']} preset does not let its hosts be changed"
            )
        definition["hosts"] = hosts
    elif not definition["hosts"]:
        raise PresetError(f"The {preset['name']} preset needs hosts")
    return validate_definition(definition)
