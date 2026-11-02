from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from api.models import (
    Agent,
    CustomUser,
    NetworkAccessPolicy,
    Organisation,
    OrganisationMember,
    Role,
    ServiceAccount,
)
from api.utils.agents import create_agent_with_default_workflow, mint_agent_token


@pytest.fixture
def identity(db):
    organisation = Organisation.objects.create(
        name="Agent identity org", identity_key="00" * 32
    )
    role = Role.objects.create(
        name="Agent identity manager",
        organisation=organisation,
        permissions={
            "permissions": {
                "Agents": ["read"],
            },
            "agent_permissions": {
                "AgentSessions": ["create", "read", "delete"],
            }
        },
    )
    user = CustomUser.objects.create_user(
        username="agent-identity-user", email="agent-identity@example.com"
    )
    member = OrganisationMember.objects.create(
        user=user, organisation=organisation, role=role
    )
    agent, workflow = create_agent_with_default_workflow(
        organisation=organisation,
        name="Identity Agent",
        harness_type=Agent.CLAUDE_CODE,
        created_by=member,
    )
    token, _, bearer = mint_agent_token(
        agent=agent,
        workflow=workflow,
        name="identity login",
        created_by=member,
    )
    return {
        "organisation": organisation,
        "member": member,
        "agent": agent,
        "workflow": workflow,
        "token": token,
        "bearer": bearer,
    }


@pytest.mark.django_db
def test_agent_token_identity_is_workflow_scoped_and_contains_no_secrets(identity):
    client = APIClient()
    client.credentials(
        HTTP_AUTHORIZATION=f"Bearer {identity['bearer']}"
    )

    response = client.get("/v1/agents/identity/")

    assert response.status_code == 200, response.content
    assert response.json() == {
        "schemaVersion": 1,
        "principalType": "agent",
        "agent": {
            "id": str(identity["agent"].id),
            "name": identity["agent"].name,
        },
        "workflow": {
            "id": str(identity["workflow"].id),
            "name": identity["workflow"].name,
        },
        "organization": {
            "id": str(identity["organisation"].id),
            "name": identity["organisation"].name,
        },
    }
    rendered = response.content.decode()
    assert identity["token"].token not in rendered


@pytest.mark.django_db
@pytest.mark.parametrize("auth_type", ["User", "ServiceAccount"])
def test_non_agent_principals_cannot_read_agent_identity(identity, auth_type):
    service_account = None
    if auth_type == "ServiceAccount":
        service_account = ServiceAccount.objects.create(
            organisation=identity["organisation"],
            name="Identity service account",
            role=identity["member"].role,
        )
    client = APIClient()
    client.force_authenticate(
        user=identity["member"].user,
        token={
            "auth_type": auth_type,
            "org_member": identity["member"] if auth_type == "User" else None,
            "service_account": service_account,
            "agent": None,
            "agent_token": None,
            "workflow": None,
            "organisation": identity["organisation"],
            "org_only": True,
        },
    )

    response = client.get("/v1/agents/identity/")

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "agent_identity_forbidden"


@pytest.mark.django_db
def test_invalid_agent_token_is_rejected_by_authentication(identity):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION="Bearer Agent invalid-agent-token")

    response = client.get("/v1/agents/identity/")

    assert response.status_code == 401
    assert response["WWW-Authenticate"] == "Bearer"
    assert response.json()["error"] == {
        "code": "agent_authentication_failed",
        "message": (
            "The Phase authentication token is invalid, expired, deleted, "
            "or no longer active. Authenticate again with a current token."
        ),
        "retryable": False,
        "details": {},
    }


@pytest.mark.django_db
def test_expired_agent_token_is_rejected_by_authentication(identity):
    identity["token"].expires_at = timezone.now() - timedelta(seconds=1)
    identity["token"].save(update_fields=["expires_at", "updated_at"])
    client = APIClient()
    client.credentials(
        HTTP_AUTHORIZATION=f"Bearer {identity['bearer']}"
    )

    response = client.get("/v1/agents/identity/")

    assert response.status_code == 401
    assert response["WWW-Authenticate"] == "Bearer"
    assert response.json()["error"]["code"] == "agent_authentication_failed"
    assert "Authenticate again" in response.json()["error"]["message"]


@pytest.mark.django_db
def test_event_ingestion_uses_the_same_canonical_authentication_error(identity):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION="Bearer Agent invalid-agent-token")

    response = client.post(
        "/v1/agents/sessions/missing-session/events/",
        {"schemaVersion": 1, "batchId": "batch-one", "events": []},
        format="json",
    )

    assert response.status_code == 401
    assert response["WWW-Authenticate"] == "Bearer"
    assert response.json()["error"]["code"] == "agent_authentication_failed"


@pytest.mark.django_db
def test_agent_token_is_held_to_the_organisations_network_access_policies(identity):
    Organisation.objects.filter(id=identity["organisation"].id).update(
        plan=Organisation.ENTERPRISE_PLAN
    )
    NetworkAccessPolicy.objects.create(
        name="Office",
        organisation=identity["organisation"],
        allowed_ips="203.0.113.0/24",
        is_global=True,
    )
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {identity['bearer']}")

    blocked = client.get("/v1/agents/identity/", REMOTE_ADDR="198.51.100.7")
    assert blocked.status_code == 403
    assert "network access policy" in blocked.json()["error"]

    allowed = client.get("/v1/agents/identity/", REMOTE_ADDR="203.0.113.7")
    assert allowed.status_code == 200, allowed.content
