"""Rules and allows are checked against what the proxy can enforce."""

import pytest

from api.utils.agent_config import DefinitionError, validate_definition
from api.utils.agent_config.access_policy import (
    PolicyError,
    allow_is_blocked,
    loose_glob_match,
    proxy_names_operation,
    validate_allow,
    validate_policy,
)


def _policy(*rules, default="allow"):
    return validate_policy(
        {"version": 1, "default": default, "rules": list(rules)}, operations=True
    )


def _block(path, **match):
    return {"match": {"path": path, **match}, "effect": "block"}


def _allow(path, *methods):
    match = {"path": path}
    if methods:
        match["methods"] = list(methods)
    return {"match": match}


# Rules by AWS action


@pytest.mark.parametrize(
    "operation",
    [
        "s3:DeleteBucket",
        "s3:GetObject",
        "lambda:DeleteFunction",
        "eks:DeleteCluster",
        "apigateway:DeleteRestApi",
    ],
)
@pytest.mark.parametrize("effect", ["allow", "ask", "block"])
def test_a_rule_cannot_name_an_action_the_proxy_cannot_tell_apart(operation, effect):
    assert proxy_names_operation(operation) is False
    with pytest.raises(PolicyError) as refusal:
        _policy({"operation": operation, "effect": effect})

    message = str(refusal.value)
    assert message.startswith(
        f"policy.rules[0].operation: a rule cannot name {operation}"
    )
    assert "rule by method and path" in message
    assert "class of calls" in message


@pytest.mark.parametrize(
    "operation",
    [
        # A query-protocol service and a JSON one name the action in each call.
        "ec2:TerminateInstances",
        "ec2:terminateinstances",
        "dynamodb:DeleteTable",
        # REST calls the manifest names by method and path.
        "lambda:AddPermission",
        "lambda:createfunctionurlconfig",
    ],
)
def test_a_rule_may_name_an_action_the_proxy_can_tell_apart(operation):
    assert proxy_names_operation(operation) is True
    assert _policy({"operation": operation, "effect": "block"})["rules"] == [
        {"operation": operation, "effect": "block"}
    ]


def test_an_allow_may_still_name_any_action():
    # The proxy offers an allow by action only for a call that named one, and
    # an allow that never matches lets nothing through.
    assert validate_allow({"operation": "s3:DeleteBucket"}, operations=True) == {
        "operation": "s3:DeleteBucket"
    }


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
            {
                **definition,
                "operationClasses": [{"match": {"path": path}, "class": "read"}],
            }
        )
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


def _blocked(policy, allow):
    """As for a custom HTTP Connection, whose calls the Console classifies."""

    return allow_is_blocked(policy, allow, operation_classes=[])


@pytest.mark.parametrize(
    "allow",
    [
        {"class": "delete"},
        {"operation": "ec2:TerminateInstances"},
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
    assert allow_is_blocked(policy, {"class": "admin"}) is True
    # A custom call is judged by its class.
    assert _blocked(policy, _allow("/x", "POST")) is False
    assert _blocked(policy, _allow("/x", "DELETE")) is True
    assert _blocked(policy, _allow("/x", "POST", "DELETE")) is False


def test_under_a_default_of_block_an_ask_rule_by_path_opens_only_what_fits_it():
    policy = _policy(
        {"match": {"methods": ["PUT"], "path": "/items/*"}, "effect": "ask"},
        default="block",
    )

    assert _blocked(policy, _allow("/items/7", "PUT")) is False
    # An ask rule reads a respelled path as the same one.
    assert _blocked(policy, _allow("/Items/7/", "PUT")) is False
    assert _blocked(policy, _allow("/orders/7", "PUT")) is True
    assert _blocked(policy, _allow("/items/7", "PATCH")) is True


def test_an_allow_rule_reads_its_path_exactly_under_a_default_of_block():
    policy = _policy(
        {"match": {"methods": ["DELETE"], "path": "/items/7"}, "effect": "allow"},
        default="block",
    )

    assert _blocked(policy, _allow("/items/7", "DELETE")) is False
    assert _blocked(policy, _allow("/Items/7", "DELETE")) is True


def test_what_the_console_cannot_classify_is_not_called_blocked():
    policy = _policy({"class": "read", "effect": "ask"}, default="block")

    # An AWS call's class is the proxy's to say, and so is a pattern's.
    assert allow_is_blocked(policy, _allow("/x", "DELETE")) is False
    assert allow_is_blocked(policy, {"operation": "ec2:StopInstances"}) is False
    assert _blocked(policy, _allow("/x/*", "DELETE")) is False


def test_a_rule_for_another_action_does_not_open_an_action_under_a_default_of_block():
    policy = _policy({"operation": "ec2:StopInstances", "effect": "ask"}, default="block")

    assert allow_is_blocked(policy, {"operation": "ec2:stopinstances"}) is False
    assert allow_is_blocked(policy, {"operation": "ec2:TerminateInstances"}) is True
