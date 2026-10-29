"""The Agents overview and session listing load once an Agent has tokens and
sessions. Both relations hang off the Workflow, not the Agent, and sessions are
keyed by session_uid."""

from datetime import timedelta

import pytest
from django.test import RequestFactory
from django.utils import timezone
from rest_framework.test import APIClient

from api.models import (
    Agent,
    AgentConnection,
    AgentRequest,
    CustomUser,
    Organisation,
    OrganisationMember,
    Role,
)
from api.utils.agents import create_agent_with_default_workflow, mint_agent_token
from backend.graphene.agents import queries as agent_queries
from backend.schema import schema


_ACTIONS = ["create", "read", "update", "delete"]


@pytest.fixture
def agent_org(db):
    organisation = Organisation.objects.create(
        name="Agent queries", identity_key="00" * 32
    )
    role = Role.objects.create(
        name="Agent queries operator",
        organisation=organisation,
        permissions={
            "permissions": {
                "Agents": _ACTIONS,
                "AgentConnections": _ACTIONS,
                "AgentRequests": _ACTIONS,
                "Logs": ["read"],
            },
            "agent_permissions": {
                "AgentWorkflows": _ACTIONS,
                "AgentSessions": _ACTIONS,
                "AgentTokens": _ACTIONS,
                "AgentMemberships": _ACTIONS,
            },
        },
    )
    user = CustomUser.objects.create_user(
        username="agent-queries-user", email="agent-queries@example.com"
    )
    member = OrganisationMember.objects.create(
        user=user, organisation=organisation, role=role
    )
    agent, workflow = create_agent_with_default_workflow(
        organisation=organisation,
        name="Queries Agent",
        harness_type=Agent.CLAUDE_CODE,
        created_by=member,
    )
    mint_agent_token(agent=agent, workflow=workflow, name="laptop", created_by=member)

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
    response = client.post(
        "/v1/agents/sessions/",
        {
            "schemaVersion": 1,
            "workflowId": str(workflow.id),
            "idempotencyKey": "agent-queries",
            "client": {
                "name": "phase-cli",
                "version": "1.0.0",
                "supportedSchemaVersions": [1],
                "protocols": ["http"],
                "injectionActions": ["aws_sigv4"],
            },
        },
        format="json",
    )
    assert response.status_code == 201, response.content
    return {
        "organisation": organisation,
        "member": member,
        "agent": agent,
        "session_uid": response.json()["sessionUid"],
    }


def _execute(query, member, variables):
    request = RequestFactory().post("/graphql/")
    request.user = member.user
    return schema.execute(query, variables=variables, context_value=request)


@pytest.mark.django_db
def test_agents_query_lists_tokens_and_sessions(agent_org):
    result = _execute(
        """
        query Agents($organisationId: ID!) {
          agents(organisationId: $organisationId) {
            name
            workflows { id }
            tokens { name }
            sessions { sessionUid }
          }
        }
        """,
        agent_org["member"],
        {"organisationId": str(agent_org["organisation"].id)},
    )

    assert result.errors is None, result.errors
    [agent] = result.data["agents"]
    assert agent["name"] == "Queries Agent"
    assert len(agent["workflows"]) == 1
    assert [token["name"] for token in agent["tokens"]] == ["laptop"]
    assert [session["sessionUid"] for session in agent["sessions"]] == [
        agent_org["session_uid"]
    ]


@pytest.mark.django_db
def test_agent_sessions_query_lists_the_open_session(agent_org):
    result = _execute(
        """
        query AgentSessions($organisationId: ID!, $agentId: ID!) {
          agentSessions(organisationId: $organisationId, agentId: $agentId) {
            sessionUid
          }
        }
        """,
        agent_org["member"],
        {
            "organisationId": str(agent_org["organisation"].id),
            "agentId": str(agent_org["agent"].id),
        },
    )

    assert result.errors is None, result.errors
    assert result.data["agentSessions"] == [{"sessionUid": agent_org["session_uid"]}]


def _setup_request(agent_org, *, expires_at, name="AWS deploy"):
    workflow = agent_org["agent"].workflows.get()
    connection = AgentConnection.objects.create(
        organisation=agent_org["organisation"],
        name=name,
        service_type="aws",
        config={},
        state=AgentConnection.PENDING_CREDENTIALS,
    )
    return AgentRequest.objects.create(
        organisation=agent_org["organisation"],
        workflow=workflow,
        connection=connection,
        kind=AgentRequest.SETUP,
        service_type="aws",
        credential_provider="aws",
        credential_name=name,
        markdown="Connect this Workflow to AWS.",
        expires_at=expires_at,
    )


_PENDING_REQUESTS = """
query Pending($organisationId: ID!) {
  agentRequests(organisationId: $organisationId, status: "pending") { id }
}
"""


@pytest.mark.django_db
def test_overdue_requests_are_closed_before_listing(agent_org):
    current = _setup_request(
        agent_org, expires_at=timezone.now() + timedelta(days=1), name="Current"
    )
    overdue = _setup_request(
        agent_org, expires_at=timezone.now() - timedelta(minutes=1), name="Overdue"
    )

    result = _execute(
        _PENDING_REQUESTS,
        agent_org["member"],
        {"organisationId": str(agent_org["organisation"].id)},
    )

    assert result.errors is None, result.errors
    assert result.data["agentRequests"] == [{"id": str(current.id)}]
    overdue.refresh_from_db()
    overdue.connection.refresh_from_db()
    assert overdue.status == AgentRequest.EXPIRED
    assert overdue.connection.deleted_at is not None


@pytest.mark.django_db
def test_request_lists_are_capped_with_pending_requests_first(agent_org, monkeypatch):
    monkeypatch.setattr(agent_queries, "AGENT_REQUEST_LIST_LIMIT", 2)
    later = timezone.now() + timedelta(days=1)
    closed = _setup_request(agent_org, expires_at=later, name="Closed")
    AgentRequest.objects.filter(id=closed.id).update(status=AgentRequest.DENIED)
    pending = [
        _setup_request(agent_org, expires_at=later, name=f"Pending {index}")
        for index in range(2)
    ]

    result = _execute(
        """
        query Requests($organisationId: ID!) {
          agentRequests(organisationId: $organisationId) { id status }
        }
        """,
        agent_org["member"],
        {"organisationId": str(agent_org["organisation"].id)},
    )

    assert result.errors is None, result.errors
    assert {item["id"] for item in result.data["agentRequests"]} == {
        str(item.id) for item in pending
    }
