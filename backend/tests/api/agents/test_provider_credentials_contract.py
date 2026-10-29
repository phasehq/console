from datetime import timedelta
import threading
from types import SimpleNamespace

import pytest
from django.db import DatabaseError, connection as db_connection, transaction
from django.test import RequestFactory, override_settings
from django.utils import timezone
from graphql import GraphQLError
from rest_framework.test import APIClient

from api.models import (
    Agent,
    AgentConnection,
    AgentEvent,
    AgentMembership,
    AgentRequest,
    AgentSession,
    AgentWorkflowGrant,
    AgentWorkflowMembership,
    AuditEvent,
    CustomUser,
    Organisation,
    OrganisationMember,
    ProviderCredentials,
    Role,
)
from api.utils.agent_sessions import create_agent_session
from api.utils.agents import (
    close_agent_request,
    create_agent_with_default_workflow,
    create_agent_workflow,
)
from api.utils.agent_credentials import (
    CredentialResolutionError,
    ResolvedCredential,
    resolve_agent_credential,
)
from api.utils.crypto import encrypt_asymmetric, get_server_keypair
from backend.graphene.mutations.syncing import (
    CreateProviderCredentials,
    DeleteProviderCredentials,
    UpdateProviderCredentials,
)
from backend.schema import schema
from api.utils.agent_config import get_config_registry
from backend.graphene.agents.mutations import (
    AllowAgentConnectionHostMutation,
    ApproveAgentConnectionHostRulesMutation,
    CreateAgentConnectionMutation,
    CreateAgentWorkflowMutation,
    DeleteAgentConnectionMutation,
    DeleteAgentMutation,
    DeleteAgentWorkflowMutation,
    FulfillAgentRequestMutation,
    GrantAgentWorkflowMutation,
    MintAgentTokenMutation,
    ResolveAgentRequestMutation,
    RevokeAgentSessionMutation,
    RevokeAgentTokenMutation,
    RevokeAgentWorkflowGrantMutation,
    UpdateAgentConnectionMutation,
    UpdateAgentWorkflowMutation,
)
from api.views.agents.base import AgentRuntimeError
from api.views.agents.runtime import resolve_workflow_config
from api.views.agents.views import _request_response


_ACTIONS = ["create", "read", "update", "delete"]


def _member(organisation, label):
    role = Role.objects.create(
        organisation=organisation,
        name=f"Agent contract {label}",
        permissions={
            "permissions": {
                "Agents": _ACTIONS,
                "AgentConnections": _ACTIONS,
                "AgentRequests": _ACTIONS,
                "IntegrationCredentials": _ACTIONS,
            },
            "agent_permissions": {
                "AgentWorkflows": _ACTIONS,
                "AgentSessions": _ACTIONS,
                "AgentTokens": _ACTIONS,
            }
        },
    )
    user = CustomUser.objects.create_user(
        username=f"agent-contract-{label}",
        email=f"agent-contract-{label}@example.com",
    )
    return OrganisationMember.objects.create(
        organisation=organisation,
        user=user,
        role=role,
    )


def _info(member):
    request = RequestFactory().post("/graphql/")
    request.user = member.user
    return SimpleNamespace(context=request)


@pytest.fixture
def contract(db):
    organisation = Organisation.objects.create(
        name="Agent credential contract",
        identity_key="00" * 32,
    )
    member = _member(organisation, "owner")
    agent, workflow = create_agent_with_default_workflow(
        organisation=organisation,
        name="AWS operator",
        harness_type=Agent.CODEX,
        created_by=member,
    )
    service = get_config_registry().get_service("aws")
    return {
        "organisation": organisation,
        "member": member,
        "info": _info(member),
        "agent": agent,
        "workflow": workflow,
        "service": service,
    }


def _credential(contract, *, provider="aws", name="AWS deploy"):
    return ProviderCredentials.objects.create(
        organisation=contract["organisation"],
        provider=provider,
        name=name,
        credentials={},
    )


def _encrypted_aws_credential(contract):
    public_key, _ = get_server_keypair()
    material = {
        "access_key_id": "AKIAABCDEFGHIJKLMNOP",
        "secret_access_key": "live-aws-secret-access-key",
        "region": "us-east-2",
    }
    return ProviderCredentials.objects.create(
        organisation=contract["organisation"],
        provider="aws",
        name="AWS EC2 RDS S3 full access",
        credentials={
            field: encrypt_asymmetric(value, public_key.hex())
            for field, value in material.items()
        },
    ), material


def _encrypted_postgres_values(
    *,
    username="agent_runtime_user",
    password="postgres-password-sentinel",
    host="database.internal.example",
    port=None,
    database="agent_runtime",
):
    public_key, _ = get_server_keypair()
    material = {
        "username": username,
        "password": password,
        "host": host,
    }
    if port is not None:
        material["port"] = str(port)
    if database is not None:
        material["database"] = database
    encrypted = {
        field: encrypt_asymmetric(value, public_key.hex())
        for field, value in material.items()
    }
    return encrypted, material


def _encrypted_postgres_credential(contract, **values):
    encrypted, material = _encrypted_postgres_values(**values)
    return ProviderCredentials.objects.create(
        organisation=contract["organisation"],
        provider="postgres",
        name="PostgreSQL application database",
        credentials=encrypted,
    ), material


def _setup_request(contract, *, expires_at=None):
    connection = AgentConnection(
        organisation=contract["organisation"],
        name="AWS deploy",
        service_type="aws",
        config=get_config_registry().validate_service_config("aws", {}),
        state=AgentConnection.PENDING_CREDENTIALS,
    )
    connection.full_clean()
    connection.save()
    agent_request = AgentRequest(
        organisation=contract["organisation"],
        workflow=contract["workflow"],
        connection=connection,
        kind=AgentRequest.SETUP,
        service_type="aws",
        credential_provider="aws",
        credential_name="AWS deploy",
        markdown="Connect this workflow to AWS for EC2, RDS, and S3.",
        progress={"stage": "awaiting_credentials"},
        expires_at=expires_at,
    )
    agent_request.full_clean()
    agent_request.save()
    return agent_request, connection


def _credential_update_request(contract):
    current = _credential(contract, name="Current AWS credential")
    connection = AgentConnection(
        organisation=contract["organisation"],
        name="AWS deploy",
        service_type="aws",
        config=get_config_registry().validate_service_config("aws", {}),
        authentication=current,
        state=AgentConnection.ACTIVE,
        created_by=contract["member"],
        updated_by=contract["member"],
    )
    connection.full_clean()
    connection.save()
    grant = AgentWorkflowGrant.objects.create(
        organisation=contract["organisation"],
        workflow=contract["workflow"],
        connection=connection,
        created_by=contract["member"],
    )
    agent_request = AgentRequest(
        organisation=contract["organisation"],
        workflow=contract["workflow"],
        connection=connection,
        grant=grant,
        kind=AgentRequest.CREDENTIAL_UPDATE,
        service_type="aws",
        credential_provider="aws",
        credential_name="Replacement AWS credential",
        markdown="Replace the AWS credential.",
        progress={
            "stage": "awaiting_credentials",
            "baseline_authentication_id": str(current.id),
            "baseline_grant_id": str(grant.id),
        },
    )
    agent_request.full_clean()
    agent_request.save()
    return agent_request, connection, current


def _blocked_host_event(contract, *, protocol="http", port=443):
    return AgentEvent.objects.create(
        event_id=f"blocked-{protocol}-{port}",
        organisation=contract["organisation"],
        agent=contract["agent"],
        workflow=contract["workflow"],
        proxy_created_at=timezone.now(),
        event_type="request",
        protocol=protocol,
        host="blocked.internal.example",
        port=port,
        provider="proxy",
        status_code=403,
        proxy_decision=AgentEvent.BLOCK,
        outcome="denied",
        reason="lockdown_unbound_host",
    )


def test_graphql_surface_binds_connections_to_provider_credentials():
    graphql_schema = schema.graphql_schema
    provider_fields = graphql_schema.get_type("ProviderCredentialsType").fields
    connection_fields = graphql_schema.get_type("AgentConnectionType").fields
    grant_fields = graphql_schema.get_type("AgentWorkflowGrantType").fields
    request_fields = graphql_schema.get_type("AgentRequestType").fields

    assert {"revision", "agentConnectionCount"} <= set(provider_fields)
    assert "authentication" in connection_fields
    assert set(grant_fields) == {"id", "workflow", "connection", "createdAt", "updatedAt"}
    assert {"credential", "credentialName", "credentialProvider"} <= set(request_fields)


@pytest.mark.django_db
def test_provider_credential_revision_changes_on_every_update(contract):
    credential = _credential(contract)
    first = credential.revision
    credential.name = "AWS deploy renamed"
    credential.save(update_fields=["name"])
    assert credential.revision != first
    second = credential.revision
    credential.save(update_fields=["name", "revision"])
    assert credential.revision != second


@pytest.mark.django_db
def test_provider_credential_deletion_guards_live_binding_but_allows_retired_binding(
    contract,
):
    credential = _credential(contract)
    connection = AgentConnection(
        organisation=contract["organisation"],
        name="AWS live",
        service_type="aws",
        config=get_config_registry().validate_service_config("aws", {}),
        authentication=credential,
        state=AgentConnection.ACTIVE,
    )
    connection.full_clean()
    connection.save()

    with pytest.raises(GraphQLError, match="used by an Agent connection"):
        DeleteProviderCredentials.mutate(
            None,
            contract["info"],
            credential_id=credential.id,
        )

    connection.state = AgentConnection.DISABLED
    connection.deleted_at = timezone.now()
    connection.save(update_fields=["state", "deleted_at", "updated_at"])
    result = DeleteProviderCredentials.mutate(
        None,
        contract["info"],
        credential_id=credential.id,
    )
    assert result.ok is True
    connection.refresh_from_db()
    assert connection.authentication_id is None


@pytest.mark.django_db
def test_setup_fulfillment_accepts_compatible_aws_provider_and_creates_grant(contract):
    agent_request, connection = _setup_request(contract)
    credential = _credential(
        contract,
        provider="aws_assume_role",
        name="AWS EC2 RDS S3 full access",
    )

    result = FulfillAgentRequestMutation.mutate(
        None,
        contract["info"],
        request_id=agent_request.id,
        expected_revision=agent_request.revision,
        credential_id=credential.id,
        expected_credential_revision=credential.revision,
        resolution_note="Approved AWS Assume Role credential.",
    )

    agent_request.refresh_from_db()
    connection.refresh_from_db()
    assert agent_request.status == AgentRequest.APPROVED
    assert str(agent_request.credential_id) == str(credential.id)
    assert agent_request.credential_provider == "aws_assume_role"
    assert agent_request.credential_name == credential.name
    assert str(connection.authentication_id) == str(credential.id)
    assert connection.state == AgentConnection.ACTIVE
    assert result.grant.workflow_id == contract["workflow"].id
    assert result.runtime_action == "restart_required"
    assert "approval_url" not in _request_response(agent_request)


@pytest.mark.django_db
def test_connection_can_be_reused_across_workflows_without_duplicate_grants(contract):
    credential = _credential(contract)
    connection = CreateAgentConnectionMutation.mutate(
        None,
        contract["info"],
        organisation_id=contract["organisation"].id,
        name="Shared AWS access",
        service_type="aws",
        authentication_id=credential.id,
        config=None,
    ).connection
    second_workflow = create_agent_workflow(
        agent=contract["agent"],
        name="Second workflow",
        created_by=contract["member"],
    )

    first = GrantAgentWorkflowMutation.mutate(
        None,
        contract["info"],
        workflow_id=contract["workflow"].id,
        connection_id=connection.id,
    ).grant
    second = GrantAgentWorkflowMutation.mutate(
        None,
        contract["info"],
        workflow_id=second_workflow.id,
        connection_id=connection.id,
    ).grant
    repeated = GrantAgentWorkflowMutation.mutate(
        None,
        contract["info"],
        workflow_id=second_workflow.id,
        connection_id=connection.id,
    ).grant

    assert first.id != second.id
    assert repeated.id == second.id
    assert set(
        connection.workflow_grants.filter(deleted_at__isnull=True).values_list(
            "workflow_id", flat=True
        )
    ) == {contract["workflow"].id, second_workflow.id}


@pytest.mark.django_db
def test_closing_a_setup_request_removes_its_unused_connection(contract):
    agent_request, connection = _setup_request(contract)

    with transaction.atomic():
        close_agent_request(agent_request, AgentRequest.CANCELLED, timezone.now())

    agent_request.refresh_from_db()
    connection.refresh_from_db()
    assert agent_request.status == AgentRequest.CANCELLED
    assert agent_request.resolved_at is not None
    assert connection.state == AgentConnection.DISABLED
    assert connection.deleted_at is not None


@pytest.mark.django_db
def test_denying_a_setup_request_removes_its_unused_connection(contract):
    agent_request, connection = _setup_request(contract)

    ResolveAgentRequestMutation.mutate(
        None,
        contract["info"],
        request_id=agent_request.id,
        expected_revision=agent_request.revision,
        approved=False,
    )

    agent_request.refresh_from_db()
    connection.refresh_from_db()
    assert agent_request.status == AgentRequest.DENIED
    assert connection.state == AgentConnection.DISABLED
    assert connection.deleted_at is not None


@pytest.mark.django_db
def test_expired_fulfillment_commits_request_and_orphan_connection_cleanup(contract):
    agent_request, connection = _setup_request(
        contract,
        expires_at=timezone.now() - timedelta(seconds=1),
    )
    credential = _credential(contract)

    with pytest.raises(GraphQLError, match="expired"):
        FulfillAgentRequestMutation.mutate(
            None,
            contract["info"],
            request_id=agent_request.id,
            expected_revision=agent_request.revision,
            credential_id=credential.id,
            expected_credential_revision=credential.revision,
        )

    agent_request.refresh_from_db()
    connection.refresh_from_db()
    assert agent_request.status == AgentRequest.EXPIRED
    assert agent_request.resolved_at is not None
    assert connection.state == AgentConnection.DISABLED
    assert connection.deleted_at is not None


@pytest.mark.django_db
def test_cross_org_caller_cannot_expire_an_agent_request(contract):
    agent_request, connection = _setup_request(
        contract,
        expires_at=timezone.now() - timedelta(seconds=1),
    )
    credential = _credential(contract)
    other_organisation = Organisation.objects.create(
        name="Unrelated organisation",
        identity_key="11" * 32,
    )
    other_member = _member(other_organisation, "other")

    with pytest.raises(GraphQLError, match="access to this organisation"):
        FulfillAgentRequestMutation.mutate(
            None,
            _info(other_member),
            request_id=agent_request.id,
            expected_revision=agent_request.revision,
            credential_id=credential.id,
            expected_credential_revision=credential.revision,
        )

    agent_request.refresh_from_db()
    connection.refresh_from_db()
    assert agent_request.status == AgentRequest.PENDING
    assert connection.state == AgentConnection.PENDING_CREDENTIALS
    assert connection.deleted_at is None


@pytest.mark.django_db
def test_aws_runtime_keeps_live_access_key_server_side_and_emits_stable_decoys(
    contract,
):
    credential, live = _encrypted_aws_credential(contract)
    connection = AgentConnection(
        organisation=contract["organisation"],
        name="AWS deploy",
        service_type="aws",
        config=get_config_registry().validate_service_config("aws", {}),
        authentication=credential,
        state=AgentConnection.ACTIVE,
        created_by=contract["member"],
        updated_by=contract["member"],
    )
    connection.full_clean()
    connection.save()
    grant = AgentWorkflowGrant.objects.create(
        organisation=contract["organisation"],
        workflow=contract["workflow"],
        connection=connection,
        created_by=contract["member"],
    )
    session, _, _ = create_agent_session(
        agent=contract["agent"],
        workflow=contract["workflow"],
        opened_by_member=contract["member"],
        idempotency_key="aws-runtime-direct-access-key",
    )

    runtime = resolve_workflow_config(session)
    first = runtime["connections"][0]
    second = resolve_workflow_config(session)["connections"][0]
    discover = resolve_workflow_config(session, include_secrets=False)["connections"][0]

    fake_access_key = first["identifiers"]["access_key_id"]
    assert fake_access_key.startswith("AKIA")
    assert len(fake_access_key) == 20
    assert fake_access_key.isalnum() and fake_access_key.upper() == fake_access_key
    assert fake_access_key != live["access_key_id"]
    assert first["agent_env"]["AWS_ACCESS_KEY_ID"] == fake_access_key
    assert first["secret_material"]["access_key_id"] == live["access_key_id"]
    assert first["secret_material"]["secret_access_key"] == live["secret_access_key"]
    assert first["connection_config"]["region"] == live["region"]
    assert first["config_env"]["AWS_REGION"] == live["region"]
    assert first["config_env"]["AWS_DEFAULT_REGION"] == live["region"]
    assert "AWS_REGION" not in first["agent_env"]
    assert "AWS_DEFAULT_REGION" not in first["agent_env"]
    assert set(runtime["config_env"]).isdisjoint(first["agent_env"])
    assert set(first["config_env"]).isdisjoint(first["agent_env"])
    assert first["authorization"] == {
        "version": 1,
        "mode": "connection",
        "access_mode": "allow",
        "state": "allowed",
        "approval": None,
    }
    assert str(grant.id) == first["grant_id"]
    assert second["identifiers"]["access_key_id"] == fake_access_key
    assert discover["identifiers"]["access_key_id"] == fake_access_key
    for field in (
        "grant_id",
        "connection_id",
        "connection_name",
        "credential_id",
        "credential_name",
        "credential_provider",
        "credential_revision",
        "service_type",
        "protocol",
        "hosts",
        "connection_config",
        "config_env",
        "material_generation",
        "credential_expires_at",
        "injection",
        "on_refresh",
        "identifiers",
        "decoy_material",
        "agent_env",
        "environment_bindings",
    ):
        assert discover.get(field) == first.get(field)
    assert "secret_material" not in discover


@pytest.mark.django_db
@override_settings(CORS_ALLOWED_ORIGINS=["http://localhost"])
def test_postgres_setup_derives_endpoint_and_keeps_password_server_side(contract):
    session, session_credential, _ = create_agent_session(
        agent=contract["agent"],
        workflow=contract["workflow"],
        opened_by_member=contract["member"],
        idempotency_key="postgres-provider-setup",
    )
    client = APIClient()
    client.force_authenticate(
        user=contract["member"].user,
        token={
            "auth_type": "User",
            "org_member": contract["member"],
            "service_account": None,
            "agent": None,
            "agent_token": None,
            "workflow": None,
            "organisation": contract["organisation"],
            "org_only": True,
        },
    )
    client.credentials(HTTP_X_PHASE_SESSION_CREDENTIAL=session_credential)

    response = client.post(
        "/v1/agents/requests/",
        {
            "schemaVersion": 1,
            "kind": "setup",
            "serviceType": "postgres",
            "credentialProvider": "postgres",
            "credentialName": "PostgreSQL application database",
            "markdown": "Connect this workflow to the application database.",
            "dedupKey": "postgres-provider-setup",
        },
        format="json",
    )

    assert response.status_code == 201, response.content
    agent_request = AgentRequest.objects.get(id=response.json()["id"])
    connection = agent_request.connection
    assert connection.state == AgentConnection.PENDING_CREDENTIALS
    assert connection.config == {}

    credential, live = _encrypted_postgres_credential(contract)
    result = FulfillAgentRequestMutation.mutate(
        None,
        contract["info"],
        request_id=agent_request.id,
        expected_revision=agent_request.revision,
        credential_id=credential.id,
        expected_credential_revision=credential.revision,
        resolution_note="Approved the application database credential.",
    )

    connection.refresh_from_db()
    assert connection.state == AgentConnection.ACTIVE
    assert connection.config == {
        "hosts": [
            {
                "match": "exact",
                "value": live["host"],
                "port": 5432,
            }
        ],
        "database": live["database"],
    }
    assert str(connection.host_rules_authored_by_id) == str(contract["member"].id)
    assert result.runtime_action == "restart_required"

    runtime = resolve_workflow_config(session)
    binding = runtime["connections"][0]
    assert binding["hosts"] == connection.config["hosts"]
    assert binding["identifiers"]["username"] == live["username"]
    assert binding["secret_material"] == {
        "username": live["username"],
        "password": live["password"],
    }
    assert binding["agent_env"]["PGUSER"] == live["username"]
    assert binding["agent_env"]["PGPASSWORD"] != live["password"]
    assert binding["config_env"] == {"PGDATABASE": live["database"]}
    assert set(binding["agent_env"]).isdisjoint(binding["config_env"])


@pytest.mark.django_db
def test_postgres_fulfillment_rejects_an_invalid_credential_endpoint(contract):
    connection = AgentConnection.objects.create(
        organisation=contract["organisation"],
        name="PostgreSQL application database",
        service_type="postgres",
        config={},
        state=AgentConnection.PENDING_CREDENTIALS,
    )
    agent_request = AgentRequest.objects.create(
        organisation=contract["organisation"],
        workflow=contract["workflow"],
        connection=connection,
        kind=AgentRequest.SETUP,
        service_type="postgres",
        credential_provider="postgres",
        credential_name="PostgreSQL application database",
        markdown="Connect this workflow to the application database.",
        progress={"stage": "awaiting_credentials"},
    )
    credential, _ = _encrypted_postgres_credential(
        contract, host="https://database.internal.example/path"
    )

    with pytest.raises(GraphQLError, match="scheme, path, or wildcard"):
        FulfillAgentRequestMutation.mutate(
            None,
            contract["info"],
            request_id=agent_request.id,
            expected_revision=agent_request.revision,
            credential_id=credential.id,
            expected_credential_revision=credential.revision,
        )

    connection.refresh_from_db()
    agent_request.refresh_from_db()
    assert connection.state == AgentConnection.PENDING_CREDENTIALS
    assert connection.authentication_id is None
    assert agent_request.status == AgentRequest.PENDING


@pytest.mark.django_db
def test_postgres_provider_credential_rejects_invalid_endpoint_before_save(contract):
    encrypted, _ = _encrypted_postgres_values(
        host="https://database.internal.example/path"
    )
    before = ProviderCredentials.objects.count()

    with pytest.raises(GraphQLError, match="scheme, path, or wildcard"):
        CreateProviderCredentials.mutate(
            None,
            contract["info"],
            org_id=contract["organisation"].id,
            provider="postgres",
            name="Invalid PostgreSQL endpoint",
            credentials=encrypted,
        )

    assert ProviderCredentials.objects.count() == before


@pytest.mark.django_db
def test_setup_fulfillment_requires_connection_create_permission(contract):
    agent_request, connection = _setup_request(contract)
    credential = _credential(contract)
    permissions = contract["member"].role.permissions
    permissions["permissions"]["AgentConnections"] = [
        action for action in _ACTIONS if action != "create"
    ]
    contract["member"].role.permissions = permissions
    contract["member"].role.save(update_fields=["permissions"])

    with pytest.raises(
        GraphQLError, match="permission to create AgentConnections"
    ):
        FulfillAgentRequestMutation.mutate(
            None,
            contract["info"],
            request_id=agent_request.id,
            expected_revision=agent_request.revision,
            credential_id=credential.id,
            expected_credential_revision=credential.revision,
        )

    connection.refresh_from_db()
    agent_request.refresh_from_db()
    assert connection.state == AgentConnection.PENDING_CREDENTIALS
    assert agent_request.status == AgentRequest.PENDING


@pytest.mark.django_db
def test_setup_fulfillment_rejects_a_connection_that_already_changed(contract):
    agent_request, connection = _setup_request(contract)
    existing = _credential(contract, name="Existing AWS credential")
    selected = _credential(contract, name="Selected AWS credential")
    connection.authentication = existing
    connection.state = AgentConnection.ACTIVE
    connection.save(update_fields=["authentication", "state", "updated_at"])

    with pytest.raises(GraphQLError, match="pending setup Connection changed"):
        FulfillAgentRequestMutation.mutate(
            None,
            contract["info"],
            request_id=agent_request.id,
            expected_revision=agent_request.revision,
            credential_id=selected.id,
            expected_credential_revision=selected.revision,
        )

    connection.refresh_from_db()
    assert str(connection.authentication_id) == str(existing.id)


@pytest.mark.django_db
def test_credential_update_fulfillment_requires_connection_update_permission(contract):
    agent_request, connection, current = _credential_update_request(contract)
    selected = _credential(contract, name="Selected AWS credential")
    permissions = contract["member"].role.permissions
    permissions["permissions"]["AgentConnections"] = [
        action for action in _ACTIONS if action != "update"
    ]
    contract["member"].role.permissions = permissions
    contract["member"].role.save(update_fields=["permissions"])

    with pytest.raises(
        GraphQLError, match="permission to update AgentConnections"
    ):
        FulfillAgentRequestMutation.mutate(
            None,
            contract["info"],
            request_id=agent_request.id,
            expected_revision=agent_request.revision,
            credential_id=selected.id,
            expected_credential_revision=selected.revision,
        )

    connection.refresh_from_db()
    assert str(connection.authentication_id) == str(current.id)


@pytest.mark.django_db
def test_credential_update_fulfillment_rejects_a_stale_authentication_baseline(
    contract,
):
    agent_request, connection, _ = _credential_update_request(contract)
    intervening = _credential(contract, name="Intervening AWS credential")
    selected = _credential(contract, name="Selected AWS credential")
    connection.authentication = intervening
    connection.save(update_fields=["authentication", "updated_at"])

    with pytest.raises(GraphQLError, match="credential changed"):
        FulfillAgentRequestMutation.mutate(
            None,
            contract["info"],
            request_id=agent_request.id,
            expected_revision=agent_request.revision,
            credential_id=selected.id,
            expected_credential_revision=selected.revision,
        )

    connection.refresh_from_db()
    assert str(connection.authentication_id) == str(intervening.id)


@pytest.mark.django_db
def test_manual_postgres_connection_derives_routing_and_rejects_overrides(contract):
    credential, live = _encrypted_postgres_credential(contract)
    created = CreateAgentConnectionMutation.mutate(
        None,
        contract["info"],
        organisation_id=contract["organisation"].id,
        name="PostgreSQL application database",
        service_type="postgres",
        authentication_id=credential.id,
        config=None,
    ).connection

    assert created.config["hosts"] == [
        {"match": "exact", "value": live["host"], "port": 5432}
    ]
    assert created.config["database"] == live["database"]

    with pytest.raises(GraphQLError, match="derived from its Integration Credential"):
        CreateAgentConnectionMutation.mutate(
            None,
            contract["info"],
            organisation_id=contract["organisation"].id,
            name="Redirected database",
            service_type="postgres",
            authentication_id=credential.id,
            config={
                "hosts": [
                    {"match": "exact", "value": "redirect.example", "port": 5432}
                ]
            },
        )

    with pytest.raises(GraphQLError, match="derived from its Integration Credential"):
        UpdateAgentConnectionMutation.mutate(
            None,
            contract["info"],
            connection_id=created.id,
            config={
                "hosts": [
                    {"match": "exact", "value": "redirect.example", "port": 5432}
                ]
            },
        )

    replacement, replacement_live = _encrypted_postgres_credential(
        contract,
        host="replacement.internal.example",
        port=6432,
        database="replacement_database",
    )
    updated = UpdateAgentConnectionMutation.mutate(
        None,
        contract["info"],
        connection_id=created.id,
        authentication_id=replacement.id,
    ).connection
    assert str(updated.authentication_id) == str(replacement.id)
    assert updated.config == {
        "hosts": [
            {
                "match": "exact",
                "value": replacement_live["host"],
                "port": 6432,
            }
        ],
        "database": replacement_live["database"],
    }


@pytest.mark.django_db
def test_allow_host_rejects_a_postgres_protocol_event_without_mutation(contract):
    credential, _ = _encrypted_postgres_credential(contract)
    connection = CreateAgentConnectionMutation.mutate(
        None,
        contract["info"],
        organisation_id=contract["organisation"].id,
        name="PostgreSQL application database",
        service_type="postgres",
        authentication_id=credential.id,
        config=None,
    ).connection
    original_config = connection.config
    original_version = connection.host_rules_version
    event = _blocked_host_event(contract, protocol="postgres", port=5432)

    with pytest.raises(GraphQLError, match="Only a Workflow host blocked"):
        AllowAgentConnectionHostMutation.mutate(
            None,
            contract["info"],
            event_ingest_seq=event.ingest_seq,
            connection_id=connection.id,
            expected_version=original_version,
        )

    connection.refresh_from_db()
    assert connection.config == original_config
    assert connection.host_rules_version == original_version


@pytest.mark.django_db
def test_allow_http_host_cannot_target_postgres_in_a_mixed_workflow(contract):
    postgres_credential, _ = _encrypted_postgres_credential(contract)
    postgres = CreateAgentConnectionMutation.mutate(
        None,
        contract["info"],
        organisation_id=contract["organisation"].id,
        name="PostgreSQL application database",
        service_type="postgres",
        authentication_id=postgres_credential.id,
        config=None,
    ).connection
    aws_credential = _credential(contract)
    aws = CreateAgentConnectionMutation.mutate(
        None,
        contract["info"],
        organisation_id=contract["organisation"].id,
        name="AWS deploy",
        service_type="aws",
        authentication_id=aws_credential.id,
        config=None,
    ).connection
    for connection in (postgres, aws):
        AgentWorkflowGrant.objects.create(
            organisation=contract["organisation"],
            workflow=contract["workflow"],
            connection=connection,
            created_by=contract["member"],
        )
    original_config = postgres.config
    original_version = postgres.host_rules_version
    event = _blocked_host_event(contract)

    with pytest.raises(GraphQLError, match="exactly one eligible HTTP Connection"):
        AllowAgentConnectionHostMutation.mutate(
            None,
            contract["info"],
            event_ingest_seq=event.ingest_seq,
            connection_id=postgres.id,
            expected_version=original_version,
        )

    postgres.refresh_from_db()
    assert postgres.config == original_config
    assert postgres.host_rules_version == original_version


def _workflow_member(contract, label):
    member = _member(contract["organisation"], label)
    membership = AgentMembership.objects.create(
        agent=contract["agent"], member=member, assigned_by=contract["member"]
    )
    AgentWorkflowMembership.objects.create(
        workflow=contract["workflow"],
        agent_membership=membership,
        assigned_by=contract["member"],
    )
    return member


def _granted_aws_connection(contract):
    credential, _ = _encrypted_aws_credential(contract)
    connection = CreateAgentConnectionMutation.mutate(
        None,
        contract["info"],
        organisation_id=contract["organisation"].id,
        name="AWS deploy",
        service_type="aws",
        authentication_id=credential.id,
        config=None,
    ).connection
    AgentWorkflowGrant.objects.create(
        organisation=contract["organisation"],
        workflow=contract["workflow"],
        connection=connection,
        created_by=contract["member"],
    )
    return connection


def _allow_host(info, event, connection):
    connection.refresh_from_db()
    return AllowAgentConnectionHostMutation.mutate(
        None,
        info,
        event_ingest_seq=event.ingest_seq,
        connection_id=connection.id,
        expected_version=connection.host_rules_version,
    )


def _approve_host_rules(info, connection):
    connection.refresh_from_db()
    return ApproveAgentConnectionHostRulesMutation.mutate(
        None,
        info,
        connection_id=connection.id,
        expected_version=connection.host_rules_version,
    )


@pytest.mark.django_db
def test_allowed_hosts_need_review_by_someone_else(contract):
    connection = _granted_aws_connection(contract)
    reviewer = _workflow_member(contract, "reviewer")

    allowed = _allow_host(contract["info"], _blocked_host_event(contract), connection)

    assert allowed.approval_required is True
    assert allowed.host_rule == {
        "match": "exact",
        "value": "blocked.internal.example",
        "port": 443,
    }
    with pytest.raises(GraphQLError, match="different humans"):
        _approve_host_rules(contract["info"], connection)
    _approve_host_rules(_info(reviewer), connection)
    connection.refresh_from_db()
    assert str(connection.host_rules_approved_by_id) == str(reviewer.id)
    assert connection.host_rules_approved_version == connection.host_rules_version


@pytest.mark.django_db
def test_allowing_a_host_cannot_adopt_unreviewed_hosts(contract):
    connection = _granted_aws_connection(contract)
    reviewer = _workflow_member(contract, "reviewer")
    _allow_host(contract["info"], _blocked_host_event(contract), connection)
    second_event = _blocked_host_event(contract, port=8443)

    # Re-authoring the pending list would let its author approve it.
    with pytest.raises(GraphQLError, match="waiting for review"):
        _allow_host(_info(reviewer), second_event, connection)
    connection.refresh_from_db()
    assert str(connection.host_rules_authored_by_id) == str(contract["member"].id)
    assert len(connection.config["hosts"]) == 2

    _approve_host_rules(_info(reviewer), connection)
    _allow_host(_info(reviewer), second_event, connection)
    connection.refresh_from_db()
    assert str(connection.host_rules_authored_by_id) == str(reviewer.id)
    assert connection.host_rules_approved_by_id is None
    assert len(connection.config["hosts"]) == 3


def _audited(resource_type, event_type, description):
    return AuditEvent.objects.filter(
        resource_type=resource_type,
        event_type=event_type,
        description__startswith=description,
    ).exists()


@pytest.mark.django_db
def test_agent_management_mutations_write_audit_events(contract):
    info = contract["info"]
    agent = contract["agent"]
    connection = _granted_aws_connection(contract)
    allowed = _allow_host(info, _blocked_host_event(contract), connection)
    assert allowed.approval_required
    _approve_host_rules(_info(_workflow_member(contract, "reviewer")), connection)

    workflow = CreateAgentWorkflowMutation.mutate(
        None, info, agent_id=agent.id, name="Nightly"
    ).workflow
    UpdateAgentWorkflowMutation.mutate(
        None, info, workflow_id=workflow.id, name="Nightly builds"
    )
    grant = GrantAgentWorkflowMutation.mutate(
        None, info, workflow_id=workflow.id, connection_id=connection.id
    ).grant
    RevokeAgentWorkflowGrantMutation.mutate(None, info, grant_id=grant.id)
    minted = MintAgentTokenMutation.mutate(
        None, info, agent_id=agent.id, workflow_id=workflow.id, name="ci"
    ).minted
    session, _, _ = create_agent_session(
        agent=agent,
        workflow=workflow,
        opened_by_member=contract["member"],
        idempotency_key="audited-session",
    )
    RevokeAgentSessionMutation.mutate(None, info, session_uid=session.session_uid)
    RevokeAgentTokenMutation.mutate(None, info, token_id=minted.token.id)
    DeleteAgentWorkflowMutation.mutate(None, info, workflow_id=workflow.id)
    agent_request, _ = _setup_request(contract)
    ResolveAgentRequestMutation.mutate(
        None,
        info,
        request_id=agent_request.id,
        expected_revision=agent_request.revision,
        approved=False,
    )
    DeleteAgentConnectionMutation.mutate(None, info, connection_id=connection.id)
    DeleteAgentMutation.mutate(None, info, agent_id=agent.id)

    connection_events = [
        (AuditEvent.UPDATE, "Allowed blocked.internal.example:443"),
        (AuditEvent.UPDATE, "Approved custom hosts"),
        (AuditEvent.CREATE, "Granted Agent Connection 'AWS deploy'"),
        (AuditEvent.DELETE, "Revoked Agent Connection 'AWS deploy'"),
        (AuditEvent.DELETE, "Deleted Agent Connection 'AWS deploy'"),
    ]
    agent_events = [
        (AuditEvent.CREATE, "Created Workflow 'Nightly'"),
        (AuditEvent.UPDATE, "Updated Workflow 'Nightly builds'"),
        (AuditEvent.CREATE, "Minted reveal-once token 'ci'"),
        (AuditEvent.DELETE, "Revoked a session"),
        (AuditEvent.DELETE, "Revoked token 'ci'"),
        (AuditEvent.DELETE, "Deleted Workflow 'Nightly builds'"),
        (AuditEvent.DELETE, f"Deleted Agent '{agent.name}'"),
    ]
    for event_type, description in connection_events:
        assert _audited(AuditEvent.AGENT_CONNECTION, event_type, description), (
            description
        )
    for event_type, description in agent_events:
        assert _audited(AuditEvent.AGENT, event_type, description), description
    assert _audited(AuditEvent.AGENT_REQUEST, AuditEvent.UPDATE, "Denied Agent")


def _postgres_connection(contract, credential):
    return CreateAgentConnectionMutation.mutate(
        None,
        contract["info"],
        organisation_id=contract["organisation"].id,
        name="PostgreSQL application database",
        service_type="postgres",
        authentication_id=credential.id,
        config=None,
    ).connection


def _update_credential(contract, credential, values):
    encrypted, _ = _encrypted_postgres_values(**values)
    return UpdateProviderCredentials.mutate(
        None,
        contract["info"],
        credential_id=credential.id,
        expected_revision=credential.revision,
        name=credential.name,
        credentials=encrypted,
    ).credential


@pytest.mark.django_db
def test_editing_a_bound_postgres_credential_moves_its_connection(contract):
    credential, live = _encrypted_postgres_credential(contract)
    connection = _postgres_connection(contract, credential)
    AgentWorkflowGrant.objects.create(
        organisation=contract["organisation"],
        workflow=contract["workflow"],
        connection=connection,
        created_by=contract["member"],
    )
    session, _, _ = create_agent_session(
        agent=contract["agent"],
        workflow=contract["workflow"],
        opened_by_member=contract["member"],
        idempotency_key="postgres-credential-edit",
    )
    generation = session.config_generation
    version = connection.host_rules_version

    # A password rotation leaves the Connection alone and refreshes live sessions.
    credential = _update_credential(
        contract,
        credential,
        {**live, "password": "rotated-password-sentinel"},
    )
    connection.refresh_from_db()
    session.refresh_from_db()
    assert connection.host_rules_version == version
    assert session.config_generation == generation + 1

    # A new endpoint moves the Connection with it and restarts its sessions.
    _update_credential(
        contract,
        credential,
        {
            "username": "phase_app",
            "password": "rotated-password-sentinel",
            "host": "replica.internal.example",
            "port": 6432,
            "database": "analytics",
        },
    )
    connection.refresh_from_db()
    session.refresh_from_db()
    host = connection.config["hosts"][0]
    assert (host["value"], host["port"]) == ("replica.internal.example", 6432)
    assert connection.config["database"] == "analytics"
    assert connection.host_rules_version != version
    assert session.revoked_at is not None
    fresh, _, _ = create_agent_session(
        agent=contract["agent"],
        workflow=contract["workflow"],
        opened_by_member=contract["member"],
        idempotency_key="postgres-credential-moved",
    )
    runtime = resolve_workflow_config(fresh)
    assert runtime["connections"][0]["connection_config"] == connection.config

    event = AuditEvent.objects.get(
        resource_type=AuditEvent.AGENT_CONNECTION,
        resource_id=str(connection.id),
        event_type=AuditEvent.UPDATE,
    )
    assert event.old_values["config"]["hosts"][0]["value"] == (
        "database.internal.example"
    )
    assert event.new_values["config"] == connection.config


@pytest.mark.django_db
def test_moving_a_bound_postgres_credential_needs_connection_update(contract):
    credential, live = _encrypted_postgres_credential(contract)
    connection = _postgres_connection(contract, credential)
    role = Role.objects.create(
        organisation=contract["organisation"],
        name="Credential editor",
        permissions={
            "permissions": {"IntegrationCredentials": _ACTIONS},
            "app_permissions": {},
        },
    )
    user = CustomUser.objects.create_user(
        username="credential-editor", email="credential-editor@example.com"
    )
    editor = OrganisationMember.objects.create(
        organisation=contract["organisation"], user=user, role=role
    )
    encrypted, _ = _encrypted_postgres_values(
        **{**live, "host": "attacker.example"}
    )

    with pytest.raises(GraphQLError, match="permission to update Agent Connections"):
        UpdateProviderCredentials.mutate(
            None,
            _info(editor),
            credential_id=credential.id,
            expected_revision=credential.revision,
            name=credential.name,
            credentials=encrypted,
        )

    revision = credential.revision
    credential.refresh_from_db()
    connection.refresh_from_db()
    assert credential.revision == revision
    assert connection.config["hosts"][0]["value"] == "database.internal.example"

    # Rotating the password leaves the endpoint alone, so no Agent permission.
    rotated, _ = _encrypted_postgres_values(**{**live, "password": "rotated"})
    UpdateProviderCredentials.mutate(
        None,
        _info(editor),
        credential_id=credential.id,
        expected_revision=credential.revision,
        name=credential.name,
        credentials=rotated,
    )


@pytest.mark.django_db
def test_provider_credentials_reject_undeclared_fields(contract):
    public_key, _ = get_server_keypair()
    encrypted, _ = _encrypted_postgres_values()
    smuggled = {
        **encrypted,
        "role_arn": encrypt_asymmetric(
            "arn:aws:iam::123456789012:role/other", public_key.hex()
        ),
    }

    with pytest.raises(GraphQLError, match="Unknown credential fields: ROLE ARN"):
        CreateProviderCredentials.mutate(
            None,
            contract["info"],
            org_id=contract["organisation"].id,
            provider="postgres",
            name="Smuggled",
            credentials=smuggled,
        )

    credential, _ = _encrypted_aws_credential(contract)
    with pytest.raises(GraphQLError, match="Unknown credential fields: ROLE ARN"):
        UpdateProviderCredentials.mutate(
            None,
            contract["info"],
            credential_id=credential.id,
            expected_revision=credential.revision,
            name=credential.name,
            credentials={"role_arn": smuggled["role_arn"]},
        )
    credential.refresh_from_db()
    assert "role_arn" not in credential.credentials


@pytest.mark.django_db
def test_blank_optional_endpoint_matches_an_absent_one(contract):
    public_key, _ = get_server_keypair()
    credential = ProviderCredentials.objects.create(
        organisation=contract["organisation"],
        provider="github",
        name="GitHub",
        credentials={
            "access_token": encrypt_asymmetric("ghp_live", public_key.hex()),
        },
    )

    updated = UpdateProviderCredentials.mutate(
        None,
        contract["info"],
        credential_id=credential.id,
        expected_revision=credential.revision,
        name="GitHub renamed",
        credentials={
            "host_url": encrypt_asymmetric("", public_key.hex()),
            "api_url": encrypt_asymmetric("", public_key.hex()),
        },
    ).credential

    assert updated.name == "GitHub renamed"
    assert updated.credentials["access_token"] == credential.credentials["access_token"]


@pytest.mark.django_db
def test_a_disabled_postgres_connection_also_follows_its_credential(contract):
    credential, live = _encrypted_postgres_credential(contract)
    connection = _postgres_connection(contract, credential)
    connection.state = AgentConnection.DISABLED
    connection.save(update_fields=["state", "updated_at"])

    _update_credential(
        contract, credential, {**live, "host": "replica.internal.example"}
    )

    reactivated = UpdateAgentConnectionMutation.mutate(
        None,
        contract["info"],
        connection_id=connection.id,
        name="PostgreSQL reactivated",
    ).connection
    assert reactivated.state == AgentConnection.ACTIVE
    assert reactivated.config["hosts"][0]["value"] == "replica.internal.example"


@pytest.mark.django_db
def test_provider_credential_update_rejects_a_stale_revision(contract):
    credential = _credential(contract)
    stale_revision = credential.revision
    credential.name = "Changed elsewhere"
    credential.save(update_fields=["name"])
    current_revision = credential.revision

    with pytest.raises(GraphQLError, match="revision changed"):
        UpdateProviderCredentials.mutate(
            None,
            contract["info"],
            credential_id=credential.id,
            expected_revision=stale_revision,
            name="Stale update",
            credentials={},
        )

    credential.refresh_from_db()
    assert credential.name == "Changed elsewhere"
    assert credential.revision == current_revision


@pytest.mark.django_db
def test_postgres_runtime_fails_closed_when_credential_routing_drifts(contract):
    credential, live = _encrypted_postgres_credential(contract)
    connection = CreateAgentConnectionMutation.mutate(
        None,
        contract["info"],
        organisation_id=contract["organisation"].id,
        name="PostgreSQL application database",
        service_type="postgres",
        authentication_id=credential.id,
        config=None,
    ).connection
    AgentWorkflowGrant.objects.create(
        organisation=contract["organisation"],
        workflow=contract["workflow"],
        connection=connection,
        created_by=contract["member"],
    )
    session, _, _ = create_agent_session(
        agent=contract["agent"],
        workflow=contract["workflow"],
        opened_by_member=contract["member"],
        idempotency_key="postgres-routing-drift",
    )
    drifted, _ = _encrypted_postgres_values(
        username=live["username"],
        password=live["password"],
        host="drifted.internal.example",
        database=live["database"],
    )
    credential.credentials = drifted
    credential.save(update_fields=["credentials"])

    with pytest.raises(AgentRuntimeError) as exc_info:
        resolve_workflow_config(session)
    assert exc_info.value.code == "credential_resolution_failed"


@pytest.mark.django_db
def test_discover_reuses_safe_assume_role_runtime_without_resolving_again(
    contract, monkeypatch
):
    credential = _credential(contract, provider="aws_assume_role")
    connection = AgentConnection.objects.create(
        organisation=contract["organisation"],
        name="AWS role",
        service_type="aws",
        config=get_config_registry().validate_service_config("aws", {}),
        authentication=credential,
        state=AgentConnection.ACTIVE,
        created_by=contract["member"],
        updated_by=contract["member"],
    )
    AgentWorkflowGrant.objects.create(
        organisation=contract["organisation"],
        workflow=contract["workflow"],
        connection=connection,
        created_by=contract["member"],
    )
    session, _, _ = create_agent_session(
        agent=contract["agent"],
        workflow=contract["workflow"],
        opened_by_member=contract["member"],
        idempotency_key="aws-runtime-assume-role-snapshot",
    )
    expires_at = timezone.now() + timedelta(minutes=45)
    resolution_count = 0

    def resolve_once(*args, **kwargs):
        nonlocal resolution_count
        resolution_count += 1
        return ResolvedCredential(
            material={
                "access_key_id": "AKIA" + "R" * 16,
                "secret_access_key": "runtime-secret",
                "session_token": "runtime-session-token",
                "region": "us-west-2",
            },
            expires_at=expires_at,
            generation="assume-role-generation",
        )

    monkeypatch.setattr(
        "api.views.agents.runtime.resolve_agent_credential", resolve_once
    )

    opened = resolve_workflow_config(session)["connections"][0]
    discover = resolve_workflow_config(session, include_secrets=False)["connections"][0]

    assert resolution_count == 1
    for field in (
        "grant_id",
        "connection_id",
        "connection_name",
        "credential_id",
        "credential_name",
        "credential_provider",
        "credential_revision",
        "service_type",
        "protocol",
        "hosts",
        "connection_config",
        "config_env",
        "material_generation",
        "credential_expires_at",
        "injection",
        "on_refresh",
        "identifiers",
        "decoy_material",
        "agent_env",
        "environment_bindings",
    ):
        assert discover.get(field) == opened.get(field)
    assert "secret_material" not in discover
    assert "secret_access_key" not in str(session.runtime_snapshot)
    assert "session_token" not in str(session.runtime_snapshot)


@pytest.mark.django_db
@override_settings(CORS_ALLOWED_ORIGINS=["http://localhost"])
def test_credential_update_accepts_a_compatible_aws_provider_credential(contract):
    current = _credential(contract, provider="aws", name="Current AWS key")
    replacement = _credential(
        contract,
        provider="aws_assume_role",
        name="Replacement AWS role",
    )
    connection = AgentConnection.objects.create(
        organisation=contract["organisation"],
        name="AWS deploy",
        service_type="aws",
        config=get_config_registry().validate_service_config("aws", {}),
        authentication=current,
        state=AgentConnection.ACTIVE,
        created_by=contract["member"],
        updated_by=contract["member"],
    )
    AgentWorkflowGrant.objects.create(
        organisation=contract["organisation"],
        workflow=contract["workflow"],
        connection=connection,
        created_by=contract["member"],
    )
    _, session_credential, _ = create_agent_session(
        agent=contract["agent"],
        workflow=contract["workflow"],
        opened_by_member=contract["member"],
        idempotency_key="aws-compatible-credential-update",
    )
    client = APIClient()
    client.force_authenticate(
        user=contract["member"].user,
        token={
            "auth_type": "User",
            "org_member": contract["member"],
            "service_account": None,
            "agent": None,
            "agent_token": None,
            "workflow": None,
            "organisation": contract["organisation"],
            "org_only": True,
        },
    )
    client.credentials(HTTP_X_PHASE_SESSION_CREDENTIAL=session_credential)

    response = client.post(
        "/v1/agents/requests/",
        {
            "schemaVersion": 1,
            "kind": "credential_update",
            "connectionId": str(connection.id),
            "credentialId": str(replacement.id),
            # This remains the Agent's suggestion while pending; the chosen
            # compatible credential's actual provider wins at fulfillment.
            "credentialProvider": "aws",
            "credentialName": "AWS EC2 RDS S3 full access",
            "markdown": "Replace the AWS credential for EC2, RDS, and S3.",
            "dedupKey": "compatible-aws-provider-update",
        },
        format="json",
    )

    assert response.status_code == 201, response.content
    body = response.json()
    assert body["credentialProvider"] == "aws"
    assert body["credentialId"] == str(replacement.id)
    assert body["connectionId"] == str(connection.id)
    assert body["approvalUrl"].startswith("http://localhost/")
    assert "action=setup" in body["approvalUrl"]


@pytest.mark.django_db
def test_assumed_role_credentials_carry_the_sts_expiry(contract, monkeypatch):
    public_key, _ = get_server_keypair()
    credential = ProviderCredentials.objects.create(
        organisation=contract["organisation"],
        provider="aws_assume_role",
        name="AWS deploy role",
        credentials={
            field: encrypt_asymmetric(value, public_key.hex())
            for field, value in {
                "role_arn": "arn:aws:iam::123456789012:role/phase-agent",
                "region": "eu-west-1",
            }.items()
        },
    )
    connection = AgentConnection.objects.create(
        organisation=contract["organisation"],
        name="AWS role",
        service_type="aws",
        config=get_config_registry().validate_service_config("aws", {}),
        authentication=credential,
        state=AgentConnection.ACTIVE,
        created_by=contract["member"],
        updated_by=contract["member"],
    )
    grant = AgentWorkflowGrant.objects.create(
        organisation=contract["organisation"],
        workflow=contract["workflow"],
        connection=connection,
        created_by=contract["member"],
    )
    session, _, _ = create_agent_session(
        agent=contract["agent"],
        workflow=contract["workflow"],
        opened_by_member=contract["member"],
        idempotency_key="aws-assume-role-expiry",
    )
    expiration = timezone.now().replace(microsecond=0) + timedelta(hours=1)
    calls = []

    def fake_assume_role(role_arn, region=None, external_id=None, **options):
        calls.append((role_arn, region, external_id, options["role_session_name"]))
        return {
            "AccessKeyId": "ASIA" + "T" * 16,
            "SecretAccessKey": "temporary-secret",
            "SessionToken": "temporary-session-token",
            "Expiration": expiration,
        }

    monkeypatch.setattr(
        "api.utils.syncing.aws.auth.assume_aws_role", fake_assume_role
    )

    resolved = resolve_agent_credential(credential, session, grant=grant)

    assert calls == [
        (
            "arn:aws:iam::123456789012:role/phase-agent",
            "eu-west-1",
            None,
            f"phase-agent-{session.pk}",
        )
    ]
    assert resolved.material == {
        "access_key_id": "ASIA" + "T" * 16,
        "secret_access_key": "temporary-secret",
        "session_token": "temporary-session-token",
        "region": "eu-west-1",
    }
    assert resolved.expires_at == expiration
    runtime = resolve_workflow_config(session)
    assert runtime["connections"][0]["credential_expires_at"] == expiration
    # The refresh reuses the role session rather than assuming the role again.
    assert len(calls) == 1


@pytest.mark.django_db
def test_assumed_role_credentials_are_renewed_near_expiry_and_never_outlive_access(
    contract, monkeypatch
):
    public_key, _ = get_server_keypair()
    credential = ProviderCredentials.objects.create(
        organisation=contract["organisation"],
        provider="aws_assume_role",
        name="AWS deploy role",
        credentials={
            "role_arn": encrypt_asymmetric(
                "arn:aws:iam::123456789012:role/phase-agent", public_key.hex()
            ),
            "region": encrypt_asymmetric("eu-west-1", public_key.hex()),
        },
    )
    connection = AgentConnection.objects.create(
        organisation=contract["organisation"],
        name="AWS role",
        service_type="aws",
        config=get_config_registry().validate_service_config("aws", {}),
        authentication=credential,
        state=AgentConnection.ACTIVE,
        created_by=contract["member"],
        updated_by=contract["member"],
    )
    grant = AgentWorkflowGrant.objects.create(
        organisation=contract["organisation"],
        workflow=contract["workflow"],
        connection=connection,
        created_by=contract["member"],
    )
    session, _, _ = create_agent_session(
        agent=contract["agent"],
        workflow=contract["workflow"],
        opened_by_member=contract["member"],
        idempotency_key="aws-assume-role-renewal",
    )
    lifetimes = [timedelta(minutes=5), timedelta(hours=1)]
    calls = []

    def fake_assume_role(role_arn, region=None, external_id=None, **options):
        calls.append(role_arn)
        return {
            "AccessKeyId": f"ASIA{len(calls):016d}",
            "SecretAccessKey": "temporary-secret",
            "SessionToken": "temporary-session-token",
            "Expiration": timezone.now() + lifetimes[len(calls) - 1],
        }

    monkeypatch.setattr(
        "api.utils.syncing.aws.auth.assume_aws_role", fake_assume_role
    )

    first = resolve_agent_credential(credential, session, grant=grant)
    # Credentials about to lapse are renewed instead of reused.
    second = resolve_agent_credential(credential, session, grant=grant)
    third = resolve_agent_credential(credential, session, grant=grant)
    assert len(calls) == 2
    assert first.material["access_key_id"] != second.material["access_key_id"]
    assert third.material == second.material

    AgentSession.objects.filter(pk=session.pk).update(revoked_at=timezone.now())
    with pytest.raises(CredentialResolutionError):
        resolve_agent_credential(credential, session, grant=grant)
    assert len(calls) == 2


@pytest.mark.django_db(transaction=True)
def test_assuming_a_role_holds_no_row_locks(contract, monkeypatch):
    public_key, _ = get_server_keypair()
    credential = ProviderCredentials.objects.create(
        organisation=contract["organisation"],
        provider="aws_assume_role",
        name="AWS deploy role",
        credentials={
            "role_arn": encrypt_asymmetric(
                "arn:aws:iam::123456789012:role/phase-agent", public_key.hex()
            ),
            "region": encrypt_asymmetric("eu-west-1", public_key.hex()),
        },
    )
    connection = AgentConnection.objects.create(
        organisation=contract["organisation"],
        name="AWS role",
        service_type="aws",
        config=get_config_registry().validate_service_config("aws", {}),
        authentication=credential,
        state=AgentConnection.ACTIVE,
        created_by=contract["member"],
        updated_by=contract["member"],
    )
    grant = AgentWorkflowGrant.objects.create(
        organisation=contract["organisation"],
        workflow=contract["workflow"],
        connection=connection,
        created_by=contract["member"],
    )
    session, _, _ = create_agent_session(
        agent=contract["agent"],
        workflow=contract["workflow"],
        opened_by_member=contract["member"],
        idempotency_key="aws-assume-role-unlocked",
    )
    locked = []

    def probe_locks():
        try:
            with transaction.atomic():
                AgentSession.objects.select_for_update(nowait=True).get(pk=session.pk)
                AgentWorkflowGrant.objects.select_for_update(nowait=True).get(
                    pk=grant.pk
                )
            locked.append(False)
        except DatabaseError:
            locked.append(True)
        finally:
            db_connection.close()

    def fake_assume_role(role_arn, region=None, external_id=None, **options):
        probe = threading.Thread(target=probe_locks)
        probe.start()
        probe.join()
        return {
            "AccessKeyId": "ASIA" + "L" * 16,
            "SecretAccessKey": "temporary-secret",
            "SessionToken": "temporary-session-token",
            "Expiration": timezone.now() + timedelta(hours=1),
        }

    monkeypatch.setattr(
        "api.utils.syncing.aws.auth.assume_aws_role", fake_assume_role
    )

    resolve_agent_credential(credential, session, grant=grant)

    assert locked == [False]


@pytest.mark.django_db
def test_fulfilling_a_credential_update_refreshes_every_workflow_on_the_connection(
    contract,
):
    agent_request, connection, _ = _credential_update_request(contract)
    other_workflow = create_agent_workflow(
        agent=contract["agent"], name="Release", created_by=contract["member"]
    )
    AgentWorkflowGrant.objects.create(
        organisation=contract["organisation"],
        workflow=other_workflow,
        connection=connection,
        created_by=contract["member"],
    )
    requesting, _, _ = create_agent_session(
        agent=contract["agent"],
        workflow=contract["workflow"],
        opened_by_member=contract["member"],
        idempotency_key="credential-update-requesting",
    )
    sibling, _, _ = create_agent_session(
        agent=contract["agent"],
        workflow=other_workflow,
        opened_by_member=contract["member"],
        idempotency_key="credential-update-sibling",
    )
    revoked, _, _ = create_agent_session(
        agent=contract["agent"],
        workflow=other_workflow,
        opened_by_member=contract["member"],
        idempotency_key="credential-update-revoked",
    )
    AgentSession.objects.filter(pk=revoked.pk).update(revoked_at=timezone.now())
    generations = {
        session.pk: session.config_generation
        for session in (requesting, sibling, revoked)
    }
    replacement = _credential(contract, name="Replacement AWS credential")

    FulfillAgentRequestMutation.mutate(
        None,
        contract["info"],
        request_id=agent_request.id,
        expected_revision=agent_request.revision,
        credential_id=replacement.id,
        expected_credential_revision=replacement.revision,
        resolution_note="Rotated.",
    )

    for session in (requesting, sibling, revoked):
        session.refresh_from_db()
    assert requesting.config_generation == generations[requesting.pk] + 1
    assert sibling.config_generation == generations[sibling.pk] + 1
    assert revoked.config_generation == generations[revoked.pk]

