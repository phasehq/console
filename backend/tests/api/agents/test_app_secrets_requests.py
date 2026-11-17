"""Asking for an app's secrets, and who may give them.

A member may never give an Agent secrets they cannot reach themselves: every
path that creates, widens, grants or approves app access checks the member's
access to the app and its environments and their ``Secrets`` permissions.
"""

from datetime import timedelta

import pytest
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from graphql import GraphQLError

from api.models import AgentConnection, AgentRequest, AgentWorkflowGrant
from api.utils.agent_app_access import DEFAULT_POLICY, connection_environments
from api.utils.agent_config import APP_SERVICE_TYPE
from backend.graphene.agents.mutations import (
    CreateAgentAppConnectionMutation,
    GrantAgentWorkflowMutation,
    SetAgentConnectionPolicyMutation,
    UpdateAgentAppConnectionMutation,
)

from .app_secrets import (
    app_connection,
    grant_app,
    lab,  # noqa: F401
    member,
    put_secret,
    secrets_url,
    sse_app,
    token_client,
)
from .custom_connections import (
    agent_client,
    approve,
    ask,
    filed,
    graphql,
    info,
    open_session,
    refused,
    session_get,
)


def _ids(environments):
    return [str(environment.id) for environment in environments]


def _session(lab):
    client, _ = agent_client(lab)
    open_session(client, lab.workflow)
    return client


def _app_access(lab, client=None, **action):
    body = {
        "type": "agent_connection.app_access",
        "version": 1,
        "appId": str(lab.app.id),
        "environments": ["development", "Staging"],
        "access": "read",
        **action,
    }
    return ask(client or _session(lab), kind="setup", durationSeconds=3600, action=body)


# --- Filing ------------------------------------------------------------------


@pytest.mark.django_db
def test_a_request_is_stored_in_canonical_form(lab):
    client = _session(lab)
    body = {
        "type": "agent_connection.app_access",
        "version": 1,
        "appName": "ORDERS-SERVICE",
        "environments": ["staging", str(lab.dev.id)],
        "access": "read_write",
    }

    agent_request = filed(ask(client, kind="setup", durationSeconds=3600, action=body))

    assert agent_request.kind == AgentRequest.SETUP
    assert agent_request.action == {
        "type": "agent_connection.app_access",
        "version": 1,
        "appId": str(lab.app.id),
        "environmentIds": [str(lab.dev.id), str(lab.staging.id)],
        "access": "read_write",
    }
    assert agent_request.service_type == APP_SERVICE_TYPE
    assert agent_request.title == (
        "Read and write secrets in orders-service (Development, Staging)"
    )
    assert agent_request.duration_seconds == 3600
    for word in ("propos",):
        assert word not in agent_request.title.lower()


@pytest.mark.django_db
def test_describe_shows_the_app_environments_and_access(lab):
    agent_request = filed(_app_access(lab))

    review = graphql(
        lab,
        """query($org: ID!, $id: ID!) {
            agentRequests(organisationId: $org, requestId: $id) { actionReview }
        }""",
        member=lab.approver,
        org=str(lab.organisation.id),
        id=str(agent_request.id),
    )

    assert review.errors is None, review.errors
    [item] = review.data["agentRequests"]
    requested = item["actionReview"]["requested"]
    assert item["actionReview"]["title"] == "Read secrets in orders-service (Development, Staging)"
    assert requested["app"] == {"id": str(lab.app.id), "name": "orders-service", "sseEnabled": True}
    assert [env["name"] for env in requested["environments"]] == ["Development", "Staging"]
    assert requested["access"] == "read"
    assert item["actionReview"]["current"] is None


@pytest.mark.django_db
@pytest.mark.parametrize(
    "action,status,code",
    [
        ({"appId": "00000000-0000-0000-0000-000000000000"}, 404, "app_not_found"),
        ({"environments": ["qa"]}, 404, "environment_not_found"),
        ({"environments": ["Development", "development"]}, 400, "invalid_app_access"),
        ({"environments": [f"env-{index}" for index in range(21)]}, 400, "too_many_environments"),
        ({"access": "admin"}, 400, "invalid_request_action"),
        ({"environments": []}, 400, "invalid_app_access"),
    ],
)
def test_bad_requests_are_refused_at_filing(lab, action, status, code):
    refused(_app_access(lab, **action), code, status)


@pytest.mark.django_db
def test_an_app_without_sse_is_refused_with_a_message_to_pass_on(lab):
    sse_app(lab, name="plain", environments=["Development"], sse=False)

    error = refused(
        _app_access(lab, appId=None, appName="plain", environments=["Development"]),
        "sse_required",
    )

    assert error["message"] == (
        "This app does not have server-side encryption enabled, which Agent "
        "access needs. A member can enable it in the app's settings."
    )


@pytest.mark.django_db
def test_an_ambiguous_app_name_is_refused(lab):
    sse_app(lab, name="Orders-Service", environments=["Development"])

    refused(
        _app_access(lab, appId=None, appName="orders-service"), "app_name_ambiguous"
    )


# --- Approval ----------------------------------------------------------------


@pytest.mark.django_db
def test_approval_creates_a_connection_and_grants_it(lab):
    put_secret(lab.dev, "K", "v")
    agent_request = filed(_app_access(lab))

    result = approve(lab, agent_request, lab.approver_info, duration_seconds=1800)

    assert result.runtime_action == "retry"
    agent_request.refresh_from_db()
    connection = agent_request.connection
    assert connection.service_type == APP_SERVICE_TYPE
    assert connection.name == "orders-service secrets (Development, Staging)"
    assert connection.policy == DEFAULT_POLICY
    assert connection.authentication_id is None
    assert connection.state == AgentConnection.ACTIVE
    assert _ids(connection_environments(connection)) == _ids([lab.dev, lab.staging])
    grant = agent_request.grant
    assert grant.is_active
    assert abs((grant.expires_at - timezone.now()).total_seconds() - 1800) < 60
    assert grant.temporary_allows == []
    assert agent_request.applied_action["access"] == "read"
    assert agent_request.applied_action["accessRecord"]["grantedDurationSeconds"] == 1800
    assert agent_request.applied_action["accessRecord"]["requestedDurationSeconds"] == 3600
    response = token_client(lab).get(secrets_url(lab.app, "Development"))
    assert response.status_code == 200, response.content


@pytest.mark.django_db
def test_the_request_payload_reports_what_was_granted(lab):
    client = _session(lab)
    agent_request = filed(_app_access(lab, client))
    approve(lab, agent_request, lab.approver_info)

    response = client.get(f"/v1/agents/requests/{agent_request.id}/")

    assert response.status_code == 200, response.content
    body = response.json()
    assert body["status"] == "approved"
    assert body["access"]["grantedDurationSeconds"] == 3600
    assert body["appliedAction"]["access"] == "read"
    assert body["runtimeAction"] == "retry"


@pytest.mark.django_db
def test_a_reviewer_may_narrow_environments_and_change_access(lab):
    agent_request = filed(_app_access(lab))

    approve(
        lab,
        agent_request,
        lab.approver_info,
        action={
            "type": "agent_connection.app_access",
            "version": 1,
            "appId": str(lab.app.id),
            "environmentIds": [str(lab.staging.id)],
            "access": "read_write",
        },
        inputs={"writeDurationSeconds": 600},
    )

    agent_request.refresh_from_db()
    assert agent_request.action["environmentIds"] == [str(lab.dev.id), str(lab.staging.id)]
    assert agent_request.applied_action["environmentIds"] == [str(lab.staging.id)]
    assert agent_request.applied_action["access"] == "read_write"
    assert _ids(connection_environments(agent_request.connection)) == _ids([lab.staging])
    allows = agent_request.grant.temporary_allows
    assert sorted(allow["class"] for allow in allows) == ["create", "delete", "update"]
    ends = {allow["expiresAt"] for allow in allows}
    assert len(ends) == 1
    until = parse_datetime(ends.pop())
    assert abs((until - timezone.now()).total_seconds() - 600) < 60
    assert agent_request.applied_action["writeAccess"]["grantedDurationSeconds"] == 600


@pytest.mark.django_db
def test_a_reviewer_may_not_widen_the_request(lab):
    agent_request = filed(_app_access(lab))

    with pytest.raises(GraphQLError, match="only narrow"):
        approve(
            lab,
            agent_request,
            lab.approver_info,
            action={
                "type": "agent_connection.app_access",
                "version": 1,
                "appId": str(lab.app.id),
                "environmentIds": [str(lab.dev.id), str(lab.prod.id)],
                "access": "read",
            },
        )


@pytest.mark.django_db
def test_write_access_ends_with_its_own_duration_and_never_after_the_grant(lab):
    agent_request = filed(_app_access(lab, access="read_write"))

    approve(
        lab,
        agent_request,
        lab.approver_info,
        duration_seconds=900,
        inputs={"writeDurationSeconds": 3600},
    )

    agent_request.refresh_from_db()
    grant = agent_request.grant
    ends = [parse_datetime(allow["expiresAt"]) for allow in grant.temporary_allows]
    assert len(ends) == 3
    assert all(abs((end - grant.expires_at).total_seconds()) < 1 for end in ends)
    client = token_client(lab)
    created = client.post(
        secrets_url(lab.app, "Staging"),
        {"secrets": [{"key": "NEW", "value": "v"}]},
        format="json",
    )
    assert created.status_code == 200, created.content


@pytest.mark.django_db
@pytest.mark.parametrize("value", [10, 10**9, "600", True])
def test_write_duration_is_checked(lab, value):
    agent_request = filed(_app_access(lab, access="read_write"))

    with pytest.raises(GraphQLError, match="writeDurationSeconds"):
        approve(lab, agent_request, lab.approver_info, inputs={"writeDurationSeconds": value})


@pytest.mark.django_db
def test_an_identical_connection_is_reused(lab):
    existing = app_connection(lab, [lab.staging, lab.dev], name="Orders dev and staging")
    app_connection(lab, [lab.dev], name="Orders dev only")
    agent_request = filed(_app_access(lab))

    approve(lab, agent_request, lab.approver_info)

    agent_request.refresh_from_db()
    assert str(agent_request.connection_id) == str(existing.id)
    assert AgentConnection.objects.filter(service_type=APP_SERVICE_TYPE).count() == 2


def _review(lab, agent_request):
    review = graphql(
        lab,
        """query($org: ID!, $id: ID!) {
            agentRequests(organisationId: $org, requestId: $id) { actionReview }
        }""",
        member=lab.approver,
        org=str(lab.organisation.id),
        id=str(agent_request.id),
    )
    assert review.errors is None, review.errors
    return review.data["agentRequests"][0]["actionReview"]


@pytest.mark.django_db
def test_the_review_names_the_connection_approval_reuses(lab):
    existing = app_connection(lab, [lab.staging, lab.dev], name="Orders dev and staging")
    agent_request = filed(_app_access(lab))

    current = _review(lab, agent_request)["current"]

    assert current["connectionId"] == str(existing.id)
    assert current["name"] == "Orders dev and staging"
    assert current["policy"] == DEFAULT_POLICY


@pytest.mark.django_db
def test_default_rules_in_another_order_are_reused(lab):
    reordered = {**DEFAULT_POLICY, "rules": list(reversed(DEFAULT_POLICY["rules"]))}
    existing = app_connection(lab, [lab.dev, lab.staging], policy=reordered)
    agent_request = filed(_app_access(lab))

    assert _review(lab, agent_request)["current"]["connectionId"] == str(existing.id)
    approve(lab, agent_request, lab.approver_info)

    agent_request.refresh_from_db()
    assert str(agent_request.connection_id) == str(existing.id)


NON_DEFAULT_POLICIES = {
    "allows_writes": {"version": 1, "default": "allow", "rules": []},
    "asks_on_read": {
        "version": 1,
        "default": "ask",
        "rules": [],
    },
    "blocks_a_class": {
        "version": 1,
        "default": "allow",
        "rules": [
            {"class": "create", "effect": "ask"},
            {"class": "update", "effect": "ask"},
            {"class": "delete", "effect": "block"},
        ],
    },
    "blocks_reads": {
        "version": 1,
        "default": "allow",
        "rules": [
            {"class": "read", "effect": "block"},
            {"class": "create", "effect": "ask"},
            {"class": "update", "effect": "ask"},
            {"class": "delete", "effect": "ask"},
        ],
    },
}


@pytest.mark.django_db
@pytest.mark.parametrize("access", ["read", "read_write"])
@pytest.mark.parametrize("label", sorted(NON_DEFAULT_POLICIES))
def test_a_connection_with_other_rules_is_not_reused(lab, label, access):
    existing = app_connection(
        lab, [lab.dev, lab.staging], name="Orders", policy=NON_DEFAULT_POLICIES[label]
    )
    put_secret(lab.dev, "K", "v")
    agent_request = filed(_app_access(lab, access=access))

    assert _review(lab, agent_request)["current"] is None
    approve(lab, agent_request, lab.approver_info)

    agent_request.refresh_from_db()
    connection = agent_request.connection
    assert str(connection.id) != str(existing.id)
    assert connection.policy == DEFAULT_POLICY
    assert connection.name == "orders-service secrets (Development, Staging)"
    assert _ids(connection_environments(connection)) == _ids([lab.dev, lab.staging])
    existing.refresh_from_db()
    assert existing.policy == NON_DEFAULT_POLICIES[label]
    assert not AgentWorkflowGrant.objects.filter(connection=existing).exists()
    # The Agent gets exactly the level asked for.
    allows = agent_request.grant.temporary_allows
    if access == "read":
        assert allows == []
    else:
        assert sorted(allow["class"] for allow in allows) == ["create", "delete", "update"]
    client = token_client(lab)
    assert client.get(secrets_url(lab.app, "Development")).status_code == 200
    created = client.post(
        secrets_url(lab.app, "Development"),
        {"secrets": [{"key": "NEW", "value": "v"}]},
        format="json",
    )
    assert created.status_code == (200 if access == "read_write" else 403), created.content


@pytest.mark.django_db
def test_new_connection_names_stay_unique(lab):
    base = "orders-service secrets (Development, Staging)"
    allows_writes = NON_DEFAULT_POLICIES["allows_writes"]
    app_connection(lab, [lab.dev, lab.staging], name=base, policy=allows_writes)
    app_connection(lab, [lab.dev, lab.staging], name=f"{base} 2", policy=allows_writes)
    # A name in another case is taken too.
    app_connection(lab, [lab.dev], name=f"{base.upper()} 3")

    agent_request = filed(_app_access(lab))
    approve(lab, agent_request, lab.approver_info)
    agent_request.refresh_from_db()
    assert agent_request.connection.name == f"{base} 4"

    # Once its rules change, the next approval creates another.
    AgentConnection.objects.filter(pk=agent_request.connection_id).update(
        policy=allows_writes
    )
    second = filed(_app_access(lab))
    approve(lab, second, lab.approver_info)
    second.refresh_from_db()
    assert second.connection.name == f"{base} 5"
    names = list(
        AgentConnection.objects.filter(organisation=lab.organisation).values_list(
            "name", flat=True
        )
    )
    assert len({name.lower() for name in names}) == len(names)


@pytest.mark.django_db
def test_a_long_connection_name_stays_within_the_limit_with_a_number(lab):
    from api.utils.agent_app_access import connection_name

    long_app, environments = sse_app(
        lab, name="a" * 64, environments=[f"environment-{index}-" + "e" * 50 for index in range(3)]
    )
    first = connection_name(long_app, environments)
    assert len(first) == 255 and first.endswith("…")
    app_connection(lab, environments, app=long_app, name=first)

    second = connection_name(long_app, environments)

    assert len(second) == 255
    assert second.endswith("… 2")
    assert second[:200] == first[:200]


@pytest.mark.django_db
def test_an_approval_extends_an_existing_grant_and_never_shortens_write_access(lab):
    connection = app_connection(lab, [lab.dev, lab.staging])
    grant = grant_app(lab, connection, allows=["create"], allow_seconds=7200)
    before = grant.temporary_allows[0]["expiresAt"]
    agent_request = filed(_app_access(lab, access="read_write"))

    approve(lab, agent_request, lab.approver_info, inputs={"writeDurationSeconds": 600})

    grant.refresh_from_db()
    by_class = {allow["class"]: allow["expiresAt"] for allow in grant.temporary_allows}
    assert by_class["create"] == before
    assert set(by_class) == {"create", "update", "delete"}
    assert AgentWorkflowGrant.objects.filter(workflow=lab.workflow).count() == 1


# --- agent_grant.allow with classes, and renew --------------------------------


def _allow(lab, connection, allow, client=None):
    return ask(
        client or _session(lab),
        kind="access_change",
        durationSeconds=900,
        action={
            "type": "agent_grant.allow",
            "version": 1,
            "connectionId": str(connection.id),
            "allow": allow,
        },
    )


@pytest.mark.django_db
def test_an_allow_for_several_classes_adds_one_entry_each(lab):
    connection = app_connection(lab, [lab.dev], name="Orders dev")
    grant_app(lab, connection)
    agent_request = filed(_allow(lab, connection, {"classes": ["delete", "create", "update"]}))
    assert agent_request.action["allow"] == {"classes": ["create", "update", "delete"]}
    assert agent_request.title == "Allow create, update and delete secrets on Orders dev"

    approve(lab, agent_request, lab.approver_info)

    grant = AgentWorkflowGrant.objects.get(workflow=lab.workflow)
    allows = grant.temporary_allows
    assert sorted(allow["class"] for allow in allows) == ["create", "delete", "update"]
    assert len({allow["expiresAt"] for allow in allows}) == 1
    created = token_client(lab).post(
        secrets_url(lab.app, "Development"),
        {"secrets": [{"key": "NEW", "value": "v"}]},
        format="json",
    )
    assert created.status_code == 200, created.content


@pytest.mark.django_db
@pytest.mark.parametrize(
    "allow",
    [
        {"match": {"methods": ["POST"]}},
        {"operation": "ec2:RunInstances"},
        {"classes": []},
        {"classes": ["admin"]},
        {"classes": ["create", "create"]},
        {"class": "create", "classes": ["update"]},
    ],
)
def test_an_allow_on_an_app_connection_takes_classes_only(lab, allow):
    connection = app_connection(lab, [lab.dev])
    grant_app(lab, connection)

    refused(_allow(lab, connection, allow), "invalid_access_allow")


@pytest.mark.django_db
def test_an_allow_for_a_blocked_class_is_refused(lab):
    connection = app_connection(
        lab,
        [lab.dev],
        policy={
            "version": 1,
            "default": "allow",
            "rules": [{"class": "delete", "effect": "block"}],
        },
    )
    grant_app(lab, connection)

    error = refused(
        _allow(lab, connection, {"classes": ["create", "delete"]}),
        "access_policy_blocks_allow",
    )
    assert "delete" in error["message"]


@pytest.mark.django_db
def test_classes_are_for_app_connections_only(lab):
    from .custom_connections import custom_connection, grant as grant_custom

    connection = custom_connection(lab)
    grant_custom(lab, connection)

    refused(_allow(lab, connection, {"classes": ["create"]}), "invalid_access_allow")


@pytest.mark.django_db
def test_renew_gives_back_an_expired_app_grant(lab):
    connection = app_connection(lab, [lab.dev])
    grant_app(lab, connection, expires_at=timezone.now() - timedelta(minutes=1))
    agent_request = filed(
        ask(
            _session(lab),
            kind="access_change",
            durationSeconds=900,
            action={"type": "agent_grant.renew", "version": 1, "connectionId": str(connection.id)},
        )
    )

    approve(lab, agent_request, lab.approver_info)

    response = token_client(lab).get(secrets_url(lab.app, "Development"))
    assert response.status_code == 200, response.content


# --- Who may give access: section 2 on every path ---------------------------------


def _outsiders(lab):
    """Members with every organisation permission who still cannot give this
    app's secrets: no app access, no environment access, no Secrets write."""

    return {
        "no app access": member(lab, "no-app"),
        "no environment access": member(lab, "no-env", app=lab.app, environments=[lab.dev]),
        "no secrets permission": member(
            lab, "no-perm", app=lab.app, environments=lab.envs, secrets=[]
        ),
    }


@pytest.mark.django_db
def test_create_needs_the_member_to_reach_the_app_and_environments(lab):
    for label, outsider in _outsiders(lab).items():
        with pytest.raises(GraphQLError):
            CreateAgentAppConnectionMutation.mutate(
                None,
                info(outsider),
                organisation_id=lab.organisation.id,
                name=f"Orders {label}",
                app_id=lab.app.id,
                environment_ids=[lab.dev.id, lab.staging.id],
            )
    assert not AgentConnection.objects.filter(service_type=APP_SERVICE_TYPE).exists()

    created = CreateAgentAppConnectionMutation.mutate(
        None,
        lab.approver_info,
        organisation_id=lab.organisation.id,
        name="Orders",
        app_id=lab.app.id,
        environment_ids=[lab.staging.id, lab.dev.id],
    ).connection
    assert created.policy == DEFAULT_POLICY
    assert _ids(connection_environments(created)) == _ids([lab.dev, lab.staging])


@pytest.mark.django_db
def test_allowing_writes_outright_needs_secrets_write_permission(lab):
    reader = member(
        lab, "reader", app=lab.app, environments=lab.envs, secrets=["read"]
    )
    allow_all = {"version": 1, "default": "allow", "rules": []}

    with pytest.raises(GraphQLError, match="create secrets"):
        CreateAgentAppConnectionMutation.mutate(
            None,
            info(reader),
            organisation_id=lab.organisation.id,
            name="Orders",
            app_id=lab.app.id,
            environment_ids=[lab.dev.id],
            policy=allow_all,
        )
    # Reads allowed and writes asking is within what the reader may give.
    connection = CreateAgentAppConnectionMutation.mutate(
        None,
        info(reader),
        organisation_id=lab.organisation.id,
        name="Orders",
        app_id=lab.app.id,
        environment_ids=[lab.dev.id],
    ).connection
    with pytest.raises(GraphQLError, match="create secrets"):
        SetAgentConnectionPolicyMutation.mutate(
            None, info(reader), connection_id=connection.id, policy=allow_all
        )
    # Tightening needs nothing beyond the organisation permission.
    blocked = {"version": 1, "default": "block", "rules": []}
    SetAgentConnectionPolicyMutation.mutate(
        None, info(member(lab, "no-app-tightens")), connection_id=connection.id, policy=blocked
    )
    connection.refresh_from_db()
    assert connection.policy == blocked


@pytest.mark.django_db
def test_create_refuses_non_sse_apps_and_foreign_environments(lab):
    plain, [plain_env] = sse_app(lab, name="plain", environments=["Development"], sse=False)
    other, [other_env] = sse_app(lab, name="other", environments=["Development"])
    owner = member(lab, "owner", managed_key="owner")

    with pytest.raises(GraphQLError, match="server-side encryption"):
        CreateAgentAppConnectionMutation.mutate(
            None, info(owner), organisation_id=lab.organisation.id, name="x",
            app_id=plain.id, environment_ids=[plain_env.id],
        )
    with pytest.raises(GraphQLError, match="no environment"):
        CreateAgentAppConnectionMutation.mutate(
            None, info(owner), organisation_id=lab.organisation.id, name="x",
            app_id=lab.app.id, environment_ids=[other_env.id],
        )
    with pytest.raises(GraphQLError, match="at least one"):
        CreateAgentAppConnectionMutation.mutate(
            None, info(owner), organisation_id=lab.organisation.id, name="x",
            app_id=lab.app.id, environment_ids=[],
        )
    with pytest.raises(GraphQLError, match="Rules|rules"):
        CreateAgentAppConnectionMutation.mutate(
            None, info(owner), organisation_id=lab.organisation.id, name="x",
            app_id=lab.app.id, environment_ids=[lab.dev.id],
            policy={"version": 1, "default": "allow", "rules": [{"class": "admin", "effect": "block"}]},
        )


@pytest.mark.django_db
def test_a_global_access_member_may_give_any_environment(lab):
    owner = member(lab, "owner", managed_key="owner")

    connection = CreateAgentAppConnectionMutation.mutate(
        None,
        info(owner),
        organisation_id=lab.organisation.id,
        name="Orders",
        app_id=lab.app.id,
        environment_ids=[lab.prod.id],
        policy={"version": 1, "default": "allow", "rules": []},
    ).connection

    assert _ids(connection_environments(connection)) == _ids([lab.prod])


@pytest.mark.django_db
def test_adding_an_environment_needs_access_to_it(lab):
    connection = app_connection(lab, [lab.dev])
    grant = grant_app(lab, connection)
    limited = member(lab, "limited", app=lab.app, environments=[lab.dev, lab.staging])

    with pytest.raises(GraphQLError, match="Production"):
        UpdateAgentAppConnectionMutation.mutate(
            None, info(limited), connection_id=connection.id,
            environment_ids=[lab.dev.id, lab.prod.id],
        )
    updated = UpdateAgentAppConnectionMutation.mutate(
        None, info(limited), connection_id=connection.id,
        environment_ids=[lab.dev.id, lab.staging.id], name="Orders dev+staging",
    ).connection
    assert _ids(connection_environments(updated)) == _ids([lab.dev, lab.staging])
    assert updated.name == "Orders dev+staging"
    # The grant is untouched, and takes effect on the next call.
    grant.refresh_from_db()
    assert grant.is_active
    put_secret(lab.staging, "K", "v")
    client = token_client(lab)
    assert client.get(secrets_url(lab.app, "Staging")).status_code == 200
    # Removing an environment needs no access to it.
    UpdateAgentAppConnectionMutation.mutate(
        None, info(member(lab, "no-app-removes")), connection_id=connection.id,
        environment_ids=[lab.dev.id],
    )
    assert client.get(secrets_url(lab.app, "Staging")).status_code == 403


@pytest.mark.django_db
def test_granting_needs_the_member_to_reach_the_app(lab):
    connection = app_connection(lab, [lab.dev, lab.staging])
    for outsider in _outsiders(lab).values():
        if outsider.role.permissions["app_permissions"]["Secrets"] == []:
            expected = "read secrets"
        else:
            expected = "access"
        with pytest.raises(GraphQLError, match=expected):
            GrantAgentWorkflowMutation.mutate(
                None, info(outsider), workflow_id=lab.workflow.id, connection_id=connection.id
            )
    assert not AgentWorkflowGrant.objects.filter(workflow=lab.workflow).exists()

    grant = GrantAgentWorkflowMutation.mutate(
        None, lab.approver_info, workflow_id=lab.workflow.id, connection_id=connection.id
    ).grant
    assert grant.is_active


@pytest.mark.django_db
def test_approving_app_access_needs_the_member_to_reach_it(lab):
    outsiders = _outsiders(lab)
    agent_request = filed(_app_access(lab))
    for outsider in outsiders.values():
        with pytest.raises(GraphQLError, match="access to|read secrets"):
            approve(lab, agent_request, info(outsider))
        agent_request.refresh_from_db()
        assert agent_request.status == AgentRequest.PENDING
    assert not AgentConnection.objects.filter(service_type=APP_SERVICE_TYPE).exists()


@pytest.mark.django_db
def test_approving_write_access_needs_secrets_write_permission(lab):
    reader = member(lab, "reader", app=lab.app, environments=lab.envs, secrets=["read"])
    agent_request = filed(_app_access(lab, access="read_write"))

    with pytest.raises(GraphQLError, match="create secrets"):
        approve(lab, agent_request, info(reader))

    agent_request.refresh_from_db()
    approve(lab, agent_request, info(reader), action={**agent_request.action, "access": "read"})
    agent_request.refresh_from_db()
    assert agent_request.status == AgentRequest.APPROVED
    assert agent_request.grant.temporary_allows == []


@pytest.mark.django_db
def test_approving_an_allow_or_a_renewal_needs_the_member_to_reach_the_app(lab):
    connection = app_connection(lab, [lab.dev])
    grant_app(lab, connection, expires_at=timezone.now() + timedelta(minutes=30))
    client = _session(lab)
    allow = filed(_allow(lab, connection, {"classes": ["create"]}, client))
    renew = filed(
        ask(
            client,
            kind="access_change",
            durationSeconds=900,
            action={"type": "agent_grant.renew", "version": 1, "connectionId": str(connection.id)},
        )
    )
    no_write = member(lab, "no-write", app=lab.app, environments=lab.envs, secrets=["read"])
    no_env = member(lab, "no-env-2", app=lab.app)

    for agent_request in (allow, renew):
        with pytest.raises(GraphQLError, match="access to the environment"):
            approve(lab, agent_request, info(no_env))
    with pytest.raises(GraphQLError, match="create secrets"):
        approve(lab, allow, info(no_write))
    # Renewing gives back reads only, which the reader may give.
    approve(lab, renew, info(no_write))
    approve(lab, allow, lab.approver_info)


# --- Sessions and context ------------------------------------------------------


@pytest.mark.django_db
def test_a_session_opens_for_a_workflow_with_only_an_app_connection(lab):
    connection = app_connection(lab, [lab.dev], name="Orders dev")
    grant_app(lab, connection)
    client, _ = agent_client(lab)

    opened = open_session(client, lab.workflow)

    assert opened["connections"] == []
    [entry] = opened["appConnections"]
    assert entry["connectionId"] == str(connection.id)
    assert entry["access"]["read"] == {"effect": "allow"}
    for endpoint in ("config", "discover"):
        body = session_get(client, opened, endpoint)
        assert body["connections"] == []
        assert [item["connectionId"] for item in body["appConnections"]] == [str(connection.id)]
    context = session_get(client, opened, "context")["markdown"]
    assert "### App secrets" in context
    assert "orders-service" in context and str(lab.app.id) in context
    assert "Development" in context
    assert "phase secrets list|get|create|update|delete|import|export" in context
    assert "phase run" in context and "--env" in context
    assert "propos" not in context.lower()


@pytest.mark.django_db
def test_expired_app_grants_are_listed_with_the_other_expired_connections(lab):
    connection = app_connection(lab, [lab.dev], name="Orders dev")
    grant_app(lab, connection, expires_at=timezone.now() - timedelta(minutes=1))
    client, _ = agent_client(lab)

    opened = open_session(client, lab.workflow)

    assert opened["appConnections"] == []
    for body in (opened, session_get(client, opened, "config"), session_get(client, opened, "discover")):
        [expired] = body["expiredConnections"]
        assert expired["connectionId"] == str(connection.id)
        assert expired["serviceType"] == "phase_app"


@pytest.mark.django_db
def test_ready_requests_from_refusals_can_be_filed_as_they_are(lab):
    connection = app_connection(lab, [lab.staging], name="Orders staging")
    grant_app(lab, connection)
    tokens = token_client(lab)
    session = _session(lab)

    missing = tokens.get(secrets_url(lab.app, "Development")).json()["request"]
    ask_body = tokens.post(
        secrets_url(lab.app, "Staging"),
        {"secrets": [{"key": "K", "value": "v"}]},
        format="json",
    ).json()["request"]

    for body in (missing, ask_body):
        assert len(body["title"]) <= 120
        filed(ask(session, **body))


@pytest.mark.django_db
def test_app_connections_sit_beside_proxy_connections(lab):
    from .custom_connections import custom_connection, grant as grant_custom

    custom = custom_connection(lab)
    grant_custom(lab, custom)
    grant_app(lab, app_connection(lab, [lab.dev]))
    client, _ = agent_client(lab)

    opened = open_session(client, lab.workflow)

    assert [item["connectionId"] for item in opened["connections"]] == [str(custom.id)]
    assert len(opened["appConnections"]) == 1
    assert session_get(client, opened, "config")["appConnections"]


@pytest.mark.django_db
def test_an_app_connection_whose_app_lost_sse_never_fails_a_session(lab):
    grant_app(lab, app_connection(lab, [lab.dev]))
    lab.app.sse_enabled = False
    lab.app.save()
    client, _ = agent_client(lab)

    opened = open_session(client, lab.workflow)

    assert opened["connections"] == []


# --- GraphQL for the UI -----------------------------------------------------------


@pytest.mark.django_db
def test_graphql_exposes_app_connections_and_their_grants(lab):
    connection = app_connection(lab, [lab.dev, lab.staging], name="Orders")
    grant_app(lab, connection, allows=["update"])

    result = graphql(
        lab,
        """query($org: ID!, $workflow: ID!) {
            agentConnections(organisationId: $org) {
                id serviceType takesPolicy managedPolicies policy
                app { id name sseEnabled }
                environments { id name envType }
            }
            agentWorkflows(organisationId: $org, workflowId: $workflow) {
                grants {
                    id temporaryAllows access
                    app { name } environments { name }
                }
            }
        }""",
        member=lab.approver,
        org=str(lab.organisation.id),
        workflow=str(lab.workflow.id),
    )

    assert result.errors is None, result.errors
    [listed] = result.data["agentConnections"]
    assert listed["serviceType"] == "phase_app"
    assert listed["takesPolicy"] is True
    assert listed["managedPolicies"] == []
    assert listed["policy"] == DEFAULT_POLICY
    assert listed["app"] == {"id": str(lab.app.id), "name": "orders-service", "sseEnabled": True}
    assert listed["environments"] == [
        {"id": str(lab.dev.id), "name": "Development", "envType": "dev"},
        {"id": str(lab.staging.id), "name": "Staging", "envType": "staging"},
    ]
    [workflow] = result.data["agentWorkflows"]
    [grant] = workflow["grants"]
    assert grant["app"] == {"name": "orders-service"}
    assert [env["name"] for env in grant["environments"]] == ["Development", "Staging"]
    assert grant["access"]["update"]["effect"] == "allow"
    assert grant["access"]["update"]["until"]
    assert grant["access"]["create"] == {"effect": "ask"}


@pytest.mark.django_db
def test_graphql_mutations_for_app_connections(lab):
    created = graphql(
        lab,
        """mutation($org: ID!, $app: ID!, $envs: [ID!]!) {
            createAgentAppConnection(
                organisationId: $org, name: "Orders", appId: $app, environmentIds: $envs
            ) { connection { id serviceType environments { name } } }
        }""",
        member=lab.approver,
        org=str(lab.organisation.id),
        app=str(lab.app.id),
        envs=[str(lab.dev.id)],
    )
    assert created.errors is None, created.errors
    connection_id = created.data["createAgentAppConnection"]["connection"]["id"]

    updated = graphql(
        lab,
        """mutation($id: ID!, $envs: [ID!]) {
            updateAgentAppConnection(connectionId: $id, environmentIds: $envs) {
                connection { environments { name } }
            }
        }""",
        member=lab.approver,
        id=connection_id,
        envs=[str(lab.dev.id), str(lab.prod.id)],
    )
    assert updated.errors is None, updated.errors
    assert [env["name"] for env in updated.data["updateAgentAppConnection"]["connection"]["environments"]] == [
        "Development",
        "Production",
    ]

    policy = graphql(
        lab,
        """mutation($id: ID!, $policy: GenericScalar) {
            setAgentConnectionPolicy(connectionId: $id, policy: $policy) { connection { policy } }
        }""",
        member=lab.approver,
        id=connection_id,
        policy={"version": 1, "default": "allow", "rules": [{"match": {"methods": ["GET"]}, "effect": "block"}]},
    )
    assert policy.errors and "read, create, update or delete" in str(policy.errors[0])

    granted = graphql(
        lab,
        """mutation($workflow: ID!, $id: ID!) {
            grantAgentWorkflow(workflowId: $workflow, connectionId: $id) { grant { id access } }
        }""",
        member=lab.approver,
        workflow=str(lab.workflow.id),
        id=connection_id,
    )
    assert granted.errors is None, granted.errors

    deleted = graphql(
        lab,
        """mutation($id: ID!) { deleteAgentConnection(connectionId: $id) { ok } }""",
        member=lab.approver,
        id=connection_id,
    )
    assert deleted.errors is None, deleted.errors
    assert not AgentWorkflowGrant.objects.active().filter(workflow=lab.workflow).exists()
    from rest_framework import status

    assert token_client(lab).get(secrets_url(lab.app, "Development")).status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.django_db
def test_packaged_connection_mutations_point_to_the_app_ones(lab):
    connection = app_connection(lab, [lab.dev])
    owner = member(lab, "owner", managed_key="owner")

    created = graphql(
        lab,
        """mutation($org: ID!) {
            createAgentConnection(organisationId: $org, name: "x", serviceType: "phase_app", authenticationId: "none") { connection { id } }
        }""",
        member=owner,
        org=str(lab.organisation.id),
    )
    assert "createAgentAppConnection" in str(created.errors[0])
    updated = graphql(
        lab,
        """mutation($id: ID!) { updateAgentConnection(connectionId: $id, name: "y") { connection { id } } }""",
        member=owner,
        id=str(connection.id),
    )
    assert "updateAgentAppConnection" in str(updated.errors[0])


@pytest.mark.django_db
def test_app_agent_access_lists_each_workflow_with_access(lab):
    connection = app_connection(lab, [lab.dev], name="Orders dev")
    expires = timezone.now() + timedelta(hours=2)
    grant = grant_app(lab, connection, expires_at=expires)
    query = """query($app: ID!) {
        appAgentAccess(appId: $app) {
            id agent { id name } workflow { id name } connection { id name }
            environments { name envType } access expiresAt
        }
    }"""

    result = graphql(lab, query, member=lab.approver, app=str(lab.app.id))

    assert result.errors is None, result.errors
    [row] = result.data["appAgentAccess"]
    assert row["id"] == str(grant.id)
    assert row["agent"] == {"id": str(lab.agent.id), "name": lab.agent.name}
    assert row["workflow"] == {"id": str(lab.workflow.id), "name": lab.workflow.name}
    assert row["connection"] == {"id": str(connection.id), "name": "Orders dev"}
    assert row["environments"] == [{"name": "Development", "envType": "dev"}]
    assert row["access"]["read"] == {"effect": "allow"}
    assert row["expiresAt"]
    # The same permission as the app's service accounts: app access too.
    outsider = member(lab, "outsider")
    denied = graphql(lab, query, member=outsider, app=str(lab.app.id))
    assert denied.errors and "access to this app" in str(denied.errors[0])


@pytest.mark.django_db
def test_secret_logs_name_the_agent(lab):
    put_secret(lab.dev, "K", "v")
    grant_app(lab, app_connection(lab, [lab.dev]))
    client = token_client(lab)
    assert client.get(secrets_url(lab.app, "Development")).status_code == 200

    result = graphql(
        lab,
        """query($app: ID!, $env: ID!) {
            secretLogs(appId: $app, environmentId: $env) {
                logs { eventType actorDeleted agent { id name harnessType deleted workflow { id name } token { id name } } user { id } }
            }
        }""",
        member=lab.approver,
        app=str(lab.app.id),
        env=str(lab.dev.id),
    )

    assert result.errors is None, result.errors
    [log] = result.data["secretLogs"]["logs"]
    assert log["actorDeleted"] is False
    assert log["user"] is None
    assert log["agent"]["id"] == str(lab.agent.id)
    assert log["agent"]["name"] == lab.agent.name
    assert log["agent"]["workflow"] == {"id": str(lab.workflow.id), "name": lab.workflow.name}
    assert log["agent"]["token"]["id"] == str(client.agent_token.id)
    assert log["agent"]["deleted"] is False


@pytest.mark.django_db
def test_devin_is_no_longer_a_harness(lab):
    from api.models import Agent
    from backend.graphene.agents.mutations import CreateAgentMutation

    assert "devin" not in dict(Agent.HARNESS_CHOICES)
    owner = member(lab, "owner", managed_key="owner")
    with pytest.raises(GraphQLError, match="Unsupported Agent harness type"):
        CreateAgentMutation.mutate(
            None,
            info(owner),
            organisation_id=lab.organisation.id,
            name="Devin",
            harness_type="devin",
        )
