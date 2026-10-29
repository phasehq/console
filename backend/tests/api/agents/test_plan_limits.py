"""Plan limits on Agents and on Workflows per Agent.

Free Cloud: 3 Agents. Free self-hosted: unlimited Agents. Pro and Enterprise
(Cloud or self-hosted): unlimited Agents. Workflows per Agent: Free 3, Pro 10,
Enterprise unlimited.
"""

import importlib.util

import pytest
from django.test import RequestFactory, override_settings
from rest_framework.test import APIClient

import backend.quotas as quotas
from api.models import (
    Agent,
    AgentWorkflow,
    CustomUser,
    Organisation,
    OrganisationMember,
    Role,
    UserToken,
)
from api.utils.agents import (
    AgentPlanLimitReached,
    create_agent_with_default_workflow,
    create_agent_workflow,
)
from api.utils.crypto import random_hex
from backend.schema import schema


def _organisation(plan=Organisation.FREE_PLAN, name="Agent limits org"):
    return Organisation.objects.create(name=name, identity_key="00" * 32, plan=plan)


def _owner(organisation, suffix="owner"):
    role = Role.objects.create(
        name="Owner",
        organisation=organisation,
        is_default=True,
        managed_key="owner",
    )
    user = CustomUser.objects.create_user(
        username=f"agent-limits-{suffix}", email=f"agent-limits-{suffix}@example.com"
    )
    return OrganisationMember.objects.create(
        user=user, organisation=organisation, role=role
    )


def _agent(organisation, member, name="Agent"):
    agent, _ = create_agent_with_default_workflow(
        organisation=organisation,
        name=name,
        harness_type=Agent.OTHER,
        created_by=member,
    )
    return agent


def _execute(query, member, variables):
    request = RequestFactory().post("/graphql/")
    request.user = member.user
    return schema.execute(query, variables=variables, context_value=request)


@pytest.fixture
def free_cloud_limits(monkeypatch):
    monkeypatch.setitem(quotas.PLAN_CONFIG["FR"], "max_agents", 3)


@pytest.fixture
def free_self_hosted_limits(monkeypatch):
    monkeypatch.setitem(quotas.PLAN_CONFIG["FR"], "max_agents", None)


@pytest.mark.parametrize(
    "app_host, expected",
    [
        ("cloud", {"FR": (3, 3), "PR": (None, 10), "EN": (None, None)}),
        ("self", {"FR": (None, 3), "PR": (None, 10), "EN": (None, None)}),
    ],
)
def test_plan_config_limits_by_hosting_mode(app_host, expected):
    # Load a separate copy: reloading backend.quotas would leave modules that
    # imported PLAN_CONFIG holding the old dict.
    spec = importlib.util.find_spec("backend.quotas")
    module = importlib.util.module_from_spec(spec)
    with override_settings(APP_HOST=app_host):
        spec.loader.exec_module(module)

    assert {
        plan: (
            module.PLAN_CONFIG[plan]["max_agents"],
            module.PLAN_CONFIG[plan]["max_workflows_per_agent"],
        )
        for plan in expected
    } == expected


@pytest.mark.django_db
def test_free_cloud_organisation_is_limited_to_three_agents(free_cloud_limits):
    organisation = _organisation()
    owner = _owner(organisation)
    agents = [_agent(organisation, owner, f"Agent {i}") for i in range(3)]

    with pytest.raises(
        AgentPlanLimitReached, match="The Free plan is limited to 3 Agents."
    ):
        _agent(organisation, owner, "One too many")
    assert Agent.objects.filter(organisation=organisation).count() == 3
    assert not AgentWorkflow.objects.filter(agent__name="One too many").exists()

    # Disabled Agents still count; deleted ones do not.
    agents[0].status = Agent.DISABLED
    agents[0].save(update_fields=["status"])
    assert quotas.can_add_agent(organisation) is False
    agents[1].delete()
    assert quotas.can_add_agent(organisation) is True
    _agent(organisation, owner, "Replacement")


@pytest.mark.django_db
def test_agent_limit_is_per_organisation(free_cloud_limits):
    organisation = _organisation()
    owner = _owner(organisation)
    for i in range(3):
        _agent(organisation, owner, f"Agent {i}")
    other = _organisation(name="Other org")

    _agent(other, _owner(other, "other-owner"), "Elsewhere")


@pytest.mark.django_db
@pytest.mark.parametrize("plan", [Organisation.PRO_PLAN, Organisation.ENTERPRISE_PLAN])
def test_paid_plans_have_no_agent_limit(free_cloud_limits, plan):
    organisation = _organisation(plan=plan)
    owner = _owner(organisation)

    for i in range(5):
        _agent(organisation, owner, f"Agent {i}")

    assert quotas.can_add_agent(organisation) is True


@pytest.mark.django_db
def test_free_self_hosted_has_no_agent_limit(free_self_hosted_limits):
    organisation = _organisation()
    owner = _owner(organisation)

    for i in range(5):
        _agent(organisation, owner, f"Agent {i}")

    assert quotas.can_add_agent(organisation) is True


@pytest.mark.django_db
@pytest.mark.parametrize(
    "plan, limit, name",
    [
        (Organisation.FREE_PLAN, 3, "Free"),
        (Organisation.PRO_PLAN, 10, "Pro"),
    ],
)
def test_workflows_per_agent_follow_the_plan(plan, limit, name):
    organisation = _organisation(plan=plan)
    owner = _owner(organisation)
    agent = _agent(organisation, owner)
    other_agent = _agent(organisation, owner, "Other Agent")

    # The default Workflow counts towards the limit.
    workflows = [
        create_agent_workflow(agent=agent, name=f"Workflow {i}", created_by=owner)
        for i in range(limit - 1)
    ]
    with pytest.raises(
        AgentPlanLimitReached,
        match=f"The {name} plan is limited to {limit} Workflows per Agent.",
    ):
        create_agent_workflow(agent=agent, name="One too many", created_by=owner)
    assert AgentWorkflow.objects.filter(agent=agent).count() == limit

    # The limit is per Agent, and deleted Workflows free a slot.
    create_agent_workflow(agent=other_agent, name="Elsewhere", created_by=owner)
    workflows[0].delete()
    create_agent_workflow(agent=agent, name="Replacement", created_by=owner)


@pytest.mark.django_db
def test_enterprise_has_no_workflow_limit():
    organisation = _organisation(plan=Organisation.ENTERPRISE_PLAN)
    owner = _owner(organisation)
    agent = _agent(organisation, owner)

    for i in range(12):
        create_agent_workflow(agent=agent, name=f"Workflow {i}", created_by=owner)

    assert AgentWorkflow.objects.filter(agent=agent).count() == 13


@pytest.mark.django_db
def test_graphql_mutations_report_the_plan_limit(free_cloud_limits):
    organisation = _organisation()
    owner = _owner(organisation)
    agent = _agent(organisation, owner)
    for i in range(2):
        create_agent_workflow(agent=agent, name=f"Workflow {i}", created_by=owner)
    for i in range(2):
        _agent(organisation, owner, f"Agent {i}")

    created = _execute(
        """
        mutation($organisationId: ID!) {
          createAgent(organisationId: $organisationId, name: "Over", harnessType: "other") {
            agent { id }
          }
        }
        """,
        owner,
        {"organisationId": str(organisation.id)},
    )
    workflow = _execute(
        """
        mutation($agentId: ID!) {
          createAgentWorkflow(agentId: $agentId, name: "Over") { workflow { id } }
        }
        """,
        owner,
        {"agentId": str(agent.id)},
    )

    assert [error.message for error in created.errors] == [
        "The Free plan is limited to 3 Agents."
    ]
    assert [error.message for error in workflow.errors] == [
        "The Free plan is limited to 3 Workflows per Agent."
    ]
    assert Agent.objects.filter(organisation=organisation).count() == 3


@pytest.mark.django_db
def test_rest_agent_creation_reports_the_plan_limit(free_cloud_limits):
    organisation = _organisation()
    owner = _owner(organisation)
    for i in range(3):
        _agent(organisation, owner, f"Agent {i}")
    token_value = random_hex(32)
    UserToken.objects.create(
        user=owner,
        name="cli",
        identity_key="00" * 32,
        token=token_value,
        wrapped_key_share="00",
    )
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer User {token_value}")

    response = client.post(
        "/v1/agents/", {"name": "Over", "harnessType": "other"}, format="json"
    )

    assert response.status_code == 403, response.content
    assert response.json()["error"]["code"] == "agent_plan_limit_reached"
    assert response.json()["error"]["message"] == "The Free plan is limited to 3 Agents."
    assert Agent.objects.filter(organisation=organisation).count() == 3


@pytest.mark.django_db
def test_plan_query_reports_agent_limits_and_counts(free_cloud_limits):
    organisation = _organisation()
    owner = _owner(organisation)
    agent = _agent(organisation, owner)
    _agent(organisation, owner, "Second").delete()
    create_agent_workflow(agent=agent, name="Second", created_by=owner)
    create_agent_workflow(agent=agent, name="Third", created_by=owner).delete()

    result = _execute(
        """
        query($organisationId: ID!) {
          organisationPlan(organisationId: $organisationId) {
            maxAgents
            maxWorkflowsPerAgent
            agentCount
          }
          organisations { planDetail { maxAgents maxWorkflowsPerAgent } }
          agents(organisationId: $organisationId) { workflowCount }
        }
        """,
        owner,
        {"organisationId": str(organisation.id)},
    )

    assert result.errors is None, result.errors
    assert result.data["organisationPlan"] == {
        "maxAgents": 3,
        "maxWorkflowsPerAgent": 3,
        "agentCount": 1,
    }
    assert result.data["organisations"] == [
        {"planDetail": {"maxAgents": 3, "maxWorkflowsPerAgent": 3}}
    ]
    assert result.data["agents"] == [{"workflowCount": 2}]
