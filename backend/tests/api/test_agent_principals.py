import pytest
from django.core.exceptions import ValidationError

from api.models import (
    Agent,
    AgentMembership,
    AgentToken,
    AgentWorkflowMembership,
    CustomUser,
    Organisation,
    OrganisationMember,
    Role,
)
from api.utils.access.permissions import (
    account_can_access_agent,
    account_can_access_workflow,
)
from api.utils.access.roles import default_roles
from api.utils.agent_sessions import create_agent_session
from api.utils.agents import (
    create_agent_with_default_workflow,
    create_agent_workflow,
    hash_agent_token_lookup,
    mint_agent_token,
)
from api.utils.rest import get_agent_token, token_is_expired_or_deleted


@pytest.fixture
def organisation(db):
    return Organisation.objects.create(name="Agent test org", identity_key="00" * 32)


@pytest.fixture
def developer_role(organisation):
    return Role.objects.create(
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


@pytest.fixture
def member(organisation, developer_role):
    user = CustomUser.objects.create_user(
        username="agent-test-user",
        email="agent-test@example.com",
    )
    return OrganisationMember.objects.create(
        user=user,
        organisation=organisation,
        role=developer_role,
    )


def _create_member(organisation, role, suffix):
    user = CustomUser.objects.create_user(
        username=f"agent-{suffix}",
        email=f"agent-{suffix}@example.com",
    )
    return OrganisationMember.objects.create(
        user=user,
        organisation=organisation,
        role=role,
    )


def test_default_agent_role_matrix():
    assert default_roles["Owner"]["agent_permissions"]["AgentMemberships"] == [
        "create",
        "read",
        "update",
        "delete",
    ]
    assert default_roles["Admin"]["agent_permissions"]["AgentMemberships"] == [
        "create",
        "read",
        "update",
        "delete",
    ]
    assert default_roles["Manager"]["agent_permissions"]["AgentMemberships"] == []
    assert default_roles["Developer"]["permissions"]["Agents"] == [
        "create",
        "read",
        "update",
    ]
    assert default_roles["Developer"]["permissions"]["AgentConnections"] == []
    assert default_roles["Developer"]["permissions"]["AgentRequests"] == [
        "create",
        "read",
        "delete",
    ]
    service = default_roles["Service"]
    assert all(
        not actions
        for resource, actions in {
            **service["permissions"],
            **service["agent_permissions"],
        }.items()
        if resource.startswith("Agent")
    )
    assert all(
        "execute" not in actions
        for role in default_roles.values()
        for scope in ("permissions", "agent_permissions")
        for actions in role[scope].values()
    )


@pytest.mark.django_db
def test_agent_creation_assigns_creator_to_default_workflow(organisation, member):
    agent, workflow = create_agent_with_default_workflow(
        organisation=organisation,
        name="Coder",
        harness_type=Agent.CLAUDE_CODE,
        created_by=member,
    )

    membership = AgentMembership.objects.get(agent=agent, member=member)
    assert str(membership.assigned_by_id) == str(member.id)
    assert AgentWorkflowMembership.objects.filter(
        workflow=workflow,
        agent_membership=membership,
        assigned_by=member,
        deleted_at__isnull=True,
    ).exists()
    assert account_can_access_agent(member, agent, "read") is True
    assert account_can_access_workflow(member, workflow, "read") is True

    token, full_token, bearer = mint_agent_token(
        agent=agent,
        workflow=workflow,
        name="local proxy",
        created_by=member,
    )

    token_value = full_token.removeprefix("pss_agent:v1:")
    assert len(token_value) == 64
    assert bearer == f"Agent {token_value}"
    assert token.token == hash_agent_token_lookup(token_value)
    assert str(token.created_by_id) == str(member.id)
    assert get_agent_token(f"Bearer {bearer}") == token
    assert get_agent_token(f"Bearer Agent {token.token}") is None
    assert token_is_expired_or_deleted(f"Bearer {bearer}") is False


@pytest.mark.django_db
def test_access_requires_rbac_and_exact_membership(
    organisation,
    member,
    developer_role,
):
    agent, workflow = create_agent_with_default_workflow(
        organisation=organisation,
        name="Membership-scoped Agent",
        harness_type=Agent.OTHER,
        created_by=member,
    )
    outsider = _create_member(organisation, developer_role, "outsider")

    assert account_can_access_agent(outsider, agent, "read") is False
    assert account_can_access_workflow(outsider, workflow, "read") is False

    membership = AgentMembership.objects.create(
        agent=agent,
        member=outsider,
        assigned_by=member,
    )
    assert account_can_access_agent(outsider, agent, "read") is True
    assert account_can_access_workflow(outsider, workflow, "read") is False

    AgentWorkflowMembership.objects.create(
        workflow=workflow,
        agent_membership=membership,
        assigned_by=member,
    )
    assert account_can_access_workflow(outsider, workflow, "read") is True
    assert account_can_access_workflow(
        outsider,
        workflow,
        "create",
        resource="AgentSessions",
    ) is True

    developer_role.permissions = {
        "permissions": {
            "Agents": [],
        },
        "agent_permissions": {
            "AgentWorkflows": [],
        }
    }
    developer_role.save(update_fields=["permissions"])
    assert account_can_access_agent(outsider, agent, "read") is False
    assert account_can_access_workflow(outsider, workflow, "read") is False


@pytest.mark.django_db
def test_owner_has_implicit_access_without_membership(organisation):
    owner_role = Role.objects.create(
        name="Owner",
        organisation=organisation,
        is_default=True,
        managed_key="owner",
    )
    owner = _create_member(organisation, owner_role, "owner")
    agent, workflow = create_agent_with_default_workflow(
        organisation=organisation,
        name="Owner Agent",
        harness_type=Agent.OTHER,
        created_by=owner,
    )

    assert AgentMembership.objects.filter(agent=agent).exists() is False
    assert account_can_access_agent(owner, agent, "delete") is True
    assert account_can_access_workflow(owner, workflow, "delete") is True


@pytest.mark.django_db
def test_workflow_creation_assigns_creator_only(
    organisation,
    member,
    developer_role,
):
    agent, _ = create_agent_with_default_workflow(
        organisation=organisation,
        name="Multi-workflow Agent",
        harness_type=Agent.OTHER,
        created_by=member,
    )
    outsider = _create_member(organisation, developer_role, "workflow-outsider")
    AgentMembership.objects.create(
        agent=agent,
        member=outsider,
        assigned_by=member,
    )

    workflow = create_agent_workflow(
        agent=agent,
        name="Second",
        created_by=member,
    )

    assert account_can_access_workflow(member, workflow, "read") is True
    assert account_can_access_workflow(outsider, workflow, "read") is False


@pytest.mark.django_db
def test_membership_validation_rejects_cross_boundary_assignments(
    organisation,
    member,
):
    other_organisation = Organisation.objects.create(
        name="Other Agent org",
        identity_key="11" * 32,
    )
    other_role = Role.objects.create(
        name="Other developer",
        organisation=other_organisation,
        permissions={"permissions": {"Agents": ["read"]}},
    )
    other_member = _create_member(other_organisation, other_role, "other-org")
    agent, workflow = create_agent_with_default_workflow(
        organisation=organisation,
        name="Boundary Agent",
        harness_type=Agent.OTHER,
        created_by=member,
    )

    with pytest.raises(ValidationError, match="organisation boundary"):
        AgentMembership(agent=agent, member=other_member).full_clean()

    other_agent = Agent.objects.create(
        organisation=other_organisation,
        name="Other Agent",
        harness_type=Agent.OTHER,
        created_by=other_member,
    )
    other_membership = AgentMembership.objects.create(
        agent=other_agent,
        member=other_member,
        assigned_by=other_member,
    )
    with pytest.raises(ValidationError, match="same Agent"):
        AgentWorkflowMembership(
            workflow=workflow,
            agent_membership=other_membership,
        ).full_clean()


@pytest.mark.django_db
def test_removing_agent_membership_revokes_member_sessions(organisation, member):
    agent, workflow = create_agent_with_default_workflow(
        organisation=organisation,
        name="Revocable Agent",
        harness_type=Agent.OTHER,
        created_by=member,
    )
    token, _, _ = mint_agent_token(
        agent=agent,
        workflow=workflow,
        name="revocable token",
        created_by=member,
    )
    direct_session, _, _ = create_agent_session(
        agent=agent,
        workflow=workflow,
        opened_by_member=member,
    )
    token_session, _, _ = create_agent_session(
        agent=agent,
        workflow=workflow,
        agent_token=token,
    )

    membership = AgentMembership.objects.get(agent=agent, member=member)
    membership.delete()

    token.refresh_from_db()
    direct_session.refresh_from_db()
    token_session.refresh_from_db()
    assert membership.deleted_at is not None
    assert token.deleted_at is not None
    assert not membership.workflow_memberships.filter(
        deleted_at__isnull=True
    ).exists()
    assert direct_session.revoked_at is not None
    assert token_session.revoked_at is not None
    assert account_can_access_agent(member, agent, "read") is False
    assert account_can_access_workflow(member, workflow, "read") is False


@pytest.mark.django_db
def test_deleting_org_member_retires_all_agent_access(organisation, member):
    agent, workflow = create_agent_with_default_workflow(
        organisation=organisation,
        name="Member retirement Agent",
        harness_type=Agent.OTHER,
        created_by=member,
    )
    token, _, _ = mint_agent_token(
        agent=agent,
        workflow=workflow,
        name="member retirement token",
        created_by=member,
    )
    direct_session, _, _ = create_agent_session(
        agent=agent,
        workflow=workflow,
        opened_by_member=member,
    )
    token_session, _, _ = create_agent_session(
        agent=agent,
        workflow=workflow,
        agent_token=token,
    )

    member.delete()

    member.refresh_from_db()
    token.refresh_from_db()
    direct_session.refresh_from_db()
    token_session.refresh_from_db()
    assert member.deleted_at is not None
    assert not AgentMembership.objects.filter(
        member=member,
        deleted_at__isnull=True,
    ).exists()
    assert not AgentWorkflowMembership.objects.filter(
        agent_membership__member=member,
        deleted_at__isnull=True,
    ).exists()
    assert token.deleted_at is not None
    assert direct_session.revoked_at is not None
    assert token_session.revoked_at is not None


@pytest.mark.django_db
def test_token_cannot_cross_workflow_agent_boundary(organisation, member):
    """A token's Agent is its Workflow's Agent; there is no second one to mismatch."""
    first_agent, first_workflow = create_agent_with_default_workflow(
        organisation=organisation,
        name="First",
        harness_type=Agent.OTHER,
        created_by=member,
    )
    second_agent, _ = create_agent_with_default_workflow(
        organisation=organisation,
        name="Second",
        harness_type=Agent.OTHER,
        created_by=member,
    )

    token = AgentToken(
        workflow=first_workflow,
        name="scoped",
        token="22" * 32,
        created_by=member,
    )
    assert token.agent == first_agent

    with pytest.raises(AttributeError):
        AgentToken(
            agent=second_agent,
            workflow=first_workflow,
            name="invalid",
            token="22" * 32,
            created_by=member,
        )
