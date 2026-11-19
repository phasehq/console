"""An approval carries out what was asked of the target as it was then. A
target that changed since, or access a member took away since, needs a new
request."""

from datetime import timedelta

import pytest
from django.db import transaction
from django.utils import timezone
from graphql import GraphQLError

from api.models import AgentRequest, AgentWorkflowGrant
from api.utils.agent_access import end_connection_access
from api.utils.agent_app_access import set_connection_environments
from backend.graphene.agents.mutations import UpdateCustomAgentConnectionMutation

from .app_secrets import app_connection, grant_app, lab  # noqa: F401
from .custom_connections import (
    agent_client,
    approve,
    ask,
    bearer_definition,
    custom_connection,
    filed,
    grant,
    open_session,
    seal,
    use_test_server_keypair,
    workspace,
)

@pytest.fixture(autouse=True)
def server_keypair(monkeypatch):
    use_test_server_keypair(monkeypatch)

@pytest.fixture
def space(db):
    space = workspace("rest-fix-approvals")
    space.client, _ = agent_client(space)
    space.session = open_session(space.client, space.workflow)
    return space

@pytest.fixture
def agent(lab):
    client, _ = agent_client(lab)
    open_session(client, lab.workflow)
    return client

def _revoke(granted):
    with transaction.atomic():
        end_connection_access(AgentWorkflowGrant.objects.filter(id=granted.id))

def test_a_secret_update_is_refused_once_the_definition_changed(space):
    reviewed = bearer_definition(path="/v1/*")
    connection = custom_connection(space, reviewed)
    grant(space, connection)
    agent_request = filed(
        ask(
            space.client,
            action={
                "type": "agent_connection.secret_update",
                "version": 1,
                "connectionId": str(connection.id),
            },
        )
    )
    plain = {**reviewed, "allowPlainHttp": True}
    UpdateCustomAgentConnectionMutation.mutate(
        None,
        space.info,
        connection_id=connection.id,
        definition=plain,
        sealed_value=seal(
            plain, connection.test_keys.public_key, fields={"token": "editor-token"}
        ),
    )
    connection.refresh_from_db()
    revision = connection.value_revision

    with pytest.raises(GraphQLError, match="changed after this request was made"):
        approve(
            space,
            agent_request,
            inputs={
                "sealedValue": seal(
                    reviewed,
                    connection.test_keys.public_key,
                    fields={"token": "reviewer-token"},
                )
            },
        )

    agent_request.refresh_from_db()
    connection.refresh_from_db()
    assert agent_request.status == AgentRequest.PENDING
    assert connection.value_revision == revision

def _allow_request(agent, connection, name="delete"):
    return filed(
        ask(
            agent,
            durationSeconds=600,
            action={
                "type": "agent_grant.allow",
                "version": 1,
                "connectionId": str(connection.id),
                "allow": {"class": name},
            },
        )
    )


def test_an_allow_does_not_follow_an_environment_added_after_it_was_asked(lab, agent):
    connection = app_connection(lab, [lab.dev])
    granted = grant_app(lab, connection)
    agent_request = _allow_request(agent, connection)
    set_connection_environments(connection, [lab.dev, lab.prod])

    with pytest.raises(GraphQLError, match="covers environments it did not"):
        approve(lab, agent_request, lab.approver_info)

    agent_request.refresh_from_db()
    granted.refresh_from_db()
    assert agent_request.status == AgentRequest.PENDING
    assert granted.temporary_allows == []


def test_an_allow_is_still_given_when_the_connection_covers_the_same_or_less(lab, agent):
    connection = app_connection(lab, [lab.dev, lab.staging])
    granted = grant_app(lab, connection)
    agent_request = _allow_request(agent, connection)
    set_connection_environments(connection, [lab.dev])

    approve(lab, agent_request, lab.approver_info)

    granted.refresh_from_db()
    assert [allow["class"] for allow in granted.temporary_allows] == ["delete"]


def _renewal(space, connection, duration=3600):
    return filed(
        ask(
            space.client,
            durationSeconds=duration,
            action={
                "type": "agent_grant.renew",
                "version": 1,
                "connectionId": str(connection.id),
            },
        )
    )


def test_a_renewal_asked_before_a_revocation_does_not_restore_access(space):
    connection = custom_connection(space)
    granted = grant(space, connection)
    agent_request = _renewal(space, connection)
    _revoke(granted)
    in_force = AgentWorkflowGrant.objects.active().filter(
        workflow=space.workflow, connection=connection
    )

    with pytest.raises(GraphQLError, match="removed this access after"):
        approve(space, agent_request)

    agent_request.refresh_from_db()
    assert agent_request.status == AgentRequest.PENDING
    assert not in_force.exists()
    # Asked again after the revocation, it is the member's to give back.
    approve(space, _renewal(space, connection, duration=7200))
    assert in_force.exists()


def test_a_renewal_still_gives_back_access_that_ran_out_after_it_was_asked(space):
    connection = custom_connection(space)
    granted = grant(space, connection)
    agent_request = _renewal(space, connection)
    AgentWorkflowGrant.objects.filter(id=granted.id).update(
        expires_at=timezone.now() - timedelta(seconds=1)
    )

    approve(space, agent_request)

    assert AgentWorkflowGrant.objects.active().filter(
        workflow=space.workflow, connection=connection
    ).exists()
