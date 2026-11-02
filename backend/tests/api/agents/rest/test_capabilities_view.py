from uuid import uuid4

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
from api.utils.agent_sessions import create_agent_session
from api.utils.agents import create_agent_with_default_workflow
from api.utils.agent_config import get_config_registry


@pytest.fixture
def capability_session(db):
    organisation = Organisation.objects.create(
        name="Agent capability discovery",
        identity_key="00" * 32,
    )
    role = Role.objects.create(
        name="Agent capability operator",
        organisation=organisation,
        permissions={
            "permissions": {
                "Agents": ["read"],
                "AgentConnections": ["read"],
            },
            "agent_permissions": {
                "AgentSessions": ["create", "read", "delete"],
            }
        },
    )
    user = CustomUser.objects.create_user(
        username="agent-capability-user",
        email="agent-capability@example.com",
    )
    member = OrganisationMember.objects.create(
        user=user,
        organisation=organisation,
        role=role,
    )
    agent, workflow = create_agent_with_default_workflow(
        organisation=organisation,
        name="Capability Agent",
        harness_type=Agent.CLAUDE_CODE,
        created_by=member,
    )

    registry = get_config_registry()
    connections = {}
    for service_type, config in (
        ("aws", {}),
        (
            "postgres",
            {
                "hosts": [
                    {
                        "match": "exact",
                        "value": "db.internal.example",
                        "port": 5432,
                    }
                ],
                "database": "phase",
            },
        ),
    ):
        service = registry.get_service(service_type)
        credential = ProviderCredentials.objects.create(
            organisation=organisation,
            provider=service["credential_providers"][0],
            name=f"{service['display_name']} credential",
            credentials={},
        )
        connection = AgentConnection.objects.create(
            organisation=organisation,
            name=f"{service['display_name']} connection",
            service_type=service_type,
            config=registry.validate_service_config(service_type, config),
            authentication=credential,
            state=AgentConnection.ACTIVE,
            created_by=member,
            updated_by=member,
        )
        AgentWorkflowGrant.objects.create(
            organisation=organisation,
            workflow=workflow,
            connection=connection,
            created_by=member,
        )
        connections[service_type] = connection

    session, session_credential, _ = create_agent_session(
        agent=agent,
        workflow=workflow,
        opened_by_member=member,
        idempotency_key=f"capabilities-{uuid4()}",
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
    client.credentials(HTTP_X_PHASE_SESSION_CREDENTIAL=session_credential)
    return {
        "client": client,
        "session": session,
        "connections": connections,
    }


@pytest.mark.django_db
def test_capabilities_are_versioned_and_derived_from_service_templates(
    capability_session,
):
    session = capability_session["session"]
    response = capability_session["client"].get(
        f"/v1/agents/sessions/{session.session_uid}/capabilities/"
    )

    assert response.status_code == 200, response.content
    body = response.json()
    assert set(body) == {
        "schemaVersion",
        "matcherSchemaVersion",
        "kind",
        "sessionUid",
        "services",
    }
    assert body["schemaVersion"] == 1
    assert body["matcherSchemaVersion"] == 1
    assert body["kind"] == "phase.ai.capabilities"
    assert body["sessionUid"] == str(session.session_uid)
    assert [service["serviceType"] for service in body["services"]] == [
        "aws",
        "postgres",
    ]

    aws, postgres = body["services"]
    assert all(
        set(service)
        == {
            "serviceType",
            "displayName",
            "credentialProviders",
            "clientMatchers",
            "connectionIds",
        }
        for service in body["services"]
    )
    assert aws == {
        "serviceType": "aws",
        "displayName": "Amazon Web Services",
        "credentialProviders": ["aws", "aws_assume_role"],
        "clientMatchers": [{"kind": "executable", "values": ["aws"]}],
        "connectionIds": [
            str(capability_session["connections"]["aws"].id)
        ],
    }
    assert postgres["clientMatchers"] == [
        {
            "kind": "executable",
            "values": [
                "clusterdb",
                "createdb",
                "createuser",
                "dropdb",
                "dropuser",
                "pg_basebackup",
                "pg_dump",
                "pg_dumpall",
                "pg_isready",
                "pg_restore",
                "pgbench",
                "psql",
                "reindexdb",
                "vacuumdb",
            ],
        },
        {"kind": "uri_scheme", "values": ["postgres", "postgresql"]},
    ]
    assert postgres["connectionIds"] == [
        str(capability_session["connections"]["postgres"].id)
    ]
    rendered = response.content.decode()
    for secret_bearing_key in (
        "secretMaterial",
        "decoyMaterial",
        "agentEnv",
        "connectionConfig",
        "configEnv",
    ):
        assert secret_bearing_key not in rendered
    assert "db.internal.example" not in rendered


@pytest.mark.django_db
def test_context_can_be_scoped_to_one_dynamically_registered_service(
    capability_session,
):
    session = capability_session["session"]
    response = capability_session["client"].get(
        f"/v1/agents/sessions/{session.session_uid}/context/",
        {"serviceType": "postgres"},
    )

    assert response.status_code == 200, response.content
    body = response.json()
    assert body["schemaVersion"] == 1
    assert body["sessionUid"] == str(session.session_uid)
    assert body["serviceType"] == "postgres"
    assert "PostgreSQL connection" in body["markdown"]
    assert "Amazon Web Services connection" not in body["markdown"]


@pytest.mark.django_db
def test_supported_services_remain_discoverable_without_workflow_connections(
    capability_session,
):
    AgentWorkflowGrant.objects.all().delete()
    session = capability_session["session"]

    capabilities = capability_session["client"].get(
        f"/v1/agents/sessions/{session.session_uid}/capabilities/"
    )
    context = capability_session["client"].get(
        f"/v1/agents/sessions/{session.session_uid}/context/",
        {"serviceType": "postgres"},
    )

    assert capabilities.status_code == 200, capabilities.content
    assert {
        service["serviceType"]: service["connectionIds"]
        for service in capabilities.json()["services"]
    } == {"aws": [], "postgres": []}
    assert context.status_code == 200, context.content
    assert "Phase supports this service" in context.json()["markdown"]


@pytest.mark.django_db
def test_invalid_runtime_configuration_does_not_hide_capability_discovery(
    capability_session,
):
    connection = capability_session["connections"]["postgres"]
    connection.config = {"hosts": "invalid-runtime-config"}
    connection.save(update_fields=["config", "updated_at"])
    session = capability_session["session"]

    response = capability_session["client"].get(
        f"/v1/agents/sessions/{session.session_uid}/capabilities/"
    )

    assert response.status_code == 200, response.content
    services = {
        service["serviceType"]: service
        for service in response.json()["services"]
    }
    assert services["postgres"]["connectionIds"] == [str(connection.id)]


@pytest.mark.django_db
def test_scoped_context_ignores_an_unrelated_invalid_connection(
    capability_session,
):
    aws = capability_session["connections"]["aws"]
    aws.config = {"hosts": "invalid-runtime-config"}
    aws.save(update_fields=["config", "updated_at"])
    session = capability_session["session"]

    response = capability_session["client"].get(
        f"/v1/agents/sessions/{session.session_uid}/context/",
        {"serviceType": "postgres"},
    )

    assert response.status_code == 200, response.content
    assert "PostgreSQL connection" in response.json()["markdown"]
    assert "Amazon Web Services connection" not in response.json()["markdown"]


@pytest.mark.django_db
def test_context_rejects_unknown_or_ambiguous_service_selectors(
    capability_session,
):
    session = capability_session["session"]
    path = f"/v1/agents/sessions/{session.session_uid}/context/"

    unknown = capability_session["client"].get(
        path, {"serviceType": "not_registered"}
    )
    duplicate = capability_session["client"].get(
        path + "?serviceType=aws&serviceType=postgres"
    )

    assert unknown.status_code == 404
    assert unknown.json()["error"]["code"] == "unknown_context_service_type"
    assert duplicate.status_code == 400
    assert duplicate.json()["error"]["code"] == "invalid_context_service_type"


@pytest.mark.django_db
def test_capabilities_reject_query_parameters(capability_session):
    session = capability_session["session"]
    response = capability_session["client"].get(
        f"/v1/agents/sessions/{session.session_uid}/capabilities/?provider=aws"
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "unsupported_capabilities_query"
