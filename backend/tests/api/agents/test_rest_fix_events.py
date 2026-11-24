"""An event names a grant only if that grant served its session."""

from datetime import timedelta

import pytest
from django.db import transaction
from django.utils import timezone

from api.models import AgentEvent, AgentSession, AgentWorkflowGrant
from api.utils.agent_access import end_connection_access

from .custom_connections import (
    agent_client,
    custom_connection,
    grant,
    open_session,
    refused,
    use_test_server_keypair,
    workspace,
)


@pytest.fixture
def space(db, monkeypatch):
    use_test_server_keypair(monkeypatch)
    space = workspace("event-grants")
    space.connection = custom_connection(space)
    space.grant = grant(space, space.connection)
    space.client, _ = agent_client(space)
    return space


def _opened(space, ago=timedelta(hours=1)):
    """A session that opened a while ago."""

    session = open_session(space.client, space.workflow)
    AgentSession.objects.filter(pk=session["sessionUid"]).update(
        created_at=timezone.now() - ago
    )
    return session


def _ship(space, session, event_id="event-0001"):
    return space.client.post(
        f"/v1/agents/sessions/{session['sessionUid']}/events/",
        {
            "schemaVersion": 1,
            "batchId": f"batch-{event_id}",
            "events": [
                {
                    "eventId": event_id,
                    "createdAt": "2026-11-14T10:00:00Z",
                    "grantId": str(space.grant.id),
                    "eventType": "request",
                    "protocol": "http",
                    "host": "api.example.com",
                    "provider": "http",
                    "proxyDecision": "allow",
                }
            ],
        },
        format="json",
    )


def _end(space, *, at, revoke):
    """End the grant at a moment, by expiry or by a member taking it away."""

    if revoke:
        with transaction.atomic():
            end_connection_access(
                AgentWorkflowGrant.objects.filter(id=space.grant.id), ended_at=at
            )
    else:
        AgentWorkflowGrant.objects.filter(id=space.grant.id).update(expires_at=at)


@pytest.mark.parametrize("revoke", [False, True], ids=["expired", "revoked"])
def test_a_grant_that_ended_while_its_session_lived_keeps_its_late_events(space, revoke):
    session = _opened(space)
    _end(space, at=timezone.now() - timedelta(minutes=5), revoke=revoke)

    response = _ship(space, session)

    assert response.status_code == 202, response.content
    recorded = AgentEvent.objects.get(event_id="event-0001")
    assert str(recorded.connection_id) == str(space.connection.id)


@pytest.mark.parametrize("revoke", [False, True], ids=["expired", "revoked"])
def test_a_grant_that_ended_before_the_session_opened_is_not_named(space, revoke):
    _end(space, at=timezone.now() - timedelta(days=30), revoke=revoke)
    session = _opened(space)

    response = _ship(space, session)

    error = refused(response, "agent_event_grant_not_found", 404)
    assert error["details"] == {"eventIndexes": [0]}
    assert not AgentEvent.objects.filter(event_id="event-0001").exists()


def test_a_grant_still_in_force_is_named(space):
    session = _opened(space)

    assert _ship(space, session).status_code == 202
    assert AgentEvent.objects.get(event_id="event-0001").connection_id is not None
