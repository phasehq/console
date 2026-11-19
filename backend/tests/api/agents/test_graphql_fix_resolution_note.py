"""A reviewer's note on a request is read by the Agent, so it carries no credential."""

from datetime import timedelta

import pytest
from django.utils import timezone
from graphql import GraphQLError

from api.models import (
    AgentConnection,
    AgentMembership,
    AgentRequest,
    AgentWorkflowMembership,
)
from backend.graphene.agents.mutations import (
    ApproveAgentRequestActionMutation,
    FulfillAgentRequestMutation,
    ResolveAgentRequestMutation,
)

from .custom_connections import ACTIONS, add_member, info, workspace


TOKEN = "ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"
NOTE = f"Use this one instead: {TOKEN}"
REFUSAL = "Remove the credential from the note"


@pytest.fixture
def setup_request(db):
    space = workspace("resolution-note")
    placeholder = AgentConnection.objects.create(
        organisation=space.organisation,
        name="Pending AWS",
        service_type="aws",
        config={},
        state=AgentConnection.PENDING_CREDENTIALS,
    )
    space.request = AgentRequest.objects.create(
        organisation=space.organisation,
        workflow=space.workflow,
        connection=placeholder,
        kind=AgentRequest.SETUP,
        service_type="aws",
        credential_provider="aws",
        credential_name="Pending AWS",
        markdown="Connect AWS.",
        expires_at=timezone.now() + timedelta(days=1),
    )
    return space


def _still_pending(agent_request):
    agent_request.refresh_from_db()
    return (
        agent_request.status == AgentRequest.PENDING
        and agent_request.resolution_note == ""
    )


@pytest.mark.django_db
def test_denying_with_a_credential_in_the_note_is_refused(setup_request):
    space = setup_request
    arguments = {
        "request_id": space.request.id,
        "expected_revision": str(space.request.revision),
        "approved": False,
    }

    with pytest.raises(GraphQLError, match=REFUSAL):
        ResolveAgentRequestMutation.mutate(
            None, space.info, resolution_note=NOTE, **arguments
        )
    assert _still_pending(space.request)

    denied = ResolveAgentRequestMutation.mutate(
        None, space.info, resolution_note="Use the staging account.", **arguments
    ).request
    assert denied.status == AgentRequest.DENIED
    assert denied.resolution_note == "Use the staging account."


@pytest.mark.django_db
def test_fulfilling_with_a_credential_in_the_note_is_refused(setup_request):
    space = setup_request
    integrator = add_member(
        space.organisation,
        "integrator",
        permissions={
            "Agents": ACTIONS,
            "AgentConnections": ACTIONS,
            "AgentRequests": ACTIONS,
            "IntegrationCredentials": ACTIONS,
        },
    )
    membership = AgentMembership.objects.create(
        agent=space.agent, member=integrator, assigned_by=space.member
    )
    AgentWorkflowMembership.objects.create(
        workflow=space.workflow, agent_membership=membership, assigned_by=space.member
    )

    # Refused before the credential is looked at, so none has to exist.
    with pytest.raises(GraphQLError, match=REFUSAL):
        FulfillAgentRequestMutation.mutate(
            None,
            info(integrator),
            request_id=space.request.id,
            expected_revision=str(space.request.revision),
            credential_id="none",
            expected_credential_revision="none",
            resolution_note=NOTE,
        )

    assert _still_pending(space.request)


@pytest.mark.django_db
def test_approving_an_action_with_a_credential_in_the_note_is_refused(setup_request):
    space = setup_request

    with pytest.raises(GraphQLError, match=REFUSAL):
        ApproveAgentRequestActionMutation.mutate(
            None,
            space.info,
            request_id=space.request.id,
            expected_revision=str(space.request.revision),
            resolution_note=NOTE,
        )

    assert _still_pending(space.request)
