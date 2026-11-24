"""Access policies on a Connection: allow, ask or block each call.

A policy is ``{"version": 1, "default": effect, "rules": [...]}``, each rule
naming one class or one match (methods, a path glob or both) and an effect.
An HTTP call's class comes from its method alone.

The managed secret guard is added to the compiled policy of a service whose
manifest gives it rules, and no rule or temporary allow can remove it.

Versioning: the CLI refuses, failing closed, a Connection whose policy has a
``version`` above the one it supports, or holds a class, effect or rule kind
it does not know, and tells the person to update the Phase CLI. It ignores
unknown keys at the top level of the session payload, of a Connection and of
a policy. It reads each Connection's ``secretGuard`` members and
``environmentBindings`` entries strictly: one it does not know makes only that
Connection unavailable, with a reason to update the Phase CLI. An injection's
``whenAbsent`` is read strictly too, as the one injection setting not
negotiated when the session opens. So ``POLICY_VERSION`` stays 1 until the
Console adds something to a policy that an older CLI would have to enforce,
and must be raised when it does; a new ``secretGuard`` or
``environmentBindings`` member, or a new ``whenAbsent`` value, is a version
bump too.
"""

from __future__ import annotations

from collections.abc import Mapping
from copy import deepcopy
from fnmatch import fnmatchcase, translate
from functools import lru_cache
import re
from typing import Any

from django.utils.dateparse import parse_datetime

from .errors import ConfigRegistryError


POLICY_VERSION = 1
ACCESS_POLICY_FEATURE = "access_policy"

EFFECTS = ("allow", "ask", "block")
USER_CLASSES = ("read", "create", "update", "delete")
# Calls that mint new credentials or assume another identity. Only the secret
# guard names this class.
CREDENTIAL_MINTING = "credential_minting"
HTTP_METHODS = frozenset(
    {"GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE", "CONNECT", "TRACE"}
)

MAX_RULES = 50
MAX_PATH_LENGTH = 1024

SECRET_GUARD_ID = "secret_guard"
_SECRET_GUARD = {
    "id": SECRET_GUARD_ID,
    "locked": True,
    "rules": [{"class": CREDENTIAL_MINTING, "effect": "block"}],
}

# Paths that take in every call, so a rule naming one answers by method alone.
_EVERY_PATH = frozenset({"/*", "*"})
# Any other method is an update.
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
_PERCENT_ESCAPE = re.compile(r"%[0-9A-Fa-f]{2}")
_GLOB_CHARACTERS = frozenset("*?[")
# A glob character in brackets stands for itself, which is how an exact path
# that holds one is written.
_BRACKETED_GLOB_CHARACTER = re.compile(r"\[([*?\[])\]")


class PolicyError(ConfigRegistryError):
    """An access policy or allow is invalid."""


def managed_policies(service_type: Any = None) -> list[dict[str, Any]]:
    """The always-on entries a Connection carries; none can be edited.

    Given its service, the secret guard is listed only when that service's
    manifest has guard rules.
    """

    if (
        service_type is not None
        and service_type not in _registry().guarded_service_types
    ):
        return []
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
    # The proxy decodes a request's path before comparing it, so an escaped
    # path would not match the request it was written for.
    if _PERCENT_ESCAPE.search(value):
        raise PolicyError(
            f"{location}: write the path decoded, for example a space instead "
            "of %20; paths are compared after decoding"
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
            or any(
                not isinstance(method, str) or method not in HTTP_METHODS
                for method in methods
            )
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
    if not isinstance(value, str) or value not in USER_CLASSES:
        raise PolicyError(
            f"{location}: expected one of {', '.join(USER_CLASSES)}"
        )
    return value


def _registry():
    # The registry validates manifests with this module, so it is read lazily.
    from .registry import get_config_registry

    return get_config_registry()


def _target(value, location):
    """Exactly one of ``class`` or ``match``, as policy rules and allows use."""

    given = [key for key in ("class", "match") if value.get(key) is not None]
    if len(given) != 1:
        raise PolicyError(f"{location}: expected exactly one of class or match")
    if given == ["class"]:
        return {"class": _class(value["class"], f"{location}.class")}
    return {"match": validate_match(value["match"], f"{location}.match")}


def validate_policy(policy: Any) -> dict[str, Any]:
    """Validate a policy and return it as it is stored.

    Absent, empty and allow-by-default-without-rules policies are all stored as ``{}``.
    """

    if policy is None or policy == {}:
        return {}
    _object(policy, {"version", "default", "rules"}, "policy")
    version = policy.get("version")
    if isinstance(version, bool) or version != POLICY_VERSION:
        raise PolicyError(f"policy.version: unsupported version {version!r}")
    default = policy.get("default", "allow")
    if not isinstance(default, str) or default not in EFFECTS:
        raise PolicyError(f"policy.default: expected one of {', '.join(EFFECTS)}")
    raw_rules = policy.get("rules", [])
    if not isinstance(raw_rules, list) or len(raw_rules) > MAX_RULES:
        raise PolicyError(f"policy.rules: expected at most {MAX_RULES} rules")
    rules = []
    for index, raw in enumerate(raw_rules):
        location = f"policy.rules[{index}]"
        _object(raw, {"class", "match", "effect"}, location)
        effect = raw.get("effect")
        if not isinstance(effect, str) or effect not in EFFECTS:
            raise PolicyError(
                f"{location}.effect: expected one of {', '.join(EFFECTS)}"
            )
        rules.append({**_target(raw, location), "effect": raw["effect"]})
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


def validate_allow(value: Any, location: str = "allow") -> dict[str, Any]:
    """What a temporary allow covers: one class, or one method and path match."""

    _object(value, {"class", "match"}, location)
    return _target(value, location)


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


def compile_policy(
    stored: Any, temporary_allows: Any, now, *, service_type: Any = None
) -> dict[str, Any]:
    """The policy block of a session payload, in the runtime API's spelling.

    ``service_type`` decides the managed entries, as it does for ``managed_policies``.
    """

    compiled = full_policy(stored)
    compiled["temporary_allows"] = [
        {
            "id": entry["id"],
            **{
                key: deepcopy(entry[key])
                for key in ("class", "match")
                if key in entry
            },
            "expires_at": entry["expiresAt"],
        }
        for entry in live_temporary_allows(temporary_allows, now)
    ]
    compiled["managed"] = managed_policies(service_type)
    return compiled


def glob_match(pattern: str, value: str) -> bool:
    """Match a path the way the proxy does."""

    return fnmatchcase(value, pattern)


@lru_cache(maxsize=256)
def _folded_glob(pattern):
    return re.compile(translate(pattern), re.IGNORECASE)


def _without_path_parameters(value):
    segment = value.rfind("/") + 1
    parameters = value.find(";", segment)
    return value if parameters < 0 else value[:parameters]


def loose_glob_match(pattern: str, value: str) -> bool:
    """Match a path the way the proxy matches a rule that stops a call.

    Letter case, one trailing slash and a ";params" tail on the last segment
    are also left out, so a respelled path does not get past the rule.
    """

    if glob_match(pattern, value):
        return True
    if len(pattern) > 1:
        pattern = pattern.removesuffix("/")
    value = _without_path_parameters(value)
    if len(value) > 1 and value.endswith("/"):
        value = _without_path_parameters(value[:-1])
    return _folded_glob(pattern).match(value) is not None


def _literal_path(pattern):
    """The one path a glob names, or None when it has a wildcard."""

    if _GLOB_CHARACTERS & set(_BRACKETED_GLOB_CHARACTER.sub("", pattern)):
        return None
    return _BRACKETED_GLOB_CHARACTER.sub(r"\1", pattern)


def classify_http_call(method: str) -> str:
    """The class of an HTTP call, which its method alone decides."""

    return _METHOD_CLASSES.get(method, "update")


def _path_of(rule):
    """The paths a rule is limited to, or None when it takes in every path."""

    path = rule.get("match", {}).get("path")
    return None if path in _EVERY_PATH else path


def has_path_rules(stored: Any) -> bool:
    """Whether some rule of the policy answers only some paths."""

    return any(_path_of(rule) is not None for rule in full_policy(stored)["rules"])


def _takes_in_method(rule, method):
    """Whether a rule answers every call by ``method``, whatever its path."""

    if "class" in rule:
        return rule["class"] == classify_http_call(method)
    if "match" not in rule or _path_of(rule) is not None:
        return False
    methods = rule["match"].get("methods")
    return methods is None or method in methods


def method_effects(stored: Any) -> dict[str, str]:
    """What the policy does with a call by each common method, on a path no
    rule names: the strongest effect of the rules that take the method in, as
    the proxy decides, or else the default."""

    policy = full_policy(stored)
    effects = {}
    for method in _METHOD_CLASSES:
        found = [
            rule["effect"]
            for rule in policy["rules"]
            if _takes_in_method(rule, method)
        ]
        effects[method] = max(found, key=EFFECTS.index) if found else policy["default"]
    return effects


def _loose_pattern(pattern):
    """A path glob without what a rule that stops a call leaves out of it."""

    if len(pattern) > 1:
        pattern = pattern.removesuffix("/")
    return pattern.casefold()


def _path_covers(rule_path, allow_path):
    """Whether a block rule's path takes in every path an allow's does."""

    literal = _literal_path(allow_path)
    if literal is not None:
        return loose_glob_match(rule_path, literal)
    # Two patterns. One covers itself; another is known to be at least as wide
    # only when "*" is its sole wildcard, since "*" takes in whatever the
    # allow's own wildcards stand for and "?" or a set might not.
    if _loose_pattern(rule_path) == _loose_pattern(allow_path):
        return True
    return not {"?", "["} & set(rule_path) and loose_glob_match(rule_path, allow_path)


def _match_covers(rule_match, allow_match):
    """Whether a block rule's match takes in every call ``allow_match`` describes."""

    rule_methods = rule_match.get("methods")
    if rule_methods is not None:
        allowed_methods = allow_match.get("methods")
        if allowed_methods is None or not set(allowed_methods) <= set(rule_methods):
            return False
    if "path" not in rule_match:
        return True
    return "path" in allow_match and _path_covers(
        rule_match["path"], allow_match["path"]
    )


def _match_classes(match):
    """The classes of the calls a match names, or None when it names no method
    and so takes in every class."""

    methods = match.get("methods")
    return {classify_http_call(method) for method in methods} if methods else None


def _blocks_cover(blocks, allow):
    """Whether block rules take in everything an allow would let through."""

    blocked_classes = {rule["class"] for rule in blocks if "class" in rule}
    if "class" in allow:
        return allow["class"] in blocked_classes
    match = allow["match"]
    if any("match" in rule and _match_covers(rule["match"], match) for rule in blocks):
        return True
    classes = _match_classes(match)
    return classes is not None and classes <= blocked_classes


def _matches_overlap(rule, allow_match):
    """Whether one call could fit both a rule's match and an allow's."""

    rule_match = rule["match"]
    methods, allowed_methods = rule_match.get("methods"), allow_match.get("methods")
    if (
        methods is not None
        and allowed_methods is not None
        and not set(methods) & set(allowed_methods)
    ):
        return False
    if "path" not in rule_match or "path" not in allow_match:
        return True
    literal = _literal_path(allow_match["path"])
    if literal is None:
        return True
    # The proxy reads an allow rule's path exactly and an ask rule's loosely.
    compare = glob_match if rule["effect"] == "allow" else loose_glob_match
    return compare(rule_match["path"], literal)


def _may_apply(rule, allow):
    """Whether a rule could answer some call an allow covers.

    Only what the Console can tell apart is ruled out.
    """

    if "class" in rule:
        classes = (
            {allow["class"]} if "class" in allow else _match_classes(allow["match"])
        )
        return classes is None or rule["class"] in classes
    if "class" in allow:
        classes = _match_classes(rule["match"])
        return classes is None or allow["class"] in classes
    return _matches_overlap(rule, allow["match"])


def allow_is_blocked(stored: Any, allow: Mapping[str, Any]) -> bool:
    """Whether the policy answers every call an allow covers with a block.

    A temporary allow turns an ask into an allow and never changes a block.
    """

    policy = full_policy(stored)
    # A rule this Console cannot read, such as a stored rule by AWS action, is
    # left out, so the allow is judged on the rules it knows.
    rules = [
        rule
        for rule in policy["rules"]
        if "match" in rule or rule.get("class") in USER_CLASSES
    ]
    blocks = [rule for rule in rules if rule["effect"] == "block"]
    if _blocks_cover(blocks, allow):
        return True
    # A call no rule answers gets the default, so a default of block stops
    # whatever no allow or ask rule could apply to.
    return policy["default"] == "block" and not any(
        rule["effect"] != "block" and _may_apply(rule, allow) for rule in rules
    )
