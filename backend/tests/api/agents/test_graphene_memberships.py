from types import SimpleNamespace

import pytest
from django.test import RequestFactory
from graphql import GraphQLError

from api.models import (
    Agent,
    AgentMembership,
    AgentWorkflowMembership,
    CustomUser,
    Organisation,
    OrganisationMember,
    Role,
)
from api.utils.agent_sessions import create_agent_session
from api.utils.rest import token_is_expired_or_deleted
from backend.schema import schema
from backend.graphene.agents.mutations import (
    AssignAgentMemberMutation,
    CreateAgentMutation,
    CreateAgentWorkflowMutation,
    MintAgentTokenMutation,
    RemoveAgentMemberMutation,
    UpdateAgentMemberWorkflowsMutation,
)
from backend.graphene.agents.queries import (
    resolve_agent_workflows,
    resolve_agents,
)


def _info(member):
    request = RequestFactory().post("/graphql/")
    request.user = member.user
    return SimpleNamespace(context=request)


def _member(organisation, role, suffix):
    user = CustomUser.objects.create_user(
        username=f"agent-graphql-{suffix}",
        email=f"agent-graphql-{suffix}@example.com",
    )
    return OrganisationMember.objects.create(
        organisation=organisation,
        user=user,
        role=role,
    )


@pytest.fixture
def management(db):
    organisation = Organisation.objects.create(
        name="Agent GraphQL organisation",
        identity_key="00" * 32,
    )
    owner_role = Role.objects.create(
        name="Owner",
        organisation=organisation,
        is_default=True,
        managed_key="owner",
    )
    developer_role = Role.objects.create(
        name="Agent developer",
        organisation=organisation,
        permissions={
            "permissions": {
                "Agents": ["create", "read", "update"],
            },
            "agent_permissions": {
                "AgentWorkflows": ["create", "read", "update", "delete"],
                "AgentTokens": ["create", "read", "delete"],
                "AgentSessions": ["create", "read", "delete"],
            }
        },
    )
    return {
        "organisation": organisation,
        "owner": _member(organisation, owner_role, "owner"),
        "creator": _member(organisation, developer_role, "creator"),
        "assignee": _member(organisation, developer_role, "assignee"),
    }


def test_agent_graphql_surface_uses_memberships_not_teams_or_local_bindings():
    graphql_schema = schema.graphql_schema
    query_fields = graphql_schema.query_type.fields
    mutation_fields = graphql_schema.mutation_type.fields
    agent_fields = graphql_schema.get_type("AgentType").fields

    assert "agentMemberships" in query_fields
    assert "agentTeamOptions" not in query_fields
    assert {
        "assignAgentMember",
        "updateAgentMemberWorkflows",
        "removeAgentMember",
    } <= set(mutation_fields)
    assert "updateAgentAccessBindings" not in mutation_fields
    assert "team" not in agent_fields
    assert "networkPolicies" not in agent_fields
    assert "identities" not in agent_fields
    assert {
        "createdBy",
        "memberships",
        "canManageMembers",
        "viewerWorkflowIds",
    } <= set(agent_fields)
    assert "teamId" not in mutation_fields["createAgent"].args
    assert "teamId" not in mutation_fields["updateAgent"].args


@pytest.mark.django_db
def test_creator_gets_only_workflows_they_create(management):
    organisation = management["organisation"]
    creator = management["creator"]
    created = CreateAgentMutation.mutate(
        None,
        _info(creator),
        organisation_id=organisation.id,
        name="Creator Agent",
        harness_type=Agent.CODEX,
    )
    second = CreateAgentWorkflowMutation.mutate(
        None,
        _info(creator),
        agent_id=created.agent.id,
        name="Second",
    ).workflow

    membership = AgentMembership.objects.get(
        agent=created.agent,
        member=creator,
        deleted_at__isnull=True,
    )
    assert set(
        AgentWorkflowMembership.objects.filter(
            agent_membership=membership,
            deleted_at__isnull=True,
        ).values_list("workflow_id", flat=True)
    ) == {created.default_workflow.id, second.id}
    assert list(
        resolve_agents(None, _info(management["assignee"]), organisation.id)
    ) == []


@pytest.mark.django_db
def test_owner_manages_exact_workflow_scope_and_removal(management):
    organisation = management["organisation"]
    creator = management["creator"]
    owner = management["owner"]
    assignee = management["assignee"]
    created = CreateAgentMutation.mutate(
        None,
        _info(creator),
        organisation_id=organisation.id,
        name="Shared Agent",
        harness_type=Agent.OTHER,
    )
    second = CreateAgentWorkflowMutation.mutate(
        None,
        _info(creator),
        agent_id=created.agent.id,
        name="Scoped",
    ).workflow

    assigned = AssignAgentMemberMutation.mutate(
        None,
        _info(owner),
        agent_id=created.agent.id,
        member_id=assignee.id,
        workflow_ids=[created.default_workflow.id, second.id],
    ).membership
    visible = resolve_agent_workflows(
        None,
        _info(assignee),
        organisation.id,
        agent_id=created.agent.id,
    )
    assert set(visible.values_list("id", flat=True)) == {
        created.default_workflow.id,
        second.id,
    }

    first_minted = MintAgentTokenMutation.mutate(
        None,
        _info(assignee),
        agent_id=created.agent.id,
        workflow_id=created.default_workflow.id,
        name="first workflow",
    ).minted
    first_token = first_minted.token
    second_minted = MintAgentTokenMutation.mutate(
        None,
        _info(assignee),
        agent_id=created.agent.id,
        workflow_id=second.id,
        name="second workflow",
    ).minted
    second_token = second_minted.token
    first_direct, _, _ = create_agent_session(
        agent=created.agent,
        workflow=created.default_workflow,
        opened_by_member=assignee,
    )
    first_token_session, _, _ = create_agent_session(
        agent=created.agent,
        workflow=created.default_workflow,
        agent_token=first_token,
    )
    second_direct, _, _ = create_agent_session(
        agent=created.agent,
        workflow=second,
        opened_by_member=assignee,
    )
    second_token_session, _, _ = create_agent_session(
        agent=created.agent,
        workflow=second,
        agent_token=second_token,
    )

    UpdateAgentMemberWorkflowsMutation.mutate(
        None,
        _info(owner),
        membership_id=assigned.id,
        workflow_ids=[second.id],
    )
    for session in (
        first_direct,
        first_token_session,
        second_direct,
        second_token_session,
    ):
        session.refresh_from_db()
    assert first_direct.revoked_at is not None
    assert first_token_session.revoked_at is not None
    assert second_direct.revoked_at is None
    assert second_token_session.revoked_at is None
    first_token.refresh_from_db()
    assert first_token.deleted_at is not None
    assert token_is_expired_or_deleted(
        f"Bearer {first_minted.bearer_token}"
    ) is True
    assert list(
        resolve_agent_workflows(
            None,
            _info(assignee),
            organisation.id,
            agent_id=created.agent.id,
        ).values_list("id", flat=True)
    ) == [second.id]

    with pytest.raises(GraphQLError, match="Workflow"):
        MintAgentTokenMutation.mutate(
            None,
            _info(assignee),
            agent_id=created.agent.id,
            workflow_id=created.default_workflow.id,
            name="not allowed",
        )
    assert str(second_token.created_by_id) == str(assignee.id)

    assert RemoveAgentMemberMutation.mutate(
        None,
        _info(owner),
        membership_id=assigned.id,
    ).ok is True
    assert list(resolve_agents(None, _info(assignee), organisation.id)) == []
    second_token.refresh_from_db()
    assert second_token.deleted_at is not None

    AssignAgentMemberMutation.mutate(
        None,
        _info(owner),
        agent_id=created.agent.id,
        member_id=assignee.id,
        workflow_ids=[created.default_workflow.id, second.id],
    )
    first_token.refresh_from_db()
    second_token.refresh_from_db()
    assert first_token.deleted_at is not None
    assert second_token.deleted_at is not None
    assert token_is_expired_or_deleted(
        f"Bearer {first_minted.bearer_token}"
    ) is True
    assert token_is_expired_or_deleted(
        f"Bearer {second_minted.bearer_token}"
    ) is True


@pytest.mark.django_db
def test_owner_implicit_access_cannot_be_assigned(management):
    creator = management["creator"]
    owner = management["owner"]
    created = CreateAgentMutation.mutate(
        None,
        _info(creator),
        organisation_id=management["organisation"].id,
        name="Implicit owner access",
        harness_type=Agent.OTHER,
    )

    with pytest.raises(GraphQLError, match="implicit access"):
        AssignAgentMemberMutation.mutate(
            None,
            _info(owner),
            agent_id=created.agent.id,
            member_id=owner.id,
            workflow_ids=[created.default_workflow.id],
        )
