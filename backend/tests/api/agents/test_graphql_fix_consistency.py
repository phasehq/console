"""Changes that land between a mutation's checks and its write.

Each test makes the second change by hand at the gap, since a test runs in one
transaction.
"""

import pytest
from django.db import connection as db
from django.test.utils import CaptureQueriesContext
from graphql import GraphQLError

from api.models import (
    Agent,
    AgentConnection,
    AgentMembership,
    AgentRequest,
    AgentToken,
    AgentWorkflow,
    AgentWorkflowGrant,
    AgentWorkflowMembership,
)
from api.utils.agents import (
    create_agent_with_default_workflow,
    create_agent_workflow,
    mint_agent_token,
)
from backend.graphene.agents import mutations
from backend.graphene.agents.mutations import (
    FulfillAgentRequestMutation,
    MintAgentTokenMutation,
    UpdateAgentConnectionMutation,
    UpdateAgentMutation,
    UpdateAgentWorkflowMutation,
)

from .custom_connections import (
    ACTIONS,
    add_member,
    info,
    live_packaged_connection,
    provider_credential,
    use_test_server_keypair,
    workspace,
)


def _statements(captured, *fragments):
    return [
        index
        for index, query in enumerate(captured)
        if all(fragment in query["sql"] for fragment in fragments)
    ]


# --- Updating an Agent or Workflow that was just deleted ----------------------


@pytest.mark.django_db
def test_renaming_an_agent_deleted_since_the_check_leaves_it_deleted(monkeypatch):
    space = workspace("stale-agent")
    checked = mutations.require_agent

    def check_then_delete(member, agent, action="read"):
        checked(member, agent, action)
        Agent.objects.get(id=agent.id).delete()

    monkeypatch.setattr(mutations, "require_agent", check_then_delete)

    with pytest.raises(GraphQLError, match="Agent not found"):
        UpdateAgentMutation.mutate(
            None, space.info, agent_id=space.agent.id, name="Renamed"
        )

    agent = Agent.objects.get(id=space.agent.id)
    assert agent.deleted_at is not None
    assert agent.status == Agent.DISABLED
    assert agent.server_wrapped_keyring is None
    assert agent.name == space.agent.name


@pytest.mark.django_db
def test_an_agent_update_writes_only_the_fields_it_was_given(monkeypatch):
    space = workspace("agent-fields")
    checked = mutations.require_agent

    def check_then_disable(member, agent, action="read"):
        checked(member, agent, action)
        Agent.objects.filter(id=agent.id).update(status=Agent.DISABLED)

    monkeypatch.setattr(mutations, "require_agent", check_then_disable)

    updated = UpdateAgentMutation.mutate(
        None, space.info, agent_id=space.agent.id, name="Renamed"
    ).agent

    assert updated.name == "Renamed"
    agent = Agent.objects.get(id=space.agent.id)
    assert (agent.name, agent.status) == ("Renamed", Agent.DISABLED)


@pytest.mark.django_db
def test_renaming_a_workflow_deleted_since_the_check_leaves_it_deleted(monkeypatch):
    space = workspace("stale-workflow")
    second = create_agent_workflow(
        agent=space.agent, name="Second", created_by=space.member
    )
    checked = mutations.require_workflow

    def check_then_delete(member, workflow, action="read"):
        checked(member, workflow, action)
        AgentWorkflow.objects.get(id=workflow.id).delete()

    monkeypatch.setattr(mutations, "require_workflow", check_then_delete)

    with pytest.raises(GraphQLError, match="Agent Workflow not found"):
        UpdateAgentWorkflowMutation.mutate(
            None, space.info, workflow_id=second.id, name="Renamed"
        )

    second.refresh_from_db()
    assert second.deleted_at is not None
    assert second.name == "Second"


@pytest.mark.django_db
def test_a_workflow_can_still_be_renamed():
    space = workspace("rename-workflow")

    renamed = UpdateAgentWorkflowMutation.mutate(
        None, space.info, workflow_id=space.workflow.id, name="Renamed"
    ).workflow

    assert renamed.name == "Renamed"
    assert AgentWorkflow.objects.get(id=space.workflow.id).name == "Renamed"


# --- Counting Agents against the plan -----------------------------------------


@pytest.mark.django_db
def test_creating_an_agent_locks_the_organisation_before_adding_it():
    space = workspace("plan-count")

    with CaptureQueriesContext(db) as captured:
        create_agent_with_default_workflow(
            organisation=space.organisation,
            name="Second Agent",
            harness_type=Agent.OTHER,
            created_by=space.member,
        )

    [lock] = _statements(captured, '"api_organisation"', "FOR UPDATE")
    [insert] = _statements(captured, 'INSERT INTO "api_agent"')
    assert lock < insert


# --- Minting a token as access is removed -------------------------------------


@pytest.mark.django_db
def test_a_token_is_not_minted_once_its_creator_is_removed_from_the_agent(
    monkeypatch,
):
    space = workspace("late-token")
    checked = mutations.require_role

    def check_then_remove(member, action, resource):
        checked(member, action, resource)
        if resource == "AgentTokens":
            AgentMembership.objects.get(
                agent=space.agent, member=space.member, deleted_at__isnull=True
            ).delete()

    monkeypatch.setattr(mutations, "require_role", check_then_remove)

    with pytest.raises(GraphQLError, match="no longer have access"):
        MintAgentTokenMutation.mutate(
            None,
            space.info,
            agent_id=space.agent.id,
            workflow_id=space.workflow.id,
            name="late",
        )

    assert not AgentToken.objects.filter(name="late").exists()


@pytest.mark.django_db
def test_minting_checks_the_creators_assignment_under_its_lock():
    space = workspace("token-lock")
    unassigned = add_member(space.organisation, "unassigned")

    with pytest.raises(ValueError, match="no longer have access"):
        mint_agent_token(
            agent=space.agent,
            workflow=space.workflow,
            name="unassigned",
            created_by=unassigned,
        )

    with CaptureQueriesContext(db) as captured:
        token, _, _ = mint_agent_token(
            agent=space.agent,
            workflow=space.workflow,
            name="assigned",
            created_by=space.member,
        )
    [lock] = _statements(captured, '"api_agentmembership"', "FOR UPDATE")
    [insert] = _statements(captured, 'INSERT INTO "api_agenttoken"')
    assert lock < insert
    assert token.deleted_at is None


# --- Hosts whose author has left ----------------------------------------------


DATABASE = {"username": "app", "password": "p", "host": "db.example.com"}


def _connection_without_its_host_author(space):
    author = add_member(space.organisation, "author")
    connection = live_packaged_connection(space, "postgres", DATABASE)
    AgentConnection.objects.filter(id=connection.id).update(
        host_rules_authored_by=author
    )
    # Deleting the account, unlike removing the member, clears the author.
    author.user.delete()
    connection.refresh_from_db()
    assert connection.host_rules_authored_by_id is None
    return connection


@pytest.mark.django_db
def test_a_connection_whose_host_author_is_gone_can_still_be_renamed(monkeypatch):
    use_test_server_keypair(monkeypatch)
    space = workspace("author-gone")
    connection = _connection_without_its_host_author(space)
    version = connection.host_rules_version

    UpdateAgentConnectionMutation.mutate(
        None, space.info, connection_id=connection.id, name="Renamed database"
    )

    connection.refresh_from_db()
    assert connection.name == "Renamed database"
    assert str(connection.host_rules_authored_by_id) == str(space.member.id)
    # The hosts did not change, so nothing about them is reviewed again.
    assert connection.host_rules_version == version


@pytest.mark.django_db
def test_a_credential_update_is_fulfilled_when_the_host_author_is_gone(monkeypatch):
    use_test_server_keypair(monkeypatch)
    space = workspace("author-gone-fulfil")
    connection = _connection_without_its_host_author(space)
    version = connection.host_rules_version
    grant = AgentWorkflowGrant.objects.create(
        organisation=space.organisation,
        workflow=space.workflow,
        connection=connection,
        created_by=space.member,
    )
    agent_request = AgentRequest.objects.create(
        organisation=space.organisation,
        workflow=space.workflow,
        connection=connection,
        grant=grant,
        kind=AgentRequest.CREDENTIAL_UPDATE,
        service_type="postgres",
        credential_provider="postgres",
        credential_name="Rotated database",
        markdown="Rotate the database password.",
        progress={
            "stage": "awaiting_credentials",
            "baseline_authentication_id": str(connection.authentication_id),
            "baseline_grant_id": str(grant.id),
        },
    )
    # The same database with a new password, so the hosts do not change.
    replacement = provider_credential(
        space, "postgres", {**DATABASE, "password": "rotated"}, "Rotated database"
    )
    replacement.refresh_from_db()
    integrator = add_member(
        space.organisation,
        "integrator",
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

    fulfilled = FulfillAgentRequestMutation.mutate(
        None,
        info(integrator),
        request_id=agent_request.id,
        expected_revision=str(agent_request.revision),
        credential_id=replacement.id,
        expected_credential_revision=str(replacement.revision),
    )

    assert fulfilled.request.status == AgentRequest.APPROVED
    connection.refresh_from_db()
    assert str(connection.authentication_id) == str(replacement.id)
    assert str(connection.host_rules_authored_by_id) == str(integrator.id)
    assert connection.host_rules_version == version
