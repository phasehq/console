"""Rules and allows are checked against what the proxy can enforce."""

import pytest

from api.utils.agent_config import DefinitionError, validate_definition
from api.utils.agent_config.access_policy import (
    PolicyError,
    allow_is_blocked,
    loose_glob_match,
    validate_allow,
    validate_policy,
)


def _policy(*rules, default="allow"):
    return validate_policy({"version": 1, "default": default, "rules": list(rules)})


def _block(path, **match):
    return {"match": {"path": path, **match}, "effect": "block"}


def _allow(path, *methods):
    match = {"path": path}
    if methods:
        match["methods"] = list(methods)
    return {"match": match}


# Escaped paths


@pytest.mark.parametrize("path", ["/reports/Q1%20final", "/a%2Fb", "/x/%e2%82%ac"])
def test_a_percent_escaped_path_is_refused_wherever_a_path_is_matched(path):
    with pytest.raises(PolicyError, match="write the path decoded"):
        _policy(_block(path))
    with pytest.raises(PolicyError, match="write the path decoded"):
        validate_allow(_allow(path, "GET"))

    definition = {
        "specVersion": 1,
        "hosts": [{"match": "exact", "value": "api.example.com"}],
        "fields": [{"name": "token", "kind": "secret", "source": {"type": "sealed"}}],
        "injections": [{"type": "header", "name": "Authorization", "field": "token"}],
    }
    with pytest.raises(DefinitionError, match="write the path decoded"):
        validate_definition(
            {**definition, "hosts": [{**definition["hosts"][0], "path": path}]}
        )


@pytest.mark.parametrize("path", ["/reports/Q1 final", "/discount/50%", "/a%zz"])
def test_a_decoded_path_is_kept_as_written(path):
    assert _policy(_block(path))["rules"][0]["match"]["path"] == path


# A path as a rule that stops a call reads it


@pytest.mark.parametrize(
    "pattern,path,matches",
    [
        # The proxy's own table for this comparison.
        ("/v1/admin", "/v1/admin", True),
        ("/v1/admin", "/v1/admin/", True),
        ("/v1/admin", "/V1/ADMIN", True),
        ("/v1/admin", "/v1/admin;a=b", True),
        ("/v1/admin", "/v1/admin;a=b/", True),
        ("/v1/admin", "/v1/admin/;a=b", True),
        ("/v1/admin/", "/v1/admin", True),
        ("/v1/admin/*", "/V1/Admin/Users/", True),
        ("/v1/[a-c]dmin", "/v1/Bdmin", True),
        ("/", "/", True),
        ("/v1/admin", "/v1/admin//", False),
        ("/v1/admin", "/v1/admin/users", False),
        ("/v1/admin", "/v1;x/admin", False),
        ("/v1/admin", "/v1/admins", False),
        ("/v1/admin", "/", False),
    ],
)
def test_a_path_is_matched_loosely_the_way_the_proxy_does(pattern, path, matches):
    assert loose_glob_match(pattern, path) is matches


@pytest.mark.parametrize(
    "allow",
    [
        _allow("/Admin/", "GET"),
        _allow("/ADMIN", "GET"),
        _allow("/admin/", "GET"),
        _allow("/admin;x=1", "GET"),
    ],
)
def test_a_block_covers_a_respelling_of_its_path(allow):
    policy = _policy(_block("/admin"), default="ask")

    assert allow_is_blocked(policy, allow) is True


def test_a_block_does_not_cover_another_path():
    policy = _policy(_block("/admin"), default="ask")

    assert allow_is_blocked(policy, _allow("/admins", "GET")) is False
    assert allow_is_blocked(policy, _allow("/admin/users", "GET")) is False


# One pattern against another


@pytest.mark.parametrize(
    "blocked,allowed,covered",
    [
        # A narrower block leaves part of a wider allow to help with.
        ("/items/?", "/items/*", False),
        ("/items/[ab]", "/items/?", False),
        ("/v1/charges/*", "/v1/*", False),
        # The same pattern, or a wider one, covers the allow.
        ("/items/?", "/items/?", True),
        ("/Items/?/", "/items/?", True),
        ("/items/*", "/items/?", True),
        ("/v1/*", "/v1/charges/*", True),
        ("/V1/*", "/v1/charges/*/refunds", True),
        # An exact path that holds a glob character is written in brackets.
        ("/items/?", "/items/[*]", True),
        ("/items/a", "/items/[*]", False),
    ],
)
def test_a_block_covers_a_patterned_allow_only_when_it_is_as_wide(
    blocked, allowed, covered
):
    policy = _policy(_block(blocked), default="ask")

    assert allow_is_blocked(policy, _allow(allowed)) is covered


# The default


@pytest.mark.parametrize(
    "allow",
    [
        {"class": "delete"},
        _allow("/x", "GET"),
        _allow("/x/*"),
    ],
)
def test_nothing_helps_under_a_default_of_block_with_no_other_rule(allow):
    assert allow_is_blocked(_policy(default="block"), allow) is True
    assert allow_is_blocked(_policy(default="ask"), allow) is False
    assert allow_is_blocked({}, allow) is False


def test_under_a_default_of_block_only_a_class_with_an_ask_or_allow_rule_is_open():
    policy = _policy(
        {"class": "read", "effect": "allow"},
        {"class": "create", "effect": "ask"},
        default="block",
    )

    assert allow_is_blocked(policy, {"class": "create"}) is False
    assert allow_is_blocked(policy, {"class": "read"}) is False
    assert allow_is_blocked(policy, {"class": "delete"}) is True
    # A call is judged by the class of its method.
    assert allow_is_blocked(policy, _allow("/x", "POST")) is False
    assert allow_is_blocked(policy, _allow("/x", "DELETE")) is True
    assert allow_is_blocked(policy, _allow("/x", "POST", "DELETE")) is False


def test_under_a_default_of_block_an_ask_rule_by_path_opens_only_what_fits_it():
    policy = _policy(
        {"match": {"methods": ["PUT"], "path": "/items/*"}, "effect": "ask"},
        default="block",
    )

    assert allow_is_blocked(policy, _allow("/items/7", "PUT")) is False
    # An ask rule reads a respelled path as the same one.
    assert allow_is_blocked(policy, _allow("/Items/7/", "PUT")) is False
    assert allow_is_blocked(policy, _allow("/orders/7", "PUT")) is True
    assert allow_is_blocked(policy, _allow("/items/7", "PATCH")) is True


def test_an_allow_rule_reads_its_path_exactly_under_a_default_of_block():
    policy = _policy(
        {"match": {"methods": ["DELETE"], "path": "/items/7"}, "effect": "allow"},
        default="block",
    )

    assert allow_is_blocked(policy, _allow("/items/7", "DELETE")) is False
    assert allow_is_blocked(policy, _allow("/Items/7", "DELETE")) is True


def test_only_a_match_without_a_method_is_not_called_blocked_by_class():
    policy = _policy({"class": "read", "effect": "ask"}, default="block")

    # Its calls could be reads, which the ask rule opens.
    assert allow_is_blocked(policy, _allow("/x/*")) is False
    # The method alone decides the class, whatever the path or the service.
    assert allow_is_blocked(policy, _allow("/x", "DELETE")) is True
    assert allow_is_blocked(policy, _allow("/x/*", "DELETE")) is True
    assert allow_is_blocked(policy, _allow("/", "POST")) is True
