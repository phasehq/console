"""Approving app access: what the approver must be able to give when a grant
is extended, and what the approval reports about write access."""

from datetime import timedelta

import pytest
from django.utils import timezone
from graphql import GraphQLError

from api.models import AgentRequest
from api.utils.agent_app_access import grant_access

from .app_secrets import app_connection, grant_app, lab, member  # noqa: F401
from .custom_connections import agent_client, approve, ask, filed, info, open_session

def _app_access(agent, lab, environments, access, duration=3600):
    return filed(
        ask(
            agent,
            kind="setup",
            durationSeconds=duration,
            action={
                "type": "agent_connection.app_access",
                "version": 1,
                "appId": str(lab.app.id),
                "environments": environments,
                "access": access,
            },
        )
    )


@pytest.fixture
def agent(lab):
    client, _ = agent_client(lab)
    open_session(client, lab.workflow)
    return client

def test_a_reader_cannot_extend_a_grant_that_keeps_live_write_allows(lab, agent):
    now = timezone.now()
    connection = app_connection(lab, [lab.dev])
    # Shortened to ten minutes; its write allows would run for an hour.
    granted = grant_app(
        lab,
        connection,
        expires_at=now + timedelta(minutes=10),
        allows=("create", "update", "delete"),
        allow_seconds=3600,
    )
    reader = member(lab, "reader", app=lab.app, environments=[lab.dev], secrets=["read"])
    agent_request = _app_access(agent, lab, ["Development"], "read")

    with pytest.raises(GraphQLError, match="permission to create secrets"):
        approve(lab, agent_request, info(reader))

    granted.refresh_from_db()
    assert granted.expires_at < now + timedelta(minutes=11)
    # A member who may write gives the same approval.
    approve(lab, agent_request, lab.approver_info)
    granted.refresh_from_db()
    assert granted.expires_at > now + timedelta(minutes=50)
    assert grant_access(granted, now + timedelta(minutes=30))["create"]["effect"] == "allow"


def test_a_reader_approves_read_access_that_extends_no_write_allow(lab, agent):
    connection = app_connection(lab, [lab.dev])
    # Until revoked, so an approval has nothing to extend.
    granted = grant_app(lab, connection, allows=("create",), allow_seconds=3600)
    reader = member(lab, "reader", app=lab.app, environments=[lab.dev], secrets=["read"])
    agent_request = _app_access(agent, lab, ["Development"], "read")

    approve(lab, agent_request, info(reader))

    agent_request.refresh_from_db()
    granted.refresh_from_db()
    assert agent_request.status == AgentRequest.APPROVED
    assert str(agent_request.grant_id) == str(granted.id)
    assert granted.expires_at is None

def test_write_access_is_reported_for_each_class_as_it_stands(lab, agent):
    connection = app_connection(lab, [lab.dev])
    # A two-hour create allow that a ten-minute approval must not shorten.
    granted = grant_app(lab, connection, allows=("create",), allow_seconds=7200)
    [kept] = granted.temporary_allows
    agent_request = _app_access(agent, lab, ["Development"], "read_write")

    approve(lab, agent_request, lab.approver_info, inputs={"writeDurationSeconds": 600})

    agent_request.refresh_from_db()
    granted.refresh_from_db()
    write = agent_request.applied_action["writeAccess"]
    ends = write["expiresAtByClass"]
    assert write["grantedDurationSeconds"] == 600
    assert set(ends) == {"create", "update", "delete"}
    assert ends["create"] == kept["expiresAt"]
    assert ends["update"] == ends["delete"] < ends["create"]
    # The whole is reported as the last of them.
    assert write["expiresAt"] == ends["create"]
    assert {allow["class"]: allow["expiresAt"] for allow in granted.temporary_allows} == ends


def test_write_access_never_reports_past_the_grant(lab, agent):
    connection = app_connection(lab, [lab.dev])
    agent_request = _app_access(agent, lab, ["Development"], "read_write", duration=600)

    approve(lab, agent_request, lab.approver_info, inputs={"writeDurationSeconds": 3600})

    agent_request.refresh_from_db()
    write = agent_request.applied_action["writeAccess"]
    assert set(write["expiresAtByClass"].values()) == {write["expiresAt"]}
    assert write["expiresAt"] == agent_request.applied_action["accessRecord"]["expiresAt"]
