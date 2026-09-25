"""Wire guards for the environment the Agent runtime hands the CLI.

These assert against live `POST /v1/agents/sessions/` and
`GET /v1/agents/sessions/<uid>/discover/` responses rather than checked-in
sample payloads, so the contract cannot drift away from what the views
actually serialize.

The invariant under test is that an environment binding is a *recipe*, never a
value: the CLI resolves each binding out of a named plane it was handed
separately, so a binding that carried its own value would let the response
smuggle material past the identifier/decoy/config split.
"""

import pytest
from rest_framework.test import APIClient

from api.models import (
    Agent,
    AgentConnection,
    AgentWorkflowGrant,
    CustomUser,
    Organisation,
    OrganisationMember,
    ProviderCredentials,
    Role,
)
from api.utils.agent_config import get_config_registry
from api.utils.agent_sessions import create_agent_session
from api.utils.agents import create_agent_with_default_workflow
from api.utils.crypto import encrypt_asymmetric, get_server_keypair


_ACTIONS = ["create", "read", "update", "delete"]
_PG_HOST = "db.internal.example"
_PG_DATABASE = "agent_runtime"
_CLIENT = {
    "name": "phase-cli",
    "version": "1.0.0",
    "supportedSchemaVersions": [1],
    "protocols": ["http", "postgres"],
    "injectionActions": ["aws_sigv4", "pg_handshake", "set_header"],
}


def _encrypted(material):
    public_key, _ = get_server_keypair()
    return {
        field: encrypt_asymmetric(value, public_key.hex())
        for field, value in material.items()
    }


def _source_value(values, source_field):
    """Look up a binding's source field across the camelCase wire rename."""

    semantic = source_field.replace("_", "").lower()
    matches = [
        value
        for key, value in values.items()
        if key.replace("_", "").lower() == semantic
    ]
    assert len(matches) == 1, (source_field, sorted(values))
    return matches[0]


@pytest.fixture
def runtime(db):
    organisation = Organisation.objects.create(
        name="Agent runtime environment contract",
        identity_key="00" * 32,
    )
    role = Role.objects.create(
        name="Agent runtime operator",
        organisation=organisation,
        permissions={
            "permissions": {
                "Agents": _ACTIONS,
                "AgentConnections": _ACTIONS,
            },
            "agent_permissions": {
                "AgentWorkflows": _ACTIONS,
                "AgentSessions": _ACTIONS,
            }
        },
    )
    user = CustomUser.objects.create_user(
        username="agent-runtime-user",
        email="agent-runtime@example.com",
    )
    member = OrganisationMember.objects.create(
        user=user, organisation=organisation, role=role
    )
    agent, workflow = create_agent_with_default_workflow(
        organisation=organisation,
        name="Runtime Agent",
        harness_type=Agent.CLAUDE_CODE,
        created_by=member,
    )

    registry = get_config_registry()
    live = {
        "aws": {
            "access_key_id": "AKIAABCDEFGHIJKLMNOP",
            "secret_access_key": "live-aws-secret-access-key",
            "region": "us-east-2",
        },
        "postgres": {
            "username": "agent_runtime_user",
            "password": "postgres-password-sentinel",
            "host": _PG_HOST,
            "database": _PG_DATABASE,
        },
    }
    configs = {
        "aws": {},
        "postgres": {
            "hosts": [{"match": "exact", "value": _PG_HOST, "port": 5432}],
            "database": _PG_DATABASE,
        },
    }
    for service_type in ("aws", "postgres"):
        service = registry.get_service(service_type)
        credential = ProviderCredentials.objects.create(
            organisation=organisation,
            provider=service_type,
            name=f"{service['display_name']} credential",
            credentials=_encrypted(live[service_type]),
        )
        connection = AgentConnection(
            organisation=organisation,
            name=f"{service['display_name']} connection",
            service_type=service_type,
            config=registry.validate_service_config(
                service_type, configs[service_type]
            ),
            authentication=credential,
            state=AgentConnection.ACTIVE,
            created_by=member,
            updated_by=member,
            host_rules_authored_by=(
                member if configs[service_type].get("hosts") else None
            ),
        )
        connection.full_clean()
        connection.save()
        AgentWorkflowGrant.objects.create(
            organisation=organisation,
            workflow=workflow,
            connection=connection,
            created_by=member,
        )

    client = APIClient()
    client.force_authenticate(
        user=user,
        token={
            "auth_type": "User",
            "org_member": member,
            "service_account": None,
            "agent": None,
            "agent_token": None,
            "workflow": None,
            "organisation": organisation,
            "org_only": True,
        },
    )
    return {"client": client, "workflow": workflow, "live": live}


def _open_session(runtime, idempotency_key="runtime-environment-contract"):
    response = runtime["client"].post(
        "/v1/agents/sessions/",
        {
            "schemaVersion": 1,
            "workflowId": str(runtime["workflow"].id),
            "idempotencyKey": idempotency_key,
            "client": _CLIENT,
        },
        format="json",
    )
    assert response.status_code == 201, response.content
    return response.json()


def _assert_environment_is_value_free(payload):
    assert all(isinstance(value, str) for value in payload["configEnv"].values())

    for connection in payload["connections"]:
        config_env = connection.get("configEnv", {})
        agent_env = connection["agentEnv"]
        assert all(isinstance(value, str) for value in config_env.values())
        assert all(isinstance(value, str) for value in agent_env.values())
        # The two planes exist so the CLI can treat configuration and
        # credential-shaped values differently; an overlap would collapse that.
        assert set(config_env).isdisjoint(agent_env)

        for binding in connection["environmentBindings"]:
            expected = {"name", "action", "source", "sensitive", "systemManaged"}
            if "sourceField" in binding:
                expected.add("sourceField")
            assert set(binding) == expected
            assert "value" not in binding
            assert binding["systemManaged"] is True

            if binding["action"] == "unset":
                assert binding["source"] == "runtime"
                _source_value(connection["decoyMaterial"], binding["sourceField"])
                assert binding["sensitive"] is False
                continue

            plane = (
                config_env
                if binding["source"] == "connection_config"
                else agent_env
            )
            assert binding["name"] in plane
            if binding["source"] == "connection_config":
                assert (
                    connection["connectionConfig"][binding["sourceField"]]
                    == plane[binding["name"]]
                )
                # The workflow-level plane only promotes settings that are
                # unambiguous across connections, so it may omit a name the
                # connection carries -- but it must never disagree with it.
                assert payload["configEnv"].get(
                    binding["name"], plane[binding["name"]]
                ) == plane[binding["name"]]
            elif binding["source"] == "identifier":
                assert (
                    _source_value(connection["identifiers"], binding["sourceField"])
                    == plane[binding["name"]]
                )
            else:
                assert binding["source"] == "decoy"
                assert (
                    _source_value(connection["decoyMaterial"], binding["sourceField"])
                    == plane[binding["name"]]
                )


@pytest.mark.django_db
def test_open_session_environment_is_value_free(runtime):
    payload = _open_session(runtime)

    assert payload["schemaVersion"] == 1
    assert {connection["serviceType"] for connection in payload["connections"]} == {
        "aws",
        "postgres",
    }
    _assert_environment_is_value_free(payload)


@pytest.mark.django_db
def test_discover_environment_is_value_free(runtime):
    session = _open_session(runtime, "runtime-environment-discover")
    runtime["client"].credentials(
        HTTP_X_PHASE_SESSION_CREDENTIAL=session["sessionCredential"]
    )

    response = runtime["client"].get(
        f"/v1/agents/sessions/{session['sessionUid']}/discover/"
    )

    assert response.status_code == 200, response.content
    payload = response.json()
    assert payload["sessionUid"] == session["sessionUid"]
    assert payload["configGeneration"] == session["configGeneration"]
    _assert_environment_is_value_free(payload)


@pytest.mark.django_db
def test_discover_withholds_live_material_that_open_session_carries(runtime):
    """Discover re-reads an open session, so it must not re-issue material."""

    session = _open_session(runtime, "runtime-environment-secrets")
    runtime["client"].credentials(
        HTTP_X_PHASE_SESSION_CREDENTIAL=session["sessionCredential"]
    )

    response = runtime["client"].get(
        f"/v1/agents/sessions/{session['sessionUid']}/discover/"
    )
    rendered = response.content.decode()

    assert "secretMaterial" not in rendered
    assert "sessionCredential" not in rendered
    for material in runtime["live"].values():
        for field, value in material.items():
            if field in {"region", "host", "database", "username"}:
                continue
            assert value not in rendered

    # Everything else the CLI needs to rebuild the environment is unchanged.
    by_id = {
        connection["connectionId"]: connection
        for connection in response.json()["connections"]
    }
    for opened in session["connections"]:
        discovered = by_id[opened["connectionId"]]
        for field in (
            "grantId",
            "connectionName",
            "credentialId",
            "credentialProvider",
            "credentialRevision",
            "serviceType",
            "protocol",
            "hosts",
            "connectionConfig",
            "configEnv",
            "injection",
            "onRefresh",
            "identifiers",
            "decoyMaterial",
            "agentEnv",
            "environmentBindings",
        ):
            assert discovered[field] == opened[field], field


@pytest.mark.django_db
def test_decoys_replace_live_secrets_in_the_agent_environment(runtime):
    """The agent plane must never receive a value the proxy will accept."""

    payload = _open_session(runtime, "runtime-environment-decoys")
    live = runtime["live"]
    by_service = {
        connection["serviceType"]: connection
        for connection in payload["connections"]
    }

    aws = by_service["aws"]
    assert aws["agentEnv"]["AWS_ACCESS_KEY_ID"] != live["aws"]["access_key_id"]
    assert (
        aws["agentEnv"]["AWS_SECRET_ACCESS_KEY"] != live["aws"]["secret_access_key"]
    )
    assert aws["configEnv"]["AWS_REGION"] == live["aws"]["region"]

    postgres = by_service["postgres"]
    assert postgres["agentEnv"]["PGUSER"] == live["postgres"]["username"]
    assert postgres["agentEnv"]["PGPASSWORD"] != live["postgres"]["password"]
    assert postgres["configEnv"]["PGDATABASE"] == _PG_DATABASE


@pytest.mark.django_db
def test_postgres_context_names_the_connection_user(runtime):
    session = _open_session(runtime, "runtime-environment-context")
    runtime["client"].credentials(
        HTTP_X_PHASE_SESSION_CREDENTIAL=session["sessionCredential"]
    )

    response = runtime["client"].get(
        f"/v1/agents/sessions/{session['sessionUid']}/context/",
        {"serviceType": "postgres"},
    )

    assert response.status_code == 200, response.content
    markdown = response.json()["markdown"]
    assert f"as {runtime['live']['postgres']['username']}" in markdown
    assert "not disclosed" not in markdown


@pytest.mark.django_db
def test_workflow_config_env_carries_single_connection_settings(runtime):
    payload = _open_session(runtime, "runtime-environment-workflow-config")

    assert payload["configEnv"]["AWS_REGION"] == runtime["live"]["aws"]["region"]
    assert payload["configEnv"]["PGDATABASE"] == _PG_DATABASE
