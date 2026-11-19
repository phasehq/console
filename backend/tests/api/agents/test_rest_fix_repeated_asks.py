"""What answers an ask an Agent repeats: a request still waiting, a recent
refusal, or an approval whose access is still in force."""

from datetime import timedelta
from uuid import uuid4

import pytest
from django.db import transaction
from django.utils import timezone

from api.models import (
    AgentMembership,
    AgentWorkflowGrant,
    AgentWorkflowMembership,
    ProviderCredentials,
)
from api.utils.agent_access import end_connection_access
from backend.graphene.agents.mutations import FulfillAgentRequestMutation

from .custom_connections import (
    ACTIONS,
    add_member,
    agent_client,
    ask,
    filed,
    info,
    open_session,
    refused,
    use_test_server_keypair,
    workspace,
)

@pytest.fixture(autouse=True)
def server_keypair(monkeypatch):
    use_test_server_keypair(monkeypatch)

@pytest.fixture
def space(db):
    space = workspace("rest-fix-repeated-asks")
    space.client, _ = agent_client(space)
    space.session = open_session(space.client, space.workflow)
    return space

def _packaged_setup(space, name="AWS deploy", **extra):
    body = {
        "kind": "setup",
        "serviceType": "aws",
        "credentialProvider": "aws",
        "credentialName": name,
        "markdown": "Connect this Workflow to AWS.",
        **extra,
    }
    return ask(space.client, **body)

def _fulfil(space, agent_request, credential_name, **arguments):
    """Fulfil a packaged setup with a credential a member picked."""

    integrator = add_member(
        space.organisation,
        f"integrator-{uuid4().hex[:4]}",
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
    credential = ProviderCredentials.objects.create(
        organisation=space.organisation,
        provider="aws",
        name=credential_name,
        credentials={},
    )
    return FulfillAgentRequestMutation.mutate(
        None,
        info(integrator),
        request_id=agent_request.id,
        expected_revision=str(agent_request.revision),
        credential_id=credential.id,
        expected_credential_revision=str(credential.revision),
        **arguments,
    )


def _revoke(granted):
    with transaction.atomic():
        end_connection_access(AgentWorkflowGrant.objects.filter(id=granted.id))

def test_a_repeated_ask_is_answered_whatever_the_member_named_the_credential(space):
    agent_request = filed(_packaged_setup(space, name="AWS deploy"))
    _fulfil(space, agent_request, "Production AWS")

    retry = _packaged_setup(space, name="AWS deploy")

    assert retry.status_code == 200, retry.content
    assert retry.json()["id"] == str(agent_request.id)
    assert retry.json()["cooldown"] is True
    assert retry.json()["credentialName"] == "Production AWS"


def test_a_pending_request_still_refuses_its_key_for_another_target(space):
    filed(_packaged_setup(space, name="AWS deploy", dedupKey="deploy-key-0001"))

    refused(
        _packaged_setup(space, name="AWS billing", dedupKey="deploy-key-0001"),
        "dedup_key_conflict",
        409,
    )


@pytest.mark.parametrize("until_revoked", [True, False])
def test_an_approval_answers_only_while_its_grant_is_in_force(space, until_revoked):
    agent_request = filed(_packaged_setup(space))
    result = _fulfil(
        space,
        agent_request,
        "AWS deploy",
        **({"until_revoked": True} if until_revoked else {"duration_seconds": 3600}),
    )
    answered = _packaged_setup(space)
    assert (answered.status_code, answered.json()["id"]) == (200, str(agent_request.id))

    _revoke(result.grant)

    again = _packaged_setup(space)
    assert again.status_code == 201, again.content
    assert again.json()["id"] != str(agent_request.id)
    assert again.json()["status"] == "pending"


def test_an_approval_stops_answering_when_its_grant_runs_out(space):
    agent_request = filed(_packaged_setup(space))
    result = _fulfil(space, agent_request, "AWS deploy", duration_seconds=3600)
    AgentWorkflowGrant.objects.filter(id=result.grant.id).update(
        expires_at=timezone.now() - timedelta(seconds=1)
    )

    assert _packaged_setup(space).status_code == 201
