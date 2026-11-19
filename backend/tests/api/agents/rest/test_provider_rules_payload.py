"""Each Connection's payload carries its manifest's provider rules.

Custom HTTP Connections list only their own fields' variables.
"""

import json
from pathlib import Path
import shutil

from djangorestframework_camel_case.render import CamelCaseJSONRenderer
import pytest

from api.utils.agent_config import DEFAULT_SERVICE_ROOT, ConfigRegistry
from api.views.agents.views import ProviderRulesJSONRenderer

from ..custom_connections import (
    ACTIONS,
    AWS_MATERIAL,
    CLIENT,
    custom_connection,
    grant,
    live_packaged_connection,
    member_client,
    open_session,
    session_get,
    use_test_server_keypair,
    workspace,
)
from ..provider_rules import expected_wire


RULE_KEYS = {"credentialEnvironment", "secretGuard", "actionClasses"}
MATERIAL = {
    "aws": AWS_MATERIAL,
    "github": {"access_token": "live-github-token"},
    "postgres": {
        "username": "agent_user",
        "password": "live-postgres-password",
        "host": "db.internal.example",
        "database": "app",
    },
    "render": {"api_key": "live-render-key"},
    "vercel": {"api_token": "live-vercel-token"},
}
WITHOUT_PROVIDER_RULES = [
    feature for feature in CLIENT["features"] if feature != "provider_rules"
]


@pytest.fixture(autouse=True)
def server_keypair(monkeypatch):
    use_test_server_keypair(monkeypatch)


@pytest.fixture
def space(db):
    space = workspace("provider-rules")
    role = space.member.role
    role.permissions["permissions"]["IntegrationCredentials"] = ACTIONS
    role.save()
    return space


def _connect(space, service_type):
    connection = live_packaged_connection(
        space, service_type, MATERIAL[service_type]
    )
    grant(space, connection)
    return connection


def _by_service(payload):
    return {
        connection["serviceType"]: connection for connection in payload["connections"]
    }


def _rules(connection):
    return {key: connection[key] for key in RULE_KEYS if key in connection}


def test_each_connection_carries_exactly_its_manifests_rules(space):
    for service_type in ("aws", "github", "postgres", "vercel"):
        _connect(space, service_type)
    grant(space, custom_connection(space))
    client = member_client(space)

    opened = open_session(client, space.workflow)
    for payload in (
        opened,
        session_get(client, opened),
        session_get(client, opened, "discover"),
    ):
        connections = _by_service(payload)
        assert set(connections) == {"aws", "github", "postgres", "vercel", "http"}
        for service_type in ("aws", "github", "postgres", "vercel"):
            assert _rules(connections[service_type]) == expected_wire(service_type)
        assert _rules(connections["http"]) == {
            "credentialEnvironment": ["EXAMPLE_API_KEY", "EXAMPLE_USER"]
        }

    connections = _by_service(opened)
    assert set(_rules(connections["aws"])) == RULE_KEYS
    assert set(_rules(connections["github"])) == {
        "credentialEnvironment",
        "secretGuard",
    }
    assert set(_rules(connections["postgres"])) == {"credentialEnvironment"}
    assert set(_rules(connections["vercel"])) == {
        "credentialEnvironment",
        "secretGuard",
    }
    # The data maps reach the client under the provider's own names.
    aws = connections["aws"]
    assert "cognito-identity" in aws["secretGuard"]["operations"]
    assert aws["actionClasses"]["exact"]["kms:CreateGrant"] == "admin"
    assert aws["actionClasses"]["s3Subresources"]["publicAccessBlock"] == "admin"
    assert aws["secretGuard"]["paths"][2]["hostLabel"] == "iot"


def test_the_emitted_aws_and_github_rules_are_the_recorded_ones(space):
    for service_type in ("aws", "github"):
        _connect(space, service_type)
    connections = _by_service(open_session(member_client(space), space.workflow))

    aws = connections["aws"]
    assert aws["secretGuard"] == expected_wire("aws")["secretGuard"]
    assert aws["actionClasses"] == expected_wire("aws")["actionClasses"]
    assert set(aws["actionClasses"]) == {
        "scheme",
        "version",
        "readVerbs",
        "createVerbs",
        "deleteVerbs",
        "adminServices",
        "adminSuffixes",
        "exact",
        "s3Subresources",
        "restOperations",
        "queryProtocolServices",
        "dualProtocolServices",
        "jsonTargetServices",
        "mixedServices",
    }
    assert connections["github"]["secretGuard"] == expected_wire("github")["secretGuard"]


# Client feature


def test_a_client_without_the_feature_cannot_open_a_workflow_with_aws(space):
    _connect(space, "aws")

    refusal = open_session(
        member_client(space),
        space.workflow,
        features=WITHOUT_PROVIDER_RULES,
        expect=400,
    )

    assert refusal["error"]["code"] == "client_capability_mismatch"
    assert refusal["error"]["details"]["missingFeatures"] == ["provider_rules"]


def test_a_client_without_the_feature_cannot_open_a_workflow_with_github(space):
    _connect(space, "github")

    refusal = open_session(
        member_client(space),
        space.workflow,
        features=WITHOUT_PROVIDER_RULES,
        expect=400,
    )

    assert refusal["error"]["details"]["missingFeatures"] == ["provider_rules"]


def test_guarded_connections_granted_later_are_left_out_for_that_client(space):
    for service_type in ("postgres", "render"):
        _connect(space, service_type)
    grant(space, custom_connection(space))
    old_client = member_client(space)
    old = open_session(old_client, space.workflow, features=WITHOUT_PROVIDER_RULES)
    assert set(_by_service(old)) == {"postgres", "render", "http"}

    _connect(space, "aws")
    _connect(space, "github")

    for endpoint in ("config", "discover"):
        assert set(_by_service(session_get(old_client, old, endpoint))) == {
            "postgres",
            "render",
            "http",
        }
    current_client = member_client(space)
    current = open_session(current_client, space.workflow)
    assert set(_by_service(session_get(current_client, current))) == {
        "aws",
        "github",
        "postgres",
        "render",
        "http",
    }


# Refresh


def _changed_registry(tmp_path):
    root = tmp_path / "v1"
    shutil.copytree(DEFAULT_SERVICE_ROOT, root)

    def rewrite(filename, mutate):
        path = root / filename
        document = json.loads(path.read_text())
        mutate(document)
        path.write_text(json.dumps(document))

    rewrite(
        "aws.json",
        lambda document: (
            document["secret_guard"]["operations"].update(
                {"sso": ["GetRoleCredentials"]}
            ),
            document["action_classes"]["read_verbs"].append("Peek"),
        ),
    )
    rewrite(
        "github.json",
        lambda document: (
            document["credential_environment"].append("GITHUB_APP_TOKEN"),
            document["secret_guard"]["paths"].append(
                {"method": "POST", "pattern": "/app/x", "operation": "Another"}
            ),
        ),
    )
    return ConfigRegistry.load(root)


def test_a_refresh_carries_changed_rules(space, monkeypatch, tmp_path):
    for service_type in ("aws", "github"):
        _connect(space, service_type)
    client = member_client(space)
    opened = open_session(client, space.workflow)
    before = _by_service(opened)
    assert "sso" not in before["aws"]["secretGuard"]["operations"]

    changed = _changed_registry(tmp_path)
    monkeypatch.setattr("api.views.agents.runtime.get_config_registry", lambda: changed)

    for endpoint in ("config", "discover"):
        after = _by_service(session_get(client, opened, endpoint))
        assert after["aws"]["secretGuard"]["operations"]["sso"] == [
            "GetRoleCredentials"
        ]
        assert after["aws"]["actionClasses"]["readVerbs"][-1] == "Peek"
        assert after["github"]["credentialEnvironment"][-1] == "GITHUB_APP_TOKEN"
        assert after["github"]["secretGuard"]["paths"][-1] == {
            "method": "POST",
            "pattern": "/app/x",
            "operation": "Another",
        }


# Key conversion


def test_the_renderer_leaves_data_map_keys_as_the_provider_wrote_them():
    payload = {
        "connections": [
            {
                "secret_guard": {
                    "operations": {"some_service": ["Action"]},
                    "paths": [{"pattern": "/x", "operation": "X", "host_label": "a"}],
                },
                "action_classes": {
                    "read_verbs": ["Get"],
                    "exact": {"some_service:Action": "read"},
                    "s3_subresources": {"x_amz": "admin"},
                },
            }
        ]
    }

    kept = json.loads(ProviderRulesJSONRenderer().render(payload))
    converted = json.loads(CamelCaseJSONRenderer().render(payload))

    [connection] = kept["connections"]
    assert connection["secretGuard"]["operations"] == {"some_service": ["Action"]}
    assert connection["secretGuard"]["paths"][0]["hostLabel"] == "a"
    assert connection["actionClasses"]["readVerbs"] == ["Get"]
    assert connection["actionClasses"]["exact"] == {"some_service:Action": "read"}
    assert connection["actionClasses"]["s3Subresources"] == {"x_amz": "admin"}
    # The plain converter would have rewritten them.
    [plain] = converted["connections"]
    assert plain["secretGuard"]["operations"] == {"someService": ["Action"]}
    assert plain["actionClasses"]["exact"] == {"someService:Action": "read"}


def test_the_registry_endpoint_keeps_data_map_keys(space):
    response = member_client(space).get("/v1/agents/registry/")
    assert response.status_code == 200, response.content
    aws = response.json()["services"]["aws"]
    assert aws["secretGuard"] == expected_wire("aws")["secretGuard"]
    assert aws["actionClasses"] == expected_wire("aws")["actionClasses"]
    assert aws["credentialEnvironment"] == expected_wire("aws")["credentialEnvironment"]
