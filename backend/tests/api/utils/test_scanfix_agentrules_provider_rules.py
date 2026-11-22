"""A GitLab or GitHub Enterprise API served below one path segment is guarded
and classed as one served at the root, and a credential that names a deeper
path is refused, so a Connection's hosts and its provider rules always agree.

The guard is compared as the proxy compares it, from the rules a session
receives; nothing here reaches a network or a database.
"""

from fnmatch import fnmatchcase
import re

import pytest

from api.utils.agent_config import REGISTRY
from api.utils.agent_config.access_policy import classify_http_call
from api.utils.agent_credentials import (
    CredentialResolutionError,
    _github_config,
    _gitlab_config,
)
from api.views.agents.runtime import provider_rules


def _guard_stops(service_type, method, path):
    """Whether the guard a session receives stops a call: one segment for
    each ``*``, without letter case or one trailing slash."""

    path = path.lower()
    if len(path) > 1:
        path = path.removesuffix("/")
    guard = provider_rules(REGISTRY.get_service(service_type))["secret_guard"]
    for rule in guard["paths"]:
        pattern = "".join(
            "[^/]*" if character == "*" else re.escape(character)
            for character in rule["pattern"].lower()
        )
        if rule.get("method", method) == method and re.fullmatch(pattern, path):
            return True
    return False


def _routed(hosts, path):
    """Whether a Connection's host rules take a request path; a ``*`` in a
    host rule's path spans segments."""

    return any("path" not in rule or fnmatchcase(path, rule["path"]) for rule in hosts)


def _gitlab_hosts(gitlab_host):
    return _gitlab_config({"gitlab_host": gitlab_host})["hosts"]


def _github_hosts(api_url):
    return _github_config({"api_url": api_url})["hosts"]


# Every rule written from the API root has its twin one segment down


@pytest.mark.parametrize("service_type,root", [("gitlab", "/api/v4/"), ("github", "/api/v3/")])
def test_every_guard_rule_on_the_api_root_has_a_twin_below_one_path_segment(
    service_type, root
):
    rules = REGISTRY.get_service(service_type)["secret_guard"]["paths"]
    rooted = [rule for rule in rules if rule["pattern"].startswith(root)]

    assert rooted
    for rule in rooted:
        assert {**rule, "pattern": "/*" + rule["pattern"]} in rules, rule


def test_every_gitlab_guard_rule_is_written_from_the_api_root_or_one_segment_below():
    for rule in REGISTRY.get_service("gitlab")["secret_guard"]["paths"]:
        assert rule["pattern"].startswith(("/api/v4/", "/*/api/v4/")), rule


# GitLab below a path prefix

_GITLAB_MINTING_CALLS = [
    "/api/v4/projects/42/access_tokens",
    "/api/v4/projects/42/access_tokens/7/rotate",
    "/api/v4/groups/9/access_tokens",
    "/api/v4/user/personal_access_tokens",
    "/api/v4/users/3/personal_access_tokens",
    "/api/v4/personal_access_tokens/self/rotate",
    "/api/v4/users/3/impersonation_tokens",
    "/api/v4/projects/42/deploy_tokens",
    "/api/v4/groups/9/deploy_tokens",
    "/api/v4/projects/42/deploy_keys",
    "/api/v4/projects/42/deploy_keys/7/enable",
    "/api/v4/user/keys",
    "/api/v4/users/3/keys",
    "/api/v4/projects/42/triggers",
    "/api/v4/user/runners",
    "/api/v4/runners",
]


@pytest.mark.parametrize("path", _GITLAB_MINTING_CALLS)
def test_a_prefixed_gitlab_connection_guards_the_calls_an_unprefixed_one_does(path):
    prefixed = f"/gitlab{path}"

    assert _routed(_gitlab_hosts("https://code.example.com/gitlab"), prefixed)
    assert _routed(_gitlab_hosts("https://gitlab.com"), path)
    assert _guard_stops("gitlab", "POST", path)
    assert _guard_stops("gitlab", "POST", prefixed)


@pytest.mark.parametrize(
    "method,path",
    [
        ("GET", "/gitlab/api/v4/projects/42/deploy_keys"),
        ("DELETE", "/gitlab/api/v4/projects/42/deploy_keys/7"),
        ("GET", "/gitlab/api/v4/user/keys"),
        ("POST", "/gitlab/api/v4/projects/42/issues"),
        ("GET", "/gitlab/api/v4/projects/42/access_tokens"),
    ],
)
def test_a_prefixed_gitlab_connections_guard_leaves_other_calls_alone(method, path):
    assert not _guard_stops("gitlab", method, path)


def test_a_prefixed_gitlab_graphql_call_is_classed_as_an_update():
    classes = REGISTRY.get_service("gitlab")["operation_classes"]

    assert classify_http_call(classes, "POST", "/api/graphql") == "update"
    assert classify_http_call(classes, "POST", "/gitlab/api/graphql") == "update"


# GitHub Enterprise Server below a path prefix

_GITHUB_ENTERPRISE_MINTING_CALLS = [
    "/api/v3/app/installations/1/access_tokens",
    "/api/v3/repos/acme/app/actions/runners/registration-token",
    "/api/v3/orgs/acme/actions/runners/generate-jitconfig",
    "/api/v3/enterprises/acme/actions/runners/registration-token",
    "/api/v3/repos/acme/app/keys",
    "/api/v3/user/keys",
]


@pytest.mark.parametrize("path", _GITHUB_ENTERPRISE_MINTING_CALLS)
def test_a_prefixed_github_enterprise_connection_guards_the_calls_an_unprefixed_one_does(
    path,
):
    prefixed = f"/ghe{path}"

    assert _routed(_github_hosts("https://ghe.example.com/ghe/api/v3"), prefixed)
    assert _routed(_github_hosts("https://ghe.example.com/api/v3"), path)
    assert _guard_stops("github", "POST", path)
    assert _guard_stops("github", "POST", prefixed)


def test_github_coms_guard_stops_adding_an_ssh_key_to_the_tokens_user():
    assert _guard_stops("github", "POST", "/user/keys")
    assert not _guard_stops("github", "GET", "/user/keys")


def test_a_prefixed_github_enterprise_graphql_call_is_classed_as_an_update():
    classes = REGISTRY.get_service("github")["operation_classes"]

    assert _routed(_github_hosts("https://ghe.example.com/ghe/api/v3"), "/ghe/api/graphql")
    for path in ("/graphql", "/api/graphql", "/ghe/api/graphql"):
        assert classify_http_call(classes, "POST", path) == "update", path
    # Other calls keep the class of their method.
    assert classify_http_call(classes, "POST", "/ghe/api/v3/repos/acme/app/issues") == (
        "create"
    )


# A credential's host is taken only as deep as the rules reach


@pytest.mark.parametrize(
    "gitlab_host,path",
    [
        ("https://gitlab.com", "/api/*"),
        ("https://code.example.com/gitlab", "/gitlab/api/*"),
        ("https://code.example.com/gitlab/", "/gitlab/api/*"),
    ],
)
def test_a_gitlab_host_at_the_root_or_one_segment_down_is_taken(gitlab_host, path):
    [rule] = _gitlab_hosts(gitlab_host)

    assert rule["path"] == path


@pytest.mark.parametrize(
    "gitlab_host",
    [
        "https://code.example.com/tools/gitlab",
        "https://code.example.com/gitlab/api/v4",
        "https://code.example.com/a/b/c",
    ],
)
def test_a_gitlab_host_two_or_more_segments_down_is_refused(gitlab_host):
    with pytest.raises(CredentialResolutionError, match="at most one path segment"):
        _gitlab_config({"gitlab_host": gitlab_host})


@pytest.mark.parametrize(
    "api_url,path",
    [
        ("https://api.github.com", None),
        ("https://api.acme.ghe.com", None),
        ("https://ghe.example.com/api/v3", "/api/*"),
        ("https://ghe.example.com/api/v3/", "/api/*"),
        ("https://ghe.example.com/ghe/api/v3", "/ghe/api/*"),
    ],
)
def test_a_github_api_at_the_root_or_below_one_segment_is_taken(api_url, path):
    [rule] = _github_hosts(api_url)

    assert rule.get("path") == path


@pytest.mark.parametrize(
    "api_url",
    [
        "https://ghe.example.com/tools/ghe/api/v3",
        "https://ghe.example.com/a/b/api",
        # No Enterprise Server API is served here, so no rule names its paths.
        "https://ghe.example.com/custom",
    ],
)
def test_a_github_api_the_rules_do_not_reach_is_refused(api_url):
    with pytest.raises(CredentialResolutionError, match="at most one path segment"):
        _github_config({"api_url": api_url})
