"""Rules and allows are checked against what the proxy can enforce."""

import pytest

from api.utils.agent_config import DefinitionError, validate_definition
from api.utils.agent_config.access_policy import (
    PolicyError,
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
