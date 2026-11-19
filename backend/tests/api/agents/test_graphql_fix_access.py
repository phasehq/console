"""Who may see and change what on the Agents GraphQL surface.

Nested fields ask for the permission their own query asks for, and a member
can hand an Agent or another member only what they hold themselves.
"""

from datetime import timedelta
from uuid import uuid4

import pytest
from django.utils import timezone
from graphql import GraphQLError

from api.models import (
    AgentConnection,
    AgentEvent,
    AgentMembership,
    AgentRequest,
    AgentWorkflowGrant,
    AgentWorkflowMembership,
    CustomUser,
    OrganisationMember,
    Role,
    Team,
    TeamAppEnvironment,
    TeamMembership,
)
from api.utils.agent_app_access import DEFAULT_POLICY, decide, grant_access
from api.utils.agent_sessions import create_agent_session
from api.utils.agents import create_agent_workflow
from backend.graphene.agents.mutations import (
    AssignAgentMemberMutation,
    CreateAgentAppConnectionMutation,
    RevokeAgentWorkflowGrantMutation,
    SetAgentConnectionPolicyMutation,
    UpdateAgentConnectionMutation,
    UpdateAgentMemberWorkflowsMutation,
)
from backend.graphene.agents.queries import resolve_app_agent_access

from .app_secrets import app_connection, grant_app, lab, member  # noqa: F401
from .custom_connections import (
    ACTIONS,
    add_member,
    graphql,
    info,
    packaged_connection,
    workspace,
)


def _assign(space, organisation_member, workflows=None):
    membership = AgentMembership.objects.create(
        agent=space.agent, member=organisation_member, assigned_by=space.member
    )
    for workflow in workflows or [space.workflow]:
        AgentWorkflowMembership.objects.create(
            workflow=workflow, agent_membership=membership, assigned_by=space.member
        )
    return membership


def _owner(space):
    role = Role.objects.create(
        organisation=space.organisation,
        name="Owner",
        is_default=True,
        managed_key="owner",
    )
    user = CustomUser.objects.create_user(
        username=f"owner-{uuid4().hex[:8]}",
        email=f"owner-{uuid4().hex[:8]}@example.com",
    )
    return OrganisationMember.objects.create(
        organisation=space.organisation, user=user, role=role
    )


# --- Lifting a block from an app Connection's policy --------------------------


def _blocking(access_class):
    return {
        "version": 1,
        "default": "allow",
        "rules": [
            {
                "class": name,
                "effect": "block" if name == access_class else "ask",
            }
            for name in ("create", "update", "delete")
        ],
    }


@pytest.mark.django_db
def test_lifting_a_block_over_a_live_temporary_allow_needs_that_permission(lab):
    connection = app_connection(lab, [lab.dev], policy=_blocking("update"))
    grant = grant_app(lab, connection, allows=["update"])
    editor = member(
        lab, "editor", app=lab.app, environments=lab.envs, secrets=["read"]
    )
    assert grant_access(grant)["update"]["effect"] == "block"

    # Back to "ask" would put the approved allow back in force.
    with pytest.raises(GraphQLError, match="update secrets"):
        SetAgentConnectionPolicyMutation.mutate(
            None, info(editor), connection_id=connection.id, policy=DEFAULT_POLICY
        )
    assert decide(lab.workflow, lab.dev, "update").effect == "block"

    SetAgentConnectionPolicyMutation.mutate(
        None, lab.approver_info, connection_id=connection.id, policy=DEFAULT_POLICY
    )
    assert decide(lab.workflow, lab.dev, "update").effect == "allow"


@pytest.mark.django_db
def test_lifting_a_block_with_no_live_allow_needs_no_secrets_permission(lab):
    connection = app_connection(lab, [lab.dev], policy=_blocking("update"))
    grant_app(lab, connection, allows=["delete"])
    editor = member(
        lab, "editor", app=lab.app, environments=lab.envs, secrets=["read"]
    )

    SetAgentConnectionPolicyMutation.mutate(
        None, info(editor), connection_id=connection.id, policy=DEFAULT_POLICY
    )

    assert decide(lab.workflow, lab.dev, "update").effect == "ask"


# --- Fields nested under events and requests ----------------------------------

_EVENTS = """
query($organisationId: ID!) {
  agentEvents(organisationId: $organisationId, limit: 10) {
    events { eventId connection { name config policy } session { sessionUid clientInfo } }
  }
}
"""

_REQUESTS = """
query($organisationId: ID!) {
  agentRequests(organisationId: $organisationId) {
    id connection { name config policy } grant { id temporaryAllows }
  }
}
"""


def _log_reader(space, label, **extra):
    reader = add_member(
        space.organisation,
        label,
        permissions={"Agents": ["read"], "Logs": ["read"], **extra},
        agent_permissions={"AgentWorkflows": ["read"]},
    )
    _assign(space, reader)
    return reader


@pytest.mark.django_db
def test_an_event_shows_its_connection_and_session_only_to_their_readers():
    space = workspace("events")
    connection = packaged_connection(space)
    session, _, _ = create_agent_session(
        agent=space.agent,
        workflow=space.workflow,
        opened_by_member=space.member,
        client_info={"name": "phase-cli", "hostname": "laptop-1"},
    )
    AgentEvent.objects.create(
        event_id="event-1",
        organisation=space.organisation,
        agent=space.agent,
        workflow=space.workflow,
        connection=connection,
        session=session,
        proxy_created_at=timezone.now(),
        event_type="request",
        protocol="http",
        host="sts.amazonaws.com",
        provider="aws",
        proxy_decision=AgentEvent.ALLOW,
    )
    variables = {"organisationId": str(space.organisation.id)}

    logs_only = _log_reader(space, "logs-only")
    result = graphql(space, _EVENTS, member=logs_only, **variables)
    assert result.errors is None, result.errors
    [event] = result.data["agentEvents"]["events"]
    assert event == {"eventId": "event-1", "connection": None, "session": None}

    connections_too = _log_reader(
        space, "connections-too", AgentConnections=["read"]
    )
    result = graphql(space, _EVENTS, member=connections_too, **variables)
    [event] = result.data["agentEvents"]["events"]
    assert event["connection"]["name"] == connection.name
    assert event["session"] is None

    sessions_too = add_member(
        space.organisation,
        "sessions-too",
        permissions={"Agents": ["read"], "Logs": ["read"]},
        agent_permissions={"AgentWorkflows": ["read"], "AgentSessions": ["read"]},
    )
    _assign(space, sessions_too)
    result = graphql(space, _EVENTS, member=sessions_too, **variables)
    [event] = result.data["agentEvents"]["events"]
    assert event["connection"] is None
    assert event["session"]["sessionUid"] == str(session.session_uid)


@pytest.mark.django_db
def test_a_request_shows_its_connection_and_grant_only_to_connection_readers():
    space = workspace("requests")
    connection = packaged_connection(space)
    grant = AgentWorkflowGrant.objects.create(
        organisation=space.organisation,
        workflow=space.workflow,
        connection=connection,
        temporary_allows=[
            {
                "id": "allow-1",
                "class": "update",
                "expiresAt": (timezone.now() + timedelta(hours=1)).isoformat(),
                "requestId": "r1",
            }
        ],
    )
    agent_request = AgentRequest.objects.create(
        organisation=space.organisation,
        workflow=space.workflow,
        connection=connection,
        grant=grant,
        kind=AgentRequest.SETUP,
        service_type="aws",
        credential_provider="aws",
        credential_name="AWS",
        markdown="Connect AWS.",
        status=AgentRequest.APPROVED,
    )
    variables = {"organisationId": str(space.organisation.id)}

    requests_only = add_member(
        space.organisation,
        "requests-only",
        permissions={"Agents": ["read"], "AgentRequests": ["read"]},
        agent_permissions={"AgentWorkflows": ["read"]},
    )
    _assign(space, requests_only)
    result = graphql(space, _REQUESTS, member=requests_only, **variables)
    assert result.errors is None, result.errors
    assert result.data["agentRequests"] == [
        {"id": str(agent_request.id), "connection": None, "grant": None}
    ]

    result = graphql(space, _REQUESTS, **variables)
    [row] = result.data["agentRequests"]
    assert row["connection"]["name"] == connection.name
    assert row["grant"]["id"] == str(grant.id)
    assert [allow["id"] for allow in row["grant"]["temporaryAllows"]] == ["allow-1"]


# --- An app's Agent access, for a member who reaches the app through a team ---


@pytest.mark.django_db
def test_app_agent_access_follows_the_role_a_team_gives_for_the_app(lab):
    grant_app(lab, app_connection(lab, [lab.dev]))
    viewer = member(lab, "team-viewer")
    secrets_only = Role.objects.create(
        organisation=lab.organisation,
        name="Secrets only",
        permissions={"app_permissions": {"Secrets": ["read"]}},
    )
    team = Team.objects.create(
        organisation=lab.organisation, name="Readers", member_role=secrets_only
    )
    TeamMembership.objects.create(team=team, org_member=viewer)
    TeamAppEnvironment.objects.create(team=team, app=lab.app, environment=lab.dev)

    # Their organisation role may read service accounts; the team's may not.
    assert resolve_app_agent_access(None, info(viewer), str(lab.app.id)) == []

    team.member_role = None
    team.save(update_fields=["member_role"])
    [row] = resolve_app_agent_access(None, info(viewer), str(lab.app.id))
    assert row["agent"]["name"] == lab.agent.name


# --- Revoking a grant, and naming an app --------------------------------------


@pytest.mark.django_db
def test_revoking_a_grant_needs_to_read_connections():
    space = workspace("revoke")
    grant = AgentWorkflowGrant.objects.create(
        organisation=space.organisation,
        workflow=space.workflow,
        connection=packaged_connection(space),
    )
    developer = add_member(
        space.organisation,
        "developer",
        permissions={"Agents": ACTIONS},
        agent_permissions={"AgentWorkflows": ACTIONS, "AgentSessions": ACTIONS},
    )
    _assign(space, developer)

    with pytest.raises(GraphQLError, match="read AgentConnections"):
        RevokeAgentWorkflowGrantMutation.mutate(
            None, info(developer), grant_id=grant.id
        )
    grant.refresh_from_db()
    assert grant.deleted_at is None

    assert RevokeAgentWorkflowGrantMutation.mutate(
        None, space.info, grant_id=grant.id
    ).ok


@pytest.mark.django_db
def test_a_refused_app_connection_never_names_an_app_the_member_cannot_reach(lab):
    outsider = member(lab, "outsider")

    with pytest.raises(GraphQLError) as refused:
        CreateAgentAppConnectionMutation.mutate(
            None,
            info(outsider),
            organisation_id=lab.organisation.id,
            name="Orders",
            app_id=lab.app.id,
            environment_ids=["not-an-environment"],
        )

    assert lab.app.name not in str(refused.value)
    assert "access to this app" in str(refused.value)

    # A member who reaches the app is still told which app has no such environment.
    with pytest.raises(GraphQLError, match=lab.app.name):
        CreateAgentAppConnectionMutation.mutate(
            None,
            lab.approver_info,
            organisation_id=lab.organisation.id,
            name="Orders",
            app_id=lab.app.id,
            environment_ids=["not-an-environment"],
        )


# --- Assigning Workflows to a member ------------------------------------------


@pytest.mark.django_db
def test_a_member_can_add_only_workflows_they_are_assigned_to():
    space = workspace("memberships")
    other = create_agent_workflow(agent=space.agent, name="Other")
    editor = space.member
    target = add_member(space.organisation, "target")
    both = [str(space.workflow.id), str(other.id)]

    with pytest.raises(GraphQLError, match="access to yourself"):
        AssignAgentMemberMutation.mutate(
            None,
            space.info,
            agent_id=space.agent.id,
            member_id=target.id,
            workflow_ids=[str(other.id)],
        )
    membership = AssignAgentMemberMutation.mutate(
        None,
        space.info,
        agent_id=space.agent.id,
        member_id=target.id,
        workflow_ids=[str(space.workflow.id)],
    ).membership

    with pytest.raises(GraphQLError, match="access to yourself"):
        UpdateAgentMemberWorkflowsMutation.mutate(
            None, space.info, membership_id=membership.id, workflow_ids=both
        )
    own = AgentMembership.objects.get(agent=space.agent, member=editor)
    with pytest.raises(GraphQLError, match="access to yourself"):
        UpdateAgentMemberWorkflowsMutation.mutate(
            None, space.info, membership_id=own.id, workflow_ids=both
        )
    assert not AgentWorkflowMembership.objects.filter(
        workflow=other, deleted_at__isnull=True
    ).exists()

    # An Owner reaches every Workflow, and what the target then holds can stay.
    UpdateAgentMemberWorkflowsMutation.mutate(
        None, info(_owner(space)), membership_id=membership.id, workflow_ids=both
    )
    UpdateAgentMemberWorkflowsMutation.mutate(
        None, space.info, membership_id=membership.id, workflow_ids=both
    )
    assert set(
        AgentWorkflowMembership.objects.filter(
            agent_membership=membership, deleted_at__isnull=True
        ).values_list("workflow_id", flat=True)
    ) == {space.workflow.id, other.id}


# --- A Connection still waiting for its setup request -------------------------


@pytest.mark.django_db
def test_a_connection_waiting_for_its_setup_request_cannot_be_edited():
    space = workspace("pending")
    placeholder = AgentConnection.objects.create(
        organisation=space.organisation,
        name="Pending AWS",
        service_type="aws",
        config={},
        state=AgentConnection.PENDING_CREDENTIALS,
    )
    agent_request = AgentRequest.objects.create(
        organisation=space.organisation,
        workflow=space.workflow,
        connection=placeholder,
        kind=AgentRequest.SETUP,
        service_type="aws",
        credential_provider="aws",
        credential_name="Pending AWS",
        markdown="Connect AWS.",
        expires_at=timezone.now() + timedelta(days=1),
    )

    with pytest.raises(GraphQLError, match="Requests page"):
        UpdateAgentConnectionMutation.mutate(
            None, space.info, connection_id=placeholder.id, name="Renamed"
        )

    placeholder.refresh_from_db()
    assert placeholder.state == AgentConnection.PENDING_CREDENTIALS
    assert placeholder.name == "Pending AWS"
    agent_request.refresh_from_db()
    assert agent_request.status == AgentRequest.PENDING
