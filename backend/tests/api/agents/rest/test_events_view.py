"""Proxy activity events: what the CLI ships is accepted, stored once, and
listed in the console."""

import pytest
from django.test import RequestFactory
from djangorestframework_camel_case.util import underscoreize
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
from api.utils.agents import create_agent_with_default_workflow
from api.utils.crypto import encrypt_asymmetric, get_server_keypair
from api.views.agents.base import AgentRuntimeError
from api.views.agents.events import validate_event_batch
from backend.schema import schema


_ACTIONS = ["create", "read", "update", "delete"]


@pytest.fixture
def runtime(db):
    organisation = Organisation.objects.create(
        name="Agent events", identity_key="00" * 32
    )
    role = Role.objects.create(
        name="Agent events operator",
        organisation=organisation,
        permissions={
            "permissions": {
                "Agents": _ACTIONS,
                "AgentConnections": _ACTIONS,
                "Logs": ["read"],
            },
            "agent_permissions": {
                "AgentWorkflows": _ACTIONS,
                "AgentSessions": _ACTIONS,
            },
        },
    )
    user = CustomUser.objects.create_user(
        username="agent-events-user", email="agent-events@example.com"
    )
    member = OrganisationMember.objects.create(
        user=user, organisation=organisation, role=role
    )
    agent, workflow = create_agent_with_default_workflow(
        organisation=organisation,
        name="Events Agent",
        harness_type=Agent.CLAUDE_CODE,
        created_by=member,
    )
    public_key, _ = get_server_keypair()
    credential = ProviderCredentials.objects.create(
        organisation=organisation,
        provider="aws",
        name="AWS credential",
        credentials={
            field: encrypt_asymmetric(value, public_key.hex())
            for field, value in {
                "access_key_id": "AKIAABCDEFGHIJKLMNOP",
                "secret_access_key": "live-aws-secret-access-key",
                "region": "us-east-2",
            }.items()
        },
    )
    connection = AgentConnection(
        organisation=organisation,
        name="AWS connection",
        service_type="aws",
        config=get_config_registry().validate_service_config("aws", {}),
        authentication=credential,
        state=AgentConnection.ACTIVE,
        created_by=member,
        updated_by=member,
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
    return {
        "client": client,
        "organisation": organisation,
        "member": member,
        "agent": agent,
        "workflow": workflow,
    }


def _open_session(runtime):
    response = runtime["client"].post(
        "/v1/agents/sessions/",
        {
            "schemaVersion": 1,
            "workflowId": str(runtime["workflow"].id),
            "idempotencyKey": "agent-events",
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
    return response.json()


def _sts_event(grant_id=None, **overrides):
    """What the CLI ships after proxying `aws sts get-caller-identity`."""

    event = {
        "eventId": "event-sts-0001",
        "createdAt": "2026-09-18T10:00:00.123456789Z",
        "eventType": "request",
        "protocol": "http",
        "method": "POST",
        "host": "sts.us-east-2.amazonaws.com",
        "port": 443,
        "path": "/",
        "provider": "aws",
        "statusCode": 200,
        "proxyDecision": "allow",
        "outcome": "ok",
        "latencyMs": 184,
        "credentialAction": "aws_sigv4",
        "reason": "connection_allowed",
        "detail": {},
    }
    if grant_id:
        event["grantId"] = grant_id
    event.update(overrides)
    return event


def _parsed_batch(event):
    """A one-event batch as the view's camelCase parser hands it over."""

    return underscoreize(
        {"schemaVersion": 1, "batchId": "batch-detail-check", "events": [event]}
    )


@pytest.mark.django_db
def test_cli_events_are_stored_once_and_listed_in_the_console(runtime):
    session = _open_session(runtime)
    grant_id = session["connections"][0]["grantId"]
    batch = {
        "schemaVersion": 1,
        "batchId": "batch-sts-0001",
        "events": [_sts_event(grant_id)],
    }

    def ship():
        return runtime["client"].post(
            f"/v1/agents/sessions/{session['sessionUid']}/events/",
            batch,
            format="json",
            HTTP_X_PHASE_SESSION_CREDENTIAL=session["sessionCredential"],
        )

    first = ship()
    assert first.status_code == 202, first.content
    assert (first.json()["accepted"], first.json()["duplicates"]) == (1, 0)

    # The CLI retries a batch until it sees a 202, so a retry must not add rows.
    retry = ship()
    assert retry.status_code == 202, retry.content
    assert (retry.json()["accepted"], retry.json()["duplicates"]) == (0, 1)

    request = RequestFactory().post("/graphql/")
    request.user = runtime["member"].user
    result = schema.execute(
        """
        query AgentEvents($organisationId: ID!, $agentId: ID!) {
          agentEvents(organisationId: $organisationId, agentId: $agentId) {
            events {
              method
              host
              path
              statusCode
              proxyDecision
              credentialAction
              connection { name }
              session { sessionUid }
            }
          }
        }
        """,
        variables={
            "organisationId": str(runtime["organisation"].id),
            "agentId": str(runtime["agent"].id),
        },
        context_value=request,
    )

    assert result.errors is None, result.errors
    assert result.data["agentEvents"]["events"] == [
        {
            "method": "POST",
            "host": "sts.us-east-2.amazonaws.com",
            "path": "/",
            "statusCode": 200,
            "proxyDecision": "ALLOW",
            "credentialAction": "aws_sigv4",
            "connection": {"name": "AWS connection"},
            "session": {"sessionUid": session["sessionUid"]},
        }
    ]


@pytest.mark.parametrize(
    "detail",
    [
        None,
        {},
        {"aws_sigv4_failure": "signature_mismatch"},
        {"attempt": 2, "retried": True, "ratio": 0.5, "note": None},
    ],
)
def test_detail_accepts_a_flat_object_of_short_values(detail):
    _, events = validate_event_batch(_parsed_batch(_sts_event(detail=detail)))

    assert events[0]["detail"] == (detail or {})


@pytest.mark.parametrize(
    "detail",
    [
        {"nested": {"value": 1}},
        {"items": ["a", "b"]},
        {"note": "x" * 513},
        {f"key{index}": index for index in range(17)},
        {"not an identifier": "value"},
        "not-an-object",
    ],
)
def test_detail_rejects_nested_or_oversized_values(detail):
    with pytest.raises(AgentRuntimeError):
        validate_event_batch(_parsed_batch(_sts_event(detail=detail)))
