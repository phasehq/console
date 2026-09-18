"""Strict, versioned loader for the AI Agents service registry.

A service owns host matching, provider compatibility, protocol behavior and
wire injection. Live material comes only from the bound ``ProviderCredentials``
row.

Every service definition is validated while the registry is loaded so an
invalid packaged definition fails closed instead of becoming a permissive
runtime configuration.

Definitions are plain JSON under ``services/v1``. Fields whose value is
currently fixed for every packaged service are not authored at all; the loader
supplies them so a definition states only what distinguishes it.
"""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from ipaddress import ip_address
import json
import math
from pathlib import Path
import re
from string import Formatter
from types import MappingProxyType
from typing import Any, Iterable, Mapping
from urllib.parse import urlparse

from api.services import Providers


SCHEMA_VERSION = 1
CLIENT_MATCHER_SCHEMA_VERSION = 1
DEFAULT_SERVICE_ROOT = Path(__file__).with_name("services") / "v1"

PROTOCOLS = frozenset({"http", "postgres"})
HOST_RULES_MODES = frozenset({"required_endpoint", "optional_override"})
ON_REFRESH_MODES = frozenset({"none", "synthetic_ok"})

REQUEST_EDIT_ACTIONS = frozenset(
    {
        "set_header",
        "replace_header",
        "remove_header",
        "set_param",
        "set_path",
        "replace_path_regex",
    }
)
FINALIZER_ACTIONS = frozenset({"aws_sigv4", "pg_handshake"})
INJECTION_ACTIONS = REQUEST_EDIT_ACTIONS | FINALIZER_ACTIONS

_ACTION_PROTOCOLS = {
    "set_header": "http",
    "replace_header": "http",
    "remove_header": "http",
    "set_param": "http",
    "set_path": "http",
    "replace_path_regex": "http",
    "aws_sigv4": "http",
    "pg_handshake": "postgres",
}

_FINALIZER_FIELDS = {
    "aws_sigv4": frozenset({"access_key_id", "secret_access_key"}),
    "pg_handshake": frozenset({"username", "password"}),
}
_FINALIZER_OPTIONAL_FIELDS = {
    "aws_sigv4": frozenset({"session_token"}),
    "pg_handshake": frozenset(),
}

_CONFIG_INPUT_TYPES = frozenset(
    {"string", "int", "bool", "list", "kv", "url", "host_rules", "enum"}
)
ENVIRONMENT_BINDING_ACTIONS = frozenset({"set", "unset"})
ENVIRONMENT_BINDING_SOURCES = frozenset(
    {
        "proxy",
        "ca",
        "connection_config",
        "identifier",
        "decoy",
        "runtime",
    }
)
CLIENT_MATCHER_KINDS = frozenset({"executable", "uri_scheme"})

_IDENTIFIER = re.compile(r"^[a-z][a-z0-9_]*$")
_ENVIRONMENT_NAME = re.compile(r"^[A-Z_][A-Z0-9_]*$")
_RAND_MACRO = re.compile(r"\{rand:(base64|alnum|hex):(\d+)\}")
_HOST_LABEL = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")
_CONTEXT_VARIABLE = re.compile(r"\{\{\s*([a-z][a-z0-9_.]*)\s*\}\}")
_EXECUTABLE_MATCHER_VALUE = re.compile(r"^[a-z0-9][a-z0-9._+-]{0,63}$")
_URI_SCHEME_MATCHER_VALUE = re.compile(r"^[a-z][a-z0-9+.-]{0,63}$")


class ConfigRegistryError(ValueError):
    """A registry template is invalid or ambiguous."""


class ConfigCompatibilityError(ConfigRegistryError):
    """A valid service and credential method cannot be combined."""


class _DuplicateKeyError(ValueError):
    pass


def _pairs_without_duplicates(pairs: Iterable[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise _DuplicateKeyError(f"duplicate key {key!r}")
        result[key] = value
    return result


def _load_service_document(path: Path) -> Mapping[str, Any]:
    try:
        contents = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise ConfigRegistryError(f"Could not read template {path}: {exc}") from exc

    try:
        document = json.loads(contents, object_pairs_hook=_pairs_without_duplicates)
    except _DuplicateKeyError as exc:
        raise ConfigRegistryError(f"{path}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise ConfigRegistryError(
            f"{path}: service definition must be valid JSON: {exc}"
        ) from exc

    if not isinstance(document, Mapping):
        raise ConfigRegistryError(f"{path}: service definition must be an object")
    return document


def _check_keys(
    value: Mapping[str, Any],
    *,
    required: Iterable[str] = (),
    optional: Iterable[str] = (),
    location: str,
) -> None:
    non_string_keys = [key for key in value if not isinstance(key, str)]
    if non_string_keys:
        raise ConfigRegistryError(
            f"{location}: object keys must be strings, got "
            f"{', '.join(map(repr, non_string_keys))}"
        )
    required_set = set(required)
    allowed = required_set | set(optional)
    missing = sorted(required_set - set(value))
    unknown = sorted(set(value) - allowed)
    if missing:
        raise ConfigRegistryError(
            f"{location}: missing required field(s): {', '.join(missing)}"
        )
    if unknown:
        raise ConfigRegistryError(
            f"{location}: unknown field(s): {', '.join(unknown)}"
        )


def _mapping(value: Any, location: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ConfigRegistryError(f"{location}: expected an object")
    return value


def _list(value: Any, location: str) -> list[Any]:
    if not isinstance(value, list):
        raise ConfigRegistryError(f"{location}: expected a list")
    return value


def _string(value: Any, location: str, *, allow_empty: bool = False) -> str:
    if not isinstance(value, str) or (not allow_empty and not value.strip()):
        qualifier = "a string" if allow_empty else "a non-empty string"
        raise ConfigRegistryError(f"{location}: expected {qualifier}")
    return value


def _identifier(value: Any, location: str) -> str:
    result = _string(value, location)
    if not _IDENTIFIER.fullmatch(result):
        raise ConfigRegistryError(
            f"{location}: expected a lower-case snake_case identifier"
        )
    return result


def _string_list(
    value: Any, location: str, *, allow_empty: bool = False
) -> list[str]:
    result = _list(value, location)
    if not allow_empty and not result:
        raise ConfigRegistryError(f"{location}: list must not be empty")
    for index, item in enumerate(result):
        _string(item, f"{location}[{index}]")
    if len(result) != len(set(result)):
        raise ConfigRegistryError(f"{location}: duplicate values are not allowed")
    return result


def _validate_client_matchers(value: Any, location: str) -> list[dict[str, Any]]:
    """Validate exact, data-only hints used by local Agent clients.

    Templates deliberately cannot supply regular expressions, paths, shell
    fragments, or arguments. The local client owns parsing and decides whether
    to use Phase; this registry only declares exact executable basenames and
    URI schemes associated with a service.
    """

    matchers = _list(value, location)
    validated: list[dict[str, Any]] = []
    seen_kinds: set[str] = set()
    for index, matcher in enumerate(matchers):
        matcher_location = f"{location}[{index}]"
        matcher = _mapping(matcher, matcher_location)
        _check_keys(
            matcher,
            required={"kind", "values"},
            location=matcher_location,
        )
        kind = _string(matcher["kind"], f"{matcher_location}.kind")
        if kind not in CLIENT_MATCHER_KINDS:
            raise ConfigRegistryError(
                f"{matcher_location}.kind: expected one of "
                f"{', '.join(sorted(CLIENT_MATCHER_KINDS))}"
            )
        if kind in seen_kinds:
            raise ConfigRegistryError(
                f"{matcher_location}.kind: duplicate matcher kind {kind!r}"
            )
        seen_kinds.add(kind)
        values = _string_list(
            matcher["values"], f"{matcher_location}.values"
        )
        value_pattern = (
            _EXECUTABLE_MATCHER_VALUE
            if kind == "executable"
            else _URI_SCHEME_MATCHER_VALUE
        )
        for value_index, item in enumerate(values):
            item_location = f"{matcher_location}.values[{value_index}]"
            if item != item.lower() or not value_pattern.fullmatch(item):
                raise ConfigRegistryError(
                    f"{item_location}: expected a canonical lower-case exact value"
                )
            if kind == "executable" and item.endswith(".exe"):
                raise ConfigRegistryError(
                    f"{item_location}: executable values omit platform extensions"
                )
        validated.append({"kind": kind, "values": sorted(values)})
    return sorted(validated, key=lambda matcher: matcher["kind"])


def _validate_schema_version(document: Mapping[str, Any], location: str) -> None:
    version = document.get("schemaVersion")
    if version != SCHEMA_VERSION:
        raise ConfigRegistryError(
            f"{location}: unsupported schemaVersion {version!r}, expected "
            f"{SCHEMA_VERSION}"
        )


def _validate_hostname(value: str, location: str, match: str) -> None:
    if value != value.lower() or value.endswith("."):
        raise ConfigRegistryError(
            f"{location}: host values must be canonical lower-case names without "
            "a trailing dot"
        )
    if "://" in value or "/" in value or "*" in value:
        raise ConfigRegistryError(
            f"{location}: host values must not contain a scheme, path, or wildcard"
        )
    hostname = value
    if match == "suffix":
        if not value.startswith("."):
            raise ConfigRegistryError(
                f"{location}: suffix host values must begin with '.'"
            )
        hostname = value[1:]
    elif value.startswith("."):
        raise ConfigRegistryError(
            f"{location}: exact host values must not begin with '.'"
        )

    try:
        ip_address(hostname)
        if match == "suffix":
            raise ConfigRegistryError(
                f"{location}: IP addresses cannot be suffix host rules"
            )
        return
    except ValueError:
        pass

    if len(hostname) > 253:
        raise ConfigRegistryError(f"{location}: host name is too long")
    for label in hostname.split("."):
        if not _HOST_LABEL.fullmatch(label):
            raise ConfigRegistryError(f"{location}: invalid host label {label!r}")


def _validate_host_rule(rule: Any, location: str, protocol: str) -> dict[str, Any]:
    rule = _mapping(rule, location)
    _check_keys(
        rule,
        required={"match", "value"},
        optional={"port", "path"},
        location=location,
    )
    match = _string(rule["match"], f"{location}.match")
    if match not in {"exact", "suffix"}:
        raise ConfigRegistryError(
            f"{location}.match: expected 'exact' or 'suffix'"
        )
    value = _string(rule["value"], f"{location}.value")
    _validate_hostname(value, f"{location}.value", match)

    if "port" in rule:
        port = rule["port"]
        if (
            isinstance(port, bool)
            or not isinstance(port, int)
            or not 1 <= port <= 65535
        ):
            raise ConfigRegistryError(
                f"{location}.port: expected an integer from 1 through 65535"
            )
    if "path" in rule:
        path = _string(rule["path"], f"{location}.path")
        if protocol != "http":
            raise ConfigRegistryError(
                f"{location}.path: path matching is only valid for HTTP"
            )
        if not path.startswith("/"):
            raise ConfigRegistryError(
                f"{location}.path: HTTP paths must begin with '/'"
            )
    return dict(rule)


def validate_host_rules(
    rules: Any, *, protocol: str, location: str = "hosts", allow_empty: bool = False
) -> list[dict[str, Any]]:
    """Validate canonical structured host rules and return a safe copy."""

    rules = _list(rules, location)
    if not rules and not allow_empty:
        raise ConfigRegistryError(f"{location}: at least one host rule is required")
    validated: list[dict[str, Any]] = []
    seen: set[tuple[Any, ...]] = set()
    for index, rule in enumerate(rules):
        checked = _validate_host_rule(rule, f"{location}[{index}]", protocol)
        identity = (
            checked["match"],
            checked["value"],
            checked.get("port"),
            checked.get("path"),
        )
        if identity in seen:
            raise ConfigRegistryError(
                f"{location}[{index}]: duplicate host rule is ambiguous"
            )
        seen.add(identity)
        validated.append(checked)
    if validated and protocol == "postgres" and (
        len(validated) != 1 or validated[0]["match"] != "exact"
    ):
        raise ConfigRegistryError(
            f"{location}: {protocol} v1 requires exactly one exact upstream host"
        )
    return validated


def _validate_value_format(value: Any, location: str) -> None:
    value = _string(value, location, allow_empty=True)
    fields: list[str] = []
    try:
        for _, field_name, format_spec, conversion in Formatter().parse(value):
            if field_name is not None:
                fields.append(field_name)
                if format_spec or conversion:
                    raise ConfigRegistryError(
                        f"{location}: format specs and conversions are not supported"
                    )
    except ValueError as exc:
        raise ConfigRegistryError(f"{location}: invalid value format: {exc}") from exc
    if fields != ["value"]:
        raise ConfigRegistryError(
            f"{location}: expected exactly one '{{value}}' placeholder"
        )


def _validate_value_source(
    value: Any,
    *,
    action: str,
    service_fields: set[str],
    location: str,
) -> None:
    source = _mapping(value, location)
    if action == "remove_header":
        _check_keys(source, required={"source"}, location=location)
        if source["source"] != "none":
            raise ConfigRegistryError(
                f"{location}.source: remove_header requires the explicit 'none' source"
            )
        return

    if action in REQUEST_EDIT_ACTIONS:
        _check_keys(source, required={"source", "field"}, location=location)
        if source["source"] != "credential":
            raise ConfigRegistryError(
                f"{location}.source: request edits require 'credential'"
            )
        field = _identifier(source["field"], f"{location}.field")
        if field not in service_fields:
            raise ConfigRegistryError(
                f"{location}.field: unknown service credential field {field!r}"
            )
        return

    _check_keys(source, required={"source", "fields"}, location=location)
    if source["source"] != "credential":
        raise ConfigRegistryError(
            f"{location}.source: finalizers require 'credential'"
        )
    fields = _mapping(source["fields"], f"{location}.fields")
    required = _FINALIZER_FIELDS[action]
    missing = sorted(required - set(fields))
    if missing:
        raise ConfigRegistryError(
            f"{location}.fields: missing finalizer field(s): {', '.join(missing)}"
        )
    unknown = sorted(
        set(fields) - required - _FINALIZER_OPTIONAL_FIELDS[action]
    )
    if unknown:
        raise ConfigRegistryError(
            f"{location}.fields: unsupported finalizer field(s): "
            f"{', '.join(unknown)}"
        )
    for role, field in fields.items():
        _identifier(role, f"{location}.fields key")
        field = _identifier(field, f"{location}.fields.{role}")
        if field not in service_fields:
            raise ConfigRegistryError(
                f"{location}.fields.{role}: unknown service credential field "
                f"{field!r}"
            )


def _validate_injection(
    value: Any, *, protocol: str, service_fields: set[str], location: str
) -> dict[str, Any]:
    injection = _mapping(value, location)
    action = _string(injection.get("action"), f"{location}.action")
    if action not in INJECTION_ACTIONS:
        raise ConfigRegistryError(f"{location}.action: unsupported action {action!r}")
    expected_protocol = _ACTION_PROTOCOLS[action]
    if protocol != expected_protocol:
        raise ConfigRegistryError(
            f"{location}.action: {action!r} requires protocol {expected_protocol!r}"
        )

    common = {"action", "value_from"}
    required = set(common)
    optional: set[str] = set()
    if action in {"set_header", "replace_header", "remove_header", "set_param"}:
        required.add("name")
    elif action == "replace_path_regex":
        required.add("pattern")

    if action in REQUEST_EDIT_ACTIONS - {"remove_header"}:
        required.add("value_format")
    if action == "aws_sigv4":
        required.update({"service_from", "region_from"})
    _check_keys(
        injection,
        required=required,
        optional=optional,
        location=location,
    )
    _validate_value_source(
        injection["value_from"],
        action=action,
        service_fields=service_fields,
        location=f"{location}.value_from",
    )
    if "name" in injection:
        _string(injection["name"], f"{location}.name")
    if "pattern" in injection:
        pattern = _string(injection["pattern"], f"{location}.pattern")
        try:
            re.compile(pattern)
        except re.error as exc:
            raise ConfigRegistryError(
                f"{location}.pattern: invalid regular expression: {exc}"
            ) from exc
    if "value_format" in injection:
        _validate_value_format(injection["value_format"], f"{location}.value_format")
    if action == "aws_sigv4":
        for key in ("service_from", "region_from"):
            if injection[key] not in {"host", "config"}:
                raise ConfigRegistryError(
                    f"{location}.{key}: expected 'host' or 'config'"
                )
    return dict(injection)


def _validate_fields(value: Any, location: str) -> dict[str, dict[str, Any]]:
    fields = _mapping(value, location)
    if not fields:
        raise ConfigRegistryError(
            f"{location}: at least one credential field is required"
        )
    validated: dict[str, dict[str, Any]] = {}
    for field_id, raw in fields.items():
        _identifier(field_id, f"{location} key")
        field = _mapping(raw, f"{location}.{field_id}")
        _check_keys(
            field,
            required={"class"},
            optional={"delivery"},
            location=f"{location}.{field_id}",
        )
        classification = field["class"]
        if classification not in {"identifier", "secret"}:
            raise ConfigRegistryError(
                f"{location}.{field_id}.class: expected 'identifier' or 'secret'"
            )
        delivery = field.get(
            "delivery", "real" if classification == "identifier" else "decoy"
        )
        expected = {"real"} if classification == "identifier" else {"decoy"}
        if delivery not in expected:
            raise ConfigRegistryError(
                f"{location}.{field_id}.delivery: invalid for {classification} field"
            )
        checked = dict(field)
        checked["delivery"] = delivery
        validated[field_id] = checked
    return validated


def _validate_decoys(
    value: Any, fields: Mapping[str, Mapping[str, Any]], location: str
) -> dict[str, str]:
    decoys = _mapping(value, location)
    expected = {
        field_id
        for field_id, field in fields.items()
        if field["class"] == "secret" and field["delivery"] == "decoy"
    }
    actual = set(decoys)
    # AWS access-key IDs are public identifiers with a fixed 20-character
    # shape. They are still decoyed so the live identifier remains proxy-only.
    expected.update(
        field_id
        for field_id, raw_format in decoys.items()
        if field_id in fields
        and fields[field_id]["class"] == "identifier"
        and raw_format == "{aws_access_key_id}"
    )
    if actual != expected:
        missing = sorted(expected - actual)
        extra = sorted(actual - expected)
        detail = []
        if missing:
            detail.append(f"missing {', '.join(missing)}")
        if extra:
            detail.append(f"unexpected {', '.join(extra)}")
        raise ConfigRegistryError(f"{location}: {'; '.join(detail)}")

    validated: dict[str, str] = {}
    bits_per_character = {"base64": 6.0, "alnum": math.log2(62), "hex": 4.0}
    for field_id, raw_format in decoys.items():
        decoy_format = _string(raw_format, f"{location}.{field_id}")
        if decoy_format == "{aws_access_key_id}":
            validated[field_id] = decoy_format
            continue
        macros = list(_RAND_MACRO.finditer(decoy_format))
        if len(macros) != 1:
            raise ConfigRegistryError(
                f"{location}.{field_id}: expected exactly one random macro"
            )
        charset, length_string = macros[0].groups()
        entropy = bits_per_character[charset] * int(length_string)
        if entropy < 128:
            raise ConfigRegistryError(
                f"{location}.{field_id}: decoy must contain at least 128 bits of "
                "randomness"
            )
        remainder = _RAND_MACRO.sub("", decoy_format)
        if "{" in remainder or "}" in remainder:
            raise ConfigRegistryError(
                f"{location}.{field_id}: unsupported decoy placeholder"
            )
        validated[field_id] = decoy_format
    return validated


def _validate_environment_bindings(
    value: Any,
    *,
    fields: Mapping[str, Mapping[str, Any]],
    config_schema: list[Mapping[str, Any]],
    location: str,
) -> list[dict[str, Any]]:
    """Validate the declarative provider-to-process environment contract.

    Service templates own connection configuration, identifier, decoy, and
    conditional cleanup bindings. Proxy URLs and CA paths are intentionally
    reserved for the CLI because their values and paths exist only on the
    machine hosting the proxy.
    """

    bindings = _list(value, location)
    if not bindings:
        raise ConfigRegistryError(
            f"{location}: at least one environment binding is required"
        )
    config_fields = {field["id"]: field for field in config_schema}
    validated: list[dict[str, Any]] = []
    names: set[str] = set()
    for index, raw in enumerate(bindings):
        binding_location = f"{location}[{index}]"
        binding = _mapping(raw, binding_location)
        _check_keys(
            binding,
            required={"name", "action", "source"},
            optional={"source_field", "sensitive"},
            location=binding_location,
        )
        name = _string(binding["name"], f"{binding_location}.name")
        if not _ENVIRONMENT_NAME.fullmatch(name):
            raise ConfigRegistryError(
                f"{binding_location}.name: expected a canonical environment "
                "variable name"
            )
        if name in names:
            raise ConfigRegistryError(
                f"{binding_location}.name: duplicate environment binding {name!r}"
            )
        names.add(name)

        action = _string(binding["action"], f"{binding_location}.action")
        if action not in ENVIRONMENT_BINDING_ACTIONS:
            raise ConfigRegistryError(
                f"{binding_location}.action: expected 'set' or 'unset'"
            )
        source = _string(binding["source"], f"{binding_location}.source")
        if source not in ENVIRONMENT_BINDING_SOURCES:
            raise ConfigRegistryError(
                f"{binding_location}.source: unsupported environment source"
            )
        sensitive = binding.get("sensitive", False)
        if not isinstance(sensitive, bool):
            raise ConfigRegistryError(
                f"{binding_location}.sensitive: expected a boolean"
            )
        if action == "unset" and "sensitive" in binding:
            raise ConfigRegistryError(
                f"{binding_location}.sensitive: cleanup bindings remove a variable "
                "and carry no value to classify"
            )

        source_field = binding.get("source_field")
        if source_field is not None:
            source_field = _identifier(
                source_field, f"{binding_location}.source_field"
            )

        if action == "set":
            if source not in {"connection_config", "identifier", "decoy"}:
                raise ConfigRegistryError(
                    f"{binding_location}.source: service set bindings must use "
                    "connection_config, identifier, or decoy"
                )
            if source_field is None:
                raise ConfigRegistryError(
                    f"{binding_location}.source_field: required for set bindings"
                )
            if source == "connection_config":
                config_field = config_fields.get(source_field)
                if config_field is None:
                    raise ConfigRegistryError(
                        f"{binding_location}.source_field: unknown connection config "
                        f"field {source_field!r}"
                    )
                if config_field.get("secret", False):
                    raise ConfigRegistryError(
                        f"{binding_location}.source_field: secret connection config "
                        "cannot be emitted to an Agent process"
                    )
            else:
                credential_field = fields.get(source_field)
                expected_class = "identifier" if source == "identifier" else "secret"
                if credential_field is None or credential_field["class"] != expected_class:
                    raise ConfigRegistryError(
                        f"{binding_location}.source_field: {source} bindings require "
                        f"a {expected_class} credential field"
                    )
                if source == "decoy" and credential_field["delivery"] != "decoy":
                    raise ConfigRegistryError(
                        f"{binding_location}.source_field: decoy binding requires "
                        "decoy delivery"
                    )
        else:
            if source != "runtime":
                raise ConfigRegistryError(
                    f"{binding_location}.source: service unset bindings must use runtime"
                )
            if source_field is None:
                raise ConfigRegistryError(
                    f"{binding_location}.source_field: cleanup must name the decoy "
                    "field that activates it"
                )
            trigger = fields.get(source_field)
            if (
                trigger is None
                or trigger["class"] != "secret"
                or trigger["delivery"] != "decoy"
            ):
                raise ConfigRegistryError(
                    f"{binding_location}.source_field: cleanup must be activated by "
                    "a decoy credential field"
                )

        checked = dict(binding)
        checked["sensitive"] = sensitive
        # Every registry binding is owned by Phase. The flag stays on the wire
        # so the CLI can tell Phase-managed variables from the user's own.
        checked["system_managed"] = True
        if source_field is not None:
            checked["source_field"] = source_field
        validated.append(checked)
    return validated


def _validate_context_template(
    value: Any,
    fields: Mapping[str, Mapping[str, Any]],
    location: str,
) -> None:
    template = _string(value, location)
    referenced = set(_CONTEXT_VARIABLE.findall(template))
    remainder = _CONTEXT_VARIABLE.sub("", template)
    if "{{" in remainder or "}}" in remainder:
        raise ConfigRegistryError(f"{location}: invalid context placeholder")
    allowed = {
        field_id
        for field_id, field in fields.items()
        if field["class"] == "identifier"
    }
    unknown = sorted(referenced - allowed)
    if unknown:
        raise ConfigRegistryError(
            f"{location}: context may reference only identifier fields, "
            f"rejected {', '.join(unknown)}"
        )


def _validate_config_schema(value: Any, location: str) -> list[dict[str, Any]]:
    schema = _list(value, location)
    validated: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, raw in enumerate(schema):
        field_location = f"{location}[{index}]"
        field = _mapping(raw, field_location)
        _check_keys(
            field,
            required={"id", "input_type"},
            optional={
                "required",
                "secret",
                "default",
                "help_text",
                "options",
                "min_items",
            },
            location=field_location,
        )
        field_id = _identifier(field["id"], f"{field_location}.id")
        if field_id in seen:
            raise ConfigRegistryError(
                f"{field_location}.id: duplicate config field {field_id!r}"
            )
        seen.add(field_id)
        input_type = _string(field["input_type"], f"{field_location}.input_type")
        if input_type not in _CONFIG_INPUT_TYPES:
            raise ConfigRegistryError(
                f"{field_location}.input_type: unsupported type {input_type!r}"
            )
        for flag in ("required", "secret"):
            if flag in field and not isinstance(field[flag], bool):
                raise ConfigRegistryError(
                    f"{field_location}.{flag}: expected a boolean"
                )
        if input_type == "enum":
            options = _string_list(field.get("options"), f"{field_location}.options")
            if "default" in field and field["default"] not in options:
                raise ConfigRegistryError(
                    f"{field_location}.default: value is not an enum option"
                )
        elif "options" in field:
            raise ConfigRegistryError(
                f"{field_location}.options: options are only valid for enums"
            )
        if "min_items" in field:
            min_items = field["min_items"]
            if input_type not in {"list", "kv"}:
                raise ConfigRegistryError(
                    f"{field_location}.min_items: only valid for list and kv fields"
                )
            if (
                isinstance(min_items, bool)
                or not isinstance(min_items, int)
                or min_items < 0
            ):
                raise ConfigRegistryError(
                    f"{field_location}.min_items: expected a non-negative integer"
                )
        if "help_text" in field:
            _string(field["help_text"], f"{field_location}.help_text")
        if "default" in field:
            _validate_config_value(
                field["default"], field, f"{field_location}.default", protocol=None
            )
        validated.append(dict(field))
    return validated


def _validate_config_value(
    value: Any,
    field: Mapping[str, Any],
    location: str,
    *,
    protocol: str | None,
) -> Any:
    input_type = field["input_type"]
    if input_type == "string":
        return _string(value, location)
    if input_type == "int":
        if isinstance(value, bool) or not isinstance(value, int):
            raise ConfigRegistryError(f"{location}: expected an integer")
        return value
    if input_type == "bool":
        if not isinstance(value, bool):
            raise ConfigRegistryError(f"{location}: expected a boolean")
        return value
    if input_type == "list":
        result = _string_list(value, location, allow_empty=True)
        if len(result) < field.get("min_items", 0):
            raise ConfigRegistryError(
                f"{location}: expected at least {field['min_items']} item(s)"
            )
        return result
    if input_type == "kv":
        values = _mapping(value, location)
        for key, item in values.items():
            _identifier(key, f"{location} key")
            _string(item, f"{location}.{key}", allow_empty=True)
        if len(values) < field.get("min_items", 0):
            raise ConfigRegistryError(
                f"{location}: expected at least {field['min_items']} item(s)"
            )
        return dict(values)
    if input_type == "url":
        parsed = urlparse(_string(value, location))
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ConfigRegistryError(
                f"{location}: expected an absolute HTTP(S) URL"
            )
        if parsed.username or parsed.password or parsed.fragment:
            raise ConfigRegistryError(
                f"{location}: URLs must not contain credentials or fragments"
            )
        return value
    if input_type == "host_rules":
        if protocol is None:
            if value:
                raise ConfigRegistryError(
                    f"{location}: host_rules defaults cannot be protocol-agnostic"
                )
            return []
        return validate_host_rules(value, protocol=protocol, location=location)
    if input_type == "enum":
        if value not in field["options"]:
            raise ConfigRegistryError(
                f"{location}: expected one of {', '.join(field['options'])}"
            )
        return value
    raise AssertionError(f"unhandled config input type {input_type}")


def _validate_service(document: Mapping[str, Any], path: Path) -> dict[str, Any]:
    location = str(path)
    _check_keys(
        document,
        required={
            "schemaVersion",
            "service_type",
            "display_name",
            "provider",
            "protocol",
            "hosts",
            "host_rules_mode",
            "config_schema",
            "injection",
            "fields",
            "decoy_format",
            "environment_bindings",
            "credential_providers",
            "client_matchers",
            "context_template",
        },
        optional={"proxy_only", "on_refresh"},
        location=location,
    )
    _validate_schema_version(document, location)
    service_type = _identifier(document["service_type"], f"{location}.service_type")
    if path.stem != service_type:
        raise ConfigRegistryError(
            f"{location}: filename must match service_type {service_type!r}"
        )
    _string(document["display_name"], f"{location}.display_name")
    proxy_only = document.get("proxy_only", False)
    if not isinstance(proxy_only, bool):
        raise ConfigRegistryError(f"{location}.proxy_only: expected a boolean")

    provider = document["provider"]
    known_providers = {
        provider_id for provider_id, _ in Providers.get_provider_choices()
    }
    if proxy_only:
        if provider is not None:
            raise ConfigRegistryError(
                f"{location}.provider: proxy-only services must use null"
            )
    elif provider not in known_providers:
        raise ConfigRegistryError(
            f"{location}.provider: unknown api.services.Providers id {provider!r}"
        )
    credential_providers = _string_list(
        document["credential_providers"],
        f"{location}.credential_providers",
        allow_empty=True,
    )
    unknown_providers = sorted(set(credential_providers) - known_providers)
    if unknown_providers:
        raise ConfigRegistryError(
            f"{location}.credential_providers: unknown provider(s): "
            f"{', '.join(unknown_providers)}"
        )
    if proxy_only and credential_providers:
        raise ConfigRegistryError(
            f"{location}.credential_providers: proxy-only services cannot "
            "accept integration credentials"
        )
    if credential_providers and provider not in credential_providers:
        raise ConfigRegistryError(
            f"{location}.credential_providers: must include the service provider"
        )
    client_matchers = _validate_client_matchers(
        document["client_matchers"], f"{location}.client_matchers"
    )
    if credential_providers and not client_matchers:
        raise ConfigRegistryError(
            f"{location}.client_matchers: services available to Agent Connections "
            "must declare at least one exact client matcher"
        )

    protocol = _string(document["protocol"], f"{location}.protocol")
    if protocol not in PROTOCOLS:
        raise ConfigRegistryError(f"{location}.protocol: unsupported protocol")
    hosts = validate_host_rules(
        document["hosts"],
        protocol=protocol,
        location=f"{location}.hosts",
        allow_empty=True,
    )
    config_schema = _validate_config_schema(
        document["config_schema"], f"{location}.config_schema"
    )
    secret_config_fields = sorted(
        field["id"] for field in config_schema if field.get("secret", False)
    )
    if secret_config_fields:
        raise ConfigRegistryError(
            f"{location}.config_schema: service connection configuration is "
            "Agent-visible and cannot contain secret fields; use a Credential "
            f"method for {', '.join(secret_config_fields)}"
        )
    host_config = next(
        (field for field in config_schema if field["input_type"] == "host_rules"),
        None,
    )
    if not hosts and (host_config is None or not host_config.get("required", False)):
        raise ConfigRegistryError(
            f"{location}: a service needs static hosts or a required host_rules "
            "config field"
        )
    host_rules_mode = _string(
        document["host_rules_mode"], f"{location}.host_rules_mode"
    )
    if host_rules_mode not in HOST_RULES_MODES:
        raise ConfigRegistryError(
            f"{location}.host_rules_mode: expected 'required_endpoint' or "
            "'optional_override'"
        )
    if host_rules_mode == "required_endpoint" and (
        hosts or host_config is None or not host_config.get("required", False)
    ):
        raise ConfigRegistryError(
            f"{location}.host_rules_mode: required_endpoint needs no static hosts "
            "and a required host_rules config field"
        )
    if host_rules_mode == "optional_override" and (
        not hosts or host_config is None or host_config.get("required", False)
    ):
        raise ConfigRegistryError(
            f"{location}.host_rules_mode: optional_override needs static hosts and "
            "an optional host_rules config field"
        )

    fields = _validate_fields(document["fields"], f"{location}.fields")
    _validate_decoys(document["decoy_format"], fields, f"{location}.decoy_format")
    environment_bindings = _validate_environment_bindings(
        document["environment_bindings"],
        fields=fields,
        config_schema=config_schema,
        location=f"{location}.environment_bindings",
    )
    _validate_injection(
        document["injection"],
        protocol=protocol,
        service_fields=set(fields),
        location=f"{location}.injection",
    )

    on_refresh = document.get("on_refresh", "none")
    if on_refresh not in ON_REFRESH_MODES:
        raise ConfigRegistryError(
            f"{location}.on_refresh: expected 'none' or 'synthetic_ok'"
        )
    _validate_context_template(
        document["context_template"], fields, f"{location}.context_template"
    )

    checked = deepcopy(dict(document))
    checked["proxy_only"] = proxy_only
    checked["on_refresh"] = on_refresh
    checked["hosts"] = hosts
    checked["config_schema"] = config_schema
    checked["fields"] = fields
    checked["environment_bindings"] = environment_bindings
    checked["credential_providers"] = credential_providers
    checked["client_matchers"] = client_matchers
    return checked


def host_rules_require_independent_approval(
    service: Mapping[str, Any], config: Mapping[str, Any]
) -> bool:
    """Return whether configured hosts replace a registry-trusted endpoint set."""

    return bool(
        service["host_rules_mode"] == "optional_override" and config.get("hosts")
    )


def _load_documents(directory: Path) -> list[tuple[Path, Mapping[str, Any]]]:
    if not directory.is_dir():
        raise ConfigRegistryError(f"Missing service directory: {directory}")
    paths = sorted(directory.glob("*.json"))
    if not paths:
        raise ConfigRegistryError(f"No service definitions found in {directory}")
    return [(path, _load_service_document(path)) for path in paths]


@dataclass(frozen=True)
class ConfigRegistry:
    """Validated, immutable-by-interface registry snapshot."""

    schema_version: int
    _services: Mapping[str, Mapping[str, Any]]
    _capabilities: Mapping[str, Any]

    @classmethod
    def load(
        cls, service_root: Path | str = DEFAULT_SERVICE_ROOT
    ) -> "ConfigRegistry":
        raw_services = _load_documents(Path(service_root))
        services: dict[str, dict[str, Any]] = {}
        host_owners: dict[tuple[Any, ...], str] = {}
        for path, document in raw_services:
            checked = _validate_service(document, path)
            service_type = checked["service_type"]
            if service_type in services:
                raise ConfigRegistryError(f"Duplicate service type {service_type!r}")
            for rule in checked["hosts"]:
                identity = (
                    checked["protocol"],
                    rule["match"],
                    rule["value"],
                    rule.get("port"),
                    rule.get("path"),
                )
                owner = host_owners.get(identity)
                if owner is not None:
                    raise ConfigRegistryError(
                        f"Ambiguous host rule shared by services {owner!r} and "
                        f"{service_type!r}: {rule}"
                    )
                host_owners[identity] = service_type
            services[service_type] = checked

        capabilities = {
            "protocols": sorted({service["protocol"] for service in services.values()}),
            "injectionActions": sorted(
                {service["injection"]["action"] for service in services.values()}
            ),
            "credentialProviders": sorted(
                {
                    provider
                    for service in services.values()
                    for provider in service["credential_providers"]
                }
            ),
            "environmentBindingActions": sorted(ENVIRONMENT_BINDING_ACTIONS),
            "environmentBindingSources": sorted(ENVIRONMENT_BINDING_SOURCES),
            "clientMatcherKinds": sorted(CLIENT_MATCHER_KINDS),
        }
        return cls(
            schema_version=SCHEMA_VERSION,
            _services=MappingProxyType(services),
            _capabilities=MappingProxyType(capabilities),
        )

    @property
    def services(self) -> dict[str, dict[str, Any]]:
        return deepcopy(dict(self._services))

    @property
    def capabilities(self) -> dict[str, Any]:
        return deepcopy(dict(self._capabilities))

    def get_service(self, service_type: str) -> dict[str, Any]:
        try:
            return deepcopy(dict(self._services[service_type]))
        except KeyError as exc:
            raise ConfigRegistryError(f"Unknown service type {service_type!r}") from exc

    def validate_service_config(
        self, service_type: str, config: Mapping[str, Any]
    ) -> dict[str, Any]:
        service = self.get_service(service_type)
        return _validate_config(
            config,
            service["config_schema"],
            location=f"service[{service_type}].config",
            protocol=service["protocol"],
        )

    def resolve_host_rules(
        self, service_type: str, config: Mapping[str, Any]
    ) -> list[dict[str, Any]]:
        """Resolve a connection's host override or the template defaults."""

        service = self.get_service(service_type)
        checked = self.validate_service_config(service_type, config)
        return deepcopy(checked.get("hosts", service["hosts"]))

    def as_dict(self) -> dict[str, Any]:
        return {
            "schemaVersion": self.schema_version,
            "capabilities": self.capabilities,
            "services": self.services,
        }


def _validate_config(
    config: Mapping[str, Any],
    schema: list[Mapping[str, Any]],
    *,
    location: str,
    protocol: str | None,
) -> dict[str, Any]:
    config = _mapping(config, location)
    fields = {field["id"]: field for field in schema}
    unknown = sorted(set(config) - set(fields))
    if unknown:
        raise ConfigRegistryError(
            f"{location}: unknown config field(s): {', '.join(unknown)}"
        )
    result: dict[str, Any] = {}
    for field_id, field in fields.items():
        if field_id in config:
            result[field_id] = _validate_config_value(
                config[field_id],
                field,
                f"{location}.{field_id}",
                protocol=protocol,
            )
        elif "default" in field:
            result[field_id] = deepcopy(field["default"])
        elif field.get("required", False):
            raise ConfigRegistryError(
                f"{location}: missing required config field {field_id!r}"
            )
    return result


def load_registry(
    service_root: Path | str = DEFAULT_SERVICE_ROOT,
) -> ConfigRegistry:
    """Load and validate a registry snapshot from a versioned service root."""

    return ConfigRegistry.load(service_root)


# Eager validation makes a broken packaged definition fail at import/startup,
# not after a workflow reaches the proxy.
REGISTRY = load_registry()


def get_config_registry() -> ConfigRegistry:
    return REGISTRY
