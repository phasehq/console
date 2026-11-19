"""User-defined HTTP Connections ("custom Connections").

A definition never carries a secret: secret fields name their source, and
identifier fields hold a value the Agent may see.
"""

from __future__ import annotations

from copy import deepcopy
import re
from typing import Any, Mapping

from .access_policy import validate_operation_classes, validate_path_glob
from .registry import (
    ConfigRegistryError,
    get_config_registry,
    validate_host_rules,
)


HTTP_SERVICE_TYPE = "http"
HTTP_DISPLAY_NAME = "Custom HTTP"
# The built-in Connection to an app's secrets. The Console serves them itself,
# so it has no definition, credential or proxy configuration.
APP_SERVICE_TYPE = "phase_app"
APP_DISPLAY_NAME = "App secrets"
LATEST_SPEC_VERSION = 1

MAX_HOSTS = 20
MAX_FIELDS = 10
MAX_INJECTIONS = 10
MAX_IDENTIFIER_VALUE_LENGTH = 256
MAX_PREFIX_LENGTH = 64
MAX_NAME_LENGTH = 128

FIELD_KINDS = frozenset({"secret", "identifier"})
SECRET_SOURCE_TYPES = frozenset({"sealed"})
INJECTION_TYPES = frozenset({"header", "basic", "query"})
WHEN_ABSENT_MODES = frozenset({"attach", "block"})
PRESETS = frozenset({"bearer", "basic", "headers", "query"})

# What a client must list in ``client.features`` to enforce any custom Connection.
REQUIRED_CLIENT_FEATURES = ("injection_list", "when_absent")

_FIELD_NAME = re.compile(r"^[a-z][a-z0-9]{0,31}$")
_ENVIRONMENT_NAME = re.compile(r"^[A-Z][A-Z0-9_]{0,63}$")
_DECOY_PREFIX = re.compile(r"^[A-Za-z0-9_-]{0,16}$")
_HEADER_TOKEN = re.compile(r"^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$")
_CONTROL_CHARACTER = re.compile(r"[\x00-\x1f\x7f-\x9f]")

_REFUSED_HEADERS = frozenset(
    {
        "host",
        "content-length",
        "transfer-encoding",
        "connection",
        "proxy-authorization",
        "proxy-connection",
        "upgrade",
        "te",
        "trailer",
    }
)
_RESERVED_ENVIRONMENT_NAMES = frozenset(
    {
        "PATH",
        "HOME",
        "SHELL",
        "USER",
        "PWD",
        "TMPDIR",
        "NODE_OPTIONS",
        "PYTHONPATH",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "NO_PROXY",
        "ALL_PROXY",
        "SSL_CERT_FILE",
        "SSL_CERT_DIR",
        "NODE_EXTRA_CA_CERTS",
        "REQUESTS_CA_BUNDLE",
        "CURL_CA_BUNDLE",
        "BASH_ENV",
        "ENV",
        "ZDOTDIR",
        "PROMPT_COMMAND",
        "IFS",
        "EDITOR",
        "VISUAL",
        "PAGER",
        "BROWSER",
        "KUBECONFIG",
        "DOCKER_HOST",
        "DOCKER_CONFIG",
        "SSH_AUTH_SOCK",
        "SSH_ASKPASS",
        "XDG_CONFIG_HOME",
        "CLASSPATH",
        "JAVA_TOOL_OPTIONS",
        "_JAVA_OPTIONS",
        "JDK_JAVA_OPTIONS",
        "MAVEN_OPTS",
        "GRADLE_OPTS",
        "RUBYOPT",
        "RUBYLIB",
        "PERL5OPT",
        "PERL5LIB",
        "NODE_PATH",
        "NODE_TLS_REJECT_UNAUTHORIZED",
        "GOFLAGS",
        "GOPROXY",
        "GOPATH",
        "GOPRIVATE",
        "GOINSECURE",
        "GONOSUMDB",
    }
)
_RESERVED_ENVIRONMENT_PREFIXES = (
    "PHASE_",
    "LD_",
    "DYLD_",
    "GIT_",
    "PYTHON",
    "NPM_CONFIG_",
    "PIP_",
    "UV_",
)
# An identifier exports a literal value a member or an Agent's request chose, so
# a name that redirects or configures a tool is refused for it.
_REDIRECTING_ENVIRONMENT_SUFFIXES = (
    "_URL",
    "_URI",
    "_BASE",
    "_ENDPOINT",
    "_HOST",
    "_PROXY",
    "_REGISTRY",
    "_OPTIONS",
    "_OPTS",
    "_PATH",
    "_HOME",
    "_CONFIG",
    "_FLAGS",
)

# Decoys reuse the registry's format machinery: a literal prefix and one random
# macro. 32 alphanumeric characters carry about 190 bits.
_DECOY_RANDOM_MACRO = "{rand:alnum:32}"


class DefinitionError(ConfigRegistryError):
    """A custom Connection definition is invalid or of an unknown version."""


# {from_version: upgrade}, each returning the definition at from_version + 1.
_UPGRADES: dict[int, Any] = {}


def is_custom_service(service_type: Any) -> bool:
    return service_type == HTTP_SERVICE_TYPE


def is_app_service(service_type: Any) -> bool:
    return service_type == APP_SERVICE_TYPE


def upgrade_definition(definition: Any) -> dict[str, Any]:
    """Return a stored definition in the latest shape, without storing it."""

    if not isinstance(definition, Mapping):
        raise DefinitionError("definition: expected an object")
    version = definition.get("specVersion")
    if (
        isinstance(version, bool)
        or not isinstance(version, int)
        or not 1 <= version <= LATEST_SPEC_VERSION
    ):
        raise DefinitionError(
            f"definition.specVersion: unsupported version {version!r}"
        )
    upgraded = deepcopy(dict(definition))
    while upgraded["specVersion"] < LATEST_SPEC_VERSION:
        upgraded = _UPGRADES[upgraded["specVersion"]](upgraded)
    return upgraded


def _keys(value, *, required, optional=(), location):
    if not isinstance(value, Mapping):
        raise DefinitionError(f"{location}: expected an object")
    required = set(required)
    missing = sorted(required - set(value))
    unknown = sorted(str(key) for key in set(value) - required - set(optional))
    if missing:
        raise DefinitionError(
            f"{location}: missing required field(s): {', '.join(missing)}"
        )
    if unknown:
        raise DefinitionError(f"{location}: unknown field(s): {', '.join(unknown)}")
    return value


def _items(value, *, maximum, location):
    if not isinstance(value, list) or not 1 <= len(value) <= maximum:
        raise DefinitionError(f"{location}: expected 1 to {maximum} entries")
    return value


def _text(value, location):
    if not isinstance(value, str) or not value:
        raise DefinitionError(f"{location}: expected a non-empty string")
    return value


def _packaged_environment_names() -> frozenset[str]:
    return frozenset(
        binding["name"]
        for service in get_config_registry().services.values()
        for binding in service["environment_bindings"]
    )


def _choice(value, allowed):
    """Whether ``value`` is one of ``allowed``; JSON lists and objects never are."""

    return isinstance(value, str) and value in allowed


def _environment_name(value, location, kind="secret"):
    name = _text(value, location)
    if not _ENVIRONMENT_NAME.fullmatch(name):
        raise DefinitionError(
            f"{location}: expected an upper-case name of at most 64 characters"
        )
    # The runtime API renders JSON keys through a case converter that rewrites
    # an underscore followed by a digit, so such a name would not reach the
    # client intact as an environment map key.
    if re.search(r"_[0-9]", name):
        raise DefinitionError(
            f"{location}: a digit must not directly follow an underscore"
        )
    if (
        name in _RESERVED_ENVIRONMENT_NAMES
        or name.startswith(_RESERVED_ENVIRONMENT_PREFIXES)
        or name in _packaged_environment_names()
    ):
        raise DefinitionError(f"{location}: {name} is reserved")
    if kind == "identifier" and name.endswith(_REDIRECTING_ENVIRONMENT_SUFFIXES):
        raise DefinitionError(
            f"{location}: an identifier cannot be exported under {name}, a "
            "variable that redirects or configures tools"
        )
    return name


def _validate_fields(value, location):
    fields = []
    names = set()
    environment_names = set()
    for index, raw in enumerate(_items(value, maximum=MAX_FIELDS, location=location)):
        field_location = f"{location}[{index}]"
        if not isinstance(raw, Mapping):
            raise DefinitionError(f"{field_location}: expected an object")
        kind = raw.get("kind")
        if not _choice(kind, FIELD_KINDS):
            raise DefinitionError(
                f"{field_location}.kind: expected 'secret' or 'identifier'"
            )
        if kind == "secret":
            if "value" in raw:
                raise DefinitionError(
                    f"{field_location}: a secret field never carries a value"
                )
            _keys(
                raw,
                required={"name", "kind", "source"},
                optional={"env", "decoyPrefix"},
                location=field_location,
            )
        else:
            _keys(
                raw,
                required={"name", "kind", "value"},
                optional={"env"},
                location=field_location,
            )
        name = _text(raw["name"], f"{field_location}.name")
        if not _FIELD_NAME.fullmatch(name):
            raise DefinitionError(
                f"{field_location}.name: expected lower-case letters and digits, "
                "starting with a letter, at most 32 characters"
            )
        if name in names:
            raise DefinitionError(f"{field_location}.name: duplicate field {name!r}")
        names.add(name)

        field = {"name": name, "kind": kind}
        if kind == "secret":
            source = _keys(
                raw["source"], required={"type"}, location=f"{field_location}.source"
            )
            if not _choice(source["type"], SECRET_SOURCE_TYPES):
                raise DefinitionError(
                    f"{field_location}.source.type: expected 'sealed'"
                )
            field["source"] = {"type": source["type"]}
        else:
            identifier = raw["value"]
            if (
                not isinstance(identifier, str)
                or not identifier.strip()
                or len(identifier) > MAX_IDENTIFIER_VALUE_LENGTH
                or _CONTROL_CHARACTER.search(identifier)
            ):
                raise DefinitionError(
                    f"{field_location}.value: expected 1 to "
                    f"{MAX_IDENTIFIER_VALUE_LENGTH} characters, not blank, "
                    "without control characters"
                )
            field["value"] = identifier
        if raw.get("env") is not None:
            environment_name = _environment_name(
                raw["env"], f"{field_location}.env", kind
            )
            if environment_name in environment_names:
                raise DefinitionError(
                    f"{field_location}.env: duplicate environment name "
                    f"{environment_name!r}"
                )
            environment_names.add(environment_name)
            field["env"] = environment_name
        if kind == "secret" and raw.get("decoyPrefix") not in (None, ""):
            prefix = raw["decoyPrefix"]
            if not isinstance(prefix, str) or not _DECOY_PREFIX.fullmatch(prefix):
                raise DefinitionError(
                    f"{field_location}.decoyPrefix: expected at most 16 letters, "
                    "digits, '_' or '-'"
                )
            field["decoyPrefix"] = prefix
        fields.append(field)
    return fields


def _field_reference(value, kinds, expected, location):
    name = _text(value, location)
    if kinds.get(name) != expected:
        article = "an" if expected == "identifier" else "a"
        raise DefinitionError(f"{location}: expected {article} {expected} field")
    return name


def _validate_injections(value, fields, location):
    kinds = {field["name"]: field["kind"] for field in fields}
    injections = []
    headers = set()
    parameters = set()
    used = set()
    for index, raw in enumerate(
        _items(value, maximum=MAX_INJECTIONS, location=location)
    ):
        injection_location = f"{location}[{index}]"
        if not isinstance(raw, Mapping):
            raise DefinitionError(f"{injection_location}: expected an object")
        injection_type = raw.get("type")
        if not _choice(injection_type, INJECTION_TYPES):
            raise DefinitionError(
                f"{injection_location}.type: expected 'header', 'basic' or 'query'"
            )
        required = {"type", "field"}
        optional = {"whenAbsent"}
        if injection_type == "header":
            required.add("name")
            optional.add("prefix")
        elif injection_type == "basic":
            required.add("usernameField")
        else:
            required.add("name")
        _keys(raw, required=required, optional=optional, location=injection_location)

        injection = {"type": injection_type}
        if injection_type == "header":
            name = _text(raw["name"], f"{injection_location}.name")
            if len(name) > MAX_NAME_LENGTH or not _HEADER_TOKEN.fullmatch(name):
                raise DefinitionError(
                    f"{injection_location}.name: expected an HTTP header name"
                )
            if name.lower() in _REFUSED_HEADERS:
                raise DefinitionError(
                    f"{injection_location}.name: the {name} header cannot be set"
                )
            header = name.lower()
            injection["name"] = name
            prefix = raw.get("prefix")
            if prefix not in (None, ""):
                # The compiled value format has exactly one ``{value}`` slot.
                if (
                    not isinstance(prefix, str)
                    or len(prefix) > MAX_PREFIX_LENGTH
                    or _CONTROL_CHARACTER.search(prefix)
                    or "{" in prefix
                    or "}" in prefix
                ):
                    raise DefinitionError(
                        f"{injection_location}.prefix: expected at most "
                        f"{MAX_PREFIX_LENGTH} characters without control "
                        "characters or braces"
                    )
                injection["prefix"] = prefix
        elif injection_type == "basic":
            header = "authorization"
            injection["usernameField"] = _field_reference(
                raw["usernameField"],
                kinds,
                "identifier",
                f"{injection_location}.usernameField",
            )
        else:
            header = None
            name = _text(raw["name"], f"{injection_location}.name")
            if (
                len(name) > MAX_NAME_LENGTH
                or any(character in name for character in "&=")
                or _CONTROL_CHARACTER.search(name)
            ):
                raise DefinitionError(
                    f"{injection_location}.name: expected a query parameter name "
                    "without '&', '=' or control characters"
                )
            if name in parameters:
                raise DefinitionError(
                    f"{injection_location}.name: query parameter {name!r} is "
                    "already written by another injection"
                )
            parameters.add(name)
            injection["name"] = name
        if header is not None:
            if header in headers:
                raise DefinitionError(
                    f"{injection_location}: the {header} header is already "
                    "written by another injection"
                )
            headers.add(header)

        injection["field"] = _field_reference(
            raw["field"], kinds, "secret", f"{injection_location}.field"
        )
        used.add(injection["field"])
        when_absent = raw.get("whenAbsent", "attach")
        if not _choice(when_absent, WHEN_ABSENT_MODES):
            raise DefinitionError(
                f"{injection_location}.whenAbsent: expected 'attach' or 'block'"
            )
        injection["whenAbsent"] = when_absent
        injections.append(injection)

    unused = sorted(
        name for name, kind in kinds.items() if kind == "secret" and name not in used
    )
    if unused:
        raise DefinitionError(
            f"{location}: secret field(s) not used by any injection: "
            f"{', '.join(unused)}"
        )
    return injections


def _validate_hosts(value, location):
    _items(value, maximum=MAX_HOSTS, location=location)
    try:
        checked = validate_host_rules(value, protocol="http", location=location)
    except DefinitionError:
        raise
    except ConfigRegistryError as exc:
        raise DefinitionError(str(exc)) from exc
    hosts = []
    for index, rule in enumerate(checked):
        host = {"match": rule["match"], "value": rule["value"]}
        if "port" in rule:
            host["port"] = rule["port"]
        if "path" in rule:
            try:
                host["path"] = validate_path_glob(
                    rule["path"], f"{location}[{index}].path"
                )
            except ConfigRegistryError as exc:
                raise DefinitionError(str(exc)) from exc
        hosts.append(host)
    return hosts


def validate_definition(definition: Any) -> dict[str, Any]:
    """Validate a definition and return it canonical, in the latest version.

    Every write goes through here, including Agent requests, and the result is what gets stored.
    """

    definition = upgrade_definition(definition)
    _keys(
        definition,
        required={"specVersion", "hosts", "fields", "injections"},
        optional={"preset", "allowPlainHttp", "operationClasses"},
        location="definition",
    )
    fields = _validate_fields(definition["fields"], "definition.fields")
    checked = {
        "specVersion": LATEST_SPEC_VERSION,
        "hosts": _validate_hosts(definition["hosts"], "definition.hosts"),
        "fields": fields,
        "injections": _validate_injections(
            definition["injections"], fields, "definition.injections"
        ),
    }
    preset = definition.get("preset")
    if preset is not None:
        if not _choice(preset, PRESETS):
            raise DefinitionError(
                "definition.preset: expected 'bearer', 'basic', 'headers' or 'query'"
            )
        checked["preset"] = preset
    allow_plain_http = definition.get("allowPlainHttp", False)
    if not isinstance(allow_plain_http, bool):
        raise DefinitionError("definition.allowPlainHttp: expected a boolean")
    if allow_plain_http:
        # Written only when set, so the default has one stored spelling.
        checked["allowPlainHttp"] = True
    if definition.get("operationClasses"):
        # How an access policy classifies this service's calls, where the
        # method alone would mislead. Written only when there are any.
        try:
            checked["operationClasses"] = validate_operation_classes(
                definition["operationClasses"], "definition.operationClasses"
            )
        except DefinitionError:
            raise
        except ConfigRegistryError as exc:
            raise DefinitionError(str(exc)) from exc
    elif definition.get("operationClasses") not in (None, []):
        raise DefinitionError("definition.operationClasses: expected a list")
    return checked


def load_definition(config: Any) -> dict[str, Any]:
    """Read a stored definition: upgrade it in memory and check it still holds."""

    return validate_definition(config)


def reduce_hosts(hosts: Any) -> list[dict[str, Any]]:
    """Host rules reduced to what a sealed value binds: match, value and port.

    Paths are not bound. The result is sorted and deduplicated.
    """

    reduced = {}
    for rule in hosts:
        value = str(rule["value"]).lower().rstrip(".")
        port = rule.get("port")
        reduced[(value, rule["match"], -1 if port is None else port)] = (
            {"match": rule["match"], "value": value}
            if port is None
            else {"match": rule["match"], "value": value, "port": port}
        )
    return [reduced[key] for key in sorted(reduced)]


def bound_hosts(definition: Mapping[str, Any]) -> list[dict[str, Any]]:
    return reduce_hosts(definition["hosts"])


def secret_field_names(definition: Mapping[str, Any]) -> list[str]:
    return [
        field["name"] for field in definition["fields"] if field["kind"] == "secret"
    ]


def identifier_values(definition: Mapping[str, Any]) -> dict[str, str]:
    return {
        field["name"]: field["value"]
        for field in definition["fields"]
        if field["kind"] == "identifier"
    }


def agent_visible_texts(definition: Mapping[str, Any]) -> list[tuple[str, str]]:
    """The free text of a definition that reaches the Agent, with a label each.

    No secret may occur in any of it: the proxy treats a live value found there as a leak.
    """

    texts = []
    for field in definition["fields"]:
        if field["kind"] == "identifier":
            texts.append((f"the value of {field['name']}", field["value"]))
        elif field.get("decoyPrefix"):
            texts.append(
                (f"the decoy prefix of {field['name']}", field["decoyPrefix"])
            )
    for injection in definition["injections"]:
        if injection.get("prefix"):
            texts.append(
                (f"the prefix of the {injection['name']} header", injection["prefix"])
            )
        if injection["type"] == "header":
            texts.append(("a header name", injection["name"]))
        elif injection["type"] == "query":
            texts.append(("a query parameter name", injection["name"]))
    for number, host in enumerate(definition["hosts"], start=1):
        texts.append((f"host {number}", host["value"]))
        if host.get("path"):
            texts.append((f"the path of host {number}", host["path"]))
    classes = definition.get("operationClasses", [])
    for number, entry in enumerate(classes, start=1):
        path = entry["match"].get("path")
        if path:
            texts.append((f"the path of call class {number}", path))
    return texts


def compile_injections(definition: Mapping[str, Any]) -> list[dict[str, Any]]:
    """The wire ``injections`` list the proxy enforces, in definition order."""

    compiled = []
    for injection in definition["injections"]:
        if injection["type"] == "header":
            entry = {
                "action": "set_header",
                "name": injection["name"],
                "value_format": f"{injection.get('prefix', '')}{{value}}",
                "value_from": {"source": "credential", "field": injection["field"]},
            }
        elif injection["type"] == "basic":
            entry = {
                "action": "basic_auth",
                "name": "Authorization",
                "value_from": {
                    "source": "credential",
                    "fields": {
                        "username": injection["usernameField"],
                        "password": injection["field"],
                    },
                },
            }
        else:
            entry = {
                "action": "set_param",
                "name": injection["name"],
                "value_format": "{value}",
                "value_from": {"source": "credential", "field": injection["field"]},
            }
        entry["when_absent"] = injection["whenAbsent"]
        compiled.append(entry)
    return compiled


def _describe_host(rule):
    host = rule["value"] if rule["match"] == "exact" else f"*{rule['value']}"
    if "port" in rule:
        host = f"{host}:{rule['port']}"
    return f"{host}{rule.get('path', '')}"


def _context_template(definition):
    hosts = ", ".join(_describe_host(rule) for rule in definition["hosts"])
    points = []
    for injection in definition["injections"]:
        if injection["type"] == "header":
            points.append(f"the {injection['name']} header")
        elif injection["type"] == "basic":
            points.append(
                "HTTP Basic authentication as "
                f"{{{{ {injection['usernameField']} }}}}"
            )
        else:
            points.append(f"the {injection['name']} query parameter")
    lines = [
        f"HTTP service through the Phase proxy for {hosts}.",
        f"The proxy supplies the credential in {', '.join(points)}; a request "
        "may carry the placeholder value or none.",
    ]
    exported = [
        f"{field['env']} ({field['name']})"
        for field in definition["fields"]
        if field.get("env")
    ]
    if exported:
        lines.append(f"Environment: {', '.join(exported)}.")
    return " ".join(lines)


def compile_service(definition: Mapping[str, Any]) -> dict[str, Any]:
    """Compile a validated definition into registry-shaped service data."""

    fields = {}
    decoy_format = {}
    environment_bindings = []
    for field in definition["fields"]:
        secret = field["kind"] == "secret"
        fields[field["name"]] = {
            "class": field["kind"],
            "delivery": "decoy" if secret else "real",
        }
        if secret:
            decoy_format[field["name"]] = (
                f"{field.get('decoyPrefix', '')}{_DECOY_RANDOM_MACRO}"
            )
        if field.get("env"):
            environment_bindings.append(
                {
                    "name": field["env"],
                    "action": "set",
                    "source": "decoy" if secret else "identifier",
                    "source_field": field["name"],
                    "sensitive": secret,
                    "system_managed": True,
                }
            )
    injections = compile_injections(definition)
    return {
        "schemaVersion": 1,
        "service_type": HTTP_SERVICE_TYPE,
        "display_name": HTTP_DISPLAY_NAME,
        "provider": None,
        "protocol": "http",
        "hosts": [],
        "host_rules_mode": "required_endpoint",
        "config_schema": [],
        # Clients that predate the list still validate the singular key.
        "injection": injections[0],
        "injections": injections,
        "fields": fields,
        "decoy_format": decoy_format,
        "environment_bindings": environment_bindings,
        "credential_providers": [],
        "client_matchers": [],
        "context_template": _context_template(definition),
        "proxy_only": False,
        "on_refresh": "none",
        "identifier_values": identifier_values(definition),
        "required_features": list(REQUIRED_CLIENT_FEATURES),
        # Unless set, the proxy never puts the value on a plain-HTTP request.
        "allow_plain_http": bool(definition.get("allowPlainHttp", False)),
        "operation_classes": deepcopy(definition.get("operationClasses", [])),
        # The Connection's own fields are what its tools read credentials from.
        "credential_environment": sorted(
            binding["name"] for binding in environment_bindings
        ),
    }


def service_for_connection(connection) -> dict[str, Any]:
    """Service data for any Connection: packaged from the registry, or compiled."""

    if is_custom_service(connection.service_type):
        return compile_service(load_definition(connection.config))
    return get_config_registry().get_service(connection.service_type)
