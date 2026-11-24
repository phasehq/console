"""Builders shared by the app secrets tests: SSE apps with real server keys,
app Connections, grants, members who can or cannot reach an app, and Agent
token clients that authenticate the way the CLI does."""

from copy import deepcopy
from datetime import timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from api.models import (
    AgentConnection,
    AgentMembership,
    AgentWorkflowGrant,
    AgentWorkflowMembership,
    App,
    CustomUser,
    Environment,
    EnvironmentKey,
    OrganisationMember,
    Role,
    Secret,
    ServerEnvironmentKey,
)
from api.utils.agent_access import iso_timestamp
from api.utils.agent_app_access import DEFAULT_POLICY, set_connection_environments
from api.utils.agent_config import APP_SERVICE_TYPE
from api.utils.agents import mint_agent_token
from api.utils.crypto import encrypt_asymmetric, random_hex
from api.utils.secrets import compute_key_digest, get_environment_keys

from .custom_connections import (
    ACTIONS,
    SERVER_KEYPAIR,
    info,
    use_test_server_keypair,
    workspace,
)


ENV_TYPES = {"Development": "dev", "Staging": "staging", "Production": "prod"}


@pytest.fixture
def lab(db, monkeypatch):
    """An organisation, an Agent and its Workflow, an SSE app with three
    environments, and a member who may give that app's secrets to Agents."""

    use_test_server_keypair(monkeypatch)
    monkeypatch.setattr("api.utils.secrets.get_server_keypair", lambda: SERVER_KEYPAIR)
    space = workspace("app-secrets")
    space.app, space.envs = sse_app(space)
    space.dev, space.staging, space.prod = space.envs
    space.approver = member(space, "approver", app=space.app, environments=space.envs)
    space.approver_info = info(space.approver)
    return space


def sse_app(space, name="orders-service", environments=("Development", "Staging", "Production"), *, sse=True):
    app = App.objects.create(
        organisation=space.organisation,
        name=name,
        identity_key="00" * 32,
        app_token="00" * 32,
        app_seed="00",
        wrapped_key_share="00",
        sse_enabled=sse,
    )
    created = []
    for index, env_name in enumerate(environments):
        environment = Environment.objects.create(
            app=app,
            name=env_name,
            env_type=ENV_TYPES.get(env_name, "custom"),
            index=index,
            identity_key="00" * 32,
            wrapped_seed="00",
            wrapped_salt="00",
        )
        if sse:
            server_public = SERVER_KEYPAIR[0].hex()
            ServerEnvironmentKey.objects.create(
                environment=environment,
                identity_key="00" * 32,
                wrapped_seed=encrypt_asymmetric(random_hex(32), server_public),
                wrapped_salt=encrypt_asymmetric(random_hex(32), server_public),
            )
        created.append(environment)
    return app, created


def put_secret(environment, key, value, *, path="/", comment=""):
    public_key, _ = get_environment_keys(environment.id)
    return Secret.objects.create(
        environment=environment,
        path=path,
        key=encrypt_asymmetric(key.upper(), public_key),
        key_digest=compute_key_digest(key, environment.id),
        value=encrypt_asymmetric(value, public_key),
        version=1,
        comment=encrypt_asymmetric(comment, public_key) if comment else "",
    )


def member(
    space,
    label,
    *,
    app=None,
    environments=(),
    secrets=ACTIONS,
    managed_key=None,
):
    """A member assigned to the Agent and its Workflow, with Agent
    permissions, the given ``Secrets`` permissions on apps, and access to the
    given app and environments. ``managed_key`` makes a managed role instead,
    such as ``owner``, which has global access."""

    if managed_key:
        role = Role.objects.create(
            organisation=space.organisation,
            name=f"{managed_key} {uuid4().hex[:6]}",
            is_default=True,
            managed_key=managed_key,
        )
    else:
        role = Role.objects.create(
            organisation=space.organisation,
            name=f"App secrets {label} {uuid4().hex[:6]}",
            permissions={
                "permissions": {
                    "Agents": ACTIONS,
                    "AgentConnections": ACTIONS,
                    "AgentRequests": ACTIONS,
                    "ServiceAccounts": ACTIONS,
                },
                "app_permissions": {
                    "Secrets": list(secrets),
                    "ServiceAccounts": ACTIONS,
                    "Logs": ["read"],
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
        username=f"app-secrets-{label}-{uuid4().hex[:8]}",
        email=f"app-secrets-{label}-{uuid4().hex[:8]}@example.com",
    )
    created = OrganisationMember.objects.create(
        organisation=space.organisation, user=user, role=role
    )
    membership = AgentMembership.objects.create(agent=space.agent, member=created)
    AgentWorkflowMembership.objects.create(
        workflow=space.workflow, agent_membership=membership
    )
    if app is not None:
        app.members.add(created)
    for environment in environments:
        give_environment(created, environment)
    return created


def give_environment(organisation_member, environment):
    EnvironmentKey.objects.create(
        environment=environment,
        user=organisation_member,
        identity_key="00" * 32,
        wrapped_seed="00",
        wrapped_salt="00",
    )


def app_connection(space, environments, *, app=None, policy=DEFAULT_POLICY, name=None, state=AgentConnection.ACTIVE):
    connection = AgentConnection.objects.create(
        organisation=space.organisation,
        name=name or f"App {uuid4().hex[:6]}",
        service_type=APP_SERVICE_TYPE,
        app=app or space.app,
        state=state,
        policy=deepcopy(policy),
    )
    set_connection_environments(connection, environments)
    return connection


def grant_app(space, connection, *, workflow=None, expires_at=None, allows=(), allow_seconds=600):
    until = iso_timestamp(timezone.now() + timedelta(seconds=allow_seconds))
    return AgentWorkflowGrant.objects.create(
        organisation=space.organisation,
        workflow=workflow or space.workflow,
        connection=connection,
        created_by=space.member,
        expires_at=expires_at,
        temporary_allows=[
            {"id": str(uuid4()), "class": name, "expiresAt": until, "requestId": "r"}
            for name in allows
        ],
    )


def token_client(space, workflow=None):
    """A client sending an Agent token in its header, as the CLI does."""

    workflow = workflow or space.workflow
    token, _, bearer = mint_agent_token(
        agent=workflow.agent,
        workflow=workflow,
        name=f"token-{uuid4().hex[:8]}",
        created_by=space.member,
    )
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {bearer}")
    client.agent_token = token
    return client


def secrets_url(app, environment_name, **query):
    params = {"app_id": str(app.id), "env": environment_name, **query}
    return "/v1/secrets/?" + "&".join(f"{key}={value}" for key, value in params.items())


def refusal(response, status, code):
    assert response.status_code == status, response.content
    body = response.json()
    assert body["code"] == code, body
    assert isinstance(body["error"], str) and body["error"]
    return body


def as_namespace(**values):
    return SimpleNamespace(**values)
