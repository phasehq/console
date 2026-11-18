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
    is_minting_operation,
    is_operation,
    live_temporary_allows,
    managed_policies,
    requires_client_feature,
    same_operation,
    takes_operations,
    validate_allow,
    validate_operation_classes,
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
        (_rule(effect="block"), "exactly one of class, match or operation"),
        (
            _rule(**{"class": "read", "match": {"path": "/"}, "effect": "block"}),
            "exactly one of class, match or operation",
        ),
        (_rule(**{"class": "write", "effect": "block"}), "expected one of read"),
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


# Rules and allows by AWS action


TERMINATE = "ec2:TerminateInstances"


def test_only_aws_takes_operations():
    assert takes_operations("aws") is True
    for service_type in ("http", "postgres", "github", "", None):
        assert takes_operations(service_type) is False


def test_a_rule_may_name_one_aws_action_on_a_connection_that_takes_them():
    policy = _policy(
        default="allow",
        rules=[
            {"operation": TERMINATE, "effect": "ask"},
            {"operation": "s3:DeleteBucket", "effect": "block"},
            {"class": "admin", "effect": "block"},
        ],
    )

    assert validate_policy(policy, operations=True) == policy
    assert validate_allow({"operation": TERMINATE}, operations=True) == {
        "operation": TERMINATE
    }
    assert requires_client_feature(validate_policy(policy, operations=True)) is True


def test_an_operation_is_refused_where_the_connection_takes_none():
    with pytest.raises(PolicyError, match="only an AWS Connection"):
        validate_policy(_rule(operation=TERMINATE, effect="ask"))
    with pytest.raises(PolicyError, match="only an AWS Connection"):
        validate_allow({"operation": TERMINATE})


@pytest.mark.parametrize(
    "operation,valid",
    [
        (TERMINATE, True),
        ("s3:GetObject", True),
        ("cognito-identity:GetId", True),
        ("a:B", True),
        ("a" * 64 + ":" + "B" * 128, True),
        ("ec2:terminateinstances", True),
        # The service is spelled in lower case.
        ("EC2:TerminateInstances", False),
        ("Ec2:TerminateInstances", False),
        # No wildcards, no patterns, nothing but one action.
        ("ec2:*", False),
        ("ec2:Terminate*", False),
        ("*", False),
        ("ec2:Terminate?", False),
        ("ec2", False),
        ("ec2:", False),
        (":TerminateInstances", False),
        ("ec2:Terminate:Instances", False),
        ("ec2:Terminate Instances", False),
        ("ec2:Terminate-Instances", False),
        ("ec2 :TerminateInstances", False),
        ("ec2:TerminateInstances\n", False),
        ("a" * 65 + ":B", False),
        ("a:" + "B" * 129, False),
        ("", False),
        (None, False),
        (["ec2:TerminateInstances"], False),
        ({"service": "ec2"}, False),
    ],
)
def test_an_operation_is_one_exact_action_with_a_lower_case_service(operation, valid):
    assert is_operation(operation) is valid
    if valid:
        assert validate_allow({"operation": operation}, operations=True) == {
            "operation": operation
        }
    else:
        for value in ({"operation": operation},):
            with pytest.raises(PolicyError):
                validate_allow(value, operations=True)
        with pytest.raises(PolicyError):
            validate_policy(_rule(operation=operation, effect="ask"), operations=True)


@pytest.mark.parametrize(
    "target",
    [
        {"operation": TERMINATE, "class": "delete"},
        {"operation": TERMINATE, "match": {"path": "/"}},
        {"operation": TERMINATE, "class": "delete", "match": {"path": "/"}},
    ],
)
def test_a_rule_or_an_allow_names_exactly_one_target(target):
    with pytest.raises(PolicyError, match="exactly one of class, match or operation"):
        validate_policy(_rule(**target, effect="ask"), operations=True)
    with pytest.raises(PolicyError, match="exactly one of class, match or operation"):
        validate_allow(target, operations=True)


@pytest.mark.parametrize(
    "operation",
    [
        "sts:AssumeRole",
        "sts:AssumeRoleWithSAML",
        "sts:AssumeRoleWithWebIdentity",
        "sts:AssumeRoot",
        "sts:GetSessionToken",
        "sts:GetFederationToken",
        "sts:GetWebIdentityToken",
        "iam:CreateAccessKey",
        "iam:CreateLoginProfile",
        "iam:UpdateLoginProfile",
        "iam:CreateServiceSpecificCredential",
        "iam:ResetServiceSpecificCredential",
        "iam:UploadSSHPublicKey",
        "iam:UploadSigningCertificate",
        "ecr:GetAuthorizationToken",
        "ecr-public:GetAuthorizationToken",
        "codeartifact:GetAuthorizationToken",
        "redshift:GetClusterCredentials",
        "redshift:GetClusterCredentialsWithIAM",
        "redshift-serverless:GetCredentials",
        "cognito-identity:GetCredentialsForIdentity",
        "cognito-identity:GetOpenIdToken",
        "cognito-identity:GetOpenIdTokenForDeveloperIdentity",
        "ec2:CreateKeyPair",
        "elasticmapreduce:GetClusterSessionCredentials",
        "lightsail:GetInstanceAccessDetails",
        "lightsail:CreateKeyPair",
        "lightsail:DownloadDefaultKeyPair",
        "lightsail:CreateBucketAccessKey",
        "s3express:CreateSession",
        # Compared without regard to case.
        "sts:assumerole",
        "sts:ASSUMEROLE",
        "iam:createaccesskey",
    ],
)
def test_an_action_that_mints_credentials_belongs_to_the_secret_guard(operation):
    assert is_minting_operation(operation) is True
    for effect in ("allow", "ask", "block"):
        with pytest.raises(PolicyError, match="secret guard"):
            validate_policy(_rule(operation=operation, effect=effect), operations=True)
    with pytest.raises(PolicyError, match="secret guard"):
        validate_allow({"operation": operation}, operations=True)


def test_other_actions_of_the_same_services_do_not_mint():
    for operation in (
        "sts:GetCallerIdentity",
        "iam:ListUsers",
        "iam:DeleteAccessKey",
        "ec2:DescribeKeyPairs",
        "ecr:DescribeRepositories",
        TERMINATE,
    ):
        assert is_minting_operation(operation) is False
        assert validate_allow({"operation": operation}, operations=True)
    assert is_minting_operation(None) is False


def test_operations_are_compared_without_regard_to_case():
    assert same_operation(TERMINATE, "ec2:terminateinstances")
    assert same_operation("ec2:TERMINATEINSTANCES", TERMINATE)
    assert not same_operation(TERMINATE, "ec2:StopInstances")
    assert not same_operation(TERMINATE, "ecs:TerminateInstances")


def test_an_allow_for_an_action_is_held_against_the_rules_that_name_it():
    policy = validate_policy(
        _policy(
            rules=[
                {"operation": TERMINATE, "effect": "block"},
                {"operation": "ec2:StopInstances", "effect": "ask"},
                {"operation": "s3:DeleteBucket", "effect": "allow"},
                {"class": "admin", "effect": "block"},
                {"match": {"methods": ["POST"], "path": "/"}, "effect": "block"},
            ]
        ),
        operations=True,
    )

    assert allow_is_blocked(policy, {"operation": TERMINATE}) is True
    assert allow_is_blocked(policy, {"operation": "ec2:terminateinstances"}) is True
    # Only a block refuses; an ask is what an allow is for.
    assert allow_is_blocked(policy, {"operation": "ec2:StopInstances"}) is False
    assert allow_is_blocked(policy, {"operation": "s3:DeleteBucket"}) is False
    # The Console cannot tell an action's class or path: the proxy classifies
    # an AWS call, so a class or match block does not refuse an action here.
    assert allow_is_blocked(policy, {"operation": "iam:ListUsers"}) is False
    # And a rule by action never covers all of a class or a match.
    assert allow_is_blocked(policy, {"class": "delete"}) is False
    assert allow_is_blocked(policy, {"class": "admin"}) is True
    assert (
        allow_is_blocked(policy, {"match": {"methods": ["DELETE"], "path": "/x"}})
        is False
    )


def test_the_compiled_policy_carries_rules_and_allows_by_action():
    now = timezone.now()
    later = (now + timedelta(hours=1)).isoformat()
    policy = validate_policy(
        _rule(operation=TERMINATE, effect="ask"), operations=True
    )
    allows = [
        {"id": "a", "operation": TERMINATE, "expiresAt": later, "requestId": "r-1"},
        {"id": "b", "operation": "ec2:StopInstances", "expiresAt": "expired"},
    ]

    compiled = compile_policy(policy, allows, now)

    assert compiled["rules"] == [{"operation": TERMINATE, "effect": "ask"}]
    assert compiled["temporary_allows"] == [
        {"id": "a", "operation": TERMINATE, "expires_at": later}
    ]
    assert compiled["managed"] == [SECRET_GUARD]


# Operation classes


def test_a_definition_carries_its_operation_classes():
    classes = [
        {"match": {"methods": ["POST"], "path": "/graphql"}, "class": "read"},
        {"match": {"path": "/admin/*"}, "class": "admin"},
    ]

    definition = validate_definition(_definition(operationClasses=classes))

    assert definition["operationClasses"] == classes
    assert definition["specVersion"] == 1
    assert compile_service(definition)["operation_classes"] == classes


def test_a_definition_without_operation_classes_stores_none():
    for definition in (_definition(), _definition(operationClasses=[])):
        checked = validate_definition(definition)
        assert "operationClasses" not in checked
        assert compile_service(checked)["operation_classes"] == []


@pytest.mark.parametrize(
    "classes,message",
    [
        ({"class": "read"}, "expected a list"),
        ([{"class": "read"}], "a match and a class"),
        ([{"match": {"path": "/x"}}], "a match and a class"),
        ([{"match": {"path": "/x"}, "class": "credential_minting"}], "secret guard"),
        ([{"match": {"path": "/x"}, "class": "write"}], "expected one of read"),
        ([{"match": {"path": "/x"}, "class": "read", "effect": "allow"}], "unknown field"),
        ([{"match": {"path": "x"}, "class": "read"}], "must begin with '/'"),
        ([{"match": {"path": "/x"}, "class": "read"}] * 51, "at most 50"),
    ],
)
def test_malformed_operation_classes_are_refused(classes, message):
    with pytest.raises(DefinitionError, match=message):
        validate_definition(_definition(operationClasses=classes))


def test_fifty_operation_classes_are_accepted():
    classes = [{"match": {"path": f"/v{index}/*"}, "class": "read"} for index in range(50)]

    assert validate_operation_classes(classes, "operationClasses") == classes


def test_a_custom_http_call_is_classified_by_override_then_method():
    classes = [
        {"match": {"methods": ["POST"], "path": "/graphql"}, "class": "read"},
        {"match": {"path": "/graphql"}, "class": "admin"},
        {"match": {"methods": ["POST"]}, "class": "update"},
    ]

    # The first matching entry wins.
    assert classify_http_call(classes, "POST", "/graphql") == "read"
    assert classify_http_call(classes, "PUT", "/graphql") == "admin"
    assert classify_http_call(classes, "POST", "/items") == "update"
    assert [
        classify_http_call([], method, "/x")
        for method in ("GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE", "TRACE")
    ] == ["read", "read", "read", "create", "update", "update", "delete", "update"]


# Allows


def test_an_allow_names_one_class_or_one_match():
    assert validate_allow({"class": "delete"}) == {"class": "delete"}
    assert validate_allow({"class": "delete"}, operations=True) == {"class": "delete"}
    assert validate_allow({"match": {"methods": ["DELETE"], "path": "/x"}}) == {
        "match": {"methods": ["DELETE"], "path": "/x"}
    }
    for allow in ({}, {"class": "delete", "match": {"path": "/x"}}, {"effect": "allow"}):
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


def test_a_custom_call_is_also_judged_by_its_class():
    delete = {"match": {"methods": ["DELETE"], "path": "/repos/acme/x"}}
    reclassified = [{"match": {"methods": ["DELETE"]}, "class": "update"}]

    # An AWS call is classified by the proxy alone.
    assert allow_is_blocked(POLICY, delete) is False
    # A packaged HTTP service's overrides count the same as a custom one's.
    github = [{"match": {"methods": ["POST"], "path": "/graphql"}, "class": "delete"}]
    graphql = {"match": {"methods": ["POST"], "path": "/graphql"}}
    assert allow_is_blocked(POLICY, graphql, operation_classes=[]) is False
    assert allow_is_blocked(POLICY, graphql, operation_classes=github) is True
    assert allow_is_blocked(POLICY, delete, operation_classes=[]) is True
    assert allow_is_blocked(POLICY, delete, operation_classes=reclassified) is False
    # A pattern can cover calls of more than one class.
    assert (
        allow_is_blocked(
            POLICY,
            {"match": {"methods": ["DELETE"], "path": "/repos/*"}},
            operation_classes=[],
        )
        is False
    )


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
    with pytest.raises(PolicyError):
        validate_operation_classes(
            [{"match": {"path": "/x"}, "class": value}], "classes"
        )
