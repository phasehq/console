"""Agent rows must survive the deletion of what created them: a Session keeps
its history when its token or member goes, and an organisation purge removes
Workflow grants along with everything else."""

from datetime import timedelta

import pytest
from django.db import IntegrityError, transaction
from django.db.models import RestrictedError
from django.utils import timezone

from api.models import (
    Agent,
    AgentConnection,
    AgentDecoy,
    AgentEvent,
    AgentSession,
    AgentToken,
    AgentWorkflowGrant,
    CustomUser,
    Organisation,
    OrganisationMember,
    ProviderCredentials,
    Role,
)
from api.tasks import organisation_deletion as jobs
from api.tasks.organisation_deletion import _delete_organisation
from api.utils.agent_config import get_config_registry
from api.utils.agent_sessions import create_agent_session
from api.utils.agents import create_agent_with_default_workflow, mint_agent_token

_ACTIONS = ["create", "read", "update", "delete"]


@pytest.fixture
def lifecycle(db):
    organisation = Organisation.objects.create(
        name="Agent lifecycle cascades", identity_key="00" * 32
    )
    role = Role.objects.create(
        organisation=organisation,
        name="Agent lifecycle owner",
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
        username="agent-lifecycle-owner", email="agent-lifecycle@example.com"
    )
    member = OrganisationMember.objects.create(
        organisation=organisation, user=user, role=role
    )
    agent, workflow = create_agent_with_default_workflow(
        organisation=organisation,
        name="Lifecycle agent",
        harness_type=Agent.CODEX,
        created_by=member,
    )
    credential = ProviderCredentials.objects.create(
        organisation=organisation, provider="aws", name="AWS", credentials={}
    )
    connection = AgentConnection.objects.create(
        organisation=organisation,
        name="AWS",
        service_type="aws",
        config=get_config_registry().validate_service_config("aws", {}),
        authentication=credential,
        state=AgentConnection.ACTIVE,
        created_by=member,
        updated_by=member,
    )
    return {
        "organisation": organisation,
        "member": member,
        "agent": agent,
        "workflow": workflow,
        "connection": connection,
    }


@pytest.mark.django_db
def test_session_history_survives_its_token_being_deleted(lifecycle):
    token, _, _ = mint_agent_token(
        agent=lifecycle["agent"],
        workflow=lifecycle["workflow"],
        name="setup",
        created_by=lifecycle["member"],
    )
    session, _, _ = create_agent_session(
        agent=lifecycle["agent"],
        workflow=lifecycle["workflow"],
        agent_token=token,
        idempotency_key="token-session",
    )

    AgentToken.objects.filter(id=token.id).delete()

    session.refresh_from_db()
    assert session.agent_token_id is None
    assert session.opened_by_member_id is None


@pytest.mark.django_db
def test_session_history_survives_its_member_being_removed(lifecycle):
    session, _, _ = create_agent_session(
        agent=lifecycle["agent"],
        workflow=lifecycle["workflow"],
        opened_by_member=lifecycle["member"],
        idempotency_key="member-session",
    )

    # A hard delete, as a user account deletion cascades into its memberships.
    OrganisationMember.objects.filter(id=lifecycle["member"].id).delete()

    session.refresh_from_db()
    assert session.opened_by_member_id is None
    assert session.agent_token_id is None


@pytest.mark.django_db
def test_sessions_still_refuse_two_authenticators(lifecycle):
    token, _, _ = mint_agent_token(
        agent=lifecycle["agent"],
        workflow=lifecycle["workflow"],
        name="setup",
        created_by=lifecycle["member"],
    )
    session, _, _ = create_agent_session(
        agent=lifecycle["agent"],
        workflow=lifecycle["workflow"],
        agent_token=token,
        idempotency_key="double-session",
    )

    with pytest.raises(IntegrityError), transaction.atomic():
        AgentSession.objects.filter(pk=session.pk).update(
            opened_by_member=lifecycle["member"]
        )


@pytest.mark.django_db
def test_organisation_purge_removes_workflow_grants(lifecycle):
    organisation = lifecycle["organisation"]
    retired = AgentWorkflowGrant.objects.create(
        organisation=organisation,
        workflow=lifecycle["workflow"],
        connection=lifecycle["connection"],
        created_by=lifecycle["member"],
    )
    retired.delete()
    assert retired.deleted_at is not None
    grant = AgentWorkflowGrant.objects.create(
        organisation=organisation,
        workflow=lifecycle["workflow"],
        connection=lifecycle["connection"],
        created_by=lifecycle["member"],
    )
    organisation.deleted_at = timezone.now() - timedelta(days=8)
    organisation.save(update_fields=["deleted_at"])

    _delete_organisation(organisation)

    assert not Organisation.objects.filter(id=organisation.id).exists()
    assert not AgentWorkflowGrant.objects.filter(
        id__in=[grant.id, retired.id]
    ).exists()
    assert not AgentConnection.objects.filter(
        id=lifecycle["connection"].id
    ).exists()


@pytest.mark.django_db
def test_connections_with_grants_still_cannot_be_hard_deleted(lifecycle):
    AgentWorkflowGrant.objects.create(
        organisation=lifecycle["organisation"],
        workflow=lifecycle["workflow"],
        connection=lifecycle["connection"],
        created_by=lifecycle["member"],
    )

    with pytest.raises(RestrictedError):
        AgentConnection.objects.filter(id=lifecycle["connection"].id).delete()


@pytest.mark.django_db
def test_organisation_purge_batches_agent_runtime_rows(lifecycle, monkeypatch):
    organisation = lifecycle["organisation"]
    grant = AgentWorkflowGrant.objects.create(
        organisation=organisation,
        workflow=lifecycle["workflow"],
        connection=lifecycle["connection"],
        created_by=lifecycle["member"],
    )
    session, _, _ = create_agent_session(
        agent=lifecycle["agent"],
        workflow=lifecycle["workflow"],
        opened_by_member=lifecycle["member"],
        idempotency_key="purge-runtime-rows",
    )
    AgentDecoy.objects.create(
        organisation=organisation,
        agent=lifecycle["agent"],
        grant=grant,
        session=session,
        kind="secret_access_key",
        field_name="secret_access_key",
        decoy_value="PHX-purge-decoy",
    )
    for index in range(3):
        AgentEvent.objects.create(
            event_id=f"purge-{index}",
            organisation=organisation,
            agent=lifecycle["agent"],
            workflow=lifecycle["workflow"],
            session=session,
            proxy_created_at=timezone.now(),
            event_type="request",
            protocol="http",
            host="sts.amazonaws.com",
            provider="aws",
            proxy_decision=AgentEvent.ALLOW,
        )
    monkeypatch.setattr(jobs, "SECRET_EVENT_BATCH_SIZE", 2)
    monkeypatch.setattr(jobs, "SECRET_EVENT_SLEEP_MS", 0)
    organisation.deleted_at = timezone.now() - timedelta(days=8)
    organisation.save(update_fields=["deleted_at"])

    assert jobs._delete_agent_runtime_rows(organisation) is True
    _delete_organisation(organisation)

    assert not Organisation.objects.filter(id=organisation.id).exists()
    for model in (AgentEvent, AgentDecoy, AgentSession):
        assert not model.objects.filter(organisation_id=organisation.id).exists()
