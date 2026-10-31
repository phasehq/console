"""The Agents overview and session listing load once an Agent has tokens and
sessions. Both relations hang off the Workflow, not the Agent, and sessions are
keyed by session_uid."""

from datetime import timedelta

import pytest
from django.db import connection as db_connection
from django.test import RequestFactory
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from api.models import (
    Agent,
    AgentConnection,
    AgentEvent,
    AgentRequest,
    AgentWorkflowGrant,
    CustomUser,
    Organisation,
    OrganisationMember,
    ProviderCredentials,
    Role,
)
from api.utils.agent_config import get_config_registry
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


_EVENTS = """
query Events(
  $organisationId: ID!
  $agentId: ID!
  $cursor: String
  $before: String
  $order: String
  $limit: Int
  $start: DateTime
  $end: DateTime
) {
  agentEvents(
    organisationId: $organisationId
    agentId: $agentId
    cursor: $cursor
    before: $before
    order: $order
    limit: $limit
    start: $start
    end: $end
  ) {
    nextCursor
    hasMore
    events { eventId }
  }
}
"""


@pytest.mark.django_db
def test_agent_events_page_back_from_the_newest(agent_org):
    agent = agent_org["agent"]
    for index in range(5):
        AgentEvent.objects.create(
            event_id=f"event-{index}",
            organisation=agent_org["organisation"],
            agent=agent,
            workflow=agent.workflows.get(),
            proxy_created_at=timezone.now(),
            event_type="request",
            protocol="http",
            host="sts.amazonaws.com",
            provider="aws",
            proxy_decision=AgentEvent.ALLOW,
        )
    variables = {
        "organisationId": str(agent_org["organisation"].id),
        "agentId": str(agent.id),
        "order": "newest",
        "limit": 2,
    }

    def page(**overrides):
        result = _execute(_EVENTS, agent_org["member"], {**variables, **overrides})
        assert result.errors is None, result.errors
        return result.data["agentEvents"]

    newest = page()
    assert [event["eventId"] for event in newest["events"]] == ["event-4", "event-3"]
    assert newest["hasMore"] is True
    older = page(before=newest["nextCursor"])
    assert [event["eventId"] for event in older["events"]] == ["event-2", "event-1"]
    oldest = page(before=older["nextCursor"])
    assert [event["eventId"] for event in oldest["events"]] == ["event-0"]
    assert oldest["hasMore"] is False

    newest_seq = str(AgentEvent.objects.get(event_id="event-4").ingest_seq)
    tail = page(order=None, cursor=newest_seq)
    assert tail["events"] == []
    assert tail["nextCursor"] == newest_seq


def _event_at(agent_org, event_id, minutes_ago):
    agent = agent_org["agent"]
    return AgentEvent.objects.create(
        event_id=event_id,
        organisation=agent_org["organisation"],
        agent=agent,
        workflow=agent.workflows.get(),
        proxy_created_at=timezone.now() - timedelta(minutes=minutes_ago),
        event_type="request",
        protocol="http",
        host="sts.amazonaws.com",
        provider="aws",
        proxy_decision=AgentEvent.ALLOW,
    )


@pytest.mark.django_db
def test_agent_event_history_follows_event_time_not_ingest_order(agent_org):
    # Proxies send events in batches, so a late batch carries older events.
    for event_id, minutes_ago in [("b", 20), ("d", 5), ("a", 30), ("c", 10)]:
        _event_at(agent_org, event_id, minutes_ago)
    variables = {
        "organisationId": str(agent_org["organisation"].id),
        "agentId": str(agent_org["agent"].id),
        "limit": 3,
    }

    def page(**overrides):
        result = _execute(_EVENTS, agent_org["member"], {**variables, **overrides})
        assert result.errors is None, result.errors
        return result.data["agentEvents"]

    newest = page(order="newest")
    assert [event["eventId"] for event in newest["events"]] == ["d", "c", "b"]
    assert newest["hasMore"] is True
    rest = page(order="newest", before=newest["nextCursor"])
    assert [event["eventId"] for event in rest["events"]] == ["a"]
    assert rest["hasMore"] is False

    oldest = page(order="oldest")
    assert [event["eventId"] for event in oldest["events"]] == ["a", "b", "c"]
    rest = page(order="oldest", before=oldest["nextCursor"])
    assert [event["eventId"] for event in rest["events"]] == ["d"]


@pytest.mark.django_db
def test_agent_event_history_breaks_time_ties_by_ingest_order(agent_org):
    first = _event_at(agent_org, "first", 5)
    second = _event_at(agent_org, "second", 5)
    AgentEvent.objects.filter(pk=second.pk).update(
        proxy_created_at=first.proxy_created_at
    )
    variables = {
        "organisationId": str(agent_org["organisation"].id),
        "agentId": str(agent_org["agent"].id),
        "order": "newest",
        "limit": 1,
    }

    newest = _execute(_EVENTS, agent_org["member"], variables).data["agentEvents"]
    assert [event["eventId"] for event in newest["events"]] == ["second"]
    rest = _execute(
        _EVENTS, agent_org["member"], {**variables, "before": newest["nextCursor"]}
    ).data["agentEvents"]
    assert [event["eventId"] for event in rest["events"]] == ["first"]


@pytest.mark.django_db
def test_agent_events_filter_by_event_time_range(agent_org):
    for event_id, minutes_ago in [("old", 120), ("mid", 45), ("new", 5)]:
        _event_at(agent_org, event_id, minutes_ago)
    now = timezone.now()
    variables = {
        "organisationId": str(agent_org["organisation"].id),
        "agentId": str(agent_org["agent"].id),
        "order": "newest",
        "start": (now - timedelta(hours=1)).isoformat(),
        "end": (now - timedelta(minutes=30)).isoformat(),
    }

    result = _execute(_EVENTS, agent_org["member"], variables)
    assert result.errors is None, result.errors
    assert [event["eventId"] for event in result.data["agentEvents"]["events"]] == [
        "mid"
    ]


@pytest.mark.django_db
@pytest.mark.parametrize(
    "overrides, message",
    [
        ({"order": "sideways"}, "Agent event order must be newest or oldest"),
        ({"order": "newest", "before": "42"}, "Agent event cursor is invalid"),
        ({"order": "oldest", "before": "-1:5"}, "Agent event cursor is invalid"),
    ],
)
def test_agent_event_history_rejects_bad_order_and_cursor(
    agent_org, overrides, message
):
    variables = {
        "organisationId": str(agent_org["organisation"].id),
        "agentId": str(agent_org["agent"].id),
        **overrides,
    }

    result = _execute(_EVENTS, agent_org["member"], variables)
    assert result.errors is not None
    assert result.errors[0].message == message


def _grant_connections(agent_org, workflow, names):
    organisation = agent_org["organisation"]
    for name in names:
        credential = ProviderCredentials.objects.create(
            organisation=organisation, provider="aws", name=name, credentials={}
        )
        connection = AgentConnection.objects.create(
            organisation=organisation,
            name=name,
            service_type="aws",
            config=get_config_registry().validate_service_config("aws", {}),
            authentication=credential,
            state=AgentConnection.ACTIVE,
        )
        AgentWorkflowGrant.objects.create(
            organisation=organisation, workflow=workflow, connection=connection
        )


@pytest.mark.django_db
def test_workflow_grants_load_in_a_fixed_number_of_queries(agent_org):
    workflow = agent_org["agent"].workflows.get()

    def load():
        with CaptureQueriesContext(db_connection) as queries:
            result = _execute(
                """
                query Mesh($organisationId: ID!) {
                  agentWorkflows(organisationId: $organisationId) {
                    grants { connection { name authentication { name } } }
                  }
                }
                """,
                agent_org["member"],
                {"organisationId": str(agent_org["organisation"].id)},
            )
        assert result.errors is None, result.errors
        return result.data["agentWorkflows"], len(queries)

    _grant_connections(agent_org, workflow, ["AWS 1"])
    _, baseline = load()
    _grant_connections(agent_org, workflow, ["AWS 2", "AWS 3", "AWS 4"])
    workflows, grown = load()

    assert len(workflows[0]["grants"]) == 4
    assert grown == baseline
