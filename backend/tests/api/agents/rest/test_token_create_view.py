from datetime import timedelta
from unittest.mock import patch

import pytest
from django.utils import timezone
from nacl.bindings import crypto_scalarmult_base
from rest_framework.test import APIClient

from api.models import (
    Agent,
    AgentToken,
    CustomUser,
    Organisation,
    OrganisationMember,
    Role,
    UserToken,
)
from api.utils.agents import (
    create_agent_with_default_workflow,
    create_agent_workflow,
    hash_agent_token_lookup,
    mint_agent_token,
)
from api.utils.crypto import decrypt_raw, ed25519_pk_to_kx, random_hex, xor_bytes

TOKEN_PERMISSIONS = {
    "permissions": {"Agents": ["read"]},
    "agent_permissions": {
        "AgentTokens": ["create", "read", "delete"],
        "AgentSessions": ["create", "read", "delete"],
    },
}


def _member(organisation, suffix, permissions=TOKEN_PERMISSIONS, **role_fields):
    role = Role.objects.create(
        name=f"Agent token {suffix}",
        organisation=organisation,
        permissions=permissions,
        **role_fields,
    )
    user = CustomUser.objects.create_user(
        username=f"agent-token-{suffix}", email=f"agent-token-{suffix}@example.com"
    )
    return OrganisationMember.objects.create(
        user=user, organisation=organisation, role=role
    )


def _client(member):
    """An API client authenticated with a Personal Access Token for member."""

    token_value = random_hex(32)
    UserToken.objects.create(
        user=member,
        name="cli",
        identity_key="00" * 32,
        token=token_value,
        wrapped_key_share="00",
    )
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer User {token_value}")
    return client


def _mint(client, agent, **body):
    return client.post(f"/v1/agents/{agent.id}/tokens/", body, format="json")


def _error_code(response):
    return response.json()["error"]["code"]


@pytest.fixture
def organisation(db):
    return Organisation.objects.create(
        name="Agent token org", identity_key="00" * 32
    )


@pytest.fixture
def member(organisation):
    return _member(organisation, "member")


@pytest.fixture
def agent_and_workflow(organisation, member):
    return create_agent_with_default_workflow(
        organisation=organisation,
        name="Minted Agent",
        harness_type=Agent.CLAUDE_CODE,
        created_by=member,
    )


@pytest.mark.django_db
def test_member_mints_a_full_token_for_an_assigned_workflow(
    member, agent_and_workflow
):
    agent, workflow = agent_and_workflow
    expires_at = timezone.now() + timedelta(days=7)

    response = _mint(
        _client(member),
        agent,
        workflowId=str(workflow.id),
        name="  cli login  ",
        expiresAt=expires_at.isoformat(),
    )

    assert response.status_code == 201, response.content
    body = response.json()
    assert body["agentId"] == str(agent.id)
    assert body["workflowId"] == str(workflow.id)
    assert body["name"] == "cli login"
    prefix, version, token_value, kx_pub, share_a, wrap_key = body[
        "fullToken"
    ].split(":")
    assert (prefix, version) == ("pss_agent", "v1")
    assert all(
        len(bytes.fromhex(part)) == 32
        for part in [token_value, kx_pub, share_a, wrap_key]
    )
    assert body["bearerToken"] == f"Agent {token_value}"

    token = AgentToken.objects.get(id=body["id"])
    assert token.token == hash_agent_token_lookup(token_value)
    assert str(token.workflow_id) == str(workflow.id)
    assert str(token.created_by_id) == str(member.id)
    assert token.expires_at == expires_at
    assert kx_pub == token.identity_key == ed25519_pk_to_kx(agent.identity_key)
    share_b = decrypt_raw(
        bytes.fromhex(token.wrapped_key_share), bytes.fromhex(wrap_key)
    ).decode()
    kx_private = xor_bytes(bytes.fromhex(share_a), bytes.fromhex(share_b))
    assert crypto_scalarmult_base(kx_private).hex() == kx_pub

    agent_client = APIClient()
    agent_client.credentials(HTTP_AUTHORIZATION=f"Bearer {body['bearerToken']}")
    identity = agent_client.get("/v1/agents/identity/")
    assert identity.status_code == 200, identity.content
    assert identity.json()["workflow"]["id"] == str(workflow.id)


@pytest.mark.django_db
def test_owner_mints_without_an_assignment(organisation, agent_and_workflow):
    agent, workflow = agent_and_workflow
    owner = _member(
        organisation, "owner", permissions={}, is_default=True, managed_key="owner"
    )

    response = _mint(_client(owner), agent, workflowId=str(workflow.id), name="ci")

    assert response.status_code == 201, response.content
    assert AgentToken.objects.filter(workflow=workflow, created_by=owner).exists()


@pytest.mark.django_db
def test_unassigned_member_cannot_mint(organisation, agent_and_workflow):
    agent, workflow = agent_and_workflow
    outsider = _member(organisation, "outsider")

    response = _mint(
        _client(outsider), agent, workflowId=str(workflow.id), name="refused"
    )

    assert response.status_code == 403, response.content
    assert _error_code(response) == "agent_token_create_forbidden"
    assert not AgentToken.objects.filter(workflow=workflow).exists()


@pytest.mark.django_db
def test_assignment_to_one_workflow_does_not_cover_another(
    organisation, member, agent_and_workflow
):
    agent, _ = agent_and_workflow
    owner = _member(
        organisation, "owner", permissions={}, is_default=True, managed_key="owner"
    )
    other_workflow = create_agent_workflow(agent=agent, name="Other", created_by=owner)

    response = _mint(
        _client(member), agent, workflowId=str(other_workflow.id), name="refused"
    )

    assert response.status_code == 403, response.content
    assert _error_code(response) == "agent_token_create_forbidden"
    assert not AgentToken.objects.filter(workflow=other_workflow).exists()


@pytest.mark.django_db
def test_assigned_member_without_token_permission_cannot_mint(organisation):
    reader = _member(
        organisation,
        "reader",
        permissions={
            "permissions": {"Agents": ["read"]},
            "agent_permissions": {"AgentTokens": ["read"]},
        },
    )
    agent, workflow = create_agent_with_default_workflow(
        organisation=organisation,
        name="Reader Agent",
        harness_type=Agent.OTHER,
        created_by=reader,
    )

    response = _mint(_client(reader), agent, workflowId=str(workflow.id), name="x")

    assert response.status_code == 403, response.content
    assert _error_code(response) == "agent_token_create_forbidden"


@pytest.mark.django_db
def test_agent_token_cannot_mint(member, agent_and_workflow):
    agent, workflow = agent_and_workflow
    _, _, bearer = mint_agent_token(
        agent=agent, workflow=workflow, name="runtime", created_by=member
    )
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {bearer}")

    response = _mint(client, agent, workflowId=str(workflow.id), name="refused")

    assert response.status_code == 403, response.content
    assert _error_code(response) == "agent_management_forbidden"
    assert AgentToken.objects.filter(workflow=workflow).count() == 1


@pytest.mark.django_db
def test_service_account_token_is_not_accepted(agent_and_workflow):
    agent, workflow = agent_and_workflow
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer ServiceAccount {random_hex(32)}")

    response = _mint(client, agent, workflowId=str(workflow.id), name="refused")

    assert response.status_code == 401, response.content
    assert _error_code(response) == "agent_authentication_failed"


@pytest.mark.django_db
def test_workflow_is_required(member, agent_and_workflow):
    agent, _ = agent_and_workflow

    response = _mint(_client(member), agent, name="no workflow")

    assert response.status_code == 400, response.content
    assert _error_code(response) == "workflow_required"


@pytest.mark.django_db
@pytest.mark.parametrize("name", [None, "", "   ", "x" * 65, 42])
def test_token_name_must_be_1_to_64_characters(member, agent_and_workflow, name):
    agent, workflow = agent_and_workflow
    body = {"workflowId": str(workflow.id)}
    if name is not None:
        body["name"] = name

    response = _mint(_client(member), agent, **body)

    assert response.status_code == 400, response.content
    assert _error_code(response) == "invalid_token_name"


@pytest.mark.django_db
@pytest.mark.parametrize("expires_at", ["not-a-date", "2020-01-01T00:00:00Z", 7])
def test_expiry_must_be_a_future_timestamp(member, agent_and_workflow, expires_at):
    agent, workflow = agent_and_workflow

    response = _mint(
        _client(member),
        agent,
        workflowId=str(workflow.id),
        name="bad expiry",
        expiresAt=expires_at,
    )

    assert response.status_code == 400, response.content
    assert _error_code(response) == "invalid_token_expiry"
    assert not AgentToken.objects.filter(workflow=workflow).exists()


@pytest.mark.django_db
def test_unknown_disabled_and_foreign_agents_are_not_found(
    organisation, member, agent_and_workflow
):
    agent, workflow = agent_and_workflow
    client = _client(member)
    foreign_organisation = Organisation.objects.create(
        name="Foreign org", identity_key="11" * 32
    )
    foreign_agent, foreign_workflow = create_agent_with_default_workflow(
        organisation=foreign_organisation,
        name="Foreign Agent",
        harness_type=Agent.OTHER,
        created_by=_member(foreign_organisation, "foreign"),
    )
    disabled_agent, disabled_workflow = create_agent_with_default_workflow(
        organisation=organisation,
        name="Disabled Agent",
        harness_type=Agent.OTHER,
        created_by=member,
    )
    disabled_agent.status = Agent.DISABLED
    disabled_agent.save(update_fields=["status"])

    for target, target_workflow in [
        (foreign_agent, foreign_workflow),
        (disabled_agent, disabled_workflow),
    ]:
        response = _mint(
            client, target, workflowId=str(target_workflow.id), name="refused"
        )
        assert response.status_code == 404, response.content
        assert _error_code(response) == "agent_not_found"
    unknown = client.post(
        "/v1/agents/not-an-agent/tokens/",
        {"workflowId": str(workflow.id), "name": "refused"},
        format="json",
    )
    assert unknown.status_code == 404, unknown.content
    assert _error_code(unknown) == "agent_not_found"
    assert not AgentToken.objects.exists()


@pytest.mark.django_db
def test_workflow_must_belong_to_the_agent(organisation, member, agent_and_workflow):
    agent, _ = agent_and_workflow
    _, other_workflow = create_agent_with_default_workflow(
        organisation=organisation,
        name="Second Agent",
        harness_type=Agent.OTHER,
        created_by=member,
    )
    client = _client(member)

    for workflow_id in [str(other_workflow.id), "not-a-workflow"]:
        response = _mint(client, agent, workflowId=workflow_id, name="refused")
        assert response.status_code == 404, response.content
        assert _error_code(response) == "workflow_not_found"
    assert not AgentToken.objects.exists()


@pytest.mark.django_db
def test_invalid_keyring_is_refused_with_an_agent_error(
    organisation, member, agent_and_workflow
):
    agent, workflow = agent_and_workflow
    donor, _ = create_agent_with_default_workflow(
        organisation=organisation,
        name="Donor",
        harness_type=Agent.OTHER,
        created_by=member,
    )
    agent.server_wrapped_keyring = donor.server_wrapped_keyring
    agent.save(update_fields=["server_wrapped_keyring"])

    response = _mint(_client(member), agent, workflowId=str(workflow.id), name="x")

    assert response.status_code == 403, response.content
    assert response.json() == {
        "error": {
            "code": "invalid_agent_keyring",
            "message": "The Agent keyring is invalid.",
            "retryable": False,
            "details": {},
        }
    }
    assert not AgentToken.objects.filter(workflow=workflow).exists()


@pytest.mark.django_db
def test_workflow_retired_during_mint_is_not_found(member, agent_and_workflow):
    agent, workflow = agent_and_workflow

    with patch(
        "api.views.agents.management.mint_agent_token",
        side_effect=ValueError("Workflow does not belong to an active Agent"),
    ):
        response = _mint(
            _client(member), agent, workflowId=str(workflow.id), name="raced"
        )

    assert response.status_code == 404, response.content
    assert _error_code(response) == "workflow_not_found"
