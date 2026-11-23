"""Packaged-service session responses, compared with a recorded copy.

Fields added after the recording are checked for one value and removed first.
"""

import json
from pathlib import Path
from uuid import UUID

import pytest
from nacl.bindings import crypto_kx_seed_keypair
from rest_framework.test import APIClient

from api.auth import AgentUser
from api.models import (
    Agent,
    AgentConnection,
    AgentWorkflowGrant,
    CustomUser,
    Organisation,
    OrganisationMember,
    ProviderCredentials,
    Role,
)
from api.utils.agent_config import get_config_registry
from api.utils.agents import create_agent_with_default_workflow, mint_agent_token
from api.utils.crypto import encrypt_asymmetric
from ..provider_rules import expected_wire


GOLDEN = Path(__file__).with_name("golden") / "packaged_session_payloads.json"

_ACTIONS = ["create", "read", "update", "delete"]
_SERVER_KEYPAIR = crypto_kx_seed_keypair(b"\x07" * 32)
# CI runs with a SERVER_SECRET that is not a key.
_SERVER_KEYPAIR_USERS = (
    "api.utils.crypto",
    "api.utils.service_accounts",
    "api.utils.agent_credentials",
    "api.utils.syncing.auth",
)
_CLIENT = {
    "name": "phase-cli",
    "version": "1.0.0",
    "supportedSchemaVersions": [1],
    "protocols": ["http", "postgres"],
    "injectionActions": ["aws_sigv4", "pg_handshake", "set_header"],
    "features": ["provider_rules"],
}
_LIVE = {
    "aws": {
        "access_key_id": "AKIAABCDEFGHIJKLMNOP",
        "secret_access_key": "live-aws-secret-access-key",
        "region": "us-east-2",
    },
    "postgres": {
        "username": "agent_runtime_user",
        "password": "postgres-password-sentinel",
        "host": "db.internal.example",
        "database": "agent_runtime",
    },
}
_CONFIGS = {
    "aws": {},
    "postgres": {
        "hosts": [{"match": "exact", "value": "db.internal.example", "port": 5432}],
        "database": "agent_runtime",
    },
}


def _workspace():
    organisation = Organisation.objects.create(
        name="Packaged payloads", identity_key="00" * 32
    )
    role = Role.objects.create(
        name="Packaged payloads operator",
        organisation=organisation,
        permissions={
            "permissions": {"Agents": _ACTIONS, "AgentConnections": _ACTIONS},
            "agent_permissions": {
                "AgentWorkflows": _ACTIONS,
                "AgentSessions": _ACTIONS,
                "AgentTokens": _ACTIONS,
            },
        },
    )
    user = CustomUser.objects.create_user(
        username="packaged-payloads", email="packaged-payloads@example.com"
    )
    member = OrganisationMember.objects.create(
        user=user, organisation=organisation, role=role
    )
    agent, workflow = create_agent_with_default_workflow(
        organisation=organisation,
        name="Packaged Agent",
        harness_type=Agent.OTHER,
        created_by=member,
    )
    registry = get_config_registry()
    for index, service_type in enumerate(("aws", "postgres"), start=1):
        credential = ProviderCredentials.objects.create(
            id=f"00000000-0000-4000-8000-00000000000{index}",
            revision=UUID(f"00000000-0000-4000-9000-00000000000{index}"),
            organisation=organisation,
            provider=service_type,
            name=f"{service_type} credential",
            credentials={
                field: encrypt_asymmetric(value, _SERVER_KEYPAIR[0].hex())
                for field, value in _LIVE[service_type].items()
            },
        )
        connection = AgentConnection(
            id=f"00000000-0000-4000-a000-00000000000{index}",
            organisation=organisation,
            name=f"{service_type} connection",
            service_type=service_type,
            config=registry.validate_service_config(
                service_type, _CONFIGS[service_type]
            ),
            authentication=credential,
            state=AgentConnection.ACTIVE,
            created_by=member,
            updated_by=member,
            host_rules_authored_by=(
                member if _CONFIGS[service_type].get("hosts") else None
            ),
        )
        connection.full_clean()
        connection.save()
        AgentWorkflowGrant.objects.create(
            id=f"00000000-0000-4000-b000-00000000000{index}",
            organisation=organisation,
            workflow=workflow,
            connection=connection,
            created_by=member,
        )
    return organisation, member, agent, workflow


def _client(organisation, member, agent, workflow, *, as_agent):
    client = APIClient()
    token = None
    if as_agent:
        token, _, _ = mint_agent_token(
            agent=agent, workflow=workflow, name="recorded", created_by=member
        )
    client.force_authenticate(
        user=AgentUser(agent) if as_agent else member.user,
        token={
            "auth_type": "Agent" if as_agent else "User",
            "org_member": None if as_agent else member,
            "service_account": None,
            "agent": agent if as_agent else None,
            "agent_token": token,
            "workflow": workflow if as_agent else None,
            "organisation": organisation,
            "org_only": True,
        },
    )
    return client


def _placeholders(session):
    """The values of an opened session that differ on every run."""

    values = {
        session[key]: f"<{key}>"
        for key in ("sessionUid", "sessionCredential", "expiresAt", "maxExpiresAt")
    }
    for connection in session["connections"]:
        service_type = connection["serviceType"]
        for field, decoy in connection["decoyMaterial"].items():
            values[decoy] = f"<{service_type}.decoy.{field}>"
        if service_type == "aws":
            values[connection["identifiers"]["accessKeyId"]] = "<aws.decoy.accessKeyId>"
    return values


# What every HTTP Connection carries when it has no policy of its own: default
# allow, no rules, and the secret guard that cannot be turned off.
_UNRESTRICTED_POLICY = {
    "version": 1,
    "default": "allow",
    "rules": [],
    "temporaryAllows": [],
    "managed": [
        {
            "id": "secret_guard",
            "locked": True,
            "rules": [{"class": "credential_minting", "effect": "block"}],
        }
    ],
}
_LATER_KEYS = {"policy", "grantExpiresAt"}
_LATER_SERVICES = {
    "cloudflare",
    "github",
    "gitlab",
    "railway",
    "render",
    "supabase",
    "vercel",
}


def _without_later_services(body):
    """Take the services packaged after the recording out of a capabilities
    catalog, checking that this Workflow has no Connection for any of them."""

    later = [
        service
        for service in body["services"]
        if service["serviceType"] in _LATER_SERVICES
    ]
    assert {service["serviceType"] for service in later} == _LATER_SERVICES
    assert all(service["connectionIds"] == [] for service in later)
    body["services"] = [
        service for service in body["services"] if service not in later
    ]
    return json.dumps(body, separators=(",", ":"), ensure_ascii=False)


def _without_later_additions(text):
    """Take the documented later keys out of a session payload, checking each."""

    body = json.loads(text)
    if body.get("kind") == "phase.ai.capabilities":
        return _without_later_services(body)
    if "connections" not in body:
        return text
    assert body.pop("expiredConnections") == []
    # App Connections are listed apart; this Workflow has none.
    assert body.pop("appConnections") == []
    # The session's own ids; test_session_identity checks their values.
    assert set(body.pop("organisation")) == {"id"}
    assert body.pop("principal")["type"] in {"agent", "user"}
    for connection in body["connections"]:
        if connection["protocol"] == "http":
            assert connection.pop("policy") == _UNRESTRICTED_POLICY
        # Each Connection's provider rules, exactly as its manifest has them.
        rules = expected_wire(connection["serviceType"])
        for key in ("credentialEnvironment", "secretGuard"):
            assert connection.pop(key, None) == rules.get(key), key
        # Nothing for PostgreSQL, and nothing else for a grant without expiry.
        assert not _LATER_KEYS & set(connection)
    return json.dumps(body, separators=(",", ":"), ensure_ascii=False)


def _recorded(response, values):
    assert response.status_code in (200, 201), response.content
    text = response.content.decode()
    for value in sorted(values, key=len, reverse=True):
        text = text.replace(value, values[value])
    # A refresh extends the session, so its expiry moves between responses.
    body = response.json()
    if "expiresAt" in body:
        text = text.replace(body["expiresAt"], "<expiresAt>")
    return _without_later_additions(text)


def packaged_exchanges(monkeypatch, *, as_agent=False, client=None):
    """Every runtime response for a Workflow with one AWS and one PostgreSQL
    Connection, with run-specific values replaced."""

    for module in _SERVER_KEYPAIR_USERS:
        monkeypatch.setattr(f"{module}.get_server_keypair", lambda: _SERVER_KEYPAIR)
    organisation, member, agent, workflow = _workspace()
    api = _client(organisation, member, agent, workflow, as_agent=as_agent)

    opened = api.post(
        "/v1/agents/sessions/",
        {
            "schemaVersion": 1,
            "workflowId": str(workflow.id),
            "idempotencyKey": "packaged-payloads-recorded",
            "client": client or _CLIENT,
        },
        format="json",
    )
    assert opened.status_code == 201, opened.content
    session = opened.json()
    values = _placeholders(session)
    api.credentials(HTTP_X_PHASE_SESSION_CREDENTIAL=session["sessionCredential"])
    base = f"/v1/agents/sessions/{session['sessionUid']}"
    return {
        "open": _recorded(opened, values),
        "discover": _recorded(api.get(f"{base}/discover/"), values),
        "config": _recorded(api.get(f"{base}/config/"), values),
        "capabilities": _recorded(api.get(f"{base}/capabilities/"), values),
        "context": _recorded(api.get(f"{base}/context/"), values),
        "context_postgres": _recorded(
            api.get(f"{base}/context/", {"serviceType": "postgres"}), values
        ),
    }


@pytest.mark.django_db
def test_packaged_responses_match_the_recorded_copy(monkeypatch):
    recorded = json.loads(GOLDEN.read_text())

    exchanges = packaged_exchanges(monkeypatch)

    assert set(exchanges) == set(recorded)
    for name, body in exchanges.items():
        assert body == recorded[name], name
    # The recording is of real payloads, not of an error envelope.
    assert '"secretMaterial":{"accessKeyId":"AKIAABCDEFGHIJKLMNOP"' in recorded["open"]
    assert '"injections"' not in recorded["open"]
    assert not any('"valueFormats"' in body for body in exchanges.values())


@pytest.mark.django_db
def test_an_agent_token_session_gets_the_same_packaged_payloads(monkeypatch):
    """Nothing is added for a client that can open sealed values when no
    Connection of the Workflow is released that way."""

    recorded = json.loads(GOLDEN.read_text())

    exchanges = packaged_exchanges(
        monkeypatch,
        as_agent=True,
        client={
            **_CLIENT,
            "injectionActions": [*_CLIENT["injectionActions"], "basic_auth"],
            "features": [
                "injection_list",
                "when_absent",
                "sealed_material",
                "provider_rules",
            ],
        },
    )

    for name, body in exchanges.items():
        assert body == recorded[name], name
    assert "agentKey" not in exchanges["open"]
