"""A proxy event dated after its arrival is stored at its arrival, so it can
never sort above events that happen later. The batch is accepted either way,
since the proxy keeps resending a refused one."""

from datetime import timedelta
from uuid import uuid4

import pytest
from django.utils import timezone

from api.models import AgentEvent

from .app_secrets import (
    app_connection,
    grant_app,
    lab,  # noqa: F401
    put_secret,
    secrets_url,
    token_client,
)
from .custom_connections import graphql, member_client, open_session


NEWEST_PAGE = """query($o: ID!, $a: ID!) {
  agentEvents(organisationId: $o, agentId: $a, order: "newest", limit: 25) {
    events { eventType eventId }
  }
}"""


def _proxy_event(**overrides):
    return {
        "eventId": f"agentrules-{uuid4().hex[:12]}",
        "createdAt": timezone.now().isoformat(),
        "eventType": "request",
        "protocol": "http",
        "method": "GET",
        "host": "api.example.com",
        "port": 443,
        "path": "/",
        "provider": "proxy",
        "statusCode": 200,
        "proxyDecision": "allow",
        "outcome": "ok",
        "reason": "connection_allowed",
        "detail": {},
        **overrides,
    }


def _post(client, session, events):
    return client.post(
        f"/v1/agents/sessions/{session['sessionUid']}/events/",
        {"schemaVersion": 1, "batchId": f"agentrules-{uuid4().hex}", "events": events},
        format="json",
    )


@pytest.fixture
def reporting(lab):
    """A live session of the lab's Workflow, and its member able to read Logs."""

    role = lab.member.role
    role.permissions["permissions"]["Logs"] = ["read"]
    role.save()
    lab.client = member_client(lab)
    lab.session = open_session(lab.client, lab.workflow)
    return lab


@pytest.mark.django_db
def test_an_event_dated_after_it_arrives_is_stored_at_its_arrival(reporting):
    future = timezone.now() + timedelta(days=365)

    response = _post(
        reporting.client,
        reporting.session,
        [_proxy_event(eventId="late-1", createdAt=future.isoformat())],
    )

    assert response.status_code == 202, response.content
    assert response.json()["accepted"] == 1
    stored = AgentEvent.objects.get(event_id="late-1")
    assert stored.proxy_created_at <= stored.ingested_at


@pytest.mark.django_db
def test_an_event_dated_before_it_arrives_keeps_its_own_time(reporting):
    earlier = (timezone.now() - timedelta(minutes=5)).replace(microsecond=0)

    response = _post(
        reporting.client,
        reporting.session,
        [_proxy_event(eventId="on-time-1", createdAt=earlier.isoformat())],
    )

    assert response.status_code == 202, response.content
    assert AgentEvent.objects.get(event_id="on-time-1").proxy_created_at == earlier


@pytest.mark.django_db
def test_future_dated_events_never_hide_a_newer_console_event_from_the_newest_page(
    reporting,
):
    future = (timezone.now() + timedelta(days=365)).isoformat()
    response = _post(
        reporting.client,
        reporting.session,
        [_proxy_event(createdAt=future) for _ in range(26)],
    )
    assert response.status_code == 202, response.content

    # The Console records an Agent's app secrets read itself, at its own time,
    # after the reports above arrived.
    put_secret(reporting.dev, "DB_PASSWORD", "dev-password-value")
    grant_app(reporting, app_connection(reporting, [reporting.dev]))
    read = token_client(reporting).get(secrets_url(reporting.app, "development"))
    assert read.status_code == 200, read.content

    page = graphql(
        reporting,
        NEWEST_PAGE,
        o=str(reporting.organisation.id),
        a=str(reporting.agent.id),
    )

    assert page.errors is None, page.errors
    events = page.data["agentEvents"]["events"]
    assert events[0]["eventType"] == "app_secrets", [
        event["eventType"] for event in events[:3]
    ]
