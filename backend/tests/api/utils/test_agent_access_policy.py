"""Access policy validation, classification and the compiled policy block."""

from datetime import timedelta

import pytest
from django.utils import timezone

from api.utils.agent_config import DefinitionError, validate_definition
from api.utils.agent_config.access_policy import (
    PolicyError,
    allow_is_blocked,
    classify_http_call,
    compile_policy,
    full_policy,
    live_temporary_allows,
    managed_policies,
    method_effects,
    requires_client_feature,
    validate_allow,
    validate_policy,
)
from api.utils.agent_config.http_definition import compile_service


POLICY = {
    "version": 1,
    "default": "allow",
    "rules": [
        {"class": "delete", "effect": "block"},
        {"class": "create", "effect": "ask"},
        {"match": {"methods": ["POST"], "path": "/v1/charges/*"}, "effect": "block"},
    ],
}
SECRET_GUARD = {
    "id": "secret_guard",
    "locked": True,
    "rules": [{"class": "credential_minting", "effect": "block"}],
}


def _definition(**members):
    return {
        "specVersion": 1,
        "hosts": [{"match": "exact", "value": "api.example.com", "port": 443}],
        "fields": [{"name": "token", "kind": "secret", "source": {"type": "sealed"}}],
        "injections": [
            {"type": "header", "name": "Authorization", "prefix": "Bearer ", "field": "token"}
        ],
        **members,
    }


def _policy(**members):
    return {"version": 1, **members}


def _rule(**members):
    return _policy(rules=[members])


# Stored policies


def test_a_policy_is_stored_as_it_is_written():
    assert validate_policy(POLICY) == POLICY


@pytest.mark.parametrize(
    "empty",
    [None, {}, {"version": 1}, {"version": 1, "default": "allow", "rules": []}],
)
def test_no_policy_and_an_allow_everything_policy_have_one_stored_spelling(empty):
    assert validate_policy(empty) == {}
    assert full_policy(validate_policy(empty)) == {
        "version": 1,
        "default": "allow",
        "rules": [],
    }


def test_default_is_allow_unless_set():
    stored = validate_policy(_rule(**{"class": "read", "effect": "allow"}))

    assert stored["default"] == "allow"
    assert validate_policy(_policy(default="ask"))["default"] == "ask"
    assert validate_policy(_policy(default="block")) == {
        "version": 1,
        "default": "block",
        "rules": [],
    }


def test_a_match_takes_methods_a_path_or_both():
    for match in (
        {"methods": ["GET", "HEAD"]},
        {"path": "/v1/*"},
        {"methods": ["DELETE"], "path": "/repos/acme/x"},
    ):
        assert validate_policy(_rule(match=match, effect="ask"))["rules"] == [
            {"match": match, "effect": "ask"}
        ]


def test_fifty_rules_are_the_most_a_policy_holds():
    rules = [{"class": "read", "effect": "allow"}] * 50

    assert len(validate_policy(_policy(rules=rules))["rules"]) == 50
    with pytest.raises(PolicyError, match="at most 50 rules"):
        validate_policy(_policy(rules=[*rules, {"class": "read", "effect": "allow"}]))


@pytest.mark.parametrize(
    "policy,message",
    [
        ("allow", "expected an object"),
        ({"version": 1, "name": "x"}, "unknown field"),
        ({"default": "block"}, "unsupported version"),
        ({"version": 2, "default": "block"}, "unsupported version"),
        ({"version": True, "default": "block"}, "unsupported version"),
        (_policy(default="deny"), "policy.default"),
        (_policy(rules={"class": "read"}), "policy.rules"),
        (_policy(rules=["read"]), "expected an object"),
        (_rule(**{"class": "read"}), "effect"),
        (_rule(**{"class": "read", "effect": "deny"}), "effect"),
        (_rule(effect="block"), "exactly one of class or match"),
        (
            _rule(**{"class": "read", "match": {"path": "/"}, "effect": "block"}),
            "exactly one of class or match",
        ),
        (_rule(**{"class": "write", "effect": "block"}), "expected one of read"),
        # The four classes are all there is.
        (_rule(**{"class": "admin", "effect": "block"}), "expected one of read"),
        # Rules name a class or a method and path, never a provider's action.
        (
            _rule(operation="ec2:TerminateInstances", effect="ask"),
            "unknown field",
        ),
        (_rule(**{"class": "read", "effect": "block", "note": "x"}), "unknown field"),
        (_rule(match={}, effect="block"), "methods, a path, or both"),
        (_rule(match={"host": "x"}, effect="block"), "unknown field"),
        (_rule(match={"methods": []}, effect="block"), "methods"),
        (_rule(match={"methods": "GET"}, effect="block"), "methods"),
        (_rule(match={"methods": ["get"]}, effect="block"), "upper-case"),
        (_rule(match={"methods": ["GET", "GET"]}, effect="block"), "distinct"),
        (_rule(match={"methods": ["PROPFIND"]}, effect="block"), "HTTP methods"),
        (_rule(match={"path": "v1/*"}, effect="block"), "must begin with '/'"),
        (_rule(match={"path": ""}, effect="block"), "non-empty"),
        (_rule(match={"path": "/" + "a" * 1024}, effect="block"), "at most 1024"),
        (_rule(match={"path": "/a\nb"}, effect="block"), "control characters"),
    ],
)
def test_a_malformed_policy_is_refused(policy, message):
    with pytest.raises(PolicyError, match=message):
        validate_policy(policy)


def test_a_path_may_be_as_long_as_a_host_rule_path():
    path = "/" + "a" * 1023

    assert validate_policy(_rule(match={"path": path}, effect="ask"))["rules"][0][
        "match"
    ] == {"path": path}


def test_all_nine_methods_fit_in_one_match():
    methods = ["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE", "CONNECT", "TRACE"]

    assert validate_policy(_rule(match={"methods": methods}, effect="ask"))


def test_credential_minting_never_appears_in_a_stored_policy():
    for effect in ("allow", "ask", "block"):
        with pytest.raises(PolicyError, match="secret guard"):
            validate_policy(_rule(**{"class": "credential_minting", "effect": effect}))


@pytest.mark.parametrize(
    "policy,needed",
    [
        ({}, False),
        (_rule(**{"class": "read", "effect": "allow"}), False),
        (_rule(**{"class": "delete", "effect": "ask"}), True),
        (_rule(match={"path": "/admin/*"}, effect="block"), True),
        (_policy(default="ask"), True),
        (_policy(default="block", rules=[{"class": "read", "effect": "allow"}]), True),
    ],
)
def test_only_a_policy_that_can_stop_a_call_needs_an_enforcing_client(policy, needed):
    assert requires_client_feature(validate_policy(policy)) is needed


# Classes


@pytest.mark.parametrize(
    "method,expected",
    [
        ("GET", "read"),
        ("HEAD", "read"),
        ("OPTIONS", "read"),
        ("POST", "create"),
        ("PUT", "update"),
        ("PATCH", "update"),
        ("DELETE", "delete"),
        ("CONNECT", "update"),
        ("TRACE", "update"),
        ("PROPFIND", "update"),
    ],
)
def test_a_call_is_classed_by_its_method_alone(method, expected):
    assert classify_http_call(method) == expected


def test_aws_slack_and_graphql_posts_are_creates_like_any_post():
    policy = _policy(rules=[{"class": "create", "effect": "block"}])

    # An AWS query-protocol call, a Slack Web API method and a GraphQL query
    # are all POSTs, whatever they read or change.
    for path in ("/", "/api/conversations.history", "/graphql"):
        assert allow_is_blocked(policy, {"match": {"methods": ["POST"], "path": path}})
    assert not allow_is_blocked(policy, {"match": {"methods": ["GET"], "path": "/"}})


def test_a_definition_takes_no_call_classes():
    classes = [{"match": {"methods": ["POST"], "path": "/graphql"}, "class": "read"}]

    with pytest.raises(DefinitionError, match="unknown field"):
        validate_definition(_definition(operationClasses=classes))
    compiled = compile_service(validate_definition(_definition()))
    assert "operation_classes" not in compiled


# Allows


def test_an_allow_names_one_class_or_one_match():
    assert validate_allow({"class": "delete"}) == {"class": "delete"}
    assert validate_allow({"match": {"methods": ["DELETE"], "path": "/x"}}) == {
        "match": {"methods": ["DELETE"], "path": "/x"}
    }
    for allow in (
        {},
        {"class": "delete", "match": {"path": "/x"}},
        {"effect": "allow"},
        {"class": "admin"},
        {"operation": "ec2:TerminateInstances"},
    ):
        with pytest.raises(PolicyError):
            validate_allow(allow)
    with pytest.raises(PolicyError, match="secret guard"):
        validate_allow({"class": "credential_minting"})


@pytest.mark.parametrize(
    "allow,blocked",
    [
        ({"class": "delete"}, True),
        ({"class": "create"}, False),
        # The exact call a block rule's match covers.
        ({"match": {"methods": ["POST"], "path": "/v1/charges/ch_1"}}, True),
        ({"match": {"methods": ["POST"], "path": "/v1/charges/*"}}, True),
        # Wider than the rule, so some of it could still be allowed.
        ({"match": {"methods": ["POST", "PUT"], "path": "/v1/charges/ch_1"}}, False),
        ({"match": {"path": "/v1/charges/ch_1"}}, False),
        ({"match": {"methods": ["POST"], "path": "/v1/*"}}, False),
        ({"match": {"methods": ["POST"], "path": "/v1/refunds"}}, False),
    ],
)
def test_an_allow_a_block_rule_covers_cannot_help(allow, blocked):
    assert allow_is_blocked(POLICY, allow) is blocked


def test_a_call_is_also_judged_by_the_class_of_its_method():
    # Any path: the method alone decides the class.
    for path in ("/repos/acme/x", "/repos/*"):
        delete = {"match": {"methods": ["DELETE"], "path": path}}
        assert allow_is_blocked(POLICY, delete) is True
    graphql = {"match": {"methods": ["POST"], "path": "/graphql"}}
    # POST is a create, which POLICY asks about rather than blocks.
    assert allow_is_blocked(POLICY, graphql) is False
    # Methods of more than one class are not all blocked.
    mixed = {"match": {"methods": ["DELETE", "GET"], "path": "/x"}}
    assert allow_is_blocked(POLICY, mixed) is False
    # A match with no method takes in every class.
    assert allow_is_blocked(POLICY, {"match": {"path": "/repos/acme/x"}}) is False


def test_ask_and_allow_rules_never_refuse_an_allow():
    policy = _policy(
        default="block",
        rules=[
            {"class": "delete", "effect": "ask"},
            {"match": {"path": "/x"}, "effect": "allow"},
        ],
    )

    assert allow_is_blocked(policy, {"class": "delete"}) is False
    assert allow_is_blocked(policy, {"match": {"path": "/x"}}) is False


# The compiled block


def test_the_compiled_policy_adds_live_allows_and_the_secret_guard():
    now = timezone.now()
    later = (now + timedelta(hours=1)).isoformat()
    allows = [
        {"id": "a", "class": "delete", "expiresAt": later, "requestId": "r-1"},
        {"id": "b", "match": {"path": "/x"}, "expiresAt": later},
        {"id": "c", "class": "create", "expiresAt": (now - timedelta(seconds=1)).isoformat()},
        {"id": "d", "class": "create", "expiresAt": "not a time"},
        {"id": "e", "class": "create"},
    ]

    compiled = compile_policy(POLICY, allows, now)

    assert {key: compiled[key] for key in ("version", "default", "rules")} == POLICY
    # Only what the proxy enforces: no request reference, nothing expired.
    assert compiled["temporary_allows"] == [
        {"id": "a", "class": "delete", "expires_at": later},
        {"id": "b", "match": {"path": "/x"}, "expires_at": later},
    ]
    assert compiled["managed"] == [SECRET_GUARD] == managed_policies()
    assert [entry["id"] for entry in live_temporary_allows(allows, now)] == ["a", "b"]


def test_an_unset_policy_compiles_to_allow_with_the_secret_guard():
    assert compile_policy({}, [], timezone.now()) == {
        "version": 1,
        "default": "allow",
        "rules": [],
        "temporary_allows": [],
        "managed": [SECRET_GUARD],
    }


def test_the_managed_entries_cannot_be_changed_through_a_copy():
    managed_policies()[0]["rules"].clear()

    assert managed_policies() == [SECRET_GUARD]


@pytest.mark.parametrize("value", [[], ["GET"], {}, {"a": 1}])
def test_a_list_or_object_where_a_name_belongs_is_refused_not_a_server_error(value):
    for policy in (
        _policy(default=value),
        _rule(**{"class": value, "effect": "block"}),
        _rule(**{"class": "read", "effect": value}),
        _rule(match={"methods": [value]}, effect="block"),
    ):
        with pytest.raises(PolicyError):
            validate_policy(policy)
    with pytest.raises(PolicyError):
        validate_allow({"match": {"methods": [value]}})
    with pytest.raises(PolicyError):
        validate_allow({"class": value})


# What the Agent is told about each method


METHODS = ("GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE")
WRITES_ASK = [
    {"class": name, "effect": "ask"} for name in ("create", "update", "delete")
]


@pytest.mark.parametrize(
    "policy,expected",
    [
        ({}, dict.fromkeys(METHODS, "allow")),
        (
            _policy(default="allow", rules=WRITES_ASK),
            {
                "GET": "allow",
                "HEAD": "allow",
                "OPTIONS": "allow",
                "POST": "ask",
                "PUT": "ask",
                "PATCH": "ask",
                "DELETE": "ask",
            },
        ),
        # A method rule counts like a class rule, the strongest effect wins,
        # and a rule with a path is left out.
        (
            _policy(
                default="block",
                rules=[
                    {"class": "read", "effect": "allow"},
                    {"match": {"methods": ["HEAD", "PATCH"]}, "effect": "ask"},
                    {"class": "update", "effect": "allow"},
                    {"match": {"methods": ["PUT"], "path": "/x"}, "effect": "allow"},
                ],
            ),
            {
                "GET": "allow",
                "HEAD": "ask",
                "OPTIONS": "allow",
                "POST": "block",
                "PUT": "allow",
                "PATCH": "ask",
                "DELETE": "block",
            },
        ),
    ],
)
def test_each_methods_effect_comes_from_the_rules_that_take_it_in(policy, expected):
    assert method_effects(validate_policy(policy)) == expected


def test_a_stored_policy_with_a_removed_rule_kind_is_still_read():
    """Rules by AWS action and the admin class are no longer written. One
    stored before is read as it is, and the summary for the Agent skips it."""

    stored = {
        "version": 1,
        "default": "ask",
        "rules": [
            {"operation": "ec2:TerminateInstances", "effect": "allow"},
            {"class": "admin", "effect": "block"},
        ],
    }

    assert full_policy(stored)["rules"] == stored["rules"]
    assert compile_policy(stored, [], timezone.now())["rules"] == stored["rules"]
    assert set(method_effects(stored).values()) == {"ask"}
