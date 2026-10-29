from datetime import timedelta
from types import SimpleNamespace

import pytest
from django.test import RequestFactory
from django.utils import timezone
from rest_framework.test import APIClient

from api.auth import AgentUser
from api.models import (
    Agent,
    AgentConnection,
    AgentRequest,
    AgentWorkflowGrant,
    AgentWorkflowMembership,
    CustomUser,
    Organisation,
    OrganisationMember,
    ProviderCredentials,
    Role,
)
from api.utils.agent_credentials import (
    CredentialResolutionError,
    resolve_agent_credential,
)
from api.utils.agent_sessions import create_agent_session
from api.utils.agents import create_agent_with_default_workflow, mint_agent_token
from api.utils.rest import get_agent_token
from backend.graphene.agents.mutations import RevokeAgentTokenMutation


def _info(member):
    request = RequestFactory().post("/graphql/")
    request.user = member.user
    return SimpleNamespace(context=request)


def _runtime(suffix, request_actions, *, agent_session=True):
    organisation = Organisation.objects.create(
        name=f"Agent runtime authorization {suffix}",
        identity_key="00" * 32,
    )
    role = Role.objects.create(
        organisation=organisation,
        name=f"Agent runtime role {suffix}",
        permissions={
            "permissions": {
                "Agents": ["create", "read", "update"],
                "AgentRequests": request_actions,
            },
            "agent_permissions": {
                "AgentWorkflows": ["create", "read", "update", "delete"],
                "AgentSessions": ["create", "read", "delete"],
                "AgentTokens": ["create", "read", "delete"],
            }
        },
    )
    user = CustomUser.objects.create_user(
        username=f"agent-runtime-{suffix}",
        email=f"agent-runtime-{suffix}@example.com",
    )
    member = OrganisationMember.objects.create(
        organisation=organisation,
        user=user,
        role=role,
    )
    agent, workflow = create_agent_with_default_workflow(
        organisation=organisation,
        name=f"Runtime Agent {suffix}",
        harness_type=Agent.OTHER,
        created_by=member,
    )
    token, _, bearer_token = mint_agent_token(
        agent=agent,
        workflow=workflow,
        name="Runtime token",
        created_by=member,
    )
    session_kwargs = (
        {"agent_token": token}
        if agent_session
        else {"opened_by_member": member}
    )
    session, session_credential, _ = create_agent_session(
        agent=agent,
        workflow=workflow,
        **session_kwargs,
    )
    return {
        "organisation": organisation,
        "role": role,
        "member": member,
        "agent": agent,
        "workflow": workflow,
        "token": token,
        "bearer_token": bearer_token,
        "session": session,
        "session_credential": session_credential,
    }


def _client(runtime, *, auth_type="Agent"):
    client = APIClient()
    if auth_type == "Agent":
        user = AgentUser(runtime["agent"])
        agent_token = runtime["token"]
        org_member = None
    else:
        user = runtime["member"].user
        agent_token = None
        org_member = runtime["member"]
    client.force_authenticate(
        user=user,
        token={
            "auth_type": auth_type,
            "org_member": org_member,
            "service_account": None,
            "agent": runtime["agent"] if auth_type == "Agent" else None,
            "agent_token": agent_token,
            "workflow": runtime["workflow"] if auth_type == "Agent" else None,
            "organisation": runtime["organisation"],
            "org_only": True,
        },
    )
    client.credentials(
        HTTP_X_PHASE_SESSION_CREDENTIAL=runtime["session_credential"]
    )
    return client


def _pending_request(runtime):
    connection = AgentConnection.objects.create(
        organisation=runtime["organisation"],
        name="Pending AWS connection",
        service_type="aws",
        config={},
        state=AgentConnection.PENDING_CREDENTIALS,
    )
    return AgentRequest.objects.create(
        organisation=runtime["organisation"],
        workflow=runtime["workflow"],
        connection=connection,
        kind=AgentRequest.SETUP,
        service_type="aws",
        credential_provider="aws",
        credential_name="AWS runtime credential",
        markdown="Connect this Workflow to AWS.",
        progress={"stage": "awaiting_credentials"},
        expires_at=timezone.now() + timedelta(days=1),
    )


@pytest.mark.django_db
def test_agent_token_lookup_returns_only_active_nonexpired_tokens():
    runtime = _runtime("lookup", ["read"])
    authorization = f"Bearer {runtime['bearer_token']}"

    assert get_agent_token(authorization).id == runtime["token"].id

    runtime["token"].expires_at = timezone.now() - timedelta(seconds=1)
    runtime["token"].save(update_fields=["expires_at", "updated_at"])
    assert get_agent_token(authorization) is None

    runtime["token"].expires_at = None
    runtime["token"].deleted_at = timezone.now()
    runtime["token"].save(
        update_fields=["expires_at", "deleted_at", "updated_at"]
    )
    assert get_agent_token(authorization) is None


@pytest.mark.django_db
def test_agent_owned_session_rejects_a_token_revoked_after_open():
    runtime = _runtime("revoked-session", ["read"])
    runtime["token"].delete()

    response = _client(runtime).get("/v1/agents/requests/")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "agent_session_revoked"


def _ask(client, dedup_key="aws-deploy-access"):
    return client.post(
        "/v1/agents/requests/",
        {
            "schemaVersion": 1,
            "kind": "setup",
            "serviceType": "aws",
            "credentialProvider": "aws",
            "credentialName": "AWS deploy",
            "markdown": "Connect this Workflow to AWS for deploys.",
            "dedupKey": dedup_key,
        },
        format="json",
    )


@pytest.mark.django_db
def test_a_repeated_ask_returns_the_open_request_with_a_cooldown():
    client = _client(_runtime("dedup-open", ["create", "read", "delete"]))

    first = _ask(client)
    again = _ask(client)

    assert first.status_code == 201, first.content
    assert "cooldown" not in first.json()
    assert again.status_code == 200, again.content
    assert again.json()["id"] == first.json()["id"]
    assert again.json()["cooldown"] is True


@pytest.mark.django_db
def test_a_recent_denial_answers_a_repeated_ask_until_its_cooldown_ends():
    client = _client(_runtime("dedup-denied", ["create", "read", "delete"]))
    first = _ask(client).json()
    denied = AgentRequest.objects.get(id=first["id"])
    denied.status = AgentRequest.DENIED
    denied.resolved_at = timezone.now()
    denied.save(update_fields=["status", "resolved_at"])

    during = _ask(client)
    assert during.status_code == 200, during.content
    assert during.json()["status"] == AgentRequest.DENIED
    assert during.json()["cooldown"] is True

    denied.resolved_at = timezone.now() - timedelta(hours=2)
    denied.save(update_fields=["resolved_at"])
    after = _ask(client)
    assert after.status_code == 201, after.content
    assert after.json()["id"] != first["id"]
    assert after.json()["status"] == AgentRequest.PENDING


@pytest.mark.django_db
@pytest.mark.parametrize("closed", [AgentRequest.CANCELLED, AgentRequest.EXPIRED])
def test_a_closed_request_does_not_block_asking_again(closed):
    client = _client(_runtime(f"dedup-{closed}", ["create", "read", "delete"]))
    first = _ask(client).json()
    AgentRequest.objects.filter(id=first["id"]).update(
        status=closed, resolved_at=timezone.now()
    )

    again = _ask(client)

    assert again.status_code == 201, again.content
    assert again.json()["id"] != first["id"]


@pytest.mark.django_db
def test_agent_request_runtime_uses_human_crud_permissions():
    runtime = _runtime("request-crud", ["read"])
    pending = _pending_request(runtime)
    client = _client(runtime)

    assert client.get("/v1/agents/requests/").status_code == 200
    assert client.get(f"/v1/agents/requests/{pending.id}/").status_code == 200
    assert client.post(
        "/v1/agents/requests/",
        {
            "schemaVersion": 1,
            "kind": "setup",
            "serviceType": "aws",
            "credentialProvider": "aws",
            "credentialName": "Second AWS credential",
            "markdown": "Connect this Workflow to another AWS account.",
            "dedupKey": "request-crud-create-denied",
        },
        format="json",
    ).status_code == 403
    assert client.post(
        f"/v1/agents/requests/{pending.id}/cancel/",
        {},
        format="json",
    ).status_code == 403

    runtime["role"].permissions["permissions"]["AgentRequests"] = [
        "create",
        "delete",
    ]
    runtime["role"].save(update_fields=["permissions"])

    assert client.get("/v1/agents/requests/").status_code == 403
    assert client.get(f"/v1/agents/requests/{pending.id}/").status_code == 403
    assert client.post(
        "/v1/agents/requests/",
        {
            "schemaVersion": 1,
            "kind": "setup",
            "serviceType": "aws",
            "credentialProvider": "aws",
            "credentialName": "Second AWS credential",
            "markdown": "Connect this Workflow to another AWS account.",
            "dedupKey": "request-crud-create-allowed",
        },
        format="json",
    ).status_code == 201
    cancelled = client.post(
        f"/v1/agents/requests/{pending.id}/cancel/",
        {},
        format="json",
    )
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == AgentRequest.CANCELLED


@pytest.mark.django_db
def test_agent_request_runtime_uses_direct_session_members_current_role():
    runtime = _runtime("direct-session", ["read"], agent_session=False)
    client = _client(runtime, auth_type="User")

    assert client.get("/v1/agents/requests/").status_code == 200

    runtime["role"].permissions["permissions"]["AgentRequests"] = []
    runtime["role"].save(update_fields=["permissions"])

    assert client.get("/v1/agents/requests/").status_code == 403


@pytest.mark.django_db
def test_agent_request_runtime_rechecks_exact_workflow_membership():
    runtime = _runtime("workflow-membership", ["read"])
    AgentWorkflowMembership.objects.filter(
        workflow=runtime["workflow"],
        agent_membership__member=runtime["member"],
    ).update(deleted_at=timezone.now())

    response = _client(runtime).get("/v1/agents/requests/")

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "agent_workflow_forbidden"


@pytest.mark.django_db
def test_credential_resolution_rechecks_agent_token_before_decrypt(monkeypatch):
    runtime = _runtime("decrypt-recheck", ["read"])
    credential = ProviderCredentials.objects.create(
        organisation=runtime["organisation"],
        provider="aws",
        name="AWS credential",
        credentials={},
    )
    connection = AgentConnection.objects.create(
        organisation=runtime["organisation"],
        name="AWS connection",
        service_type="aws",
        config={},
        authentication=credential,
        state=AgentConnection.ACTIVE,
    )
    grant = AgentWorkflowGrant.objects.create(
        organisation=runtime["organisation"],
        workflow=runtime["workflow"],
        connection=connection,
        created_by=runtime["member"],
    )
    monkeypatch.setattr(
        "api.utils.agent_credentials.get_credentials",
        lambda *_args, **_kwargs: pytest.fail(
            "credential decryption ran after token revocation"
        ),
    )
    runtime["token"].delete()

    with pytest.raises(CredentialResolutionError, match="no longer active"):
        resolve_agent_credential(
            credential,
            runtime["session"],
            grant=grant,
        )


@pytest.mark.django_db
def test_graphql_token_revocation_synchronously_revokes_sessions():
    runtime = _runtime("graphql-revoke", ["read"])

    result = RevokeAgentTokenMutation.mutate(
        None,
        _info(runtime["member"]),
        token_id=runtime["token"].id,
    )

    runtime["token"].refresh_from_db()
    runtime["session"].refresh_from_db()
    assert result.token.id == runtime["token"].id
    assert runtime["token"].deleted_at is not None
    assert runtime["session"].revoked_at is not None


@pytest.mark.django_db
def test_graphql_token_revocation_rolls_back_if_session_revocation_fails(
    monkeypatch,
):
    runtime = _runtime("graphql-revoke-rollback", ["read"])

    def fail_session_revocation(_sessions):
        raise RuntimeError("session revocation failed")

    monkeypatch.setattr(
        "backend.graphene.agents.mutations.revoke_agent_sessions",
        fail_session_revocation,
    )
    with pytest.raises(RuntimeError, match="session revocation failed"):
        RevokeAgentTokenMutation.mutate(
            None,
            _info(runtime["member"]),
            token_id=runtime["token"].id,
        )

    runtime["token"].refresh_from_db()
    runtime["session"].refresh_from_db()
    assert runtime["token"].deleted_at is None
    assert runtime["session"].revoked_at is None
