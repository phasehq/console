"""Builders shared by the custom Connection tests."""

from copy import deepcopy
import json
from types import SimpleNamespace
from uuid import uuid4

from django.test import RequestFactory
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
    Role,
)
from api.utils.agent_config.http_definition import bound_hosts
from api.utils.agent_connection_values import (
    activate_custom_connection,
    ensure_agent_key_copy,
)
from api.utils.agents import create_agent_with_default_workflow, mint_agent_token
from api.utils.crypto import (
    decrypt_asymmetric,
    decrypt_raw,
    ed25519_to_kx,
    encrypt_asymmetric,
    random_key_pair,
    xor_bytes,
)
from api.utils.service_accounts import unwrap_server_managed_sa_keyring


# CI runs with a SERVER_SECRET that is not a key, so every module on these
# code paths that derives the server keypair is pointed at this one instead.
SERVER_KEYPAIR = crypto_kx_seed_keypair(b"\x07" * 32)
_SERVER_KEYPAIR_USERS = (
    "api.utils.crypto",
    "api.utils.service_accounts",
    "api.utils.agent_connection_values",
    "api.utils.agent_credentials",
    "api.utils.syncing.auth",
)

ACTIONS = ["create", "read", "update", "delete"]
SECRETS = {"token": "live-token-value", "password": "live-password-value"}
CLIENT = {
    "name": "phase-cli",
    "version": "2.0.0",
    "supportedSchemaVersions": [1],
    "protocols": ["http", "postgres"],
    "injectionActions": [
        "aws_sigv4",
        "pg_handshake",
        "set_header",
        "set_param",
        "basic_auth",
    ],
    "features": ["injection_list", "when_absent", "sealed_material"],
}


def use_test_server_keypair(monkeypatch):
    for module in _SERVER_KEYPAIR_USERS:
        monkeypatch.setattr(f"{module}.get_server_keypair", lambda: SERVER_KEYPAIR)


def definition(**changes):
    value = {
        "specVersion": 1,
        "hosts": [
            {"match": "exact", "value": "api.example.com", "port": 443, "path": "/v1/*"}
        ],
        "fields": [
            {
                "name": "token",
                "kind": "secret",
                "source": {"type": "sealed"},
                "env": "EXAMPLE_API_KEY",
                "decoyPrefix": "sk-",
            },
            {"name": "password", "kind": "secret", "source": {"type": "sealed"}},
            {
                "name": "username",
                "kind": "identifier",
                "value": "alice",
                "env": "EXAMPLE_USER",
            },
        ],
        "injections": [
            {
                "type": "header",
                "name": "X-Api-Key",
                "prefix": "Token ",
                "field": "token",
                "whenAbsent": "attach",
            },
            {
                "type": "basic",
                "usernameField": "username",
                "field": "password",
                "whenAbsent": "block",
            },
            {"type": "query", "name": "api_key", "field": "token", "whenAbsent": "attach"},
        ],
        "preset": "headers",
    }
    value.update(deepcopy(changes))
    return value


def bearer_definition(host="api.example.com", path=None):
    rule = {"match": "exact", "value": host, "port": 443}
    if path:
        rule["path"] = path
    return {
        "specVersion": 1,
        "hosts": [rule],
        "fields": [{"name": "token", "kind": "secret", "source": {"type": "sealed"}}],
        "injections": [
            {
                "type": "header",
                "name": "Authorization",
                "prefix": "Bearer ",
                "field": "token",
                "whenAbsent": "attach",
            }
        ],
        "preset": "bearer",
    }


def new_keys():
    """A Connection keypair as a browser would make it, wrapped to the server."""

    public_key, private_key = (key.hex() for key in random_key_pair())
    return SimpleNamespace(
        public_key=public_key,
        private_key=private_key,
        server_wrapped_key=encrypt_asymmetric(private_key, SERVER_KEYPAIR[0].hex()),
    )


def seal(connection_definition, public_key, fields=None, **payload):
    """Seal a value the way a browser does before it is submitted."""

    if fields is None:
        fields = {
            field["name"]: SECRETS[field["name"]]
            for field in connection_definition["fields"]
            if field["kind"] == "secret"
        }
    body = {"v": 1, "hosts": bound_hosts(connection_definition), "fields": fields}
    body.update(payload)
    return encrypt_asymmetric(json.dumps(body), public_key)


def info(member):
    request = RequestFactory().post("/graphql/")
    request.user = member.user
    return SimpleNamespace(context=request)


def add_member(organisation, label, *, permissions=None, agent_permissions=None):
    role = Role.objects.create(
        organisation=organisation,
        name=f"Custom connections {label}",
        permissions={
            "permissions": (
                {
                    "Agents": ACTIONS,
                    "AgentConnections": ACTIONS,
                    "AgentRequests": ACTIONS,
                }
                if permissions is None
                else permissions
            ),
            "agent_permissions": (
                {
                    "AgentWorkflows": ACTIONS,
                    "AgentSessions": ACTIONS,
                    "AgentTokens": ACTIONS,
                    "AgentMemberships": ACTIONS,
                }
                if agent_permissions is None
                else agent_permissions
            ),
        },
    )
    user = CustomUser.objects.create_user(
        username=f"custom-connections-{label}-{uuid4().hex[:8]}",
        email=f"custom-connections-{label}-{uuid4().hex[:8]}@example.com",
    )
    return OrganisationMember.objects.create(
        organisation=organisation, user=user, role=role
    )


def workspace(label="workspace"):
    """An organisation with one member, one Agent and its default Workflow.

    The member's role has no IntegrationCredentials permission: custom
    Connections must never need it.
    """

    organisation = Organisation.objects.create(
        name=f"Custom connections {label} {uuid4().hex[:8]}",
        identity_key="00" * 32,
    )
    member = add_member(organisation, label)
    agent, workflow = create_agent_with_default_workflow(
        organisation=organisation,
        name=f"Agent {label}",
        harness_type=Agent.OTHER,
        created_by=member,
    )
    return SimpleNamespace(
        organisation=organisation,
        member=member,
        info=info(member),
        agent=agent,
        workflow=workflow,
    )


def custom_connection(space, connection_definition=None, *, name="Example API"):
    """An active custom Connection, with the keys kept for the test to use."""

    connection_definition = connection_definition or definition()
    keys = new_keys()
    connection = AgentConnection(organisation=space.organisation, name=name)
    activate_custom_connection(
        connection,
        definition=connection_definition,
        encryption_public_key=keys.public_key,
        server_wrapped_key=keys.server_wrapped_key,
        sealed_value=seal(connection_definition, keys.public_key),
        member=space.member,
    )
    connection.test_keys = keys
    return connection


def grant(space, connection, workflow=None):
    workflow = workflow or space.workflow
    granted = AgentWorkflowGrant.objects.create(
        organisation=space.organisation,
        workflow=workflow,
        connection=connection,
        created_by=space.member,
    )
    ensure_agent_key_copy(connection, workflow.agent)
    return granted


def member_client(space, member=None):
    member = member or space.member
    client = APIClient()
    client.force_authenticate(
        user=member.user,
        token={
            "auth_type": "User",
            "org_member": member,
            "service_account": None,
            "agent": None,
            "agent_token": None,
            "workflow": None,
            "organisation": space.organisation,
            "org_only": True,
        },
    )
    return client


def agent_client(space, workflow=None):
    """A client authenticated with a freshly minted Agent token.

    Returns the client and the full token string, which the proxy needs to
    rebuild the Agent's key.
    """

    workflow = workflow or space.workflow
    token, full_token, _ = mint_agent_token(
        agent=workflow.agent,
        workflow=workflow,
        name=f"token-{uuid4().hex[:8]}",
        created_by=space.member,
    )
    client = APIClient()
    client.force_authenticate(
        user=AgentUser(workflow.agent),
        token={
            "auth_type": "Agent",
            "org_member": None,
            "service_account": None,
            "agent": workflow.agent,
            "agent_token": token,
            "workflow": workflow,
            "organisation": space.organisation,
            "org_only": True,
        },
    )
    client.agent_token = token
    return client, full_token


def open_session(client, workflow, *, features=None, actions=None, expect=201):
    body = {
        "schemaVersion": 1,
        "workflowId": str(workflow.id),
        "idempotencyKey": f"custom-connections-{uuid4().hex}",
        "client": {
            **CLIENT,
            "features": CLIENT["features"] if features is None else features,
            "injectionActions": (
                CLIENT["injectionActions"] if actions is None else actions
            ),
        },
    }
    response = client.post("/v1/agents/sessions/", body, format="json")
    assert response.status_code == expect, response.content
    payload = response.json()
    if expect == 201:
        client.credentials(HTTP_X_PHASE_SESSION_CREDENTIAL=payload["sessionCredential"])
    return payload


def agent_private_key(agent):
    """The Agent's key exchange keypair, from its server-managed keyring."""

    keyring = unwrap_server_managed_sa_keyring(
        agent.server_wrapped_keyring, agent.identity_key
    )
    return ed25519_to_kx(keyring["publicKey"], keyring["privateKey"])


def open_as_proxy(full_token, session_payload, connection_payload):
    """Open a sealed lane the way the proxy does, from the token alone."""

    _, _, _, kx_public, share_a, wrap_key = full_token.split(":")
    share_b = decrypt_raw(
        bytes.fromhex(session_payload["agentKey"]["wrappedKeyShare"]),
        bytes.fromhex(wrap_key),
    ).decode()
    agent_private = xor_bytes(bytes.fromhex(share_a), bytes.fromhex(share_b)).hex()
    sealed = connection_payload["sealedMaterial"]
    connection_private = decrypt_asymmetric(
        sealed["wrappedKey"], agent_private, kx_public
    )
    return json.loads(
        decrypt_asymmetric(sealed["ciphertext"], connection_private, sealed["publicKey"])
    )
