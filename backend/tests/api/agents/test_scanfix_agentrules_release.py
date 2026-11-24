"""What a session is sent reflects its access as it is when the reply goes out.

A revoke, grant end or policy change that commits while a session's config is
being built is never answered as current: opening a session and reading its
config make the same check before they reply. Each change is made by hand at
the point it would land.
"""

from uuid import uuid4

import pytest
from django.db import transaction
from django.utils import timezone

from api.models import AgentConnection, AgentSession, AgentWorkflowGrant
from api.utils.agent_access import end_connection_access
from api.utils.agent_sessions import refresh_workflow_sessions, revoke_agent_sessions
from api.views.agents import views as agent_views

from .custom_connections import (
    AWS_MATERIAL,
    POLICY_FEATURES,
    generation,
    grant,
    live_packaged_connection,
    member_client,
    refused,
    session_get,
    use_test_server_keypair,
    workspace,
)


BLOCK_ALL = {"version": 1, "default": "block", "rules": []}


@pytest.fixture(autouse=True)
def server_keypair(monkeypatch):
    use_test_server_keypair(monkeypatch)


@pytest.fixture
def space(db):
    space = workspace("agentrules-release")
    role = space.member.role
    role.permissions["permissions"]["IntegrationCredentials"] = ["read"]
    role.save()
    space.connection = live_packaged_connection(space, "aws", AWS_MATERIAL)
    space.grant = grant(space, space.connection)
    space.client = member_client(space)
    return space


def _open(space):
    return space.client.post(
        "/v1/agents/sessions/",
        {
            "schemaVersion": 1,
            "workflowId": str(space.workflow.id),
            "idempotencyKey": f"agentrules-{uuid4().hex}",
            "client": {
                "name": "phase-cli",
                "version": "2.0.0",
                "supportedSchemaVersions": [1],
                "protocols": ["http", "postgres"],
                "injectionActions": ["aws_sigv4", "set_header"],
                "features": POLICY_FEATURES,
            },
        },
        format="json",
    )


def _after_the_first_build(monkeypatch, change):
    """Make ``change`` once, after the first build of a session's config."""

    build = agent_views.resolve_workflow_config
    builds = []

    def build_then_change(session, **options):
        config = build(session, **options)
        builds.append(session.pk)
        if len(builds) == 1:
            change(session)
        return config

    monkeypatch.setattr(agent_views, "resolve_workflow_config", build_then_change)
    return builds


def _blocking(space):
    """A policy change that blocks every call on the space's Connection, made
    the way a member's change lands: the policy, then a refresh of the
    Workflow's sessions."""

    def block(session):
        AgentConnection.objects.filter(id=space.connection.id).update(policy=BLOCK_ALL)
        refresh_workflow_sessions([space.workflow.id])

    return block


def _ending_the_grant(space):
    def end(session):
        with transaction.atomic():
            end_connection_access(AgentWorkflowGrant.objects.filter(id=space.grant.id))

    return end


# Opening a session


def test_a_session_revoked_while_it_opens_is_sent_no_secret_material(
    space, monkeypatch
):
    def revoke(session):
        _ending_the_grant(space)(session)
        revoke_agent_sessions(AgentSession.objects.filter(pk=session.pk))

    _after_the_first_build(monkeypatch, revoke)

    response = _open(space)

    refused(response, "agent_session_revoked", status=401)
    assert AWS_MATERIAL["secret_access_key"] not in response.content.decode()


def test_a_grant_ended_while_a_session_opens_is_left_out_of_its_reply(
    space, monkeypatch
):
    builds = _after_the_first_build(monkeypatch, _ending_the_grant(space))

    response = _open(space)

    assert response.status_code == 201, response.content
    payload = response.json()
    assert payload["connections"] == []
    assert AWS_MATERIAL["secret_access_key"] not in response.content.decode()
    assert len(builds) == 2
    assert payload["configGeneration"] == generation(payload)


def test_a_policy_change_while_a_session_opens_is_in_its_reply(space, monkeypatch):
    _after_the_first_build(monkeypatch, _blocking(space))

    response = _open(space)

    assert response.status_code == 201, response.content
    payload = response.json()
    [connection] = payload["connections"]
    assert connection["policy"]["default"] == "block"
    assert payload["configGeneration"] == generation(payload)


def test_an_undisturbed_open_is_built_once_at_the_sessions_generation(
    space, monkeypatch
):
    builds = _after_the_first_build(monkeypatch, lambda session: None)

    response = _open(space)

    assert response.status_code == 201, response.content
    payload = response.json()
    assert len(builds) == 1
    assert payload["configGeneration"] == generation(payload) == 1
    [connection] = payload["connections"]
    assert connection["secretMaterial"]["secretAccessKey"] == (
        AWS_MATERIAL["secret_access_key"]
    )


# Reading a session's config


@pytest.fixture
def opened(space):
    response = _open(space)
    assert response.status_code == 201, response.content
    session = response.json()
    space.client.credentials(
        HTTP_X_PHASE_SESSION_CREDENTIAL=session["sessionCredential"]
    )
    return session


def _read_config(space, session):
    return space.client.get(f"/v1/agents/sessions/{session['sessionUid']}/config/")


def test_a_policy_change_while_a_config_is_built_is_in_the_reply(
    space, opened, monkeypatch
):
    builds = _after_the_first_build(monkeypatch, _blocking(space))

    payload = session_get(space.client, opened)

    [connection] = payload["connections"]
    assert connection["policy"]["default"] == "block"
    assert len(builds) == 2
    # The generation the reply was confirmed at, moved on once by the read.
    assert payload["configGeneration"] == generation(opened)


def test_a_grant_ended_while_a_config_is_built_is_left_out_of_the_reply(
    space, opened, monkeypatch
):
    _after_the_first_build(monkeypatch, _ending_the_grant(space))

    response = _read_config(space, opened)

    assert response.status_code == 200, response.content
    assert response.json()["connections"] == []
    assert AWS_MATERIAL["secret_access_key"] not in response.content.decode()


def test_a_config_read_moves_the_generation_on_once_and_replies_with_it(space, opened):
    before = generation(opened)

    payload = session_get(space.client, opened)

    assert payload["configGeneration"] == before + 1 == generation(opened)


def test_a_session_revoked_while_its_config_is_built_is_sent_nothing(
    space, opened, monkeypatch
):
    _after_the_first_build(
        monkeypatch,
        lambda session: AgentSession.objects.filter(pk=session.pk).update(
            revoked_at=timezone.now()
        ),
    )

    response = _read_config(space, opened)

    refused(response, "agent_session_revoked", status=401)
    assert AWS_MATERIAL["secret_access_key"] not in response.content.decode()


def test_a_config_that_keeps_changing_while_it_is_built_is_not_sent(
    space, opened, monkeypatch
):
    build = agent_views.resolve_workflow_config

    def build_then_change(session, **options):
        config = build(session, **options)
        refresh_workflow_sessions([session.workflow_id])
        return config

    monkeypatch.setattr(agent_views, "resolve_workflow_config", build_then_change)
    before = generation(opened)

    response = _read_config(space, opened)

    refused(response, "agent_session_config_changed", status=409)
    assert AWS_MATERIAL["secret_access_key"] not in response.content.decode()
    # Only the changes moved the generation; the refused read did not.
    assert generation(opened) == before + 3
