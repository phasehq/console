"""The secret guard: which calls each service's manifest stops, and which
Connections list the guard."""

import re

from django.utils import timezone
import pytest

from api.utils.agent_config import REGISTRY
from api.utils.agent_config.access_policy import compile_policy, managed_policies


SECRET_GUARD = {
    "id": "secret_guard",
    "locked": True,
    "rules": [{"class": "credential_minting", "effect": "block"}],
}


def _guard_stops(service_type, method, path):
    """Whether a service's guard stops a call, compared as the proxy compares
    a guard path: one segment for each ``*``, without letter case or one
    trailing slash."""

    path = path.lower()
    if len(path) > 1:
        path = path.removesuffix("/")
    for rule in REGISTRY.get_service(service_type)["secret_guard"]["paths"]:
        pattern = "".join(
            "[^/]*" if character == "*" else re.escape(character)
            for character in rule["pattern"].lower()
        )
        if rule.get("method", method) == method and re.fullmatch(pattern, path):
            return True
    return False


# Calls that hand back a new credential. A path rule cannot see a call named in
# the request body, so GitLab's and Railway's GraphQL endpoints are not here.
_MINTING_CALLS = {
    "gitlab": [
        ("POST", "/api/v4/projects/42/access_tokens"),
        ("POST", "/api/v4/projects/42/access_tokens/7/rotate"),
        ("POST", "/api/v4/projects/42/access_tokens/self/rotate"),
        ("POST", "/api/v4/groups/9/access_tokens"),
        ("POST", "/api/v4/groups/9/access_tokens/7/rotate"),
        ("POST", "/api/v4/user/personal_access_tokens"),
        ("POST", "/api/v4/users/3/personal_access_tokens"),
        ("POST", "/api/v4/personal_access_tokens/7/rotate"),
        ("POST", "/api/v4/personal_access_tokens/self/rotate"),
        ("POST", "/api/v4/users/3/impersonation_tokens"),
        ("POST", "/api/v4/projects/42/deploy_tokens"),
        ("POST", "/api/v4/groups/9/deploy_tokens"),
        ("POST", "/api/v4/projects/42/triggers"),
        ("POST", "/api/v4/user/runners"),
        ("POST", "/api/v4/runners"),
        # A deploy key, or an SSH key on a user, is a key the caller supplies
        # that keeps its access after the Connection's grant ends.
        ("POST", "/api/v4/projects/42/deploy_keys"),
        ("POST", "/api/v4/projects/42/deploy_keys/7/enable"),
        ("POST", "/api/v4/user/keys"),
        ("POST", "/api/v4/users/3/keys"),
        # A respelled path reaches the same route.
        ("POST", "/API/v4/Projects/42/access_tokens/"),
    ],
    "cloudflare": [
        ("POST", "/client/v4/user/tokens"),
        ("PUT", "/client/v4/user/tokens/abc123/value"),
        ("POST", "/client/v4/accounts/acc1/tokens"),
        ("PUT", "/client/v4/accounts/acc1/tokens/abc123/value"),
        ("POST", "/client/v4/accounts/acc1/r2/temp-access-credentials"),
    ],
    "vercel": [("POST", "/v3/user/tokens")],
    "supabase": [("POST", "/v1/projects/abcdefghij/api-keys")],
    "github": [
        ("POST", "/app/installations/1/access_tokens"),
        # An Enterprise Server serves the same API below /api/v3.
        ("POST", "/api/v3/app/installations/1/access_tokens"),
        # A runner registration token or just-in-time configuration enrols a
        # runner that outlives the Connection.
        ("POST", "/repos/acme/app/actions/runners/registration-token"),
        ("POST", "/orgs/acme/actions/runners/registration-token"),
        ("POST", "/enterprises/acme/actions/runners/registration-token"),
        ("POST", "/repos/acme/app/actions/runners/generate-jitconfig"),
        ("POST", "/orgs/acme/actions/runners/generate-jitconfig"),
        ("POST", "/enterprises/acme/actions/runners/generate-jitconfig"),
        ("POST", "/api/v3/repos/acme/app/actions/runners/registration-token"),
        ("POST", "/api/v3/orgs/acme/actions/runners/registration-token"),
        ("POST", "/api/v3/enterprises/acme/actions/runners/registration-token"),
        ("POST", "/api/v3/repos/acme/app/actions/runners/generate-jitconfig"),
        ("POST", "/api/v3/orgs/acme/actions/runners/generate-jitconfig"),
        ("POST", "/api/v3/enterprises/acme/actions/runners/generate-jitconfig"),
        # A deploy key is an SSH key the caller supplies, with no expiry, as
        # is an SSH key added to the token's user.
        ("POST", "/repos/acme/app/keys"),
        ("POST", "/api/v3/repos/acme/app/keys"),
        ("POST", "/user/keys"),
        ("POST", "/api/v3/user/keys"),
    ],
}
_OTHER_CALLS = {
    "gitlab": [
        ("GET", "/api/v4/projects/42/access_tokens"),
        ("DELETE", "/api/v4/projects/42/access_tokens/7"),
        ("GET", "/api/v4/personal_access_tokens"),
        ("POST", "/api/v4/projects/42/issues"),
        ("POST", "/api/v4/projects/42/triggers/5/take_ownership"),
        ("GET", "/api/v4/runners"),
        ("GET", "/api/v4/projects/42/deploy_keys"),
        ("DELETE", "/api/v4/projects/42/deploy_keys/7"),
        ("GET", "/api/v4/user/keys"),
        ("DELETE", "/api/v4/user/keys/7"),
    ],
    "cloudflare": [
        ("GET", "/client/v4/user/tokens"),
        ("PUT", "/client/v4/user/tokens/abc123"),
        ("GET", "/client/v4/user/tokens/verify"),
        ("POST", "/client/v4/zones/z1/dns_records"),
    ],
    "vercel": [("GET", "/v5/user/tokens"), ("POST", "/v13/deployments")],
    "supabase": [
        ("GET", "/v1/projects/abcdefghij/api-keys"),
        ("POST", "/v1/projects"),
    ],
    "github": [
        ("GET", "/app/installations/1"),
        ("POST", "/repos/acme/app/issues"),
        ("GET", "/repos/acme/app/keys"),
        ("DELETE", "/repos/acme/app/keys/7"),
        ("GET", "/repos/acme/app/actions/runners"),
        ("POST", "/user/repos"),
        ("GET", "/user/keys"),
        ("DELETE", "/user/keys/7"),
    ],
}


def _calls(table):
    return [
        (service_type, method, path)
        for service_type, calls in table.items()
        for method, path in calls
    ]


@pytest.mark.parametrize("service_type,method,path", _calls(_MINTING_CALLS))
def test_a_call_that_mints_a_credential_is_in_its_services_guard(
    service_type, method, path
):
    assert _guard_stops(service_type, method, path)


@pytest.mark.parametrize("service_type,method,path", _calls(_OTHER_CALLS))
def test_the_guard_leaves_other_calls_alone(service_type, method, path):
    assert not _guard_stops(service_type, method, path)


def test_every_guard_path_rule_names_its_method_and_what_it_stops():
    for service_type in REGISTRY.guarded_service_types - {"aws"}:
        service = REGISTRY.get_service(service_type)
        assert set(service["secret_guard"]) == {"paths"}
        for rule in service["secret_guard"]["paths"]:
            assert set(rule) == {"method", "pattern", "operation"}, rule
            assert rule["operation"].startswith(service["display_name"])


@pytest.mark.parametrize("service_type", ["railway", "render", "postgres"])
def test_a_service_with_no_call_to_stop_has_no_guard(service_type):
    assert "secret_guard" not in REGISTRY.get_service(service_type)
    assert service_type not in REGISTRY.guarded_service_types


# AWS


def test_the_aws_guard_stops_grafana_service_account_and_gamelift_compute_tokens():
    aws = REGISTRY.get_service("aws")

    assert "GetComputeAuthToken" in aws["secret_guard"]["operations"]["gamelift"]
    assert {
        "method": "POST",
        "pattern": "/workspaces/*/serviceaccounts/*/tokens",
        "operation": "grafana:CreateWorkspaceServiceAccountToken",
        "services": ["grafana"],
    } in aws["secret_guard"]["paths"]


def _aws_guard_stops(service, method, path, query=(), host=None):
    """Whether the AWS guard's path rules stop a call, compared as the proxy
    compares them: the method, the signing service, a DNS label of the host,
    a query parameter the call carries, then the path."""

    host = host or f"{service}.us-east-1.amazonaws.com"
    labels = {label.removesuffix("-fips") for label in host.split(".")}
    path = path.lower()
    if len(path) > 1:
        path = path.removesuffix("/")
    for rule in REGISTRY.get_service("aws")["secret_guard"]["paths"]:
        if rule.get("method", method) != method:
            continue
        if service not in rule.get("services", [service]):
            continue
        if "host_label" in rule and rule["host_label"] not in labels:
            continue
        if "query" in rule and rule["query"] not in query:
            continue
        pattern = "".join(
            "[^/]*" if character == "*" else re.escape(character)
            for character in rule["pattern"].lower()
        )
        if re.fullmatch(pattern, path):
            return True
    return False


_AWS_MINTING_CALLS = [
    # AppSync: the key's id is the key itself.
    ("appsync", "GET", "/v1/apis/abc123/apikeys", ()),
    ("appsync", "POST", "/v1/apis/abc123/apikeys", ()),
    ("appsync", "POST", "/v1/apis/abc123/apikeys/da2-keyid", ()),
    # API Gateway hands back key values on request.
    ("apigateway", "POST", "/apikeys", ()),
    ("apigateway", "GET", "/apikeys", ("includeValues",)),
    ("apigateway", "GET", "/apikeys/abc123", ("includeValue",)),
    # IoT: a claim certificate and key, or a certificate for the caller's CSR.
    ("iot", "POST", "/provisioning-templates/fleet/provisioning-claim", ()),
    ("iot", "POST", "/certificates", ("setAsActive",)),
    ("iot", "POST", "/keys-and-certificate", ()),
]
_AWS_OTHER_CALLS = [
    ("appsync", "GET", "/v1/apis/abc123", ()),
    ("appsync", "DELETE", "/v1/apis/abc123/apikeys/da2-keyid", ()),
    ("apigateway", "GET", "/apikeys", ()),
    ("apigateway", "GET", "/apikeys/abc123", ()),
    ("apigateway", "GET", "/restapis", ("includeValues",)),
    ("iot", "GET", "/provisioning-templates/fleet", ()),
    ("iot", "GET", "/certificates", ()),
    ("iot", "POST", "/provisioning-templates", ()),
]


@pytest.mark.parametrize("service,method,path,query", _AWS_MINTING_CALLS)
def test_an_aws_call_that_hands_back_a_credential_is_guarded(
    service, method, path, query
):
    assert _aws_guard_stops(service, method, path, query)


@pytest.mark.parametrize("service,method,path,query", _AWS_OTHER_CALLS)
def test_the_aws_guard_leaves_other_rest_calls_alone(service, method, path, query):
    assert not _aws_guard_stops(service, method, path, query)


def test_the_iot_certificate_rules_apply_only_to_an_iot_host():
    assert not _aws_guard_stops(
        "execute-api",
        "POST",
        "/certificates",
        host="abc123.execute-api.us-east-1.amazonaws.com",
    )
    assert _aws_guard_stops(
        "execute-api", "POST", "/certificates", host="iot.us-east-1.amazonaws.com"
    )


# Which Connections list the guard


@pytest.mark.parametrize(
    "service_type", ["aws", "github", "gitlab", "cloudflare", "vercel", "supabase"]
)
def test_a_service_with_guard_rules_lists_the_secret_guard(service_type):
    assert managed_policies(service_type) == [SECRET_GUARD]
    compiled = compile_policy({}, [], timezone.now(), service_type=service_type)
    assert compiled["managed"] == [SECRET_GUARD]


@pytest.mark.parametrize("service_type", ["railway", "render", "http", "postgres"])
def test_a_service_without_guard_rules_lists_no_secret_guard(service_type):
    assert managed_policies(service_type) == []
    compiled = compile_policy({}, [], timezone.now(), service_type=service_type)
    assert compiled["managed"] == []
