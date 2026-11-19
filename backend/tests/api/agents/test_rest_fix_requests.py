"""What a request may carry, and what a caller who cannot read requests is
answered with."""

from uuid import uuid4

import pytest

from api.models import (
    AgentConnection,
    AgentMembership,
    AgentRequest,
    AgentWorkflowMembership,
    CustomUser,
    OrganisationMember,
    Role,
)
from api.utils.agents import mint_agent_token
from api.utils.request_actions import CREDENTIAL_TEXT

from .custom_connections import (
    ACTIONS,
    agent_client,
    ask,
    filed,
    grant,
    member_client,
    open_session,
    packaged_connection,
    refused,
    use_test_server_keypair,
    workspace,
)


GH_TOKEN = "ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"

@pytest.fixture(autouse=True)
def server_keypair(monkeypatch):
    use_test_server_keypair(monkeypatch)

@pytest.fixture
def space(db):
    space = workspace("rest-fix-requests")
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

# --- What a request may carry ---------------------------------------------------


def test_a_credential_shaped_name_is_refused_for_a_packaged_setup(space):
    # The same value is refused as a title; a name becomes one.
    refused(_packaged_setup(space, title=GH_TOKEN), "credential_in_request_title")

    error = refused(_packaged_setup(space, name=GH_TOKEN), "credential_in_request_name")

    assert error["message"] == (
        "credentialName must not contain credential-shaped values."
    )
    assert not AgentRequest.objects.filter(workflow=space.workflow).exists()
    assert not AgentConnection.objects.filter(organisation=space.organisation).exists()


def test_a_credential_shaped_name_is_refused_for_a_credential_update(space):
    aws = packaged_connection(space, "aws")
    grant(space, aws)

    def update(**members):
        return ask(
            space.client,
            kind="credential_update",
            connectionId=str(aws.id),
            markdown="Rotate it.",
            **members,
        )

    refused(update(credentialName=GH_TOKEN), "credential_in_request_name")
    # An update that names none keeps the name its credential already has.
    assert filed(update()).credential_name == "aws"


@pytest.mark.parametrize(
    "text",
    [
        "curl -H 'Authorization: Bearer Agent " + "0a1b2c3d" * 8 + "'",
        "-----BEGIN PRIVATE KEY-----",
        "-----BEGIN ENCRYPTED PRIVATE KEY-----",
        "-----BEGIN RSA PRIVATE KEY-----",
        "-----BEGIN EC PRIVATE KEY-----",
        "-----BEGIN DSA PRIVATE KEY-----",
        "-----BEGIN OPENSSH PRIVATE KEY-----",
        "-----BEGIN PGP PRIVATE KEY BLOCK-----",
    ],
)
def test_credential_text_covers_a_bearer_agent_token_and_every_private_key(text):
    assert CREDENTIAL_TEXT.search(text)


@pytest.mark.parametrize(
    "text",
    [
        "Agent Smith asked for access",
        "Agent " + "0a1b2c3d" * 7 + "0a1b2c3",
        "Agent " + "0a1b2c3d" * 8 + "0",
        "-----BEGIN PUBLIC KEY-----",
        "-----BEGIN CERTIFICATE-----",
        "BEGIN PRIVATE KEY",
    ],
)
def test_credential_text_leaves_ordinary_text_alone(text):
    assert CREDENTIAL_TEXT.search(text) is None


def test_a_request_cannot_carry_the_agent_token_as_it_is_sent(space):
    _, _, bearer = mint_agent_token(
        agent=space.agent, workflow=space.workflow, name="t", created_by=space.member
    )

    for markdown in (
        f"curl -H 'Authorization: Bearer {bearer}'",
        "-----BEGIN PRIVATE KEY-----\nMIIEv...\n-----END PRIVATE KEY-----",
    ):
        refused(
            _packaged_setup(space, markdown=markdown), "credential_in_request_markdown"
        )
    assert not AgentRequest.objects.filter(workflow=space.workflow).exists()


# --- A caller who may file or cancel, but not read ---------------------------------


def _member_with(space, request_actions):
    role = Role.objects.create(
        organisation=space.organisation,
        name=f"rest fix {uuid4().hex[:6]}",
        permissions={
            "permissions": {
                "Agents": ACTIONS,
                "AgentConnections": ACTIONS,
                "AgentRequests": request_actions,
            },
            "agent_permissions": {
                "AgentWorkflows": ACTIONS,
                "AgentSessions": ACTIONS,
                "AgentTokens": ACTIONS,
                "AgentMemberships": ACTIONS,
            },
        },
    )
    user = CustomUser.objects.create_user(
        username=f"rest-fix-{uuid4().hex[:8]}",
        email=f"rest-fix-{uuid4().hex[:8]}@example.com",
    )
    created = OrganisationMember.objects.create(
        organisation=space.organisation, user=user, role=role
    )
    membership = AgentMembership.objects.create(agent=space.agent, member=created)
    AgentWorkflowMembership.objects.create(
        workflow=space.workflow, agent_membership=membership
    )
    client = member_client(space, created)
    open_session(client, space.workflow)
    return client


def test_a_caller_without_read_gets_only_the_id_and_status(space):
    agent_request = filed(_packaged_setup(space, dedupKey="shared-key-0001"))
    client = _member_with(space, ["create", "delete"])
    assert client.get(f"/v1/agents/requests/{agent_request.id}/").status_code == 403

    repeated = ask(
        client,
        kind="setup",
        serviceType="aws",
        credentialProvider="aws",
        credentialName="AWS deploy",
        markdown="Another member's words.",
        dedupKey="shared-key-0001",
    )
    cancelled = client.post(
        f"/v1/agents/requests/{agent_request.id}/cancel/", {}, format="json"
    )

    assert repeated.status_code == 200, repeated.content
    assert repeated.json() == {
        "schemaVersion": 1,
        "id": str(agent_request.id),
        "status": "pending",
        "cooldown": True,
    }
    assert cancelled.status_code == 200, cancelled.content
    assert cancelled.json() == {
        "schemaVersion": 1,
        "id": str(agent_request.id),
        "status": "cancelled",
    }


def test_a_caller_with_read_still_gets_the_request(space):
    agent_request = filed(_packaged_setup(space, dedupKey="shared-key-0001"))

    repeated = _packaged_setup(space, dedupKey="shared-key-0001")
    cancelled = space.client.post(
        f"/v1/agents/requests/{agent_request.id}/cancel/", {}, format="json"
    )

    assert repeated.json()["markdown"] == "Connect this Workflow to AWS."
    assert repeated.json()["cooldown"] is True
    assert cancelled.json()["markdown"] == "Connect this Workflow to AWS."
    assert cancelled.json()["status"] == "cancelled"
