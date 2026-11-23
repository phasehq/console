"""Access policies on a Connection, the secret guard, and a Workflow's allows
for stopped calls."""

from datetime import timedelta

import pytest
from django.test import TestCase
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from graphql import GraphQLError

from api.models import (
    AgentConnection,
    AgentEvent,
    AgentOrganisationSettings,
    AgentRequest,
    AgentWorkflowGrant,
    AuditEvent,
)
from api.utils.agent_access import iso_timestamp
from api.utils.agents import create_agent_workflow
from backend.graphene.agents.mutations import (
    ApproveAgentRequestActionMutation,
    GrantAgentWorkflowMutation,
    RemoveAgentWorkflowGrantAllowMutation,
)
from backend.schema import schema

from .custom_connections import (
    ACTIONS,
    AWS_MATERIAL,
    POLICY_FEATURES,
    SECRET_GUARD,
    add_member,
    agent_client,
    approve,
    ask,
    bearer_definition,
    custom_connection,
    filed,
    generation,
    grant,
    graphql,
    info,
    live_packaged_connection,
    member_client,
    open_session,
    packaged_connection,
    refused,
    session_get,
    set_policy,
    unrestricted_policy,
    use_test_server_keypair,
    workspace,
)


ASK_DELETES = {"version": 1, "default": "allow", "rules": [{"class": "delete", "effect": "ask"}]}
BLOCK_DELETES = {
    "version": 1,
    "default": "allow",
    "rules": [{"class": "delete", "effect": "block"}],
}
DELETE_X = {"match": {"methods": ["DELETE"], "path": "/repos/acme/x"}}


@pytest.fixture(autouse=True)
def server_keypair(monkeypatch):
    use_test_server_keypair(monkeypatch)


@pytest.fixture
def space(db):
    space = workspace("policies")
    space.connection = custom_connection(space, bearer_definition(), name="GitHub")
    space.grant = grant(space, space.connection)
    space.client, space.full_token = agent_client(space)
    space.session = open_session(space.client, space.workflow, features=POLICY_FEATURES)
    return space


def _only(payload):
    [connection] = payload["connections"]
    return connection


_set_policy = set_policy


def _grant_packaged(space, connection):
    """Grant a packaged Connection as a member who may read its Integration
    Credential, which granting it needs."""

    role = space.member.role
    role.permissions["permissions"]["IntegrationCredentials"] = ["read"]
    role.save(update_fields=["permissions"])
    return GrantAgentWorkflowMutation.mutate(
        None, space.info, workflow_id=space.workflow.id, connection_id=connection.id
    )


def _allow_action(space, allow=None, **members):
    return {
        "type": "agent_grant.allow",
        "version": 1,
        "connectionId": str(space.connection.id),
        "allow": DELETE_X if allow is None else allow,
        **members,
    }


BLOCKED_CALL = {
    "method": "DELETE",
    "host": "api.example.com",
    "path": "/repos/acme/x",
    "class": "delete",
}


# The policy in a session payload


def test_a_connection_with_no_policy_gains_only_the_documented_keys(space):
    opened = space.session
    for payload in (
        opened,
        session_get(space.client, opened),
        session_get(space.client, opened, "discover"),
    ):
        connection = _only(payload)
        assert connection["policy"] == unrestricted_policy()
        # A call's class comes from its method, so no list travels with it.
        assert "operationClasses" not in connection
        assert "grantExpiresAt" not in connection
        assert payload["expiredConnections"] == []


def test_a_policy_set_by_a_member_reaches_the_session(space):
    before = generation(space.session)

    stored = _set_policy(space, ASK_DELETES)

    assert stored.policy == ASK_DELETES
    assert AgentConnection.objects.get(id=space.connection.id).policy == ASK_DELETES
    # Changing a policy tells the live sessions to fetch again.
    assert generation(space.session) == before + 1
    for endpoint in ("config", "discover"):
        policy = _only(session_get(space.client, space.session, endpoint))["policy"]
        assert policy == unrestricted_policy(rules=ASK_DELETES["rules"])
    audit = AuditEvent.objects.filter(
        resource_type=AuditEvent.AGENT_CONNECTION,
        resource_id=str(space.connection.id),
        event_type=AuditEvent.UPDATE,
    ).latest("timestamp")
    assert audit.resource_metadata["policy"] == ASK_DELETES
    assert audit.resource_metadata["previous_policy"] == {}
    assert audit.resource_metadata["workflow_ids"] == [str(space.workflow.id)]
    assert "access policy" in audit.description


def test_setting_the_same_policy_again_changes_nothing(space):
    _set_policy(space, ASK_DELETES)
    before = generation(space.session)
    audits = AuditEvent.objects.count()

    _set_policy(space, ASK_DELETES)

    assert generation(space.session) == before
    assert AuditEvent.objects.count() == audits


@pytest.mark.parametrize("cleared", [None, {}, {"version": 1, "default": "allow", "rules": []}])
def test_a_policy_is_cleared_with_an_empty_one(space, cleared):
    _set_policy(space, BLOCK_DELETES)

    assert _set_policy(space, cleared).policy == {}
    assert _only(session_get(space.client, space.session))["policy"] == unrestricted_policy()


def test_a_non_allow_default_is_carried(space):
    _set_policy(space, {"version": 1, "default": "ask"})

    policy = _only(session_get(space.client, space.session))["policy"]
    assert (policy["default"], policy["rules"]) == ("ask", [])


def test_one_policy_holds_every_workflow_granted_the_connection(space):
    """The rules are the Connection's; a temporary allow is one Workflow's."""

    other = create_agent_workflow(
        agent=space.agent, name="Second workflow", created_by=space.member
    )
    other_grant = grant(space, space.connection, other)
    other_client, _ = agent_client(space, other)
    other_session = open_session(other_client, other, features=POLICY_FEATURES)
    ungranted = create_agent_workflow(
        agent=space.agent, name="Third workflow", created_by=space.member
    )
    idle_client, _ = agent_client(space, ungranted)
    idle_session = open_session(idle_client, ungranted, features=POLICY_FEATURES)
    before = [generation(session) for session in (space.session, other_session, idle_session)]

    _set_policy(space, ASK_DELETES)

    # Every Workflow granted the Connection is told to fetch its config again,
    # and no other.
    assert [
        generation(session) for session in (space.session, other_session, idle_session)
    ] == [before[0] + 1, before[1] + 1, before[2]]
    expiry = iso_timestamp(timezone.now() + timedelta(hours=1))
    first_allow = {"id": "first", "class": "delete", "expiresAt": expiry, "requestId": "r-1"}
    second_allow = {"id": "second", **DELETE_X, "expiresAt": expiry, "requestId": "r-2"}
    AgentWorkflowGrant.objects.filter(id=space.grant.id).update(
        temporary_allows=[first_allow]
    )
    AgentWorkflowGrant.objects.filter(id=other_grant.id).update(
        temporary_allows=[second_allow]
    )

    for endpoint in ("config", "discover"):
        first = _only(session_get(space.client, space.session, endpoint))["policy"]
        second = _only(session_get(other_client, other_session, endpoint))["policy"]
        assert first == unrestricted_policy(
            rules=ASK_DELETES["rules"],
            temporaryAllows=[{"id": "first", "class": "delete", "expiresAt": expiry}],
        )
        # The same rules, and only this Workflow's own allow.
        assert second == unrestricted_policy(
            rules=ASK_DELETES["rules"],
            temporaryAllows=[{"id": "second", **DELETE_X, "expiresAt": expiry}],
        )


def test_a_connection_no_workflow_has_takes_a_policy(db):
    space = workspace("ungranted")
    connection = custom_connection(space)

    stored = _set_policy(space, BLOCK_DELETES, connection)

    assert stored.policy == BLOCK_DELETES
    # A Workflow granted it afterwards is held to the policy already there.
    grant(space, connection)
    client = member_client(space)
    opened = open_session(client, space.workflow, features=POLICY_FEATURES)
    assert _only(opened)["policy"] == unrestricted_policy(rules=BLOCK_DELETES["rules"])


@pytest.mark.parametrize(
    "policy,message",
    [
        ({"version": 2, "default": "block"}, "unsupported version"),
        ({"version": 1, "rules": [{"class": "credential_minting", "effect": "allow"}]}, "secret guard"),
        ({"version": 1, "rules": [{"class": "delete"}]}, "effect"),
        ({"version": 1, "extra": True}, "unknown field"),
        ({"version": 1, "rules": [{"class": "admin", "effect": "block"}]}, "expected one of"),
        (
            {"version": 1, "rules": [{"operation": "ec2:TerminateInstances", "effect": "ask"}]},
            "unknown field",
        ),
    ],
)
def test_an_invalid_policy_is_refused(space, policy, message):
    before = generation(space.session)

    with pytest.raises(GraphQLError, match=message):
        _set_policy(space, policy)

    space.connection.refresh_from_db()
    assert space.connection.policy == {}
    assert generation(space.session) == before


def test_a_postgresql_connection_takes_no_policy(space):
    postgres = packaged_connection(space, "postgres")
    aws = packaged_connection(space, "aws")

    with pytest.raises(GraphQLError, match="only to HTTP Connections"):
        _set_policy(space, BLOCK_DELETES, postgres)
    postgres.refresh_from_db()
    assert postgres.policy == {}
    # An empty policy is no policy.
    assert _set_policy(space, {}, postgres).policy == {}
    assert _set_policy(space, None, postgres).policy == {}
    assert _set_policy(space, BLOCK_DELETES, aws).policy == BLOCK_DELETES


def test_setting_a_policy_needs_permission_to_update_connections(space):
    reader = add_member(
        space.organisation,
        "read-connections",
        permissions={"Agents": ACTIONS, "AgentConnections": ["read"]},
    )
    blind = add_member(
        space.organisation,
        "no-connections",
        permissions={"Agents": ACTIONS, "AgentRequests": ACTIONS},
    )
    stranger = workspace("elsewhere")

    with pytest.raises(GraphQLError, match="permission to update AgentConnections"):
        _set_policy(space, BLOCK_DELETES, member_info=info(reader))
    with pytest.raises(GraphQLError, match="permission to update AgentConnections"):
        _set_policy(space, BLOCK_DELETES, member_info=info(blind))
    with pytest.raises(GraphQLError, match="access to this organisation"):
        _set_policy(space, BLOCK_DELETES, member_info=stranger.info)
    space.connection.refresh_from_db()
    assert space.connection.policy == {}

    # The policy is the Connection's, so it does not take being assigned to
    # any Workflow that uses it.
    editor = add_member(space.organisation, "editor")
    assert _set_policy(space, BLOCK_DELETES, member_info=info(editor)).policy == (
        BLOCK_DELETES
    )


def test_a_deleted_connection_takes_no_policy(space):
    AgentConnection.objects.filter(id=space.connection.id).update(
        deleted_at=timezone.now()
    )

    with pytest.raises(GraphQLError, match="Agent Connection not found"):
        _set_policy(space, BLOCK_DELETES)
    with pytest.raises(GraphQLError, match="Agent Connection not found"):
        _set_policy(space, BLOCK_DELETES, AgentConnection(id="no-such-connection"))


def test_the_policy_left_the_grant_api():
    graphql_schema = schema.graphql_schema
    mutations = graphql_schema.mutation_type.fields

    assert "setAgentWorkflowGrantPolicy" not in mutations
    assert set(mutations["setAgentConnectionPolicy"].args) == {"connectionId", "policy"}
    assert set(mutations["grantAgentWorkflow"].args) == {
        "workflowId",
        "connectionId",
        "expiresAt",
    }
    grant_fields = set(graphql_schema.get_type("AgentWorkflowGrantType").fields)
    assert not {"policy", "managedPolicies", "takesPolicy"} & grant_fields
    assert {"expiresAt", "temporaryAllows", "createdBy"} <= grant_fields
    assert {"policy", "managedPolicies", "takesPolicy"} <= set(
        graphql_schema.get_type("AgentConnectionType").fields
    )


_GRANT_QUERY = """
query Grants($organisationId: ID!) {
  agentWorkflows(organisationId: $organisationId) {
    id
    grants {
      id expiresAt temporaryAllows
      connection { id serviceType policy managedPolicies takesPolicy }
    }
  }
  agentConnections(organisationId: $organisationId) {
    id serviceType policy managedPolicies takesPolicy
  }
}
"""


def test_the_console_reads_a_connections_policy_and_its_locked_secret_guard(space):
    _set_policy(space, ASK_DELETES)
    postgres = packaged_connection(space, "postgres")
    packaged_connection(space, "aws")
    _grant_packaged(space, postgres)
    allow = {
        "id": "allow-1",
        **DELETE_X,
        "expiresAt": iso_timestamp(timezone.now() + timedelta(hours=1)),
        "requestId": "request-1",
    }
    expired = {**allow, "id": "allow-0", "expiresAt": iso_timestamp(timezone.now())}
    AgentWorkflowGrant.objects.filter(id=space.grant.id).update(
        temporary_allows=[expired, allow]
    )

    result = graphql(space, _GRANT_QUERY, organisationId=str(space.organisation.id))

    assert result.errors is None, result.errors
    [workflow] = result.data["agentWorkflows"]
    grants = {item["connection"]["serviceType"]: item for item in workflow["grants"]}
    connections = {
        item["serviceType"]: item for item in result.data["agentConnections"]
    }
    assert grants["http"]["temporaryAllows"] == [allow]
    assert grants["http"]["expiresAt"] is None
    assert grants["postgres"]["temporaryAllows"] == []
    # The same Connection, read from the list or through a grant.
    assert grants["http"]["connection"] == connections["http"]
    assert connections["http"]["policy"] == ASK_DELETES
    # The guard is listed only for a service whose manifest gives it rules.
    assert connections["http"]["managedPolicies"] == []
    assert connections["aws"]["managedPolicies"] == [SECRET_GUARD]
    assert connections["http"]["takesPolicy"] is True
    assert connections["postgres"]["policy"] == {
        "version": 1,
        "default": "allow",
        "rules": [],
    }
    assert connections["postgres"]["managedPolicies"] == []
    assert connections["postgres"]["takesPolicy"] is False


# Clients that do not enforce policies


def test_a_restricted_connection_is_left_out_for_a_client_without_the_feature(space):
    old = member_client(space)
    old_session = open_session(old, space.workflow)
    assert _only(old_session)["policy"] == unrestricted_policy()

    _set_policy(space, {"version": 1, "rules": [{"class": "read", "effect": "allow"}]})
    # A policy that cannot stop a call needs no enforcement.
    assert _only(session_get(old, old_session))["serviceType"] == "http"

    for policy in (ASK_DELETES, BLOCK_DELETES, {"version": 1, "default": "ask"}):
        _set_policy(space, policy)
        for endpoint in ("config", "discover"):
            assert session_get(old, old_session, endpoint)["connections"] == []
        assert "GitHub" not in session_get(old, old_session, "context")["markdown"]
        assert _only(session_get(space.client, space.session))["policy"]["rules"] == (
            policy.get("rules", [])
        )
    assert "GitHub" in session_get(space.client, space.session, "context")["markdown"]


def test_a_client_without_the_feature_cannot_open_onto_a_restricted_connection(space):
    _set_policy(space, BLOCK_DELETES)

    refusal = open_session(member_client(space), space.workflow, expect=400)

    assert refusal["error"]["code"] == "client_capability_mismatch"
    assert refusal["error"]["details"]["missingFeatures"] == ["access_policy"]
    # The secret guard alone needs no feature.
    _set_policy(space, None)
    assert _only(open_session(member_client(space), space.workflow))["policy"][
        "managed"
    ] == [SECRET_GUARD]


# The secret guard


def test_credential_minting_is_refused_everywhere_it_could_be_written(space):
    minting = {"class": "credential_minting"}
    with pytest.raises(GraphQLError, match="secret guard"):
        _set_policy(space, {"version": 1, "rules": [{**minting, "effect": "allow"}]})
    _set_policy(space, ASK_DELETES)
    refused(ask(space.client, action=_allow_action(space, minting)), "invalid_access_allow")
    refused(
        ask(
            space.client,
            action=_allow_action(
                space, blockedCall={**BLOCKED_CALL, "class": "credential_minting"}
            ),
        ),
        "secret_guard_blocks_call",
    )
    assert not AgentRequest.objects.filter(workflow=space.workflow).exists()


def test_the_secret_guard_is_in_every_http_payload_and_never_stored(space):
    _set_policy(space, BLOCK_DELETES)

    policy = _only(session_get(space.client, space.session))["policy"]

    assert policy["managed"] == [SECRET_GUARD]
    space.connection.refresh_from_db()
    assert "managed" not in space.connection.policy
    assert "credential_minting" not in str(space.connection.policy)


# Asking to be allowed a stopped call


def test_an_agent_asks_to_be_allowed_a_call_the_policy_asks_about(space):
    _set_policy(space, ASK_DELETES)
    body = {
        "kind": "access_change",
        "title": "Allow DELETE /repos/acme/x on GitHub",
        "durationSeconds": 1800,
        "action": _allow_action(space, blockedCall=BLOCKED_CALL),
    }

    response = ask(space.client, **body)

    assert response.status_code == 201, response.content
    answer = response.json()
    assert answer["kind"] == "access_change"
    assert answer["title"] == body["title"]
    assert answer["durationSeconds"] == 1800
    assert answer["action"] == body["action"]
    assert answer["connectionId"] == str(space.connection.id)
    assert answer["grantId"] == str(space.grant.id)
    stored = AgentRequest.objects.get(id=answer["id"])
    assert (stored.kind, stored.duration_seconds) == ("access_change", 1800)
    # Nothing changes until a member approves.
    space.grant.refresh_from_db()
    assert space.grant.temporary_allows == []


def test_the_title_and_duration_are_filled_in_when_left_out(space):
    _set_policy(space, ASK_DELETES)

    by_match = filed(ask(space.client, action=_allow_action(space)))
    by_class = filed(ask(space.client, action=_allow_action(space, {"class": "delete"})))

    assert by_match.title == "Allow DELETE /repos/acme/x on GitHub"
    assert by_class.title == "Allow delete calls on GitHub"
    assert by_match.duration_seconds == by_class.duration_seconds == 3600


def test_approving_adds_a_temporary_allow_to_that_grant(space):
    _set_policy(space, ASK_DELETES)
    agent_request = filed(
        ask(space.client, durationSeconds=1800, action=_allow_action(space, blockedCall=BLOCKED_CALL))
    )
    before = generation(space.session)
    started = timezone.now()

    result = approve(space, agent_request)

    assert result.runtime_action == "retry"
    space.grant.refresh_from_db()
    [allow] = space.grant.temporary_allows
    assert allow["match"] == DELETE_X["match"]
    assert allow["requestId"] == str(agent_request.id)
    assert set(allow) == {"id", "match", "expiresAt", "requestId"}
    assert generation(space.session) == before + 1
    # The policy itself is untouched.
    space.connection.refresh_from_db()
    assert space.connection.policy == ASK_DELETES
    [sent] = _only(session_get(space.client, space.session))["policy"]["temporaryAllows"]
    assert sent == {"id": allow["id"], "match": DELETE_X["match"], "expiresAt": allow["expiresAt"]}
    applied = result.request.applied_action
    assert applied["allow"] == DELETE_X
    assert applied["blockedCall"] == BLOCKED_CALL
    assert applied["access"] == {
        "requestedDurationSeconds": 1800,
        "grantedDurationSeconds": 1800,
        "expiresAt": allow["expiresAt"],
    }
    expires_at = parse_datetime(allow["expiresAt"])
    assert timedelta(seconds=1795) < expires_at - started < timedelta(seconds=1805)
    polled = space.client.get(f"/v1/agents/requests/{agent_request.id}/").json()
    assert polled["status"] == "approved"
    assert polled["runtimeAction"] == "retry"
    assert polled["access"] == applied["access"]
    audit = AuditEvent.objects.get(
        resource_type=AuditEvent.AGENT_REQUEST, resource_id=str(agent_request.id)
    )
    assert audit.resource_metadata["applied_action"] == applied


def test_the_reviewer_may_narrow_the_allow_and_change_its_duration(space):
    _set_policy(space, ASK_DELETES)
    agent_request = filed(ask(space.client, action=_allow_action(space, {"class": "delete"})))

    result = approve(
        space, agent_request, action=_allow_action(space), duration_seconds=600
    )

    space.grant.refresh_from_db()
    [allow] = space.grant.temporary_allows
    assert allow["match"] == DELETE_X["match"]
    assert "class" not in allow
    assert result.request.action["allow"] == {"class": "delete"}
    assert result.request.applied_action["access"]["grantedDurationSeconds"] == 600
    assert result.request.applied_action["access"]["requestedDurationSeconds"] == 3600


def test_a_temporary_allow_always_expires_within_the_organisation_maximum(space):
    _set_policy(space, ASK_DELETES)
    agent_request = filed(ask(space.client, action=_allow_action(space)))

    with pytest.raises(GraphQLError, match="always has an expiry"):
        approve(space, agent_request, until_revoked=True)
    with pytest.raises(GraphQLError, match="between 1 and 86400"):
        approve(space, agent_request, duration_seconds=86401)
    with pytest.raises(GraphQLError, match="between 1 and 86400"):
        approve(space, agent_request, duration_seconds=0)

    agent_request.refresh_from_db()
    assert agent_request.status == AgentRequest.PENDING
    assert approve(space, agent_request, duration_seconds=86400).runtime_action == "retry"


def test_an_allow_a_block_rule_covers_is_refused(space):
    _set_policy(
        space,
        {
            "version": 1,
            "rules": [
                {"class": "delete", "effect": "block"},
                {"match": {"methods": ["POST"], "path": "/v1/charges/*"}, "effect": "block"},
                {"class": "create", "effect": "ask"},
            ],
        },
    )

    for allow in (
        {"class": "delete"},
        # Classified as a delete by its method.
        DELETE_X,
        {"match": {"methods": ["POST"], "path": "/v1/charges/ch_1"}},
    ):
        error = refused(
            ask(space.client, action=_allow_action(space, allow)),
            "access_policy_blocks_allow",
        )
        assert "never changes a block" in error["message"]
    # Approval could help here: only an ask rule stands in the way.
    assert ask(
        space.client,
        action=_allow_action(space, {"match": {"methods": ["POST"], "path": "/v1/refunds"}}),
    ).status_code == 201
    assert AgentRequest.objects.filter(workflow=space.workflow).count() == 1


def test_an_allow_is_refused_at_approval_when_the_policy_now_blocks_it(space):
    _set_policy(space, ASK_DELETES)
    agent_request = filed(ask(space.client, action=_allow_action(space)))
    _set_policy(space, BLOCK_DELETES)

    with pytest.raises(GraphQLError, match="never changes a block"):
        approve(space, agent_request)

    space.grant.refresh_from_db()
    assert space.grant.temporary_allows == []


@pytest.mark.parametrize(
    "members,code",
    [
        ({"allow": {}}, "invalid_access_allow"),
        ({"allow": {"class": "delete", "match": {"path": "/x"}}}, "invalid_access_allow"),
        ({"allow": {"match": {"methods": ["delete"]}}}, "invalid_access_allow"),
        ({"allow": {"class": "delete"}, "effect": "allow"}, "invalid_request_action"),
        ({"blockedCall": {"method": "DELETE", "body": "x"}}, "invalid_request_action"),
        ({"blockedCall": {"path": "x" * 4097}}, "invalid_request_action"),
        ({"blockedCall": {"class": "everything"}}, "invalid_request_action"),
        ({"blockedCall": {"class": "admin"}}, "invalid_request_action"),
        ({"blockedCall": {"operation": "ec2:TerminateInstances"}}, "invalid_request_action"),
        ({"allow": {"class": "admin"}}, "invalid_access_allow"),
        ({"allow": {"operation": "ec2:TerminateInstances"}}, "invalid_access_allow"),
        ({"blockedCall": "DELETE /x"}, "invalid_request_action"),
        ({"blockedCall": {"path": "/t/ghp_" + "a" * 24}}, "credential_in_request_action"),
    ],
)
def test_a_malformed_allow_request_is_refused(space, members, code):
    _set_policy(space, ASK_DELETES)

    refused(ask(space.client, action=_allow_action(space, **members)), code)


def test_an_allow_names_a_connection_the_workflow_has_over_http(space):
    postgres = packaged_connection(space, "postgres")
    _grant_packaged(space, postgres)
    ungranted = custom_connection(space, bearer_definition(host="api.other.example"), name="Other")

    refused(
        ask(space.client, action={**_allow_action(space), "connectionId": str(postgres.id)}),
        "access_policy_not_supported",
    )
    refused(
        ask(space.client, action={**_allow_action(space), "connectionId": str(ungranted.id)}),
        "connection_not_in_workflow",
        404,
    )
    refused(
        ask(space.client, kind="connection_update", action=_allow_action(space)),
        "request_kind_mismatch",
    )
    refused(ask(space.client, kind="access_change", markdown="Let me."), "action_required")


def test_expired_allows_are_ignored_on_read_and_pruned(space):
    now = timezone.now()
    live = {"id": "live", "class": "delete", "expiresAt": iso_timestamp(now + timedelta(hours=1))}
    stale = {"id": "stale", **DELETE_X, "expiresAt": iso_timestamp(now - timedelta(seconds=1))}
    AgentWorkflowGrant.objects.filter(id=space.grant.id).update(
        temporary_allows=[stale, live]
    )
    AgentConnection.objects.filter(id=space.connection.id).update(policy=ASK_DELETES)

    sent = _only(session_get(space.client, space.session, "discover"))["policy"]

    assert [allow["id"] for allow in sent["temporaryAllows"]] == ["live"]
    space.grant.refresh_from_db()
    assert space.grant.temporary_allows == [live]


def test_a_pending_allow_answers_a_repeated_ask_but_an_approved_one_does_not(space):
    _set_policy(space, ASK_DELETES)
    first = filed(ask(space.client, action=_allow_action(space)))

    # While the request waits, it answers the repeat.
    repeated = ask(space.client, action=_allow_action(space))
    assert repeated.status_code == 200
    assert repeated.json()["id"] == str(first.id)

    approve(space, first)

    # Once approved it answers nothing: a member may have removed the allow.
    again = ask(space.client, action=_allow_action(space))
    assert again.status_code == 201, again.content
    assert again.json()["id"] != str(first.id)


def test_an_explicit_dedup_key_reused_after_an_approval_is_not_a_conflict(space):
    _set_policy(space, ASK_DELETES)
    first = filed(
        ask(space.client, action=_allow_action(space), dedupKey="delete-x")
    )
    approve(space, first)

    again = ask(space.client, action=_allow_action(space), dedupKey="delete-x")

    assert again.status_code == 201, again.content
    assert again.json()["id"] != str(first.id)


def test_the_sessions_are_refreshed_only_after_the_approval_commits(space):
    # The runtime locks a session and then a grant, so the approval, which holds
    # the grant lock, must not touch session rows before it commits.
    _set_policy(space, ASK_DELETES)
    agent_request = filed(ask(space.client, action=_allow_action(space)))
    before = generation(space.session)

    with TestCase.captureOnCommitCallbacks(execute=False) as callbacks:
        ApproveAgentRequestActionMutation.mutate(
            None,
            space.info,
            request_id=agent_request.id,
            expected_revision=str(agent_request.revision),
        )

    assert generation(space.session) == before
    assert len(callbacks) == 1
    callbacks[0]()
    assert generation(space.session) == before + 1


def test_a_grant_holds_a_bounded_number_of_live_allows(space):
    _set_policy(space, ASK_DELETES)
    expiry = iso_timestamp(timezone.now() + timedelta(hours=1))
    AgentWorkflowGrant.objects.filter(id=space.grant.id).update(
        temporary_allows=[
            {"id": str(index), "class": "delete", "expiresAt": expiry} for index in range(50)
        ]
    )
    agent_request = filed(ask(space.client, action=_allow_action(space)))

    with pytest.raises(GraphQLError, match="already has 50 temporary allows"):
        approve(space, agent_request)


def test_the_organisation_maximum_limits_what_an_allow_may_ask_for(space):
    _set_policy(space, ASK_DELETES)
    AgentOrganisationSettings.objects.create(
        organisation=space.organisation,
        max_request_duration_seconds=900,
        default_request_duration_seconds=600,
    )

    error = refused(
        ask(space.client, durationSeconds=901, action=_allow_action(space)),
        "invalid_duration",
    )
    assert "900" in error["message"]
    assert filed(ask(space.client, action=_allow_action(space))).duration_seconds == 600


# What the proxy reports


def _event(event_id, **members):
    return {
        "eventId": event_id,
        "createdAt": "2026-11-14T10:00:00.000000Z",
        "eventType": "request",
        "protocol": "http",
        "method": "DELETE",
        "host": "api.example.com",
        "port": 443,
        "path": "/repos/acme/x",
        "provider": "http",
        "statusCode": 403,
        "proxyDecision": "block",
        "outcome": "denied",
        **members,
    }


def _ship(space, *events):
    return space.client.post(
        f"/v1/agents/sessions/{space.session['sessionUid']}/events/",
        {"schemaVersion": 1, "batchId": "policy-events", "events": list(events)},
        format="json",
    )


def test_events_for_stopped_calls_and_scrubbed_responses_are_accepted(space):
    detail = {
        "connectionId": str(space.connection.id),
        "connectionName": "GitHub",
        "class": "delete",
        "method": "DELETE",
        "path": "/repos/acme/" + "x" * 2000,
    }
    rule = {"match": {"methods": ["DELETE"], "path": "/repos/*"}, "effect": "block"}

    response = _ship(
        space,
        _event(
            "blocked",
            grantId=str(space.grant.id),
            reason="agent_access_policy_blocked",
            detail={**detail, "rule": rule},
        ),
        _event(
            "asked",
            grantId=str(space.grant.id),
            proxyDecision="ask",
            reason="agent_access_policy_ask",
            detail={**detail, "rule": {"class": "delete", "effect": "ask"}},
        ),
        _event(
            "default",
            grantId=str(space.grant.id),
            reason="agent_access_policy_blocked",
            detail={**detail, "rule": "default"},
        ),
        _event(
            "guard",
            grantId=str(space.grant.id),
            reason="agent_access_policy_blocked",
            detail={**detail, "class": "credential_minting", "rule": "secret_guard"},
        ),
        _event(
            "guard-rule",
            reason="agent_access_policy_blocked",
            detail={"rule": {"class": "credential_minting", "effect": "block"}},
        ),
        _event(
            "scrubbed",
            eventType="response_scrubbed",
            statusCode=200,
            proxyDecision="allow",
            outcome="success",
            provider="aws",
            reason="credential_response_scrubbed",
            detail={"scrubbed_fields": 3, "format": "xml"},
        ),
    )

    assert response.status_code == 202, response.content
    assert response.json()["accepted"] == 6
    events = {
        event.event_id: event
        for event in AgentEvent.objects.filter(session_id=space.session["sessionUid"])
    }
    assert events["blocked"].detail["rule"] == rule
    assert events["blocked"].detail["connection_id"] == str(space.connection.id)
    assert events["blocked"].detail["class"] == "delete"
    assert events["blocked"].reason == "agent_access_policy_blocked"
    assert str(events["blocked"].connection_id) == str(space.connection.id)
    assert events["asked"].proxy_decision == AgentEvent.ASK
    assert events["default"].detail["rule"] == "default"
    assert events["guard"].detail["rule"] == "secret_guard"
    assert events["scrubbed"].event_type == "response_scrubbed"


@pytest.mark.parametrize(
    "detail",
    [
        {"rule": {"class": "delete"}},
        {"rule": {"class": "delete", "effect": "block", "note": "x"}},
        {"rule": {"class": "everything", "effect": "block"}},
        {"rule": {"class": "admin", "effect": "block"}},
        {"rule": {"operation": "ec2:TerminateInstances", "effect": "block"}},
        {"rule": {"match": {"path": "relative"}, "effect": "block"}},
        {"rule": ["delete"]},
        {"matched": {"class": "delete", "effect": "block"}},
        {"path": "/" + "x" * 4096},
        {"connectionName": "x" * 513},
    ],
)
def test_event_detail_stays_bounded(space, detail):
    response = _ship(space, _event("bounded", detail=detail))

    assert response.status_code == 400, response.content
    assert not AgentEvent.objects.filter(event_id="bounded").exists()


# Ending a temporary allow early


def _remove_allow(space, allow_id, target=None, member_info=None):
    return RemoveAgentWorkflowGrantAllowMutation.mutate(
        None,
        member_info or space.info,
        grant_id=(target or space.grant).id,
        allow_id=allow_id,
    ).grant


def _store_allows(space, *allows):
    AgentConnection.objects.filter(id=space.connection.id).update(policy=ASK_DELETES)
    AgentWorkflowGrant.objects.filter(id=space.grant.id).update(
        temporary_allows=list(allows)
    )


def _live_allow(allow_id, **members):
    expires = iso_timestamp(timezone.now() + timedelta(hours=1))
    return {"id": allow_id, **(members or {"class": "delete"}), "expiresAt": expires}


def test_removing_an_allow_ends_it_and_tells_the_live_sessions(space):
    first, second = _live_allow("first"), _live_allow("second", **DELETE_X)
    _store_allows(space, first, second)
    before = generation(space.session)

    result = _remove_allow(space, "first")

    assert [allow["id"] for allow in result.temporary_allows] == ["second"]
    space.grant.refresh_from_db()
    assert space.grant.temporary_allows == [second]
    space.connection.refresh_from_db()
    assert space.connection.policy == ASK_DELETES
    assert generation(space.session) == before + 1
    [sent] = _only(session_get(space.client, space.session))["policy"]["temporaryAllows"]
    assert sent["id"] == "second"
    audit = AuditEvent.objects.filter(
        resource_type=AuditEvent.AGENT_CONNECTION,
        resource_id=str(space.connection.id),
        event_type=AuditEvent.UPDATE,
    ).latest("timestamp")
    assert audit.resource_metadata["allow"] == first
    assert audit.resource_metadata["grant_id"] == str(space.grant.id)


@pytest.mark.parametrize("allow_id", ["missing", ""])
def test_an_unknown_allow_is_not_found(space, allow_id):
    _store_allows(space, _live_allow("live"))
    before = generation(space.session)

    with pytest.raises(GraphQLError, match="Temporary allow not found"):
        _remove_allow(space, allow_id)

    space.grant.refresh_from_db()
    assert [allow["id"] for allow in space.grant.temporary_allows] == ["live"]
    assert generation(space.session) == before


def test_an_expired_allow_is_not_found(space):
    stale = {
        "id": "stale",
        **DELETE_X,
        "expiresAt": iso_timestamp(timezone.now() - timedelta(seconds=1)),
    }
    _store_allows(space, stale)

    with pytest.raises(GraphQLError, match="Temporary allow not found"):
        _remove_allow(space, "stale")


def test_an_allow_cannot_be_removed_twice(space):
    _store_allows(space, _live_allow("once"))
    _remove_allow(space, "once")

    with pytest.raises(GraphQLError, match="Temporary allow not found"):
        _remove_allow(space, "once")


def test_removing_an_allow_needs_what_granting_needs(space):
    _store_allows(space, _live_allow("kept"))
    outsider = add_member(space.organisation, "outsider")
    reader = add_member(
        space.organisation,
        "no-connections",
        permissions={"Agents": ACTIONS, "AgentRequests": ACTIONS},
    )
    stranger = workspace("elsewhere")

    with pytest.raises(GraphQLError, match="update this Workflow"):
        _remove_allow(space, "kept", member_info=info(outsider))
    with pytest.raises(GraphQLError):
        _remove_allow(space, "kept", member_info=info(reader))
    with pytest.raises(GraphQLError, match="access to this organisation"):
        _remove_allow(space, "kept", member_info=stranger.info)
    space.grant.refresh_from_db()
    assert [allow["id"] for allow in space.grant.temporary_allows] == ["kept"]


def test_an_ended_grant_has_no_allow_to_remove(space):
    _store_allows(space, _live_allow("gone"))
    space.grant.delete()

    with pytest.raises(GraphQLError, match="Grant not found"):
        _remove_allow(space, "gone")


def test_the_connection_type_says_whether_it_takes_a_policy(space):
    packaged_connection(space, "postgres")

    result = graphql(
        space,
        "query($organisationId: ID!) { agentConnections(organisationId: $organisationId)"
        " { serviceType takesPolicy } }",
        organisationId=str(space.organisation.id),
    )

    assert result.errors is None, result.errors
    takes = {item["serviceType"]: item["takesPolicy"] for item in result.data["agentConnections"]}
    assert takes == {"http": True, "postgres": False}


# AWS calls, classed by their method like any other


BLOCKED_AWS_CALL = {
    "method": "POST",
    "host": "ec2.us-east-2.amazonaws.com",
    "path": "/",
    "class": "create",
}
AWS_POST = {"match": {"methods": ["POST"], "path": "/"}}


@pytest.fixture
def aws(db):
    """A Workflow with a live AWS Connection and a custom HTTP one."""

    space = workspace("aws-actions")
    space.connection = live_packaged_connection(space, "aws", AWS_MATERIAL, name="AWS")
    space.grant = grant(space, space.connection)
    space.http = custom_connection(space, bearer_definition(), name="Example API")
    space.http_grant = grant(space, space.http)
    space.client, space.full_token = agent_client(space)
    space.session = open_session(space.client, space.workflow, features=POLICY_FEATURES)
    return space


def _connection(payload, connection):
    [found] = [
        item for item in payload["connections"] if item["connectionId"] == str(connection.id)
    ]
    return found


def test_an_aws_connection_takes_the_same_rules_as_any_http_connection(aws):
    policy = {
        "version": 1,
        "default": "allow",
        "rules": [
            {"class": "create", "effect": "ask"},
            {"class": "delete", "effect": "block"},
            {"match": {"methods": ["GET"], "path": "/admin/*"}, "effect": "block"},
        ],
    }

    stored = _set_policy(aws, policy)

    assert stored.policy == policy
    for endpoint in ("config", "discover"):
        sent = _connection(session_get(aws.client, aws.session, endpoint), aws.connection)
        assert sent["policy"] == unrestricted_policy(rules=policy["rules"])
        # No list of AWS actions travels with it.
        assert not {"actionClasses", "operationClasses"} & set(sent)
    for rule in (
        {"operation": "ec2:TerminateInstances", "effect": "ask"},
        {"class": "admin", "effect": "block"},
    ):
        with pytest.raises(GraphQLError):
            _set_policy(aws, {"version": 1, "rules": [rule]})


def test_an_agent_asks_to_be_allowed_an_aws_call_by_its_method_and_path(aws):
    _set_policy(aws, {"version": 1, "rules": [{"class": "create", "effect": "ask"}]})
    action = _allow_action(aws, AWS_POST, blockedCall=BLOCKED_AWS_CALL)

    response = ask(aws.client, kind="access_change", durationSeconds=900, action=action)

    assert response.status_code == 201, response.content
    answer = response.json()
    assert answer["action"] == action
    assert answer["title"] == "Allow POST / on AWS"

    result = approve(aws, AgentRequest.objects.get(id=answer["id"]))

    assert result.runtime_action == "retry"
    aws.grant.refresh_from_db()
    [allow] = aws.grant.temporary_allows
    assert allow["match"] == AWS_POST["match"]
    for endpoint in ("config", "discover"):
        sent = _connection(session_get(aws.client, aws.session, endpoint), aws.connection)
        assert sent["policy"]["temporaryAllows"] == [
            {"id": allow["id"], **AWS_POST, "expiresAt": allow["expiresAt"]}
        ]
    # The other Connection of the same Workflow is not opened by it.
    other = _connection(session_get(aws.client, aws.session), aws.http)
    assert other["policy"]["temporaryAllows"] == []


def test_an_allow_for_an_aws_post_is_refused_when_creates_are_blocked(aws):
    """Most AWS calls are POSTs, so a block on creates stops them whatever
    action each names."""

    _set_policy(aws, {"version": 1, "rules": [{"class": "create", "effect": "block"}]})

    for path in ("/", "/2015-03-31/functions"):
        post = {"match": {"methods": ["POST"], "path": path}}
        error = refused(
            ask(aws.client, action=_allow_action(aws, post)),
            "access_policy_blocks_allow",
        )
        assert "never changes a block" in error["message"]
    delete = {"match": {"methods": ["DELETE"], "path": "/x"}}
    assert filed(ask(aws.client, action=_allow_action(aws, delete)))


def test_the_proxy_names_a_guarded_aws_action_but_no_rule_by_action(aws):
    detail = {
        "connectionId": str(aws.connection.id),
        "connectionName": "AWS",
        "class": "credential_minting",
        "operation": "sts:AssumeRole",
        "method": "POST",
        "path": "/",
    }

    response = _ship(
        aws,
        _event(
            "guarded-action",
            grantId=str(aws.grant.id),
            provider="aws",
            reason="agent_access_policy_blocked",
            detail={**detail, "rule": "secret_guard"},
        ),
    )

    assert response.status_code == 202, response.content
    stored = AgentEvent.objects.get(event_id="guarded-action")
    assert stored.detail["operation"] == "sts:AssumeRole"
    assert stored.detail["rule"] == "secret_guard"
    refusal = _ship(
        aws,
        _event(
            "rule-by-action",
            detail={"rule": {"operation": "ec2:TerminateInstances", "effect": "ask"}},
        ),
    )
    assert refusal.status_code == 400, refusal.content
    assert not AgentEvent.objects.filter(event_id="rule-by-action").exists()
