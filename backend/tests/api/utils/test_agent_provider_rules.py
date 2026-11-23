"""Provider rules in the service manifests, with shape guards.

Like ``test_agent_config``, these corrupt copies of the real packaged files, so a check that
stops rejecting bad input fails here.
"""

import json
from pathlib import Path
import shutil

import pytest

from api.utils.agent_config import (
    DEFAULT_SERVICE_ROOT,
    REGISTRY,
    ConfigRegistry,
    ConfigRegistryError,
)
from tests.api.agents.provider_rules import SERVICES, recorded


def _root(tmp_path: Path) -> Path:
    root = tmp_path / "v1"
    shutil.copytree(DEFAULT_SERVICE_ROOT, root)
    return root


def _load_with(tmp_path, filename, mutate):
    root = _root(tmp_path)
    path = root / filename
    document = json.loads(path.read_text(encoding="utf-8"))
    mutate(document)
    path.write_text(json.dumps(document), encoding="utf-8")
    return ConfigRegistry.load(root)


def _refused(tmp_path, filename, mutate, message):
    with pytest.raises(ConfigRegistryError, match=message):
        _load_with(tmp_path, filename, mutate)


# What the manifests hold


def test_every_service_carries_the_rules_recorded_from_the_cli():
    assert set(SERVICES) == set(REGISTRY.services)
    for service_type in SERVICES:
        service = REGISTRY.get_service(service_type)
        expected = recorded(service_type)
        assert service["credential_environment"] == expected["credential_environment"]
        assert service.get("secret_guard") == expected.get("secret_guard"), service_type


def test_the_services_with_a_guard_are_known_and_none_classes_calls():
    guarded = {
        service_type
        for service_type, service in REGISTRY.services.items()
        if "secret_guard" in service
    }
    assert guarded == {"aws", "cloudflare", "github", "gitlab", "supabase", "vercel"}
    assert guarded == REGISTRY.guarded_service_types
    # Every call is classed by its HTTP method alone.
    for service in REGISTRY.services.values():
        assert not {"action_classes", "operation_classes"} & set(service)


# credential_environment


def test_credential_environment_is_optional_and_defaults_to_empty(tmp_path):
    registry = _load_with(
        tmp_path, "vercel.json", lambda document: document.pop("credential_environment")
    )
    assert registry.get_service("vercel")["credential_environment"] == []


@pytest.mark.parametrize(
    ("value", "message"),
    [
        ("VERCEL_TOKEN", "expected a list"),
        (["vercel_token"], "upper-case environment variable"),
        (["1TOKEN"], "upper-case environment variable"),
        (["VERCEL-TOKEN"], "upper-case environment variable"),
        (["A" * 129], "at most 128"),
        ([f"NAME_{index}" for index in range(65)], "at most 64"),
        (["VERCEL_TOKEN", "VERCEL_TOKEN"], "duplicate"),
        ([7], "non-empty string"),
    ],
)
def test_credential_environment_rejects_names_the_client_would_refuse(
    tmp_path, value, message
):
    _refused(
        tmp_path,
        "vercel.json",
        lambda document: document.update({"credential_environment": value}),
        message,
    )


def test_credential_environment_accepts_the_longest_names(tmp_path):
    names = [f"N{index:03d}" + "A" * 124 for index in range(64)]
    registry = _load_with(
        tmp_path,
        "vercel.json",
        lambda document: document.update({"credential_environment": names}),
    )
    assert registry.get_service("vercel")["credential_environment"] == names


# secret_guard


def _github_guard(**rule):
    return lambda document: document.update(
        {"secret_guard": {"paths": [{"pattern": "/x", "operation": "X", **rule}]}}
    )


def test_a_secret_guard_path_rule_takes_every_documented_member(tmp_path):
    registry = _load_with(
        tmp_path,
        "github.json",
        _github_guard(method="POST", query="session", host_label="api"),
    )
    assert registry.get_service("github")["secret_guard"] == {
        "paths": [
            {
                "method": "POST",
                "pattern": "/x",
                "query": "session",
                "operation": "X",
                "host_label": "api",
            }
        ]
    }


@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (lambda d: d.update({"secret_guard": {}}), "operations, paths, or both"),
        (lambda d: d.update({"secret_guard": {"paths": []}}), "operations, paths"),
        (
            lambda d: d.update({"secret_guard": {"operations": {}, "paths": []}}),
            "operations, paths, or both",
        ),
        (
            lambda d: d.update({"secret_guard": {"operations": None, "paths": None}}),
            "operations, paths, or both",
        ),
        (
            lambda d: d.update(
                {"secret_guard": {"paths": [{"pattern": "/x", "operation": ""}]}}
            ),
            "non-empty string",
        ),
        (lambda d: d.update({"secret_guard": []}), "expected an object"),
        (lambda d: d.update({"secret_guard": {"rules": []}}), "unknown field"),
        (_github_guard(methods=["POST"]), "unknown field"),
        (_github_guard(path="/y"), "unknown field"),
        (_github_guard(method="post"), "upper-case HTTP method"),
        (_github_guard(method=["POST"]), "upper-case HTTP method"),
        (_github_guard(query={"name": "value"}), "non-empty string"),
        (_github_guard(query="a=b"), "one query parameter"),
        (_github_guard(host_label="API"), "DNS label"),
        (_github_guard(services=["codeartifact"]), "only valid for a service signed"),
        (
            lambda d: d.update({"secret_guard": {"operations": {"sts": ["AssumeRole"]}}}),
            "only valid for a service signed",
        ),
        (
            lambda d: d.update(
                {"secret_guard": {"paths": [{"pattern": "x", "operation": "X"}]}}
            ),
            "must begin with '/'",
        ),
        (
            lambda d: d.update({"secret_guard": {"paths": [{"pattern": "/x"}]}}),
            "missing required field",
        ),
        (
            lambda d: d.update(
                {"secret_guard": {"paths": [{"pattern": "/x", "operation": "\x00"}]}}
            ),
            "control characters",
        ),
    ],
)
def test_a_github_secret_guard_rejects_bad_shapes(tmp_path, mutate, message):
    _refused(tmp_path, "github.json", mutate, message)


def _aws_operations(operations):
    return lambda document: document["secret_guard"].update({"operations": operations})


@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (_aws_operations({}), "must not be empty"),
        (_aws_operations({"STS": ["AssumeRole"]}), "invalid service"),
        (_aws_operations({"sts": []}), "must not be empty"),
        (_aws_operations({"sts": ["Assume Role"]}), "invalid value"),
        (_aws_operations({"sts": ["AssumeRole", "AssumeRole"]}), "duplicate"),
        (_aws_operations({"sts": "AssumeRole"}), "expected a list"),
        (_aws_operations({"sts": [""]}), "non-empty string"),
        (_aws_operations({"sts": ["AssumeRole", " "]}), "non-empty string"),
        (_aws_operations({"": ["AssumeRole"]}), "invalid service"),
        (
            lambda d: d["secret_guard"]["paths"][0].update({"services": [""]}),
            "non-empty string",
        ),
        (
            lambda d: d["secret_guard"]["paths"][0].update({"services": []}),
            "must not be empty",
        ),
        # A service signed for AWS needs guarded operations, not paths only.
        (lambda d: d["secret_guard"].pop("operations"), "needs operations"),
        (
            lambda d: d.update({"secret_guard": {"operations": {}, "paths": []}}),
            "operations, paths, or both",
        ),
        (lambda d: d.update({"secret_guard": {}}), "operations, paths, or both"),
        (
            lambda d: d["secret_guard"]["paths"][0].update({"services": ["Code Artifact"]}),
            "invalid value",
        ),
    ],
)
def test_an_aws_secret_guard_rejects_bad_operations(tmp_path, mutate, message):
    _refused(tmp_path, "aws.json", mutate, message)


# An AWS Connection always carries its guard


def test_the_aws_manifest_cannot_load_without_its_guard(tmp_path):
    _refused(
        tmp_path,
        "aws.json",
        lambda document: document.pop("secret_guard"),
        "needs secret_guard",
    )


@pytest.mark.parametrize(
    ("filename", "key"),
    [("aws.json", "action_classes"), ("github.json", "operation_classes")],
)
def test_a_manifest_that_classes_calls_is_refused(tmp_path, filename, key):
    _refused(
        tmp_path,
        filename,
        lambda document: document.update({key: {}}),
        f"unknown field\\(s\\): {key}",
    )


def test_the_packaged_aws_manifest_has_its_guard():
    service = REGISTRY.get_service("aws")
    assert service["injection"]["action"] == "aws_sigv4"
    assert service["secret_guard"]["operations"]


# credential_fields (token providers)


def test_token_providers_name_their_stored_credential_fields():
    assert {
        provider: REGISTRY.token_service(provider)["credential_fields"]
        for provider in (
            "github",
            "gitlab",
            "cloudflare",
            "vercel",
            "render",
            "railway",
            "supabase",
        )
    } == {
        "github": {"token": "access_token"},
        "gitlab": {"token": "gitlab_token"},
        "cloudflare": {"token": "access_token", "account_id": "account_id"},
        "vercel": {"token": "api_token"},
        "render": {"token": "api_key"},
        "railway": {"token": "api_token"},
        "supabase": {"token": "access_token"},
    }
    for provider in ("aws", "aws_assume_role", "postgres"):
        assert REGISTRY.token_service(provider) is None


@pytest.mark.parametrize(
    ("filename", "mutate", "message"),
    [
        (
            "vercel.json",
            lambda d: d.update({"credential_fields": {}}),
            "every service field",
        ),
        (
            "cloudflare.json",
            lambda d: d.update({"credential_fields": {"token": "access_token"}}),
            "every service field",
        ),
        (
            "vercel.json",
            lambda d: d.update({"credential_fields": {"token": "token"}}),
            "is not a vercel credential field",
        ),
        (
            "aws.json",
            lambda d: d.update(
                {
                    "credential_fields": {
                        "access_key_id": "access_key_id",
                        "secret_access_key": "secret_access_key",
                        "session_token": "access_key_id",
                    }
                }
            ),
            "injects a stored token",
        ),
    ],
)
def test_credential_fields_reject_bad_shapes(tmp_path, filename, mutate, message):
    _refused(tmp_path, filename, mutate, message)


def test_a_provider_is_read_by_one_service_only(tmp_path):
    root = _root(tmp_path)
    copy = json.loads((root / "vercel.json").read_text())
    copy["service_type"] = "vercel_two"
    copy["hosts"] = [{"match": "exact", "value": "api2.vercel.com", "port": 443}]
    (root / "vercel_two.json").write_text(json.dumps(copy))
    with pytest.raises(ConfigRegistryError, match="already read by another service"):
        ConfigRegistry.load(root)


def test_the_registry_endpoint_payload_carries_the_new_fields():
    services = REGISTRY.as_dict()["services"]
    assert services["aws"]["secret_guard"] == recorded("aws")["secret_guard"]
    assert services["github"]["credential_fields"] == {"token": "access_token"}
