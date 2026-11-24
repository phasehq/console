"""Asking members to review a change request, and which requests are a member's own.

Who can be asked is decided by the checks approving runs, so the tests hold the two together: a
member can be asked exactly when their approval would go through.
"""

from datetime import timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest
from django.db import transaction
from django.utils import timezone
from graphql import GraphQLError

from api.models import (
    Agent,
    AgentRequest,
    AgentRequestReviewer,
    AgentWorkflowMembership,
    AuditEvent,
    CustomUser,
    EnvironmentKey,
    Organisation,
    OrganisationMember,
    Role,
)
from api.utils.agent_request_reviewers import MAX_REVIEWERS, can_approve
from api.utils.agents import create_agent_with_default_workflow
from backend.graphene.agents.mutations import SetAgentRequestReviewersMutation

from .app_secrets import app_connection, lab, member  # noqa: F401
from .custom_connections import (
    add_member,
    agent_client,
    approve,
    ask,
    bearer_definition,
    filed,
    graphql,
    info,
    open_session,
)


def _session(lab, workflow=None, minted_by=None):
    space = lab if minted_by is None else SimpleNamespace(
        organisation=lab.organisation, member=minted_by
    )
    client, _ = agent_client(space, workflow)
    open_session(client, workflow or lab.workflow)
    return client


def _ask_for_app(lab, client=None, **action):
    body = {
        "type": "agent_connection.app_access",
        "version": 1,
        "appId": str(lab.app.id),
        "environments": ["Development", "Staging"],
        "access": "read",
        **action,
    }
    return ask(client or _session(lab), kind="setup", durationSeconds=3600, action=body)


def _managed(lab, label, managed_key="owner"):
    """A member with a managed role and no Agent or Workflow membership."""

    role = Role.objects.create(
        organisation=lab.organisation,
        name=f"{managed_key} {uuid4().hex[:6]}",
        is_default=True,
        managed_key=managed_key,
    )
    user = CustomUser.objects.create_user(
        username=f"reviewers-{label}-{uuid4().hex[:8]}",
        email=f"reviewers-{label}-{uuid4().hex[:8]}@example.com",
    )
    return OrganisationMember.objects.create(
        organisation=lab.organisation, user=user, role=role
    )


def _without(organisation_member, resource, action):
    role = organisation_member.role
    for section in ("permissions", "agent_permissions"):
        if resource in role.permissions.get(section, {}):
            role.permissions[section][resource] = [
                name for name in role.permissions[section][resource] if name != action
            ]
    role.save()
    organisation_member.refresh_from_db()
    return organisation_member


def _read_only(lab, label="read-only"):
    """On the Workflow, but may only read change requests."""

    return _without(member(lab, label), "AgentRequests", "update")


class _Undo(Exception):
    pass


def _approves(lab, agent_request, approver):
    """Whether ``approver``'s approval goes through, tried and then undone."""

    try:
        with transaction.atomic():
            approve(lab, agent_request, info(approver), duration_seconds=1800)
            raise _Undo
    except _Undo:
        return True
    except GraphQLError:
        return False


def _set(asker, agent_request, members):
    return SetAgentRequestReviewersMutation.mutate(
        None,
        info(asker),
        request_id=agent_request.id,
        member_ids=[str(each.id) for each in members],
    )


def _reviewer_ids(agent_request):
    return sorted(
        str(member_id)
        for member_id in AgentRequestReviewer.objects.filter(
            request=agent_request
        ).values_list("member_id", flat=True)
    )


_LIST = """
query Requests($organisationId: ID!, $scope: String) {
  agentRequests(organisationId: $organisationId, scope: $scope) {
    id
    reviewers { member { id } requestedBy { id } }
  }
  agentRequestQueue(organisationId: $organisationId) { pendingCount }
}
"""

_CANDIDATES = """
query Candidates($organisationId: ID!, $requestId: ID!) {
  agentRequestReviewerCandidates(organisationId: $organisationId, requestId: $requestId) {
    id
  }
}
"""


def _listed(lab, viewer, scope=None):
    result = graphql(
        lab, _LIST, member=viewer, organisationId=str(lab.organisation.id), scope=scope
    )
    assert result.errors is None, result.errors
    return result.data


def _ids(data):
    return sorted(item["id"] for item in data["agentRequests"])


# --- Who can be asked --------------------------------------------------------


@pytest.mark.django_db
@pytest.mark.parametrize("access", ["read", "read_write"])
def test_who_can_be_asked_is_exactly_who_can_approve(lab, access):
    agent_request = filed(_ask_for_app(lab, access=access))
    expected = {
        # On the Workflow, with the app and both environments.
        "approver": (lab.approver, True),
        # A role that reaches every Agent, on no Workflow at all.
        "owner": (_managed(lab, "owner"), True),
        # Has the app, but only one of the two environments asked for.
        "partial": (member(lab, "partial", app=lab.app, environments=[lab.dev]), False),
        # May read secrets but not change them: enough for read access only.
        "reads-secrets": (
            member(lab, "reads", app=lab.app, environments=lab.envs, secrets=["read"]),
            access == "read",
        ),
        # Everything, except updating change requests.
        "cannot-update-requests": (_read_only(lab), False),
        # Everything, except creating Connections, which this approval needs.
        "cannot-create-connections": (
            _without(
                member(lab, "no-create", app=lab.app, environments=lab.envs),
                "AgentConnections",
                "create",
            ),
            False,
        ),
        # Every permission, but not on this Workflow.
        "not-on-the-workflow": (add_member(lab.organisation, "outsider"), False),
        # On the Workflow, but may not update Workflows.
        "cannot-update-workflows": (
            _without(
                member(lab, "no-workflow-update", app=lab.app, environments=lab.envs),
                "AgentWorkflows",
                "update",
            ),
            False,
        ),
    }
    for label, (candidate, allowed) in expected.items():
        assert can_approve(candidate, agent_request) is allowed, label
        assert _approves(lab, agent_request, candidate) is allowed, label


@pytest.mark.django_db
def test_a_connection_to_reuse_means_creating_one_is_not_needed(lab):
    app_connection(lab, [lab.dev, lab.staging])
    agent_request = filed(_ask_for_app(lab))
    no_create = _without(
        member(lab, "no-create", app=lab.app, environments=lab.envs),
        "AgentConnections",
        "create",
    )

    assert can_approve(no_create, agent_request) is True
    assert _approves(lab, agent_request, no_create) is True


@pytest.mark.django_db
def test_a_request_fulfilled_with_a_credential_needs_credential_access(lab):
    agent_request = filed(
        ask(
            _session(lab),
            kind="setup",
            serviceType="aws",
            credentialProvider="aws",
            credentialName="AWS deploy",
            markdown="Connect this Workflow to AWS.",
        )
    )

    # Approving it picks an Integration Credential, which these roles cannot read.
    assert can_approve(lab.approver, agent_request) is False
    assert can_approve(_managed(lab, "owner"), agent_request) is True
    assert can_approve(_managed(lab, "developer", "developer"), agent_request) is False


@pytest.mark.django_db
def test_a_new_connection_needs_permission_to_create_connections(lab):
    agent_request = filed(
        ask(
            _session(lab),
            action={
                "type": "agent_connection.create",
                "version": 1,
                "serviceType": "http",
                "name": "Example API",
                "definition": bearer_definition(),
            },
        )
    )
    no_create = _without(member(lab, "no-create"), "AgentConnections", "create")

    assert can_approve(lab.approver, agent_request) is True
    assert can_approve(no_create, agent_request) is False


@pytest.mark.django_db
def test_a_member_who_left_cannot_be_asked(lab):
    agent_request = filed(_ask_for_app(lab))
    gone = member(lab, "gone", app=lab.app, environments=lab.envs)
    OrganisationMember.objects.filter(id=gone.id).update(deleted_at=timezone.now())
    gone.refresh_from_db()

    assert can_approve(gone, agent_request) is False


@pytest.mark.django_db
def test_the_candidates_are_the_members_who_could_approve(lab):
    agent_request = filed(_ask_for_app(lab))
    owner = _managed(lab, "owner")
    member(lab, "partial", app=lab.app, environments=[lab.dev])
    _read_only(lab)
    gone = member(lab, "gone", app=lab.app, environments=lab.envs)
    OrganisationMember.objects.filter(id=gone.id).update(deleted_at=timezone.now())
    # Any member who can read the request can see who could approve it.
    reader = _read_only(lab, "asker")

    result = graphql(
        lab,
        _CANDIDATES,
        member=reader,
        organisationId=str(lab.organisation.id),
        requestId=str(agent_request.id),
    )

    assert result.errors is None, result.errors
    listed = [item["id"] for item in result.data["agentRequestReviewerCandidates"]]
    assert sorted(listed) == sorted([str(lab.approver.id), str(owner.id)])
    emails = {
        str(each.id): each.user.email.lower() for each in (lab.approver, owner)
    }
    assert [emails[each] for each in listed] == sorted(emails.values())


@pytest.mark.django_db
def test_the_candidates_of_a_request_you_cannot_read_are_not_shown(lab):
    agent_request = filed(_ask_for_app(lab))
    outsider = add_member(lab.organisation, "outsider")

    result = graphql(
        lab,
        _CANDIDATES,
        member=outsider,
        organisationId=str(lab.organisation.id),
        requestId=str(agent_request.id),
    )

    assert result.errors[0].message == "Agent request not found"


# --- Asking ------------------------------------------------------------------


@pytest.mark.django_db
def test_a_member_who_can_only_read_can_ask_someone_who_can_approve(lab):
    agent_request = filed(_ask_for_app(lab))
    revision = str(agent_request.revision)
    asker = _read_only(lab, "asker")

    _set(asker, agent_request, [lab.approver])

    reviewer = AgentRequestReviewer.objects.get(request=agent_request)
    assert str(reviewer.member_id) == str(lab.approver.id)
    assert str(reviewer.requested_by_id) == str(asker.id)
    # Asking is not a change to the request: an approval already open still goes through.
    agent_request.refresh_from_db()
    assert str(agent_request.revision) == revision
    audit = AuditEvent.objects.get(
        resource_id=str(agent_request.id),
        description__startswith="Changed who reviews",
    )
    assert audit.resource_metadata["reviewers_added"] == [
        {"id": str(lab.approver.id), "name": lab.approver.user.email}
    ]
    assert audit.resource_metadata["reviewers_removed"] == []


@pytest.mark.django_db
def test_asking_someone_who_cannot_approve_is_refused(lab):
    agent_request = filed(_ask_for_app(lab))
    partial = member(lab, "partial", app=lab.app, environments=[lab.dev])

    with pytest.raises(GraphQLError, match="can't approve this request"):
        _set(lab.approver, agent_request, [lab.approver, partial])

    assert _reviewer_ids(agent_request) == []


@pytest.mark.django_db
def test_the_list_is_replaced_and_someone_asked_earlier_may_stay(lab):
    agent_request = filed(_ask_for_app(lab))
    owner = _managed(lab, "owner")
    asked = member(lab, "asked", app=lab.app, environments=lab.envs)
    _set(lab.approver, agent_request, [asked])
    # They lose an environment after being asked: they stay until taken off.
    EnvironmentKey.objects.filter(user=asked, environment=lab.staging).delete()
    assert can_approve(asked, agent_request) is False

    _set(lab.approver, agent_request, [asked, owner])
    assert _reviewer_ids(agent_request) == sorted([str(asked.id), str(owner.id)])

    _set(lab.approver, agent_request, [owner])
    assert _reviewer_ids(agent_request) == [str(owner.id)]
    with pytest.raises(GraphQLError, match="can't approve this request"):
        _set(lab.approver, agent_request, [owner, asked])

    _set(lab.approver, agent_request, [])
    assert _reviewer_ids(agent_request) == []


@pytest.mark.django_db
def test_repeated_members_count_once_and_the_list_is_capped(lab):
    agent_request = filed(_ask_for_app(lab))
    _set(lab.approver, agent_request, [lab.approver, lab.approver])
    assert _reviewer_ids(agent_request) == [str(lab.approver.id)]

    many = [
        member(lab, f"many-{index}", app=lab.app, environments=lab.envs)
        for index in range(MAX_REVIEWERS + 1)
    ]
    with pytest.raises(GraphQLError, match=f"at most {MAX_REVIEWERS} reviewers"):
        _set(lab.approver, agent_request, many)
    assert _reviewer_ids(agent_request) == [str(lab.approver.id)]


@pytest.mark.django_db
def test_only_members_of_the_organisation_can_be_asked(lab):
    agent_request = filed(_ask_for_app(lab))
    elsewhere = Organisation.objects.create(
        name=f"Elsewhere {uuid4().hex[:8]}", identity_key="00" * 32
    )
    stranger = add_member(elsewhere, "stranger")

    for member_ids in ([str(stranger.id)], ["not-a-member"]):
        with pytest.raises(GraphQLError, match="Member not found"):
            SetAgentRequestReviewersMutation.mutate(
                None,
                info(lab.approver),
                request_id=agent_request.id,
                member_ids=member_ids,
            )
    assert _reviewer_ids(agent_request) == []


@pytest.mark.django_db
def test_only_a_member_who_can_read_the_request_may_ask(lab):
    agent_request = filed(_ask_for_app(lab))
    outsider = add_member(lab.organisation, "outsider")
    no_read = _without(member(lab, "no-read"), "AgentRequests", "read")

    for asker in (outsider, no_read):
        with pytest.raises(GraphQLError, match="permission"):
            _set(asker, agent_request, [lab.approver])
    assert _reviewer_ids(agent_request) == []


@pytest.mark.django_db
def test_reviewers_are_chosen_only_while_the_request_is_pending(lab):
    agent_request = filed(_ask_for_app(lab))
    _set(lab.approver, agent_request, [lab.approver])
    approve(lab, agent_request, lab.approver_info, duration_seconds=1800)

    with pytest.raises(GraphQLError, match="no longer pending"):
        _set(lab.approver, agent_request, [])
    # The record of who was asked stays with the resolved request.
    assert _reviewer_ids(agent_request) == [str(lab.approver.id)]


@pytest.mark.django_db
def test_an_overdue_request_is_expired_instead_of_changed(lab):
    agent_request = filed(_ask_for_app(lab))
    AgentRequest.objects.filter(id=agent_request.id).update(
        expires_at=timezone.now() - timedelta(minutes=1)
    )

    with pytest.raises(GraphQLError, match="expired"):
        _set(lab.approver, agent_request, [lab.approver])
    agent_request.refresh_from_db()
    assert agent_request.status == AgentRequest.EXPIRED


# --- Which requests are yours ------------------------------------------------


@pytest.mark.django_db
def test_your_requests_are_on_your_workflows_your_agents_and_asked_of_you(lab):
    on_lab = filed(_ask_for_app(lab))
    owner = _managed(lab, "owner")
    _, owners_workflow = create_agent_with_default_workflow(
        organisation=lab.organisation,
        name="Owner's Agent",
        harness_type=Agent.OTHER,
        created_by=owner,
    )
    on_owners = filed(_ask_for_app(lab, _session(lab, owners_workflow, owner)))
    admin = _managed(lab, "admin", "admin")

    # A role that reaches every Agent can read every request...
    assert _ids(_listed(lab, owner, "all")) == sorted([str(on_lab.id), str(on_owners.id)])
    assert _ids(_listed(lab, owner)) == _ids(_listed(lab, owner, "all"))
    # ...but only the ones on its own Agents are its own.
    owner_view = _listed(lab, owner, "mine")
    assert _ids(owner_view) == [str(on_owners.id)]
    assert owner_view["agentRequestQueue"]["pendingCount"] == 1
    admin_view = _listed(lab, admin, "mine")
    assert _ids(admin_view) == []
    assert admin_view["agentRequestQueue"]["pendingCount"] == 0
    # A member of a Workflow sees that Workflow's requests and no other Agent's.
    assert _ids(_listed(lab, lab.approver, "mine")) == [str(on_lab.id)]
    assert _ids(_listed(lab, lab.approver, "all")) == [str(on_lab.id)]

    # Asked to review a request, it is theirs too.
    _set(lab.approver, on_lab, [owner, admin])
    owner_view = _listed(lab, owner, "mine")
    assert _ids(owner_view) == sorted([str(on_lab.id), str(on_owners.id)])
    assert owner_view["agentRequestQueue"]["pendingCount"] == 2
    assert _ids(_listed(lab, owner, "review_requested")) == [str(on_lab.id)]
    admin_view = _listed(lab, admin, "mine")
    assert _ids(admin_view) == [str(on_lab.id)]
    assert admin_view["agentRequestQueue"]["pendingCount"] == 1
    assert _ids(_listed(lab, lab.approver, "review_requested")) == []


@pytest.mark.django_db
def test_leaving_a_workflow_takes_its_requests_off_your_list(lab):
    on_lab = filed(_ask_for_app(lab))
    assert _ids(_listed(lab, lab.approver, "mine")) == [str(on_lab.id)]

    AgentWorkflowMembership.objects.filter(
        workflow=lab.workflow, agent_membership__member=lab.approver
    ).update(deleted_at=timezone.now())

    assert _ids(_listed(lab, lab.approver, "mine")) == []
    assert _listed(lab, lab.approver, "mine")["agentRequestQueue"]["pendingCount"] == 0


@pytest.mark.django_db
def test_a_request_lists_its_reviewers_and_who_asked_them(lab):
    agent_request = filed(_ask_for_app(lab))
    owner = _managed(lab, "owner")
    gone = member(lab, "gone", app=lab.app, environments=lab.envs)
    _set(lab.approver, agent_request, [owner, gone])
    OrganisationMember.objects.filter(id=gone.id).update(deleted_at=timezone.now())

    [listed] = _listed(lab, lab.approver, "mine")["agentRequests"]

    # A member who has left is no longer shown.
    assert listed["reviewers"] == [
        {"member": {"id": str(owner.id)}, "requestedBy": {"id": str(lab.approver.id)}}
    ]


@pytest.mark.django_db
def test_an_unknown_scope_is_refused(lab):
    result = graphql(
        lab, _LIST, member=lab.approver, organisationId=str(lab.organisation.id), scope="everyone"
    )

    assert result.errors[0].message == "Unsupported Agent request scope"
