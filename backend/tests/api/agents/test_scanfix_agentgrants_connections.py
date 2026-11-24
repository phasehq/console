"""Changing and granting Connections: each change needs what the access it
gives needs, and its replies and refusals tell a member no more than they may
read."""

from uuid import uuid4

import pytest
from graphql import GraphQLError

from api.models import (
    AgentMembership,
    AgentRequest,
    AgentWorkflowGrant,
    AgentWorkflowMembership,
    CustomUser,
    OrganisationMember,
    Role,
)
from api.utils.agent_app_access import DEFAULT_POLICY, class_effect, decide
from api.utils.agents import create_agent_workflow
from api.utils.request_actions import action_handler
from backend.graphene.agents.mutations import (
    GrantAgentWorkflowMutation,
    SetAgentConnectionPolicyMutation,
    UpdateAgentAppConnectionMutation,
    UpdateCustomAgentConnectionMutation,
)

from .app_secrets import app_connection, grant_app, lab  # noqa: F401
from .custom_connections import (
    SECRETS,
    add_member,
    agent_client,
    approve,
    ask,
    bearer_definition,
    custom_connection,
    definition,
    filed,
    grant,
    graphql,
    info,
    open_session,
    packaged_connection,
    refused,
    seal,
    use_test_server_keypair,
    workspace,
)


@pytest.fixture(autouse=True)
def server_keypair(monkeypatch):
    use_test_server_keypair(monkeypatch)


@pytest.fixture
def space(db):
    return workspace("scanfix-connections")


def _assign(space, member):
    membership = AgentMembership.objects.create(
        agent=space.agent, member=member, assigned_by=space.member
    )
    AgentWorkflowMembership.objects.create(
        workflow=space.workflow, agent_membership=membership, assigned_by=space.member
    )


def _built_in(space, managed_key):
    """A member holding one of the built-in roles, assigned to no app."""

    role = Role.objects.create(
        organisation=space.organisation,
        name=f"{managed_key} {uuid4().hex[:6]}",
        is_default=True,
        managed_key=managed_key,
    )
    user = CustomUser.objects.create_user(
        username=f"scanfix-{managed_key}-{uuid4().hex[:8]}",
        email=f"scanfix-{managed_key}-{uuid4().hex[:8]}@example.com",
    )
    return OrganisationMember.objects.create(
        organisation=space.organisation, user=user, role=role
    )


def _may_read_credentials(member):
    role = member.role
    role.permissions["permissions"]["IntegrationCredentials"] = ["read"]
    role.save(update_fields=["permissions"])


# --- Making a class of app secrets allowed by the rules ---------------------

# Writes ask except update, which the rules allow.
UPDATE_ALLOWED = {
    "version": 1,
    "default": "allow",
    "rules": [
        {"class": "create", "effect": "ask"},
        {"class": "delete", "effect": "ask"},
    ],
}


def test_a_temporary_allow_does_not_let_an_editor_allow_its_class_for_good(lab):
    connection = app_connection(lab, [lab.dev])  # reads allowed, writes ask
    # One Workflow holds a temporary update allow; another holds none.
    grant_app(lab, connection, allows=["update"])
    other = create_agent_workflow(agent=lab.agent, name="Other", created_by=lab.member)
    grant_app(lab, connection, workflow=other)
    editor = _built_in(lab, "manager")  # may edit Connections, not in the app

    with pytest.raises(GraphQLError, match="access to this app"):
        SetAgentConnectionPolicyMutation.mutate(
            None, info(editor), connection_id=connection.id, policy=UPDATE_ALLOWED
        )

    connection.refresh_from_db()
    assert connection.policy == DEFAULT_POLICY
    assert decide(other, lab.dev, "update").effect == "ask"


def test_a_member_who_may_give_the_class_can_still_allow_it(lab):
    connection = app_connection(lab, [lab.dev])
    grant_app(lab, connection, allows=["update"])

    SetAgentConnectionPolicyMutation.mutate(
        None, lab.approver_info, connection_id=connection.id, policy=UPDATE_ALLOWED
    )

    connection.refresh_from_db()
    assert class_effect(connection.policy, "update") == "allow"


def test_tightening_the_rules_needs_no_access_to_the_app(lab):
    connection = app_connection(lab, [lab.dev], policy=UPDATE_ALLOWED)
    grant_app(lab, connection, allows=["update"])
    editor = _built_in(lab, "manager")

    SetAgentConnectionPolicyMutation.mutate(
        None, info(editor), connection_id=connection.id, policy=DEFAULT_POLICY
    )

    connection.refresh_from_db()
    assert class_effect(connection.policy, "update") == "ask"


# --- Granting or renewing a packaged Connection -----------------------------


def _workflow_editor(space):
    """May edit an assigned Workflow and see Connections; may not read
    Integration Credentials."""

    member = add_member(
        space.organisation,
        "workflow-editor",
        permissions={"Agents": ["read"], "AgentConnections": ["read"]},
        agent_permissions={
            "AgentWorkflows": ["read", "update"],
            "AgentSessions": ["create", "read"],
        },
    )
    _assign(space, member)
    return member


def _grant(member, space, connection):
    return GrantAgentWorkflowMutation.mutate(
        None, info(member), workflow_id=space.workflow.id, connection_id=connection.id
    )


def test_granting_a_packaged_connection_takes_integration_credentials_read(space):
    connection = packaged_connection(space, "postgres")
    editor = _workflow_editor(space)

    with pytest.raises(GraphQLError, match="permission to read IntegrationCredentials"):
        _grant(editor, space, connection)
    assert not AgentWorkflowGrant.objects.filter(connection=connection).exists()

    _may_read_credentials(editor)
    _grant(editor, space, connection)
    assert AgentWorkflowGrant.objects.active().filter(connection=connection).exists()


def test_granting_a_custom_connection_takes_no_integration_credentials(space):
    connection = custom_connection(space)

    _grant(_workflow_editor(space), space, connection)

    assert AgentWorkflowGrant.objects.active().filter(connection=connection).exists()


def test_renewing_a_packaged_connection_takes_integration_credentials_read(space):
    client, _ = agent_client(space)
    # Opened before the grant: this Connection's credential holds no material.
    open_session(client, space.workflow)
    connection = packaged_connection(space, "postgres")
    grant(space, connection)
    agent_request = filed(
        ask(
            client,
            durationSeconds=3600,
            action={
                "type": "agent_grant.renew",
                "version": 1,
                "connectionId": str(connection.id),
            },
        )
    )

    # The workspace member may approve requests but not read credentials.
    with pytest.raises(GraphQLError, match="permission to read IntegrationCredentials"):
        approve(space, agent_request)
    agent_request.refresh_from_db()
    assert agent_request.status == AgentRequest.PENDING

    _may_read_credentials(space.member)
    approve(space, agent_request)
    agent_request.refresh_from_db()
    assert agent_request.status == AgentRequest.APPROVED


# --- Text the Agent reads on a custom Connection ----------------------------


def test_a_definition_change_answers_the_same_whatever_text_it_holds(space):
    connection = custom_connection(space)
    # May edit Connections; holds no Agent or Workflow permission.
    editor = add_member(
        space.organisation,
        "connection-editor",
        permissions={"AgentConnections": ["read", "update"]},
        agent_permissions={},
    )

    def outcome(text):
        changed = definition()
        changed["fields"][2]["value"] = text  # the "username" identifier
        try:
            UpdateCustomAgentConnectionMutation.mutate(
                None, info(editor), connection_id=connection.id, definition=changed
            )
            return "saved"
        except GraphQLError as exc:
            return str(exc)

    unrelated = outcome("someone-else")
    matching = outcome(SECRETS["token"])

    assert unrelated == matching
    assert "Enter the secret again" in unrelated
    connection.refresh_from_db()
    assert connection.config == definition()
    assert connection.value_revision == 1


def test_new_text_is_stored_once_the_secret_is_entered_again(space):
    connection = custom_connection(space)
    changed = definition()
    changed["fields"][2]["value"] = "someone-else"

    UpdateCustomAgentConnectionMutation.mutate(
        None,
        space.info,
        connection_id=connection.id,
        definition=changed,
        sealed_value=seal(changed, connection.test_keys.public_key),
    )

    connection.refresh_from_db()
    assert connection.config == changed
    assert connection.value_revision == 2


def test_an_agents_change_to_text_it_reads_asks_the_reviewer_for_the_secret(space):
    connection = custom_connection(space, bearer_definition(path="/v1/*"))
    grant(space, connection)
    client, _ = agent_client(space)
    open_session(client, space.workflow)
    requested = bearer_definition(path="/v2/*")
    agent_request = filed(
        ask(
            client,
            action={
                "type": "agent_connection.update",
                "version": 1,
                "connectionId": str(connection.id),
                "definition": requested,
            },
        )
    )

    review = action_handler(agent_request.action).describe(
        agent_request, agent_request.action, space.member
    )
    assert review["requiresSecret"] is True
    with pytest.raises(GraphQLError, match="Enter the secret again"):
        approve(space, agent_request)

    approve(
        space,
        agent_request,
        inputs={"sealedValue": seal(requested, connection.test_keys.public_key)},
    )
    connection.refresh_from_db()
    assert connection.config == requested


# --- What a Connection change sends back -------------------------------------

_UPDATE = """
mutation($id: ID!) {
  updateAgentConnection(connectionId: $id) { connection { name config } }
}
"""


def test_a_member_who_may_update_but_not_read_connections_is_sent_none_back(space):
    connection = packaged_connection(space, "postgres", name="orders-db")
    custom = custom_connection(space)
    editor = add_member(
        space.organisation,
        "update-only",
        permissions={"AgentConnections": ["update"]},
        agent_permissions={},
    )

    result = graphql(space, _UPDATE, member=editor, id=str(connection.id))

    assert result.errors
    assert "permission to read AgentConnections" in str(result.errors[0])
    assert not (result.data or {}).get("updateAgentConnection")
    with pytest.raises(GraphQLError, match="permission to read AgentConnections"):
        UpdateCustomAgentConnectionMutation.mutate(
            None, info(editor), connection_id=custom.id, name="Renamed"
        )
    with pytest.raises(GraphQLError, match="permission to read AgentConnections"):
        SetAgentConnectionPolicyMutation.mutate(
            None, info(editor), connection_id=custom.id, policy=None
        )


def test_a_member_who_may_read_and_update_connections_is_sent_the_connection(space):
    connection = packaged_connection(space, "postgres", name="orders-db")
    editor = add_member(
        space.organisation,
        "read-update",
        permissions={"AgentConnections": ["read", "update"]},
        agent_permissions={},
    )

    result = graphql(space, _UPDATE, member=editor, id=str(connection.id))

    assert result.errors is None, result.errors
    returned = result.data["updateAgentConnection"]["connection"]
    assert returned["name"] == "orders-db"
    assert returned["config"]["database"] == "app"


# --- Naming an app in a refusal ----------------------------------------------


def test_an_editor_who_cannot_reach_the_app_is_not_told_its_name(lab):
    connection = app_connection(lab, [lab.dev])
    editor = _built_in(lab, "manager")

    with pytest.raises(GraphQLError) as refusal:
        UpdateAgentAppConnectionMutation.mutate(
            None,
            info(editor),
            connection_id=connection.id,
            environment_ids=[str(uuid4())],
        )

    assert "has no environment" in str(refusal.value)
    assert lab.app.name not in str(refusal.value)


def test_an_agent_is_not_told_the_name_of_an_app_in_a_refusal(lab):
    # The token's creator, lab.member, is not a member of the app.
    client, _ = agent_client(lab)
    open_session(client, lab.workflow)

    response = ask(
        client,
        durationSeconds=3600,
        action={
            "type": "agent_connection.app_access",
            "version": 1,
            "appId": str(lab.app.id),
            "environments": ["no-such-environment"],
            "access": "read",
        },
    )

    refused(response, "environment_not_found", 404)
    assert lab.app.name not in response.content.decode()
