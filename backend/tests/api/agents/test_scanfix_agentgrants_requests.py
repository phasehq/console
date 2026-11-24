"""Approving a request carries out what was asked for a member who may give it
as things stand when it is carried out. Access a member took away since the
request was made needs a new request, and the approver is checked again as they
are at that point."""

from datetime import timedelta
from uuid import uuid4

import pytest
from django.db import transaction
from django.utils import timezone
from graphql import GraphQLError
from rest_framework.test import APIClient

from api.models import (
    AgentConnection,
    AgentMembership,
    AgentRequest,
    AgentToken,
    AgentWorkflow,
    AgentWorkflowGrant,
    AgentWorkflowMembership,
    OrganisationMember,
    ProviderCredentials,
    Role,
    UserToken,
)
from api.utils.agent_access import end_connection_access
from api.utils.agent_config import get_config_registry
from api.utils.agent_config.access_policy import live_temporary_allows
from api.utils.agents import mint_agent_token
from api.utils.crypto import random_hex
from api.utils.request_actions import agent_grants
from api.utils.request_actions.agent_workflows import set_workflow_context
from api.views.agents import management
from backend.graphene.agents import mutations
from backend.graphene.agents.mutations import (
    FulfillAgentRequestMutation,
    GrantAgentWorkflowMutation,
    RemoveAgentWorkflowGrantAllowMutation,
)

from .app_secrets import app_connection, grant_app, lab  # noqa: F401
from .custom_connections import (
    ACTIONS,
    add_member,
    agent_client,
    approve,
    ask,
    custom_connection,
    filed,
    grant,
    graphql,
    info,
    open_session,
    use_test_server_keypair,
    workspace,
)


@pytest.fixture(autouse=True)
def server_keypair(monkeypatch):
    use_test_server_keypair(monkeypatch)


@pytest.fixture
def space(db):
    space = workspace("scanfix-requests")
    space.client, _ = agent_client(space)
    open_session(space.client, space.workflow)
    return space


@pytest.fixture
def agent(lab):
    client, _ = agent_client(lab)
    open_session(client, lab.workflow)
    return client


def _assign(space, member):
    membership = AgentMembership.objects.create(
        agent=space.agent, member=member, assigned_by=space.member
    )
    AgentWorkflowMembership.objects.create(
        workflow=space.workflow, agent_membership=membership, assigned_by=space.member
    )
    return membership


def _revoke(granted):
    with transaction.atomic():
        end_connection_access(AgentWorkflowGrant.objects.filter(id=granted.id))


def _status(agent_request):
    agent_request.refresh_from_db()
    return agent_request.status


# --- App access a member revoked after it was asked for ---------------------


def _app_access(agent, lab, dedup_key, environments=None):
    return filed(
        ask(
            agent,
            durationSeconds=3600,
            dedupKey=dedup_key,
            action={
                "type": "agent_connection.app_access",
                "version": 1,
                "appId": str(lab.app.id),
                "environmentIds": [
                    str(environment.id) for environment in environments or [lab.dev]
                ],
                "access": "read",
            },
        )
    )


def _app_grants_in_force(lab):
    return AgentWorkflowGrant.objects.active().filter(
        workflow=lab.workflow, connection__app=lab.app
    )


def test_app_access_asked_for_before_a_revocation_is_not_given_back(lab, agent):
    granted = grant_app(lab, app_connection(lab, [lab.dev]))
    agent_request = _app_access(agent, lab, "asked-while-granted")
    _revoke(granted)

    with pytest.raises(GraphQLError, match="removed this access after"):
        approve(lab, agent_request, lab.approver_info)

    assert _status(agent_request) == AgentRequest.PENDING
    assert not _app_grants_in_force(lab).exists()


def test_a_revocation_on_any_connection_to_the_app_counts(lab, agent):
    # Approval would make a new Connection for Development alone; the access
    # taken away was to the same app.
    granted = grant_app(lab, app_connection(lab, [lab.dev, lab.staging]))
    agent_request = _app_access(agent, lab, "asked-while-granted")
    _revoke(granted)

    with pytest.raises(GraphQLError, match="removed this access after"):
        approve(lab, agent_request, lab.approver_info)

    assert not _app_grants_in_force(lab).exists()
    assert not AgentConnection.objects.filter(
        organisation=lab.organisation, app=lab.app
    ).exclude(id=granted.connection_id).exists()


def test_app_access_asked_for_after_a_revocation_can_be_given(lab, agent):
    granted = grant_app(lab, app_connection(lab, [lab.dev]))
    _revoke(granted)

    approve(lab, _app_access(agent, lab, "asked-after"), lab.approver_info)

    assert _app_grants_in_force(lab).exists()


def test_app_access_that_ran_out_after_it_was_asked_for_can_be_given(lab, agent):
    granted = grant_app(lab, app_connection(lab, [lab.dev]))
    agent_request = _app_access(agent, lab, "asked-before-expiry")
    # It expired on its own; ending it afterwards is not a member's removal.
    AgentWorkflowGrant.objects.filter(id=granted.id).update(
        expires_at=timezone.now() - timedelta(seconds=1)
    )
    _revoke(granted)

    approve(lab, agent_request, lab.approver_info)

    assert _app_grants_in_force(lab).exists()


# --- A temporary allow a member ended ---------------------------------------


def _allow(agent, connection, dedup_key):
    return filed(
        ask(
            agent,
            durationSeconds=600,
            dedupKey=dedup_key,
            action={
                "type": "agent_grant.allow",
                "version": 1,
                "connectionId": str(connection.id),
                "allow": {"class": "delete"},
            },
        )
    )


def _live(granted):
    granted.refresh_from_db()
    return live_temporary_allows(granted.temporary_allows, timezone.now())


def test_an_allow_asked_for_before_a_member_ended_it_does_not_come_back(lab, agent):
    connection = app_connection(lab, [lab.dev])  # delete asks
    granted = grant_app(lab, connection)
    first = _allow(agent, connection, "first")
    second = _allow(agent, connection, "second")  # the same allow, asked again
    approve(lab, first, lab.approver_info)
    [given] = _live(granted)

    RemoveAgentWorkflowGrantAllowMutation.mutate(
        None, lab.approver_info, grant_id=granted.id, allow_id=given["id"]
    )

    assert _status(second) == AgentRequest.CANCELLED
    with pytest.raises(GraphQLError, match="no longer pending"):
        approve(lab, second, lab.approver_info)
    assert _live(granted) == []


def test_an_allow_asked_for_after_it_was_ended_can_be_given(lab, agent):
    connection = app_connection(lab, [lab.dev])
    granted = grant_app(lab, connection)
    approve(lab, _allow(agent, connection, "first"), lab.approver_info)
    [given] = _live(granted)
    RemoveAgentWorkflowGrantAllowMutation.mutate(
        None, lab.approver_info, grant_id=granted.id, allow_id=given["id"]
    )

    approve(lab, _allow(agent, connection, "asked-again"), lab.approver_info)

    assert [allow["class"] for allow in _live(granted)] == ["delete"]


def test_ending_an_allow_that_is_not_there_leaves_pending_requests_alone(lab, agent):
    connection = app_connection(lab, [lab.dev])
    granted = grant_app(lab, connection)
    pending = _allow(agent, connection, "pending")

    with pytest.raises(GraphQLError, match="Temporary allow not found"):
        RemoveAgentWorkflowGrantAllowMutation.mutate(
            None, lab.approver_info, grant_id=granted.id, allow_id=str(uuid4())
        )

    assert _status(pending) == AgentRequest.PENDING


def test_an_allow_whose_grant_is_revoked_during_approval_is_refused_plainly(
    lab, agent, monkeypatch
):
    connection = app_connection(lab, [lab.dev])
    granted = grant_app(lab, connection)
    agent_request = _allow(agent, connection, "asked")
    real_target = agent_grants._locked_target

    def revoked_after_the_check(request):
        # A revoke that lands once the grant was checked, before it is locked.
        checked = real_target(request)
        _revoke(granted)
        return checked

    monkeypatch.setattr(agent_grants, "_locked_target", revoked_after_the_check)

    with pytest.raises(GraphQLError, match="ended while the request was open"):
        approve(lab, agent_request, lab.approver_info)

    assert _status(agent_request) == AgentRequest.PENDING
    granted.refresh_from_db()
    assert granted.temporary_allows == []


# --- Approving the Agent's request to drop a Connection ---------------------


def _removal(space, connection):
    return filed(
        ask(
            space.client,
            action={
                "type": "agent_connection.remove",
                "version": 1,
                "connectionId": str(connection.id),
            },
        )
    )


def test_approving_a_removal_takes_what_revoking_the_grant_takes(space):
    connection = custom_connection(space)
    granted = grant(space, connection)
    agent_request = _removal(space, connection)
    # May resolve requests and update the Workflow; may not read Connections.
    reviewer = add_member(
        space.organisation,
        "removal-reviewer",
        permissions={"Agents": ["read"], "AgentRequests": ["read", "update"]},
        agent_permissions={"AgentWorkflows": ["read", "update"]},
    )
    _assign(space, reviewer)
    in_force = AgentWorkflowGrant.objects.active().filter(id=granted.id)

    with pytest.raises(GraphQLError, match="permission to read AgentConnections"):
        approve(space, agent_request, info(reviewer))
    assert in_force.exists()

    approve(space, agent_request)
    assert not in_force.exists()


# --- What a review shows a member who cannot read its target ----------------

_QUEUE = """
query($o: ID!) {
  agentRequestQueue(organisationId: $o) { requests { kind actionReview } }
}
"""
_REQUESTS = """
query($o: ID!) {
  agentRequests(organisationId: $o) { kind connection { name } actionReview }
}
"""


def test_a_reviewer_who_cannot_read_the_workflow_is_not_shown_its_context(space):
    workflow = AgentWorkflow.objects.get(id=space.workflow.id)
    set_workflow_context(workflow, "Deploys go out on Tuesdays.", space.member)
    filed(
        ask(
            space.client,
            action={
                "type": "agent_workflow.context_update",
                "version": 1,
                "markdown": "Replacement notes.",
            },
        )
    )
    # May update requests and the Workflow, not read the Workflow.
    reviewer = add_member(
        space.organisation,
        "context-reviewer",
        permissions={"AgentRequests": ["update"]},
        agent_permissions={"AgentWorkflows": ["update"]},
    )
    _assign(space, reviewer)
    organisation_id = str(space.organisation.id)

    hidden = graphql(space, _QUEUE, member=reviewer, o=organisation_id)
    shown = graphql(space, _QUEUE, o=organisation_id)

    assert hidden.errors is None, hidden.errors
    [item] = hidden.data["agentRequestQueue"]["requests"]
    assert item["actionReview"]["current"] is None
    assert item["actionReview"]["requested"] == {"markdown": "Replacement notes."}
    assert "Tuesdays" not in str(item["actionReview"])
    [item] = shown.data["agentRequestQueue"]["requests"]
    assert item["actionReview"]["current"] == {
        "markdown": "Deploys go out on Tuesdays."
    }


def test_a_request_reader_who_cannot_read_connections_is_not_shown_the_definition(
    space,
):
    connection = custom_connection(space)
    grant(space, connection)
    for action in (
        {"type": "agent_connection.secret_update"},
        # Only a new name: the definition it keeps is the stored one.
        {"type": "agent_connection.update", "name": "Renamed API"},
    ):
        filed(
            ask(
                space.client,
                action={**action, "version": 1, "connectionId": str(connection.id)},
            )
        )
    reader = add_member(
        space.organisation,
        "request-reader",
        permissions={"Agents": ["read"], "AgentRequests": ["read"]},
        agent_permissions={"AgentWorkflows": ["read"]},
    )
    _assign(space, reader)
    organisation_id = str(space.organisation.id)

    hidden = graphql(space, _REQUESTS, member=reader, o=organisation_id)
    shown = graphql(space, _REQUESTS, o=organisation_id)

    assert hidden.errors is None, hidden.errors
    reviews = {item["kind"]: item for item in hidden.data["agentRequests"]}
    for item in reviews.values():
        assert item["connection"] is None
        assert item["actionReview"]["current"] is None
        assert "api.example.com" not in str(item["actionReview"])
    renamed = reviews[AgentRequest.CONNECTION_UPDATE]["actionReview"]["requested"]
    assert renamed == {"name": "Renamed API", "definition": None}
    for item in shown.data["agentRequests"]:
        assert item["actionReview"]["current"]["definition"]["hosts"][0]["value"] == (
            "api.example.com"
        )


# --- The approver as they are when the request is carried out ----------------


def _reviewer(space, label="reviewer"):
    reviewer = add_member(
        space.organisation,
        label,
        permissions={
            "Agents": ACTIONS,
            "AgentConnections": ACTIONS,
            "AgentRequests": ACTIONS,
            "IntegrationCredentials": ACTIONS,
        },
    )
    return reviewer, _assign(space, reviewer)


def _between_check_and_approval(monkeypatch, change):
    """Run ``change`` after the mutation checked its member, before the
    transaction that carries the request out."""

    expire = mutations._expire_pending_request

    def changed_then_expire(*args, **kwargs):
        change()
        return expire(*args, **kwargs)

    monkeypatch.setattr(mutations, "_expire_pending_request", changed_then_expire)


def _setup_request(space):
    pending = AgentConnection(
        organisation=space.organisation,
        name="AWS setup",
        service_type="aws",
        config=get_config_registry().validate_service_config("aws", {}),
        state=AgentConnection.PENDING_CREDENTIALS,
    )
    pending.full_clean()
    pending.save()
    agent_request = AgentRequest(
        organisation=space.organisation,
        workflow=space.workflow,
        connection=pending,
        kind=AgentRequest.SETUP,
        service_type="aws",
        credential_provider="aws",
        credential_name="AWS setup",
        markdown="Connect this Workflow to AWS.",
        progress={"stage": "awaiting_credentials"},
    )
    agent_request.full_clean()
    agent_request.save()
    credential = ProviderCredentials.objects.create(
        organisation=space.organisation,
        provider="aws",
        name="AWS deploy",
        credentials={},
    )
    return agent_request, pending, credential


def _fulfil(member, agent_request, credential):
    return FulfillAgentRequestMutation.mutate(
        None,
        info(member),
        request_id=agent_request.id,
        expected_revision=str(agent_request.revision),
        credential_id=credential.id,
        expected_credential_revision=str(credential.revision),
    )


def test_a_reviewer_removed_before_a_setup_is_fulfilled_grants_nothing(
    space, monkeypatch
):
    reviewer, membership = _reviewer(space)
    agent_request, pending, credential = _setup_request(space)
    _between_check_and_approval(
        monkeypatch, lambda: AgentMembership.objects.get(pk=membership.pk).delete()
    )

    with pytest.raises(GraphQLError, match="permission to update this Workflow"):
        _fulfil(reviewer, agent_request, credential)

    assert _status(agent_request) == AgentRequest.PENDING
    assert not AgentWorkflowGrant.objects.filter(connection=pending).exists()
    pending.refresh_from_db()
    assert pending.authentication_id is None


def test_a_reviewer_still_assigned_fulfils_the_setup(space):
    reviewer, _ = _reviewer(space)
    agent_request, pending, credential = _setup_request(space)

    _fulfil(reviewer, agent_request, credential)

    assert _status(agent_request) == AgentRequest.APPROVED
    assert AgentWorkflowGrant.objects.active().filter(connection=pending).exists()


def test_a_reviewer_removed_before_an_approval_changes_nothing(space, monkeypatch):
    reviewer, membership = _reviewer(space)
    connection = custom_connection(space)
    granted = grant(space, connection)
    agent_request = _removal(space, connection)
    _between_check_and_approval(
        monkeypatch, lambda: AgentMembership.objects.get(pk=membership.pk).delete()
    )

    with pytest.raises(GraphQLError, match="permission to update this Workflow"):
        approve(space, agent_request, info(reviewer))

    assert _status(agent_request) == AgentRequest.PENDING
    assert AgentWorkflowGrant.objects.active().filter(id=granted.id).exists()


def test_a_reviewer_whose_role_lost_request_rights_changes_nothing(space, monkeypatch):
    reviewer, _ = _reviewer(space)
    connection = custom_connection(space)
    granted = grant(space, connection)
    agent_request = _removal(space, connection)
    reader = Role.objects.create(
        organisation=space.organisation,
        name="Requests read only",
        permissions={
            "permissions": {
                "Agents": ACTIONS,
                "AgentConnections": ACTIONS,
                "AgentRequests": ["read"],
            },
            "agent_permissions": {"AgentWorkflows": ACTIONS},
        },
    )
    _between_check_and_approval(
        monkeypatch,
        lambda: OrganisationMember.objects.filter(pk=reviewer.pk).update(role=reader),
    )

    with pytest.raises(GraphQLError, match="permission to update AgentRequests"):
        approve(space, agent_request, info(reviewer))

    assert _status(agent_request) == AgentRequest.PENDING
    assert AgentWorkflowGrant.objects.active().filter(id=granted.id).exists()


# --- A member granting a Connection directly --------------------------------


def _between_check_and_grant(monkeypatch, change):
    """Run ``change`` once the grant mutation checked its member, before the
    transaction that makes the grant."""

    real = mutations.require_role
    changed = []

    def checked_then_changed(member, action, resource):
        real(member, action, resource)
        if (action, resource) == ("read", "AgentConnections") and not changed:
            changed.append(True)
            change()

    monkeypatch.setattr(mutations, "require_role", checked_then_changed)


def _grant_editor(space):
    editor = add_member(
        space.organisation,
        "grant-editor",
        permissions={"Agents": ["read"], "AgentConnections": ["read"]},
        agent_permissions={"AgentWorkflows": ["read", "update"]},
    )
    return editor, _assign(space, editor)


def _grant(member, space, connection):
    return GrantAgentWorkflowMutation.mutate(
        None, info(member), workflow_id=space.workflow.id, connection_id=connection.id
    )


def test_a_member_removed_before_a_grant_is_made_grants_nothing(space, monkeypatch):
    editor, membership = _grant_editor(space)
    connection = custom_connection(space)
    _between_check_and_grant(
        monkeypatch, lambda: AgentMembership.objects.get(pk=membership.pk).delete()
    )

    with pytest.raises(GraphQLError, match="permission to update this Workflow"):
        _grant(editor, space, connection)

    assert not AgentWorkflowGrant.objects.filter(connection=connection).exists()


def test_a_member_whose_role_lost_connection_read_grants_nothing(space, monkeypatch):
    editor, _ = _grant_editor(space)
    connection = custom_connection(space)
    workflows_only = Role.objects.create(
        organisation=space.organisation,
        name="Workflows only",
        permissions={
            "permissions": {"Agents": ["read"]},
            "agent_permissions": {"AgentWorkflows": ["read", "update"]},
        },
    )
    _between_check_and_grant(
        monkeypatch,
        lambda: OrganisationMember.objects.filter(pk=editor.pk).update(
            role=workflows_only
        ),
    )

    with pytest.raises(GraphQLError, match="permission to read AgentConnections"):
        _grant(editor, space, connection)

    assert not AgentWorkflowGrant.objects.filter(connection=connection).exists()


def test_a_member_still_assigned_makes_the_grant(space):
    editor, _ = _grant_editor(space)
    connection = custom_connection(space)

    _grant(editor, space, connection)

    assert AgentWorkflowGrant.objects.active().filter(connection=connection).exists()


# --- Minting an Agent token -------------------------------------------------


_MINTER_PERMISSIONS = {
    "AgentWorkflows": ["read"],
    "AgentSessions": ["create", "read"],
    "AgentTokens": ["create", "read"],
}


def test_a_member_whose_role_lost_token_creation_mints_no_token(space):
    minter = add_member(
        space.organisation,
        "minter",
        permissions={"Agents": ["read"]},
        agent_permissions=_MINTER_PERMISSIONS,
    )
    _assign(space, minter)
    # The member as the caller checked them.
    checked = OrganisationMember.objects.select_related("role").get(pk=minter.pk)
    mint_agent_token(
        agent=space.agent, workflow=space.workflow, name="before", created_by=checked
    )
    # Still able to open sessions, no longer to create tokens.
    sessions_only = Role.objects.create(
        organisation=space.organisation,
        name="Sessions only",
        permissions={
            "permissions": {"Agents": ["read"]},
            "agent_permissions": {**_MINTER_PERMISSIONS, "AgentTokens": ["read"]},
        },
    )
    OrganisationMember.objects.filter(pk=minter.pk).update(role=sessions_only)

    with pytest.raises(ValueError, match="no longer have permission to create"):
        mint_agent_token(
            agent=space.agent, workflow=space.workflow, name="after", created_by=checked
        )

    assert list(
        AgentToken.objects.filter(created_by=minter).values_list("name", flat=True)
    ) == ["before"]


def _cli_client(member):
    """A client authenticated with the member's Personal Access Token."""

    token_value = random_hex(32)
    UserToken.objects.create(
        user=member,
        name="cli",
        identity_key="00" * 32,
        token=token_value,
        wrapped_key_share="00",
    )
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer User {token_value}")
    return client


def _changed_during_mint(monkeypatch, change):
    """Run ``change`` after the token view checked the member, before minting."""

    real = management.mint_agent_token

    def changed_then_minted(**kwargs):
        change()
        return real(**kwargs)

    monkeypatch.setattr(management, "mint_agent_token", changed_then_minted)


def _cli_mint(space, member):
    return _cli_client(member).post(
        f"/v1/agents/{space.agent.id}/tokens/",
        {"workflowId": str(space.workflow.id), "name": "cli login"},
        format="json",
    )


@pytest.fixture
def minter(space):
    member = add_member(
        space.organisation,
        "cli-minter",
        permissions={"Agents": ["read"]},
        agent_permissions=_MINTER_PERMISSIONS,
    )
    member.membership = _assign(space, member)
    return member


def test_a_cli_mint_refused_for_a_changed_role_is_answered_as_forbidden(
    space, minter, monkeypatch
):
    sessions_only = Role.objects.create(
        organisation=space.organisation,
        name="CLI sessions only",
        permissions={
            "permissions": {"Agents": ["read"]},
            "agent_permissions": {**_MINTER_PERMISSIONS, "AgentTokens": ["read"]},
        },
    )
    _changed_during_mint(
        monkeypatch,
        lambda: OrganisationMember.objects.filter(pk=minter.pk).update(
            role=sessions_only
        ),
    )

    response = _cli_mint(space, minter)

    assert response.status_code == 403, response.content
    error = response.json()["error"]
    assert error["code"] == "agent_token_create_forbidden"
    assert "no longer have permission to create Agent tokens" in error["message"]
    assert not AgentToken.objects.filter(created_by=minter).exists()


def test_a_cli_mint_refused_for_a_removed_assignment_is_answered_as_forbidden(
    space, minter, monkeypatch
):
    _changed_during_mint(
        monkeypatch,
        lambda: AgentWorkflowMembership.objects.filter(
            agent_membership=minter.membership
        ).update(deleted_at=timezone.now()),
    )

    response = _cli_mint(space, minter)

    assert response.status_code == 403, response.content
    error = response.json()["error"]
    assert error["code"] == "agent_token_create_forbidden"
    assert "no longer have access to this Workflow" in error["message"]
    assert not AgentToken.objects.filter(created_by=minter).exists()


def test_a_cli_mint_for_a_workflow_retired_meanwhile_is_still_not_found(
    space, minter, monkeypatch
):
    _changed_during_mint(
        monkeypatch,
        lambda: AgentWorkflow.objects.filter(pk=space.workflow.pk).update(
            deleted_at=timezone.now()
        ),
    )

    response = _cli_mint(space, minter)

    assert response.status_code == 404, response.content
    assert response.json()["error"]["code"] == "workflow_not_found"
