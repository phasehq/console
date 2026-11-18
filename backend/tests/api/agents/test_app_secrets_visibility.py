"""A member sees an app's name, and each environment's, only when they can
access it themselves.

The Connection or request stays listed with the name withheld, so a reviewer
knows something is there that they cannot act on. Approving and granting stay
refused for them as before.
"""

import json
from datetime import timedelta
from types import SimpleNamespace

import pytest
from django.utils import timezone
from graphql import GraphQLError

from api.models import AgentEvent
from api.utils.agent_app_access import connection_name
from backend.graphene.agents.mutations import GrantAgentWorkflowMutation
from backend.graphene.agents.queries import resolve_app_agent_access
from backend.graphene.agents.types import AgentEventType

from .app_secrets import (
    app_connection,
    grant_app,
    lab,  # noqa: F401
    member,
    secrets_url,
    token_client,
)
from .custom_connections import agent_client, approve, ask, filed, graphql, info, open_session


APP = "orders-service"
QUERY = """query($org: ID!, $workflow: ID!) {
  agentConnections(organisationId: $org) {
    id name appRestricted hiddenEnvironmentCount
    app { name } environments { name }
  }
  agentWorkflows(organisationId: $org, workflowId: $workflow) {
    expiredConnections
    grants {
      appRestricted hiddenEnvironmentCount
      app { name } environments { name } connection { name }
    }
  }
  agentRequests(organisationId: $org) {
    id title credentialName markdown appRestricted hiddenEnvironmentCount
    actionReview connection { name }
  }
}"""


@pytest.fixture
def scene(lab):
    """A granted Connection on Development and Staging, an expired one on
    Development and Production, an app access request, an allow request, and
    an Agent's call to each of Development and Staging."""

    covered = [lab.dev, lab.staging]
    connection = app_connection(lab, covered, name=connection_name(lab.app, covered))
    grant_app(lab, connection)
    lapsed_envs = [lab.dev, lab.prod]
    lapsed = app_connection(lab, lapsed_envs, name=connection_name(lab.app, lapsed_envs))
    grant_app(lab, lapsed, expires_at=timezone.now() - timedelta(hours=1))

    client, _ = agent_client(lab)
    open_session(client, lab.workflow)
    app_access = filed(
        ask(
            client,
            kind="setup",
            durationSeconds=3600,
            markdown=f"I need the {APP} Staging values.",
            action={
                "type": "agent_connection.app_access",
                "version": 1,
                "appId": str(lab.app.id),
                "environments": ["Development", "Staging"],
                "access": "read",
            },
        )
    )
    allow = filed(
        ask(
            client,
            kind="access_change",
            durationSeconds=900,
            action={
                "type": "agent_grant.allow",
                "version": 1,
                "connectionId": str(connection.id),
                "allow": {"classes": ["create"]},
            },
        )
    )
    token = token_client(lab)
    for name in ("Development", "Staging"):
        assert token.get(secrets_url(lab.app, name)).status_code == 200
    return SimpleNamespace(
        lab=lab,
        connection=connection,
        lapsed=lapsed,
        app_access=app_access,
        allow=allow,
        viewers={
            "none": member(lab, "none"),
            "partial": member(lab, "partial", app=lab.app, environments=[lab.dev]),
            "full": lab.approver,
            "owner": member(lab, "owner", managed_key="owner"),
        },
    )


def _screens(scene, viewer):
    lab = scene.lab
    result = graphql(
        lab,
        QUERY,
        member=scene.viewers[viewer],
        org=str(lab.organisation.id),
        workflow=str(lab.workflow.id),
    )
    assert result.errors is None, result.errors
    return result.data


def _by_id(items, value):
    return next(item for item in items if item["id"] == str(value))


def _event_details(scene, viewer):
    viewer_info = info(scene.viewers[viewer])
    return [
        AgentEventType.resolve_detail(event, viewer_info)
        for event in AgentEvent.objects.filter(workflow=scene.lab.workflow).order_by(
            "ingest_seq"
        )
    ]


@pytest.mark.django_db
def test_a_member_without_app_access_sees_no_app_or_environment_name(scene):
    data = _screens(scene, "none")
    text = json.dumps(data)
    for name in (APP, "Development", "Staging", "Production"):
        assert name.lower() not in text.lower(), name

    connection = _by_id(data["agentConnections"], scene.connection.id)
    assert connection["app"] is None
    assert connection["appRestricted"] is True
    assert connection["environments"] == []
    assert connection["hiddenEnvironmentCount"] == 2
    assert connection["name"] == "App secrets"

    [workflow] = data["agentWorkflows"]
    [grant] = workflow["grants"]
    assert grant["app"] is None and grant["appRestricted"] is True
    assert grant["environments"] == [] and grant["hiddenEnvironmentCount"] == 2
    [expired] = workflow["expiredConnections"]
    assert expired["connectionName"] == "App secrets"

    app_access = _by_id(data["agentRequests"], scene.app_access.id)
    assert app_access["title"] == "Read secrets in an app you can't access"
    assert app_access["appRestricted"] is True
    assert app_access["hiddenEnvironmentCount"] == 2
    assert app_access["credentialName"] == "App secrets"
    assert app_access["markdown"].startswith("Not shown")
    requested = app_access["actionReview"]["requested"]
    assert requested["app"] is None and requested["appRestricted"] is True
    assert requested["environments"] == [] and requested["hiddenEnvironmentCount"] == 2

    allow = _by_id(data["agentRequests"], scene.allow.id)
    assert allow["title"] == (
        "Allow create secrets on a Connection to an app you can't access"
    )
    assert allow["connection"]["name"] == "App secrets"
    current = allow["actionReview"]["current"]
    assert current["app"] is None and current["appRestricted"] is True
    assert current["hiddenEnvironmentCount"] == 2

    for detail in _event_details(scene, "none"):
        assert detail["app_name"] is None and detail["app_restricted"] is True
        assert detail["environment_name"] is None
        assert detail["environment_restricted"] is True


@pytest.mark.django_db
def test_a_member_with_some_environments_sees_only_those(scene):
    data = _screens(scene, "partial")
    text = json.dumps(data)
    assert APP in text and "Development" in text
    for name in ("Staging", "Production"):
        assert name not in text, name

    connection = _by_id(data["agentConnections"], scene.connection.id)
    assert connection["app"] == {"name": APP}
    assert connection["appRestricted"] is False
    assert connection["environments"] == [{"name": "Development"}]
    assert connection["hiddenEnvironmentCount"] == 1
    assert connection["name"] == f"{APP} secrets"

    [workflow] = data["agentWorkflows"]
    [grant] = workflow["grants"]
    assert grant["environments"] == [{"name": "Development"}]
    assert grant["hiddenEnvironmentCount"] == 1
    assert workflow["expiredConnections"][0]["connectionName"] == f"{APP} secrets"

    app_access = _by_id(data["agentRequests"], scene.app_access.id)
    assert app_access["title"] == f"Read secrets in {APP} (Development and 1 more)"
    assert app_access["appRestricted"] is False
    assert app_access["hiddenEnvironmentCount"] == 1
    assert app_access["credentialName"] == APP
    assert app_access["markdown"].startswith("Not shown")
    requested = app_access["actionReview"]["requested"]
    assert requested["app"]["name"] == APP
    assert [env["name"] for env in requested["environments"]] == ["Development"]
    assert requested["hiddenEnvironmentCount"] == 1

    allow = _by_id(data["agentRequests"], scene.allow.id)
    assert allow["title"] == f"Allow create secrets on {APP} secrets"
    assert allow["actionReview"]["current"]["hiddenEnvironmentCount"] == 1

    details = _event_details(scene, "partial")
    assert [detail["environment_name"] for detail in details] == ["Development", None]
    assert all(detail["app_name"] == APP for detail in details)

    rows = resolve_app_agent_access(
        None, info(scene.viewers["partial"]), str(scene.lab.app.id)
    )
    [row] = rows
    assert [env.name for env in row["environments"]] == ["Development"]
    assert row["hidden_environment_count"] == 1
    assert row["connection"]["name"] == f"{APP} secrets"


@pytest.mark.parametrize("viewer", ["full", "owner"])
@pytest.mark.django_db
def test_members_with_access_see_every_name(scene, viewer):
    data = _screens(scene, viewer)

    connection = _by_id(data["agentConnections"], scene.connection.id)
    assert connection["name"] == scene.connection.name
    assert connection["app"] == {"name": APP}
    assert connection["appRestricted"] is False
    assert [env["name"] for env in connection["environments"]] == [
        "Development",
        "Staging",
    ]
    assert connection["hiddenEnvironmentCount"] == 0

    [workflow] = data["agentWorkflows"]
    assert workflow["grants"][0]["hiddenEnvironmentCount"] == 0
    assert workflow["expiredConnections"][0]["connectionName"] == scene.lapsed.name

    app_access = _by_id(data["agentRequests"], scene.app_access.id)
    assert app_access["title"] == scene.app_access.title
    assert app_access["title"] == f"Read secrets in {APP} (Development, Staging)"
    assert app_access["markdown"] == scene.app_access.markdown
    assert app_access["credentialName"] == APP
    assert app_access["appRestricted"] is False
    assert app_access["hiddenEnvironmentCount"] == 0
    allow = _by_id(data["agentRequests"], scene.allow.id)
    assert allow["title"] == f"Allow create secrets on {scene.connection.name}"

    details = _event_details(scene, viewer)
    assert [detail["environment_name"] for detail in details] == [
        "Development",
        "Staging",
    ]
    assert not any("app_restricted" in detail for detail in details)
    if viewer == "full":
        # appAgentAccess needs app membership itself, whatever the role.
        rows = resolve_app_agent_access(
            None, info(scene.viewers[viewer]), str(scene.lab.app.id)
        )
        assert rows[0]["hidden_environment_count"] == 0


@pytest.mark.parametrize("viewer", ["none", "partial"])
@pytest.mark.django_db
def test_approving_and_granting_stay_refused(scene, viewer):
    viewer_info = info(scene.viewers[viewer])
    for agent_request in (scene.app_access, scene.allow):
        with pytest.raises(GraphQLError) as refused:
            approve(scene.lab, agent_request, viewer_info)
        # The refusal names nothing the member cannot see.
        for name in ("Staging", "Production"):
            assert name not in str(refused.value)
        if viewer == "none":
            assert APP not in str(refused.value)
    with pytest.raises(GraphQLError):
        GrantAgentWorkflowMutation.mutate(
            None,
            viewer_info,
            workflow_id=scene.lab.workflow.id,
            connection_id=scene.lapsed.id,
        )


@pytest.mark.django_db
def test_stored_titles_keep_every_name(scene):
    # Only what a member is shown changes; what is stored keeps the names.
    scene.app_access.refresh_from_db()
    assert scene.app_access.title == f"Read secrets in {APP} (Development, Staging)"
    assert scene.app_access.credential_name == APP
