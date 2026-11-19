"""Two custom Connections of one Workflow cannot export one variable."""

import pytest
from django.core.exceptions import ValidationError
from django.db import transaction
from graphql import GraphQLError

from api.models import AgentConnection, AgentWorkflowGrant
from api.utils.agent_access import end_connection_access, grant_connection_access
from backend.graphene.agents.mutations import GrantAgentWorkflowMutation

from .custom_connections import (
    agent_client,
    approve,
    ask,
    bearer_definition,
    custom_connection,
    definition,
    filed,
    grant,
    new_keys,
    open_session,
    packaged_connection,
    seal,
    use_test_server_keypair,
    workspace,
)

@pytest.fixture(autouse=True)
def server_keypair(monkeypatch):
    use_test_server_keypair(monkeypatch)

@pytest.fixture
def space(db):
    space = workspace("rest-fix-exported-names")
    space.client, _ = agent_client(space)
    return space

def _exporting(space, name, variable="EXAMPLE_API_KEY", user="alice"):
    """A custom Connection that exports ``variable`` and EXAMPLE_USER."""

    connection_definition = definition()
    connection_definition["fields"][0]["env"] = variable
    connection_definition["fields"][2]["value"] = user
    return custom_connection(space, connection_definition, name=name)


def _give(space, connection):
    with transaction.atomic():
        locked = AgentConnection.objects.select_for_update().get(id=connection.id)
        return grant_connection_access(space.workflow, locked, space.member)


def test_a_second_custom_connection_cannot_export_a_variable_the_first_does(space):
    first = _exporting(space, "First API")
    second = _exporting(space, "Second API", variable="SECOND_API_KEY", user="bob")
    _give(space, first)

    with pytest.raises(ValidationError) as refusal:
        _give(space, second)

    [message] = refusal.value.messages
    assert message == (
        "'Second API' and 'First API' both export the variable EXAMPLE_USER, and "
        "this Workflow already has 'First API'. Change the variable's name on one "
        "of them, or remove the other from this Workflow first."
    )
    assert not AgentWorkflowGrant.objects.filter(connection=second).exists()


def test_the_refusal_reaches_a_member_granting_the_connection(space):
    _give(space, _exporting(space, "First API"))
    second = _exporting(space, "Second API")

    with pytest.raises(GraphQLError, match="both export the variable EXAMPLE_API_KEY"):
        GrantAgentWorkflowMutation.mutate(
            None, space.info, workflow_id=space.workflow.id, connection_id=second.id
        )


def test_the_refusal_reaches_a_member_approving_a_new_connection(space):
    _give(space, _exporting(space, "First API"))
    open_session(space.client, space.workflow)
    asked = definition()
    agent_request = filed(
        ask(
            space.client,
            action={
                "type": "agent_connection.create",
                "version": 1,
                "serviceType": "http",
                "name": "Second API",
                "definition": asked,
            },
        )
    )
    keys = new_keys()

    with pytest.raises(GraphQLError, match="both export the variable EXAMPLE_API_KEY"):
        approve(
            space,
            agent_request,
            inputs={
                "encryptionPublicKey": keys.public_key,
                "sealedValue": seal(asked, keys.public_key),
                "serverWrappedKey": keys.server_wrapped_key,
            },
        )

    assert not AgentConnection.objects.filter(name="Second API").exists()


def test_connections_that_share_no_variable_are_both_granted(space):
    first = _exporting(space, "First API")
    other_definition = bearer_definition(host="api.other.example")
    other_definition["fields"][0]["env"] = "OTHER_API_KEY"
    second = custom_connection(space, other_definition, name="Other API")
    unnamed = custom_connection(space, bearer_definition(), name="No variable")

    for connection in (first, second, unnamed):
        _, created = _give(space, connection)
        assert created
    # Granting one again changes nothing and is not refused.
    assert _give(space, first)[1] is False


def test_a_connection_the_workflow_no_longer_has_holds_no_variable(space):
    granted, _ = _give(space, _exporting(space, "First API"))
    with transaction.atomic():
        end_connection_access(AgentWorkflowGrant.objects.filter(id=granted.id))

    assert _give(space, _exporting(space, "Second API"))[1] is True


def test_another_workflows_connection_holds_no_variable_here(space):
    other = workspace("rest-fix-runtime-other")
    grant(other, _exporting(other, "First API"))

    assert _give(space, _exporting(space, "Second API"))[1] is True


def test_packaged_connections_are_left_as_they_are(space):
    for name in ("AWS one", "AWS two"):
        assert _give(space, packaged_connection(space, "aws", name=name))[1] is True
