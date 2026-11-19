"""A partial approval grants only the environments the approver can access.

Names of the others are never shown. The rest go into a new pending request.
"""

import json

import pytest
from graphql import GraphQLError

from api.models import AgentRequest
from api.utils.agent_app_access import connection_environments

from .app_secrets import lab, member  # noqa: F401
from .custom_connections import agent_client, approve, ask, filed, graphql, info, open_session


APP = "orders-service"
REQUESTS = """query($org: ID!, $id: ID!) {
  agentRequests(organisationId: $org, requestId: $id) {
    id title markdown status appRestricted hiddenEnvironmentCount actionReview
  }
}"""


def _ids(*environments):
    return [str(environment.id) for environment in environments]


def _covered(connection):
    return _ids(*connection_environments(connection))


def _ask(lab, client, **body):
    return filed(
        ask(
            client,
            kind="setup",
            durationSeconds=3600,
            action={
                "type": "agent_connection.app_access",
                "version": 1,
                "appId": str(lab.app.id),
                "environments": ["Development", "Staging", "Production"],
                "access": "read_write",
            },
            **body,
        )
    )


@pytest.fixture
def scene(lab):
    lab.client, _ = agent_client(lab)
    open_session(lab.client, lab.workflow)
    lab.request = _ask(lab, lab.client, markdown="For the nightly deploy.")
    # Development and Staging, not Production.
    lab.partial = member(lab, "partial", app=lab.app, environments=[lab.dev, lab.staging])
    return lab


def _narrowed(lab, *environments, access="read_write"):
    return {
        "type": "agent_connection.app_access",
        "version": 1,
        "appId": str(lab.app.id),
        "environmentIds": _ids(*environments),
        "access": access,
    }


def _follow_ons(lab):
    return list(AgentRequest.objects.filter(related_request=lab.request))


def _seen(lab, viewer, agent_request):
    result = graphql(
        lab,
        REQUESTS,
        member=viewer,
        org=str(lab.organisation.id),
        id=str(agent_request.id),
    )
    assert result.errors is None, result.errors
    [item] = result.data["agentRequests"]
    return item


@pytest.mark.django_db
def test_a_partial_approval_grants_what_the_approver_can_access(scene):
    lab = scene
    approve(lab, lab.request, info(lab.partial), action=_narrowed(lab, lab.dev, lab.staging))

    lab.request.refresh_from_db()
    assert lab.request.status == AgentRequest.APPROVED
    assert lab.request.applied_action["environmentIds"] == _ids(lab.dev, lab.staging)
    assert _covered(lab.request.connection) == _ids(lab.dev, lab.staging)

    [follow_on] = _follow_ons(lab)
    assert follow_on.status == AgentRequest.PENDING
    assert follow_on.workflow_id == lab.request.workflow_id
    assert follow_on.kind == lab.request.kind
    assert follow_on.action == _narrowed(lab, lab.prod)
    assert follow_on.duration_seconds == 3600
    assert follow_on.markdown == "For the nightly deploy."
    assert follow_on.title == f"Read and write secrets in {APP} (Production)"
    assert follow_on.expires_at is not None
    assert lab.request.resolution["follow_on_request_id"] == str(follow_on.id)


@pytest.mark.django_db
def test_the_agents_own_title_is_kept(lab):
    client, _ = agent_client(lab)
    open_session(client, lab.workflow)
    lab.request = _ask(lab, client, title="Secrets for the nightly deploy")
    partial = member(lab, "partial", app=lab.app, environments=[lab.dev])

    approve(lab, lab.request, info(partial), action=_narrowed(lab, lab.dev))

    [follow_on] = _follow_ons(lab)
    assert follow_on.title == "Secrets for the nightly deploy"
    assert follow_on.action["environmentIds"] == _ids(lab.staging, lab.prod)


@pytest.mark.django_db
def test_an_unticked_environment_is_not_asked_for_again(scene):
    lab = scene
    # Staging is theirs to give and they leave it out.
    approve(lab, lab.request, info(lab.partial), action=_narrowed(lab, lab.dev))

    lab.request.refresh_from_db()
    assert _covered(lab.request.connection) == _ids(lab.dev)
    [follow_on] = _follow_ons(lab)
    assert follow_on.action["environmentIds"] == _ids(lab.prod)


@pytest.mark.django_db
def test_a_member_with_full_access_narrowing_files_nothing(scene):
    lab = scene
    approve(lab, lab.request, lab.approver_info, action=_narrowed(lab, lab.dev))

    lab.request.refresh_from_db()
    assert lab.request.status == AgentRequest.APPROVED
    assert _follow_ons(lab) == []
    assert "follow_on_request_id" not in lab.request.resolution


@pytest.mark.django_db
def test_a_partial_approver_cannot_approve_an_environment_they_cannot_access(scene):
    lab = scene
    for action in (None, _narrowed(lab, lab.dev, lab.prod)):
        arguments = {"action": action} if action else {}
        with pytest.raises(GraphQLError) as refused:
            approve(lab, lab.request, info(lab.partial), **arguments)
        assert "Production" not in str(refused.value)

    lab.request.refresh_from_db()
    assert lab.request.status == AgentRequest.PENDING
    assert _follow_ons(lab) == []


@pytest.mark.django_db
def test_approving_twice_files_one_follow_on(scene):
    lab = scene
    stale = AgentRequest.objects.get(id=lab.request.id)
    action = _narrowed(lab, lab.dev, lab.staging)
    approve(lab, lab.request, info(lab.partial), action=action)

    # The same approval sent again, and one from a second reviewer.
    for reviewer in (info(lab.partial), lab.approver_info):
        with pytest.raises(GraphQLError):
            approve(lab, stale, reviewer, action=action)
        lab.request.refresh_from_db()
        with pytest.raises(GraphQLError):
            approve(lab, lab.request, reviewer, action=action)

    assert len(_follow_ons(lab)) == 1
    assert AgentRequest.objects.filter(workflow=lab.workflow).count() == 2


@pytest.mark.django_db
def test_the_approver_sees_the_follow_on_without_names_and_cannot_approve_it(scene):
    lab = scene
    approve(lab, lab.request, info(lab.partial), action=_narrowed(lab, lab.dev, lab.staging))
    [follow_on] = _follow_ons(lab)

    item = _seen(lab, lab.partial, follow_on)
    assert "Production" not in json.dumps(item)
    assert item["title"] == (
        f"Read and write secrets in {APP} (1 environment you can't access)"
    )
    assert item["appRestricted"] is False
    assert item["hiddenEnvironmentCount"] == 1
    requested = item["actionReview"]["requested"]
    assert requested["app"]["name"] == APP
    assert requested["environments"] == []
    assert requested["hiddenEnvironmentCount"] == 1

    with pytest.raises(GraphQLError) as refused:
        approve(lab, follow_on, info(lab.partial))
    assert "Production" not in str(refused.value)
    follow_on.refresh_from_db()
    assert follow_on.status == AgentRequest.PENDING


@pytest.mark.django_db
def test_a_member_with_full_access_approves_the_follow_on(scene):
    lab = scene
    approve(lab, lab.request, info(lab.partial), action=_narrowed(lab, lab.dev, lab.staging))
    [follow_on] = _follow_ons(lab)

    assert _seen(lab, lab.approver, follow_on)["title"] == (
        f"Read and write secrets in {APP} (Production)"
    )
    approve(lab, follow_on, lab.approver_info)

    follow_on.refresh_from_db()
    assert follow_on.status == AgentRequest.APPROVED
    assert _covered(follow_on.connection) == _ids(lab.prod)
    # Nothing is left over, so nothing more is filed.
    assert AgentRequest.objects.filter(related_request=follow_on).count() == 0
    assert "follow_on_request_id" not in follow_on.resolution


@pytest.mark.django_db
def test_the_agent_can_tell_part_is_granted_and_part_still_waits(scene):
    lab = scene
    approve(lab, lab.request, info(lab.partial), action=_narrowed(lab, lab.dev, lab.staging))
    [follow_on] = _follow_ons(lab)

    polled = lab.client.get(f"/v1/agents/requests/{lab.request.id}/").json()
    assert polled["status"] == "approved"
    assert polled["appliedAction"]["environmentIds"] == _ids(lab.dev, lab.staging)
    assert polled["resolution"]["followOnRequestId"] == str(follow_on.id)

    waiting = lab.client.get(f"/v1/agents/requests/{follow_on.id}/").json()
    assert waiting["status"] == "pending"
    assert waiting["relatedRequestId"] == str(lab.request.id)
    assert waiting["action"]["environmentIds"] == _ids(lab.prod)
    assert waiting["durationSeconds"] == 3600
    assert waiting["approvalUrl"]
