"""Access policies on a Connection.

A policy says which calls through a Connection are allowed, need a member's
approval, or are blocked. It is stored on the Connection, apart from its
definition, applies to every Workflow granted the Connection, and can only
narrow what the Connection allows. A temporary allow is an approved exception
to an ``ask`` and belongs to one Workflow's grant. This module validates a
policy on every write and compiles the block the proxy enforces.

The secret guard is not part of any stored policy: it is a managed entry added
to every compiled policy, and no rule or temporary allow can name its class or
an AWS action that mints credentials.
"""

from __future__ import annotations

from collections.abc import Mapping
from copy import deepcopy
from fnmatch import fnmatchcase
import re
from typing import Any

from django.utils.dateparse import parse_datetime

from .errors import ConfigRegistryError


POLICY_VERSION = 1
ACCESS_POLICY_FEATURE = "access_policy"

EFFECTS = ("allow", "ask", "block")
USER_CLASSES = ("read", "create", "update", "delete", "admin")
# Calls that mint new credentials or assume another identity. Only the secret
# guard names this class.
CREDENTIAL_MINTING = "credential_minting"
HTTP_METHODS = frozenset(
    {"GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE", "CONNECT", "TRACE"}
)

MAX_RULES = 50
MAX_OPERATION_CLASSES = 50
MAX_PATH_LENGTH = 1024

# The services whose calls are classified by a named operation, so a rule or
# an allow may name one: an AWS action such as ``ec2:TerminateInstances``.
OPERATION_SERVICE_TYPES = frozenset({"aws"})
_OPERATION = re.compile(r"^[a-z0-9-]{1,64}:[A-Za-z0-9]{1,128}$")
# The AWS actions the proxy's secret guard blocks, as the CLI lists them. The
# proxy is what enforces the guard; this copy only refuses to store a rule or
# file an allow that could never apply.
_MINTING_OPERATIONS = frozenset(
    f"{service}:{action}".lower()
    for service, actions in {
        "sts": (
            "AssumeRole",
            "AssumeRoleWithSAML",
            "AssumeRoleWithWebIdentity",
            "AssumeRoot",
            "GetFederationToken",
            "GetSessionToken",
            "GetWebIdentityToken",
        ),
        "iam": (
            "CreateAccessKey",
            "CreateLoginProfile",
            "UpdateLoginProfile",
            "CreateServiceSpecificCredential",
            "ResetServiceSpecificCredential",
            "UploadSSHPublicKey",
            "UploadSigningCertificate",
        ),
        "ecr": ("GetAuthorizationToken",),
        "ecr-public": ("GetAuthorizationToken",),
        "codeartifact": ("GetAuthorizationToken",),
        "redshift": ("GetClusterCredentials", "GetClusterCredentialsWithIAM"),
        "redshift-serverless": ("GetCredentials",),
        "cognito-identity": (
            "GetCredentialsForIdentity",
            "GetOpenIdToken",
            "GetOpenIdTokenForDeveloperIdentity",
        ),
        "ec2": ("CreateKeyPair",),
        "elasticmapreduce": ("GetClusterSessionCredentials",),
        "lightsail": (
            "GetInstanceAccessDetails",
            "CreateKeyPair",
            "DownloadDefaultKeyPair",
            "CreateBucketAccessKey",
        ),
        "s3express": ("CreateSession",),
    }.items()
    for action in actions
)

SECRET_GUARD_ID = "secret_guard"
_SECRET_GUARD = {
    "id": SECRET_GUARD_ID,
    "locked": True,
    "rules": [{"class": CREDENTIAL_MINTING, "effect": "block"}],
}

_METHOD_CLASSES = {
    "GET": "read",
    "HEAD": "read",
    "OPTIONS": "read",
    "POST": "create",
    "PUT": "update",
    "PATCH": "update",
    "DELETE": "delete",
}
_CONTROL_CHARACTER = re.compile(r"[\x00-\x1f\x7f-\x9f]")
_GLOB_CHARACTERS = frozenset("*?[")


class PolicyError(ConfigRegistryError):
    """An access policy, operation class list or allow is invalid."""


def managed_policies() -> list[dict[str, Any]]:
    """The always-on entries every HTTP grant carries; none can be edited."""

    return [deepcopy(_SECRET_GUARD)]


def validate_path_glob(value: Any, location: str) -> str:
    """A path glob in the syntax host rules use."""

    if not isinstance(value, str) or not value:
        raise PolicyError(f"{location}: expected a non-empty string")
    if not value.startswith("/"):
        raise PolicyError(f"{location}: HTTP paths must begin with '/'")
    if len(value) > MAX_PATH_LENGTH or _CONTROL_CHARACTER.search(value):
        raise PolicyError(
            f"{location}: expected at most {MAX_PATH_LENGTH} characters without "
            "control characters"
        )
    return value


def _object(value, allowed, location):
    if not isinstance(value, Mapping):
        raise PolicyError(f"{location}: expected an object")
    unknown = sorted(str(key) for key in set(value) - set(allowed))
    if unknown:
        raise PolicyError(f"{location}: unknown field(s): {', '.join(unknown)}")
    return value


def validate_match(value: Any, location: str) -> dict[str, Any]:
    """``methods`` and/or ``path``; at least one of the two."""

    _object(value, {"methods", "path"}, location)
    checked = {}
    methods = value.get("methods")
    if methods is not None:
        if (
            not isinstance(methods, list)
            or not 1 <= len(methods) <= len(HTTP_METHODS)
            or any(method not in HTTP_METHODS for method in methods)
            or len(set(methods)) != len(methods)
        ):
            raise PolicyError(
                f"{location}.methods: expected 1 to {len(HTTP_METHODS)} distinct "
                "upper-case HTTP methods"
            )
        checked["methods"] = list(methods)
    if value.get("path") is not None:
        checked["path"] = validate_path_glob(value["path"], f"{location}.path")
    if not checked:
        raise PolicyError(f"{location}: expected methods, a path, or both")
    return checked


def _class(value, location):
    if value == CREDENTIAL_MINTING:
        raise PolicyError(
            f"{location}: {CREDENTIAL_MINTING} belongs to the secret guard, which "
            "is always on and cannot be changed"
        )
    if value not in USER_CLASSES:
        raise PolicyError(
            f"{location}: expected one of {', '.join(USER_CLASSES)}"
        )
    return value


def takes_operations(service_type: Any) -> bool:
    """Whether a Connection of this service takes rules by named operation."""

    return service_type in OPERATION_SERVICE_TYPES


def is_operation(value: Any) -> bool:
    """Whether a value is spelled as an operation: ``<service>:<Action>``,
    the service in lower case, with no wildcards."""

    return isinstance(value, str) and bool(_OPERATION.fullmatch(value))


def same_operation(first: str, second: str) -> bool:
    """Operations are compared without regard to case."""

    return first.lower() == second.lower()


def is_minting_operation(value: Any) -> bool:
    """Whether an operation mints credentials or assumes another identity."""

    return isinstance(value, str) and value.lower() in _MINTING_OPERATIONS


def validate_operation(value: Any, location: str) -> str:
    """One exact operation a rule or an allow names, returned as it is stored."""

    if not is_operation(value):
        raise PolicyError(
            f"{location}: expected one exact AWS action such as "
            "ec2:TerminateInstances, without wildcards"
        )
    if is_minting_operation(value):
        raise PolicyError(
            f"{location}: {value} mints credentials, which belongs to the secret "
            "guard; it is always on and cannot be changed"
        )
    return value


def _target(value, location, operations):
    """Exactly one of ``class``, ``match`` or ``operation``, as policy rules
    and allows use. ``operations`` says whether the Connection takes the last."""

    given = [
        key for key in ("class", "match", "operation") if value.get(key) is not None
    ]
    if len(given) != 1:
        raise PolicyError(
            f"{location}: expected exactly one of class, match or operation"
        )
    if given == ["class"]:
        return {"class": _class(value["class"], f"{location}.class")}
    if given == ["match"]:
        return {"match": validate_match(value["match"], f"{location}.match")}
    if not operations:
        raise PolicyError(
            f"{location}.operation: only an AWS Connection takes rules by AWS action"
        )
    return {
        "operation": validate_operation(value["operation"], f"{location}.operation")
    }


def validate_policy(policy: Any, *, operations: bool = False) -> dict[str, Any]:
    """Validate a policy and return it as it is stored.

    An absent or empty policy, and one that allows by default and has no
    rules, are all stored as ``{}``. ``operations`` is true for a Connection
    whose rules may name an AWS action.
    """

    if policy is None or policy == {}:
        return {}
    _object(policy, {"version", "default", "rules"}, "policy")
    version = policy.get("version")
    if isinstance(version, bool) or version != POLICY_VERSION:
        raise PolicyError(f"policy.version: unsupported version {version!r}")
    default = policy.get("default", "allow")
    if default not in EFFECTS:
        raise PolicyError(f"policy.default: expected one of {', '.join(EFFECTS)}")
    raw_rules = policy.get("rules", [])
    if not isinstance(raw_rules, list) or len(raw_rules) > MAX_RULES:
        raise PolicyError(f"policy.rules: expected at most {MAX_RULES} rules")
    rules = []
    for index, raw in enumerate(raw_rules):
        location = f"policy.rules[{index}]"
        _object(raw, {"class", "match", "operation", "effect"}, location)
        if raw.get("effect") not in EFFECTS:
            raise PolicyError(
                f"{location}.effect: expected one of {', '.join(EFFECTS)}"
            )
        rules.append(
            {**_target(raw, location, operations), "effect": raw["effect"]}
        )
    if default == "allow" and not rules:
        return {}
    return {"version": POLICY_VERSION, "default": default, "rules": rules}


def full_policy(stored: Any) -> dict[str, Any]:
    """A stored policy written out in full, for a reader."""

    stored = stored or {}
    return {
        "version": POLICY_VERSION,
        "default": stored.get("default", "allow"),
        "rules": deepcopy(stored.get("rules", [])),
    }


def requires_client_feature(stored: Any) -> bool:
    """Whether a client must enforce policies to be sent this Connection."""

    policy = full_policy(stored)
    return policy["default"] != "allow" or any(
        rule["effect"] != "allow" for rule in policy["rules"]
    )


def validate_operation_classes(value: Any, location: str) -> list[dict[str, Any]]:
    """A definition's overrides of how its calls are classified."""

    if not isinstance(value, list) or len(value) > MAX_OPERATION_CLASSES:
        raise PolicyError(
            f"{location}: expected a list of at most {MAX_OPERATION_CLASSES} entries"
        )
    checked = []
    for index, raw in enumerate(value):
        entry_location = f"{location}[{index}]"
        _object(raw, {"match", "class"}, entry_location)
        if raw.get("match") is None or raw.get("class") is None:
            raise PolicyError(f"{entry_location}: expected a match and a class")
        checked.append(
            {
                "match": validate_match(raw["match"], f"{entry_location}.match"),
                "class": _class(raw["class"], f"{entry_location}.class"),
            }
        )
    return checked


def validate_allow(
    value: Any, location: str = "allow", *, operations: bool = False
) -> dict[str, Any]:
    """What a temporary allow covers: one class, one method and path match,
    or, on a Connection that takes them, one AWS action."""

    _object(value, {"class", "match", "operation"}, location)
    return _target(value, location, operations)


def _expiry(entry):
    value = entry.get("expiresAt") if isinstance(entry, Mapping) else None
    try:
        return parse_datetime(value) if isinstance(value, str) else None
    except ValueError:
        return None


def live_temporary_allows(entries: Any, now) -> list[dict[str, Any]]:
    """The stored temporary allows that have not expired."""

    live = []
    for entry in entries or []:
        expires_at = _expiry(entry)
        if expires_at is not None and expires_at > now:
            live.append(entry)
    return live


def compile_policy(stored: Any, temporary_allows: Any, now) -> dict[str, Any]:
    """The policy block of a session payload, in the runtime API's spelling."""

    compiled = full_policy(stored)
    compiled["temporary_allows"] = [
        {
            "id": entry["id"],
            **{
                key: deepcopy(entry[key])
                for key in ("class", "match", "operation")
                if key in entry
            },
            "expires_at": entry["expiresAt"],
        }
        for entry in live_temporary_allows(temporary_allows, now)
    ]
    compiled["managed"] = managed_policies()
    return compiled


def glob_match(pattern: str, value: str) -> bool:
    """Match a path the way the proxy does."""

    return fnmatchcase(value, pattern)


def _match_applies(match, method, path):
    methods = match.get("methods")
    if methods is not None and method not in methods:
        return False
    return "path" not in match or glob_match(match["path"], path)


def classify_http_call(operation_classes: Any, method: str, path: str) -> str:
    """The class of an HTTP call: its service's first matching override, then
    its method."""

    for entry in operation_classes or []:
        if _match_applies(entry["match"], method, path):
            return entry["class"]
    return _METHOD_CLASSES.get(method, "update")


def _match_covers(rule_match, allow_match):
    """Whether every call ``allow_match`` describes also fits ``rule_match``."""

    rule_methods = rule_match.get("methods")
    if rule_methods is not None:
        allowed_methods = allow_match.get("methods")
        if allowed_methods is None or not set(allowed_methods) <= set(rule_methods):
            return False
    if "path" in rule_match:
        # The allow's own text stands in for the calls it covers: exact for a
        # literal path, and a pattern is covered only by one at least as wide.
        return "path" in allow_match and glob_match(
            rule_match["path"], allow_match["path"]
        )
    return True


def allow_is_blocked(stored: Any, allow: Mapping[str, Any], *, operation_classes=None):
    """Whether a block rule covers everything an allow would let through.

    A temporary allow never changes a block, so approving such an allow could
    not help. ``operation_classes`` is given for a Connection whose calls are
    classified by method and path, which the Console can do; an AWS call is
    classified by the proxy alone, so an allow for an AWS action is held only
    against the rules that name that action.
    """

    blocks = [
        rule for rule in full_policy(stored)["rules"] if rule["effect"] == "block"
    ]
    blocked_classes = {rule["class"] for rule in blocks if "class" in rule}
    if "class" in allow:
        return allow["class"] in blocked_classes
    if "operation" in allow:
        return any(
            "operation" in rule
            and same_operation(rule["operation"], allow["operation"])
            for rule in blocks
        )
    match = allow["match"]
    if any("match" in rule and _match_covers(rule["match"], match) for rule in blocks):
        return True
    methods = match.get("methods")
    path = match.get("path")
    if (
        operation_classes is None
        or not methods
        or path is None
        or _GLOB_CHARACTERS & set(path)
    ):
        return False
    return all(
        classify_http_call(operation_classes, method, path) in blocked_classes
        for method in methods
    )
