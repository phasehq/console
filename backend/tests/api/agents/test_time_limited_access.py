"""Grants that expire, requested and granted durations, and renewal."""

from datetime import timedelta

import pytest
from django.db import IntegrityError, transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from graphql import GraphQLError

from api.models import (
    AgentConnection,
    AgentConnectionKeyCopy,
    AgentEvent,
    AgentMembership,
    AgentOrganisationSettings,
    AgentRequest,
    AgentWorkflowGrant,
    AgentWorkflowMembership,
    AuditEvent,
    ProviderCredentials,
)
from api.utils.agent_access import (
    end_lapsed_access,
    expired_connections,
    grant_connection_access,
)
from api.utils.agent_config import load_definition
from api.utils.agent_credentials import (
    CredentialResolutionError,
    resolve_custom_connection,
)
from api.utils.agents import create_agent_workflow
from backend.graphene.agents.mutations import (
    FulfillAgentRequestMutation,
    GrantAgentWorkflowMutation,
    RevokeAgentWorkflowGrantMutation,
    SetAgentWorkflowGrantPolicyMutation,
    UpdateAgentSettingsMutation,
)

from .custom_connections import (
    ACTIONS,
    POLICY_FEATURES,
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
    new_keys,
    open_session,
    refused,
    seal,
    session_get,
    use_test_server_keypair,
    workspace,
)


HOUR = timedelta(hours=1)
BLOCK_DELETES = {
    "version": 1,
    "default": "allow",
    "rules": [{"class": "delete", "effect": "block"}],
}


@pytest.fixture(autouse=True)
def server_keypair(monkeypatch):
    use_test_server_keypair(monkeypatch)


@pytest.fixture
def space(db):
    space = workspace("durations")
    space.connection = custom_connection(space, bearer_definition(), name="Example API")
    space.grant = grant(space, space.connection)
    space.client, space.full_token = agent_client(space)
    space.session = open_session(space.client, space.workflow, features=POLICY_FEATURES)
    return space


def _expire(granted, ago=timedelta(seconds=1)):
    """Move a grant's expiry into the past without ending it."""

    expires_at = timezone.now() - ago
    AgentWorkflowGrant.objects.filter(id=granted.id).update(expires_at=expires_at)
    granted.refresh_from_db()
    return expires_at


def _grant_mutation(space, connection=None, **options):
    return GrantAgentWorkflowMutation.mutate(
        None,
        space.info,
        workflow_id=space.workflow.id,
        connection_id=(connection or space.connection).id,
        **options,
    ).grant


def _create_action(name="Second API", host="api.second.example"):
    return {
        "type": "agent_connection.create",
        "version": 1,
        "serviceType": "http",
        "name": name,
        "definition": bearer_definition(host=host),
    }


def _key_inputs(connection_definition):
    keys = new_keys()
    return {
        "encryptionPublicKey": keys.public_key,
        "sealedValue": seal(connection_definition, keys.public_key),
        "serverWrappedKey": keys.server_wrapped_key,
    }


def _renew_action(connection):
    return {"type": "agent_grant.renew", "version": 1, "connectionId": str(connection.id)}


def _ids(grants):
    return [str(item.id) for item in grants]


def _about(moment, expected, slack=timedelta(seconds=10)):
    return abs(moment - expected) < slack


# The shared predicate


def test_an_active_grant_is_not_ended_and_not_past_its_expiry(space):
    grants = AgentWorkflowGrant.objects.filter(workflow=space.workflow)
    assert space.grant.is_active
    assert _ids(grants.active()) == [str(space.grant.id)]

    AgentWorkflowGrant.objects.filter(id=space.grant.id).update(
        expires_at=timezone.now() + HOUR
    )
    space.grant.refresh_from_db()
    assert space.grant.is_active
    assert grants.active().exists()
    assert not grants.lapsed().exists()

    _expire(space.grant)
    assert not space.grant.is_active
    assert not grants.active().exists()
    # Past its expiry, but nothing has ended it yet.
    assert _ids(grants.lapsed()) == _ids(grants.not_ended()) == [str(space.grant.id)]
    assert _ids(grants.expired()) == [str(space.grant.id)]


def test_a_revoked_grant_is_not_an_expired_one(space):
    AgentWorkflowGrant.objects.filter(id=space.grant.id).update(
        expires_at=timezone.now() + HOUR
    )
    space.grant.delete()

    grants = AgentWorkflowGrant.objects.filter(workflow=space.workflow)
    assert not grants.active().exists()
    assert not grants.expired(timezone.now() + 2 * HOUR).exists()


# Expiry on read


def test_an_expiry_is_carried_in_the_payload(space):
    expires_at = timezone.now() + HOUR
    AgentWorkflowGrant.objects.filter(id=space.grant.id).update(expires_at=expires_at)

    for endpoint in ("config", "discover"):
        [connection] = session_get(space.client, space.session, endpoint)["connections"]
        assert parse_datetime(connection["grantExpiresAt"]) == expires_at


def test_an_expired_grant_stops_giving_access_on_the_next_read(space):
    before = generation(space.session)
    expired_at = _expire(space.grant)

    config = session_get(space.client, space.session)

    assert config["connections"] == []
    [expired] = config["expiredConnections"]
    assert expired == {
        "connectionId": str(space.connection.id),
        "connectionName": "Example API",
        "serviceType": "http",
        "expiredAt": expired["expiredAt"],
    }
    assert parse_datetime(expired["expiredAt"]) == expired_at
    # Looking at it ended it, through the one path that ends a grant: the
    # Agent's copy of the key is gone and the sessions were told to refresh.
    space.grant.refresh_from_db()
    assert space.grant.deleted_at is not None
    assert space.grant.deleted_at >= expired_at
    assert not AgentConnectionKeyCopy.objects.filter(
        connection=space.connection, reader_type=AgentConnectionKeyCopy.AGENT
    ).exists()
    assert config["configGeneration"] >= before + 2
    assert "Example API" not in session_get(space.client, space.session, "context")["markdown"]


def test_discover_ends_an_expired_grant_and_reports_the_new_generation(space):
    before = generation(space.session)
    _expire(space.grant)

    discovered = session_get(space.client, space.session, "discover")

    assert discovered["connections"] == []
    assert [item["connectionId"] for item in discovered["expiredConnections"]] == [
        str(space.connection.id)
    ]
    assert discovered["configGeneration"] == before + 1 == generation(space.session)


def test_a_value_is_never_released_for_an_expired_grant(space):
    _expire(space.grant)

    # Nothing has ended the grant yet; the release recheck still refuses it.
    assert AgentWorkflowGrant.objects.get(id=space.grant.id).deleted_at is None
    from api.models import AgentSession

    session = AgentSession.objects.get(pk=space.session["sessionUid"])
    with pytest.raises(CredentialResolutionError):
        resolve_custom_connection(
            session, space.grant, load_definition(space.connection.config), sealed=True
        )


def test_an_expired_grant_takes_no_requests_but_keeps_its_late_events(space):
    _expire(space.grant)
    other = workspace("other-tenant")
    foreign = grant(other, custom_connection(other))

    events = space.client.post(
        f"/v1/agents/sessions/{space.session['sessionUid']}/events/",
        {
            "schemaVersion": 1,
            "batchId": "after-expiry",
            "events": [
                {
                    "eventId": "late",
                    "createdAt": "2026-11-14T10:00:00Z",
                    "grantId": str(space.grant.id),
                    "eventType": "request",
                    "protocol": "http",
                    "host": "api.example.com",
                    "provider": "http",
                    "proxyDecision": "allow",
                }
            ],
        },
        format="json",
    )
    removal = ask(
        space.client,
        action={
            "type": "agent_connection.remove",
            "version": 1,
            "connectionId": str(space.connection.id),
        },
    )

    refused(removal, "connection_not_in_workflow", 404)
    # The proxy ships events after the calls they describe. One for a call made
    # under a grant that has since expired is still recorded against it.
    assert events.status_code == 202, events.content
    recorded = AgentEvent.objects.get(event_id="late")
    assert str(recorded.connection_id) == str(space.connection.id)
    # A grant of another Workflow is still refused.
    stray = space.client.post(
        f"/v1/agents/sessions/{space.session['sessionUid']}/events/",
        {
            "schemaVersion": 1,
            "batchId": "another-grant",
            "events": [
                {
                    "eventId": "stray",
                    "createdAt": "2026-11-14T10:00:00Z",
                    "grantId": str(foreign.id),
                    "eventType": "request",
                    "protocol": "http",
                    "host": "api.example.com",
                    "provider": "http",
                    "proxyDecision": "allow",
                }
            ],
        },
        format="json",
    )
    refused(stray, "agent_event_grant_not_found", 404)


def test_ending_lapsed_grants_leaves_the_others_alone(space):
    other = custom_connection(space, bearer_definition(host="api.other.example"), name="Other")
    kept = grant(space, other)
    AgentWorkflowGrant.objects.filter(id=kept.id).update(expires_at=timezone.now() + HOUR)
    _expire(space.grant)

    ended = end_lapsed_access(space.workflow.grants.all())

    assert _ids(ended) == [str(space.grant.id)]
    assert end_lapsed_access(space.workflow.grants.all()) == []
    kept.refresh_from_db()
    assert kept.is_active
    assert AgentConnectionKeyCopy.objects.filter(
        connection=other, reader_type=AgentConnectionKeyCopy.AGENT
    ).exists()


def test_the_console_listing_ends_expired_grants_and_shows_what_expired(space):
    expired_at = _expire(space.grant)
    query = """
    query Workflows($organisationId: ID!) {
      agentWorkflows(organisationId: $organisationId) {
        grants { id }
        expiredConnections
      }
    }
    """

    result = graphql(space, query, organisationId=str(space.organisation.id))

    assert result.errors is None, result.errors
    [workflow] = result.data["agentWorkflows"]
    assert workflow["grants"] == []
    [expired] = workflow["expiredConnections"]
    assert expired["connectionId"] == str(space.connection.id)
    assert expired["connectionName"] == "Example API"
    assert expired["serviceType"] == "http"
    assert parse_datetime(expired["expiredAt"]) == expired_at
    space.grant.refresh_from_db()
    assert space.grant.deleted_at is not None


def test_expired_connections_cover_thirty_days_and_skip_what_was_given_back(space):
    old = custom_connection(space, bearer_definition(host="api.old.example"), name="Old")
    _expire(grant(space, old), ago=timedelta(days=31))
    revoked = custom_connection(space, bearer_definition(host="api.gone.example"), name="Revoked")
    revoked_grant = grant(space, revoked)
    AgentWorkflowGrant.objects.filter(id=revoked_grant.id).update(
        expires_at=timezone.now() + HOUR
    )
    revoked_grant.delete()
    deleted = custom_connection(space, bearer_definition(host="api.deleted.example"), name="Deleted")
    _expire(grant(space, deleted))
    AgentConnection.objects.filter(id=deleted.id).update(deleted_at=timezone.now())
    _expire(space.grant)

    assert [item["connection_name"] for item in expired_connections(space.workflow)] == [
        "Example API"
    ]

    _grant_mutation(space)
    assert expired_connections(space.workflow) == []


# The uniqueness rule


def test_an_expired_grant_does_not_hold_the_pair(space):
    _expire(space.grant)
    assert AgentWorkflowGrant.objects.get(id=space.grant.id).deleted_at is None

    again = _grant_mutation(space)

    assert str(again.id) != str(space.grant.id)
    assert again.is_active
    assert again.expires_at is None
    space.grant.refresh_from_db()
    assert space.grant.deleted_at is not None
    assert AgentConnectionKeyCopy.objects.filter(
        connection=space.connection, reader_type=AgentConnectionKeyCopy.AGENT
    ).exists()
    # Two grants in force for one pair are still impossible.
    with pytest.raises(IntegrityError), transaction.atomic():
        AgentWorkflowGrant.objects.create(
            organisation=space.organisation,
            workflow=space.workflow,
            connection=space.connection,
        )


def test_granting_returns_the_grant_in_force(space):
    with transaction.atomic():
        connection = AgentConnection.objects.select_for_update().get(id=space.connection.id)
        same, created = grant_connection_access(space.workflow, connection, space.member)

    assert (str(same.id), created) == (str(space.grant.id), False)


# Grants a member creates


def test_a_member_grant_has_no_expiry_unless_one_is_given(db):
    space = workspace("member-grants")
    forever = custom_connection(space, name="Forever")
    limited = custom_connection(space, bearer_definition(host="api.limited.example"), name="Limited")
    expires_at = timezone.now() + 3 * HOUR

    assert _grant_mutation(space, forever).expires_at is None
    granted = _grant_mutation(space, limited, expires_at=expires_at.isoformat())

    assert granted.expires_at == expires_at
    audit = AuditEvent.objects.filter(resource_id=str(limited.id)).latest("timestamp")
    assert parse_datetime(audit.resource_metadata["expires_at"]) == expires_at


def test_a_member_changes_or_removes_the_expiry_of_a_grant(space):
    later = timezone.now() + 5 * HOUR

    assert _grant_mutation(space, expires_at=later.isoformat()).expires_at == later
    # Granting again without naming an expiry leaves it alone.
    assert _grant_mutation(space).expires_at == later
    assert _grant_mutation(space, expires_at=None).expires_at is None
    with pytest.raises(GraphQLError, match="in the future"):
        _grant_mutation(space, expires_at=(timezone.now() - HOUR).isoformat())
    with pytest.raises(GraphQLError, match="ISO-8601"):
        _grant_mutation(space, expires_at="tomorrow")


def test_revoking_an_expired_grant_finds_nothing(space):
    _expire(space.grant)

    with pytest.raises(GraphQLError, match="Grant not found"):
        RevokeAgentWorkflowGrantMutation.mutate(None, space.info, grant_id=space.grant.id)


# What a request may ask for


def test_a_request_that_ends_in_access_asks_for_the_default_duration(space):
    custom = ask(space.client, action=_create_action())
    packaged = ask(
        space.client,
        kind="setup",
        serviceType="aws",
        credentialProvider="aws",
        credentialName="AWS deploy",
        markdown="Connect AWS.",
    )

    assert custom.status_code == packaged.status_code == 201
    assert custom.json()["durationSeconds"] == packaged.json()["durationSeconds"] == 3600
    review = AgentRequest.objects.get(id=custom.json()["id"])
    assert review.duration_seconds == 3600


def test_a_request_names_its_own_duration_within_the_bounds(space):
    assert filed(
        ask(space.client, durationSeconds=300, action=_create_action())
    ).duration_seconds == 300
    assert filed(
        ask(
            space.client,
            durationSeconds=86400,
            action=_create_action("Third API", "api.third.example"),
        )
    ).duration_seconds == 86400

    too_long = refused(
        ask(space.client, durationSeconds=86401, action=_create_action("Fourth", "api.4.example")),
        "invalid_duration",
    )
    assert "at most 86400" in too_long["message"]
    too_short = refused(
        ask(space.client, durationSeconds=299, action=_create_action("Fifth", "api.5.example")),
        "invalid_duration",
    )
    assert "at least 300" in too_short["message"]
    for malformed in ("3600", 3600.5, True):
        refused(
            ask(space.client, durationSeconds=malformed, action=_create_action("Sixth", "api.6.example")),
            "invalid_duration",
        )
    refused(
        ask(
            space.client,
            kind="setup",
            serviceType="aws",
            credentialProvider="aws",
            credentialName="AWS deploy",
            markdown="Connect AWS.",
            durationSeconds=99999999,
        ),
        "invalid_duration",
    )


def test_the_organisation_settings_set_the_default_and_the_maximum(space):
    AgentOrganisationSettings.objects.create(
        organisation=space.organisation,
        max_request_duration_seconds=7200,
        default_request_duration_seconds=900,
    )

    assert filed(ask(space.client, action=_create_action())).duration_seconds == 900
    error = refused(
        ask(space.client, durationSeconds=7201, action=_create_action("Other", "api.o.example")),
        "invalid_duration",
    )
    assert "7200" in error["message"]


def test_a_duration_is_refused_on_a_request_that_does_not_end_in_access(space):
    connection_id = str(space.connection.id)
    for body in (
        {"action": {"type": "agent_connection.remove", "version": 1, "connectionId": connection_id}},
        {"action": {"type": "agent_connection.update", "version": 1, "connectionId": connection_id, "name": "Renamed"}},
        {"action": {"type": "agent_workflow.context_update", "version": 1, "markdown": "Notes."}},
        {"kind": "credential_update", "connectionId": connection_id, "markdown": "Rotate it."},
    ):
        error = refused(
            ask(space.client, durationSeconds=3600, **body), "unexpected_request_field"
        )
        assert error["details"] == {"field": "durationSeconds"}
    assert not AgentRequest.objects.filter(workflow=space.workflow).exists()


def test_a_different_duration_is_a_different_ask(space):
    first = ask(space.client, durationSeconds=600, action=_create_action())
    same = ask(space.client, durationSeconds=600, action=_create_action())
    longer = ask(space.client, durationSeconds=1200, action=_create_action())
    clash = ask(space.client, dedupKey="one-key", durationSeconds=600, action=_create_action("K", "api.k.example"))
    clash_again = ask(space.client, dedupKey="one-key", durationSeconds=900, action=_create_action("K", "api.k.example"))

    assert (first.status_code, same.status_code, longer.status_code) == (201, 200, 201)
    assert same.json()["id"] == first.json()["id"] != longer.json()["id"]
    assert clash.status_code == 201
    refused(clash_again, "dedup_key_conflict", 409)


# What the approver grants


def test_the_requested_duration_is_granted_unless_the_approver_changes_it(space):
    agent_request = filed(ask(space.client, durationSeconds=1800, action=_create_action()))
    started = timezone.now()

    result = approve(space, agent_request, inputs=_key_inputs(bearer_definition(host="api.second.example")))

    granted = result.request.grant
    assert _about(granted.expires_at, started + timedelta(seconds=1800))
    assert result.request.applied_action["access"] == {
        "requestedDurationSeconds": 1800,
        "grantedDurationSeconds": 1800,
        "expiresAt": result.request.applied_action["access"]["expiresAt"],
    }
    assert parse_datetime(result.request.applied_action["access"]["expiresAt"]) == (
        granted.expires_at
    )
    audit = AuditEvent.objects.get(
        resource_type=AuditEvent.AGENT_REQUEST, resource_id=str(agent_request.id)
    )
    assert audit.resource_metadata["applied_action"]["access"] == (
        result.request.applied_action["access"]
    )
    payload = session_get(space.client, space.session)
    second = next(item for item in payload["connections"] if item["connectionName"] == "Second API")
    assert parse_datetime(second["grantExpiresAt"]) == granted.expires_at


def test_the_approver_may_grant_any_length_or_until_revoked(space):
    longer = filed(ask(space.client, action=_create_action()))
    forever = filed(ask(space.client, action=_create_action("Third API", "api.third.example")))
    started = timezone.now()

    # The organisation maximum limits only what an Agent may ask for.
    long_result = approve(
        space,
        longer,
        inputs=_key_inputs(bearer_definition(host="api.second.example")),
        duration_seconds=90 * 86400,
    )
    forever_result = approve(
        space,
        forever,
        inputs=_key_inputs(bearer_definition(host="api.third.example")),
        until_revoked=True,
    )

    assert _about(long_result.request.grant.expires_at, started + timedelta(days=90))
    assert long_result.request.applied_action["access"]["grantedDurationSeconds"] == 90 * 86400
    assert forever_result.request.grant.expires_at is None
    assert forever_result.request.applied_action["access"] == {
        "requestedDurationSeconds": 3600,
        "grantedDurationSeconds": None,
        "expiresAt": None,
    }
    polled = space.client.get(f"/v1/agents/requests/{forever.id}/").json()
    assert polled["access"]["expiresAt"] is None


def test_a_granted_duration_must_make_sense(space):
    agent_request = filed(ask(space.client, action=_create_action()))
    inputs = _key_inputs(bearer_definition(host="api.second.example"))

    with pytest.raises(GraphQLError, match="not both"):
        approve(space, agent_request, inputs=inputs, duration_seconds=600, until_revoked=True)
    with pytest.raises(GraphQLError, match="between 1 and"):
        approve(space, agent_request, inputs=inputs, duration_seconds=0)
    with pytest.raises(GraphQLError, match="whole number"):
        approve(space, agent_request, inputs={**inputs, "durationSeconds": "600"})
    removal = filed(
        ask(
            space.client,
            action={
                "type": "agent_connection.remove",
                "version": 1,
                "connectionId": str(space.connection.id),
            },
        )
    )
    with pytest.raises(GraphQLError, match="durationSeconds is not accepted"):
        approve(space, removal, duration_seconds=600)
    assert not AgentConnection.objects.filter(name="Second API").exists()


def _packaged_setup(space, **body):
    agent_request = filed(
        ask(
            space.client,
            kind="setup",
            serviceType="aws",
            credentialProvider="aws",
            credentialName="AWS deploy",
            markdown="Connect AWS.",
            **body,
        )
    )
    credential = ProviderCredentials.objects.create(
        organisation=space.organisation, provider="aws", name="AWS", credentials={}
    )
    integrator = add_member(
        space.organisation,
        "integrator",
        permissions={
            "Agents": ACTIONS,
            "AgentConnections": ACTIONS,
            "AgentRequests": ACTIONS,
            "IntegrationCredentials": ACTIONS,
        },
    )
    membership = AgentMembership.objects.create(
        agent=space.agent, member=integrator, assigned_by=space.member
    )
    AgentWorkflowMembership.objects.create(
        workflow=space.workflow, agent_membership=membership, assigned_by=space.member
    )

    def fulfil(**arguments):
        return FulfillAgentRequestMutation.mutate(
            None,
            info(integrator),
            request_id=agent_request.id,
            expected_revision=str(agent_request.revision),
            credential_id=credential.id,
            expected_credential_revision=str(credential.revision),
            **arguments,
        )

    return agent_request, fulfil


def test_a_packaged_setup_carries_a_duration_through_fulfilment(space):
    agent_request, fulfil = _packaged_setup(space, durationSeconds=7200)
    started = timezone.now()

    result = fulfil()

    assert _about(result.grant.expires_at, started + timedelta(seconds=7200))
    assert result.request.applied_action == {
        "access": {
            "requestedDurationSeconds": 7200,
            "grantedDurationSeconds": 7200,
            "expiresAt": result.request.applied_action["access"]["expiresAt"],
        }
    }
    audit = AuditEvent.objects.get(
        resource_type=AuditEvent.AGENT_REQUEST, resource_id=str(agent_request.id)
    )
    assert audit.resource_metadata["access"] == result.request.applied_action["access"]
    polled = space.client.get(f"/v1/agents/requests/{agent_request.id}/").json()
    assert polled["durationSeconds"] == 7200
    assert polled["access"] == result.request.applied_action["access"]


@pytest.mark.parametrize(
    "arguments,seconds",
    [({"until_revoked": True}, None), ({"duration_seconds": 600}, 600)],
)
def test_the_approver_overrides_a_packaged_setups_duration(space, arguments, seconds):
    _, fulfil = _packaged_setup(space)
    started = timezone.now()

    result = fulfil(**arguments)

    access = result.request.applied_action["access"]
    assert access["requestedDurationSeconds"] == 3600
    assert access["grantedDurationSeconds"] == seconds
    if seconds is None:
        assert result.grant.expires_at is None
        assert access["expiresAt"] is None
    else:
        assert _about(result.grant.expires_at, started + timedelta(seconds=seconds))


# Renewal


def test_renewing_extends_the_grant_in_force(space):
    soon = timezone.now() + timedelta(minutes=5)
    AgentWorkflowGrant.objects.filter(id=space.grant.id).update(expires_at=soon)

    response = ask(space.client, durationSeconds=7200, action=_renew_action(space.connection))

    assert response.status_code == 201, response.content
    body = response.json()
    assert (body["kind"], body["title"]) == ("access_change", "Renew access to Example API")
    assert body["connectionId"] == str(space.connection.id)
    agent_request = AgentRequest.objects.get(id=body["id"])
    started = timezone.now()
    result = approve(space, agent_request)

    assert result.runtime_action == "retry"
    space.grant.refresh_from_db()
    assert str(result.request.grant_id) == str(space.grant.id)
    assert _about(space.grant.expires_at, started + timedelta(seconds=7200))
    assert result.request.applied_action["access"]["grantedDurationSeconds"] == 7200
    assert parse_datetime(result.request.applied_action["access"]["expiresAt"]) == (
        space.grant.expires_at
    )


def test_renewing_never_brings_an_expiry_forward(space):
    far = timezone.now() + timedelta(days=10)
    AgentWorkflowGrant.objects.filter(id=space.grant.id).update(expires_at=far)
    shorter = filed(ask(space.client, durationSeconds=600, action=_renew_action(space.connection)))

    result = approve(space, shorter)

    space.grant.refresh_from_db()
    assert space.grant.expires_at == far
    assert parse_datetime(result.request.applied_action["access"]["expiresAt"]) == far

    AgentWorkflowGrant.objects.filter(id=space.grant.id).update(expires_at=None)
    unlimited = filed(ask(space.client, durationSeconds=900, action=_renew_action(space.connection)))
    approve(space, unlimited)
    space.grant.refresh_from_db()
    assert space.grant.expires_at is None


def test_renewing_an_expired_grant_gives_the_connection_back_with_its_policy(space):
    SetAgentWorkflowGrantPolicyMutation.mutate(
        None, space.info, grant_id=space.grant.id, policy=BLOCK_DELETES
    )
    _expire(space.grant)
    assert session_get(space.client, space.session)["connections"] == []

    agent_request = filed(ask(space.client, action=_renew_action(space.connection)))
    review = agent_request_review(space, agent_request)
    started = timezone.now()
    result = approve(space, agent_request)

    assert review["current"]["state"] == "expired"
    assert review["requested"] == {"durationSeconds": 3600}
    assert result.runtime_action == "restart_required"
    renewed = result.request.grant
    assert str(renewed.id) != str(space.grant.id)
    assert renewed.is_active
    assert renewed.policy == BLOCK_DELETES
    assert renewed.temporary_allows == []
    assert _about(renewed.expires_at, started + timedelta(seconds=3600))
    assert AgentConnectionKeyCopy.objects.filter(
        connection=space.connection, reader_type=AgentConnectionKeyCopy.AGENT
    ).exists()
    payload = session_get(space.client, space.session)
    [connection] = payload["connections"]
    assert connection["grantId"] == str(renewed.id)
    assert connection["policy"]["rules"] == BLOCK_DELETES["rules"]
    assert payload["expiredConnections"] == []
    polled = space.client.get(f"/v1/agents/requests/{agent_request.id}/").json()
    assert polled["grantId"] == str(renewed.id)
    assert polled["runtimeAction"] == "restart_required"


def agent_request_review(space, agent_request):
    query = """
    query Review($organisationId: ID!, $requestId: ID!) {
      agentRequests(organisationId: $organisationId, requestId: $requestId) {
        durationSeconds
        access
        actionReview
      }
    }
    """
    result = graphql(
        space,
        query,
        organisationId=str(space.organisation.id),
        requestId=str(agent_request.id),
    )
    assert result.errors is None, result.errors
    [reviewed] = result.data["agentRequests"]
    assert reviewed["durationSeconds"] == agent_request.duration_seconds
    return reviewed["actionReview"]


def test_the_approver_may_renew_until_revoked(space):
    AgentWorkflowGrant.objects.filter(id=space.grant.id).update(
        expires_at=timezone.now() + HOUR
    )
    agent_request = filed(ask(space.client, action=_renew_action(space.connection)))

    approve(space, agent_request, until_revoked=True)

    space.grant.refresh_from_db()
    assert space.grant.expires_at is None


def test_only_a_connection_the_workflow_had_recently_can_be_renewed(space):
    never = custom_connection(space, bearer_definition(host="api.never.example"), name="Never")
    long_ago = custom_connection(space, bearer_definition(host="api.ago.example"), name="Long ago")
    old = grant(space, long_ago)
    _expire(old, ago=timedelta(days=31))
    other_workflow = create_agent_workflow(
        agent=space.agent, name="Other", created_by=space.member
    )
    elsewhere = custom_connection(space, bearer_definition(host="api.else.example"), name="Elsewhere")
    grant(space, elsewhere, other_workflow)
    recently = custom_connection(space, bearer_definition(host="api.recent.example"), name="Recent")
    _expire(grant(space, recently), ago=timedelta(days=29))

    for connection in (never, long_ago, elsewhere):
        refused(
            ask(space.client, action=_renew_action(connection)),
            "connection_not_renewable",
            404,
        )
    refused(
        ask(space.client, action={**_renew_action(space.connection), "connectionId": "no such"}),
        "connection_id_required",
    )
    assert ask(space.client, action=_renew_action(recently)).status_code == 201


def test_a_renewal_is_not_applied_once_the_connection_is_gone(space):
    _expire(space.grant)
    agent_request = filed(ask(space.client, action=_renew_action(space.connection)))
    AgentConnection.objects.filter(id=space.connection.id).update(
        state=AgentConnection.DISABLED
    )

    with pytest.raises(GraphQLError):
        approve(space, agent_request)

    assert not AgentWorkflowGrant.objects.filter(workflow=space.workflow).active().exists()


def test_a_renewal_can_be_asked_for_again_after_the_next_expiry(space):
    AgentWorkflowGrant.objects.filter(id=space.grant.id).update(
        expires_at=timezone.now() + timedelta(minutes=5)
    )
    first = filed(ask(space.client, action=_renew_action(space.connection)))
    approve(space, first)
    assert ask(space.client, action=_renew_action(space.connection)).status_code == 200

    first.refresh_from_db()
    passed = (timezone.now() - timedelta(seconds=1)).isoformat().replace("+00:00", "Z")
    AgentRequest.objects.filter(id=first.id).update(
        applied_action={
            **first.applied_action,
            "access": {**first.applied_action["access"], "expiresAt": passed},
        }
    )
    _expire(space.grant)

    assert ask(space.client, action=_renew_action(space.connection)).status_code == 201


# Organisation settings


_SETTINGS_QUERY = """
query Settings($organisationId: ID!) {
  agentSettings(organisationId: $organisationId) {
    maxRequestDurationSeconds
    defaultRequestDurationSeconds
    minDurationSeconds
    maxDurationSeconds
    updatedAt
    updatedBy { id }
  }
}
"""


def _update_settings(space, member_info=None, **changes):
    return UpdateAgentSettingsMutation.mutate(
        None, member_info or space.info, organisation_id=space.organisation.id, **changes
    ).settings


def test_the_settings_have_defaults_until_a_member_changes_them(space):
    result = graphql(space, _SETTINGS_QUERY, organisationId=str(space.organisation.id))

    assert result.errors is None, result.errors
    assert result.data["agentSettings"] == {
        "maxRequestDurationSeconds": 86400,
        "defaultRequestDurationSeconds": 3600,
        "minDurationSeconds": 300,
        "maxDurationSeconds": 2592000,
        "updatedAt": None,
        "updatedBy": None,
    }
    assert not AgentOrganisationSettings.objects.exists()

    settings = _update_settings(
        space, max_request_duration_seconds=7200, default_request_duration_seconds=600
    )

    assert (settings.max_request_duration_seconds, settings.default_request_duration_seconds) == (7200, 600)
    changed = graphql(space, _SETTINGS_QUERY, organisationId=str(space.organisation.id)).data[
        "agentSettings"
    ]
    assert changed["maxRequestDurationSeconds"] == 7200
    assert changed["updatedBy"] == {"id": str(space.member.id)}
    audit = AuditEvent.objects.get(resource_type=AuditEvent.ORGANISATION)
    assert audit.resource_metadata["max_request_duration_seconds"] == 7200
    assert audit.resource_metadata["previous"]["max_request_duration_seconds"] == 86400


@pytest.mark.parametrize(
    "changes,message",
    [
        ({"max_request_duration_seconds": 299}, "between 300 and 2592000"),
        ({"max_request_duration_seconds": 2592001}, "between 300 and 2592000"),
        ({"default_request_duration_seconds": 299}, "between 300 and 2592000"),
        ({"default_request_duration_seconds": 86401}, "must not exceed the maximum"),
        ({"max_request_duration_seconds": 3599}, "must not exceed the maximum"),
    ],
)
def test_the_settings_stay_within_their_bounds(space, changes, message):
    with pytest.raises(GraphQLError, match=message):
        _update_settings(space, **changes)

    assert not AgentOrganisationSettings.objects.exists()


def test_the_bounds_themselves_are_allowed(space):
    settings = _update_settings(
        space, max_request_duration_seconds=2592000, default_request_duration_seconds=300
    )

    assert settings.max_request_duration_seconds == 2592000
    assert _update_settings(space, default_request_duration_seconds=2592000)
    assert _update_settings(space).default_request_duration_seconds == 2592000


def test_changing_the_settings_takes_the_permission_to_resolve_requests(space):
    filer = add_member(
        space.organisation,
        "filer",
        permissions={
            "Agents": ACTIONS,
            "AgentConnections": ACTIONS,
            "AgentRequests": ["create", "read", "delete"],
        },
    )
    blind = add_member(space.organisation, "blind", permissions={"Agents": ACTIONS})

    with pytest.raises(GraphQLError, match="update AgentRequests"):
        _update_settings(space, info(filer), max_request_duration_seconds=7200)
    readable = graphql(space, _SETTINGS_QUERY, filer, organisationId=str(space.organisation.id))
    hidden = graphql(space, _SETTINGS_QUERY, blind, organisationId=str(space.organisation.id))

    assert readable.errors is None
    assert hidden.errors is not None


# The GraphQL surface


_SURFACE = """
mutation Surface(
  $organisationId: ID!, $workflowId: ID!, $connectionId: ID!, $policy: GenericScalar,
  $expiresAt: String, $markdown: String!
) {
  grantAgentWorkflow(
    workflowId: $workflowId, connectionId: $connectionId, policy: $policy,
    expiresAt: $expiresAt
  ) { grant { id expiresAt policy takesPolicy } }
  setAgentWorkflowContext(workflowId: $workflowId, markdown: $markdown) {
    workflow { contextMarkdown contextUpdatedBy { id } }
  }
  updateAgentSettings(
    organisationId: $organisationId, maxRequestDurationSeconds: 7200,
    defaultRequestDurationSeconds: 900
  ) { settings { maxRequestDurationSeconds defaultRequestDurationSeconds updatedBy { id } } }
}
"""
_POLICY_MUTATION = """
mutation Policy($grantId: ID!, $policy: GenericScalar) {
  setAgentWorkflowGrantPolicy(grantId: $grantId, policy: $policy) {
    grant { id policy temporaryAllows managedPolicies }
  }
}
"""
_CLEAR_EXPIRY = """
mutation Clear($workflowId: ID!, $connectionId: ID!) {
  grantAgentWorkflow(workflowId: $workflowId, connectionId: $connectionId, expiresAt: null) {
    grant { expiresAt }
  }
}
"""
_APPROVE = """
mutation Approve($requestId: ID!, $revision: String!, $seconds: Int, $untilRevoked: Boolean) {
  approveAgentRequestAction(
    requestId: $requestId, expectedRevision: $revision, durationSeconds: $seconds,
    untilRevoked: $untilRevoked
  ) { runtimeAction request { durationSeconds access grant { expiresAt } } }
}
"""


def test_the_additions_are_reachable_through_the_schema(space):
    expires_at = timezone.now() + 2 * HOUR

    result = graphql(
        space,
        _SURFACE,
        organisationId=str(space.organisation.id),
        workflowId=str(space.workflow.id),
        connectionId=str(space.connection.id),
        policy=BLOCK_DELETES,
        expiresAt=expires_at.isoformat(),
        markdown="Notes.",
    )

    assert result.errors is None, result.errors
    granted = result.data["grantAgentWorkflow"]["grant"]
    assert granted["id"] == str(space.grant.id)
    assert parse_datetime(granted["expiresAt"]) == expires_at
    assert granted["policy"] == BLOCK_DELETES
    assert granted["takesPolicy"] is True
    assert result.data["setAgentWorkflowContext"]["workflow"] == {
        "contextMarkdown": "Notes.",
        "contextUpdatedBy": {"id": str(space.member.id)},
    }
    assert result.data["updateAgentSettings"]["settings"] == {
        "maxRequestDurationSeconds": 7200,
        "defaultRequestDurationSeconds": 900,
        "updatedBy": {"id": str(space.member.id)},
    }

    cleared = graphql(space, _POLICY_MUTATION, grantId=str(space.grant.id), policy=None)
    assert cleared.errors is None, cleared.errors
    assert cleared.data["setAgentWorkflowGrantPolicy"]["grant"] == {
        "id": str(space.grant.id),
        "policy": {"version": 1, "default": "allow", "rules": []},
        "temporaryAllows": [],
        "managedPolicies": [
            {
                "id": "secret_guard",
                "locked": True,
                "rules": [{"class": "credential_minting", "effect": "block"}],
            }
        ],
    }
    refusal = graphql(
        space, _POLICY_MUTATION, grantId=str(space.grant.id), policy={"version": 3}
    )
    assert "unsupported version" in str(refusal.errors)

    # An explicit null removes the expiry; leaving the argument out would not.
    no_expiry = graphql(
        space,
        _CLEAR_EXPIRY,
        workflowId=str(space.workflow.id),
        connectionId=str(space.connection.id),
    )
    assert no_expiry.errors is None, no_expiry.errors
    assert no_expiry.data["grantAgentWorkflow"]["grant"] == {"expiresAt": None}

    renewal = filed(ask(space.client, durationSeconds=600, action=_renew_action(space.connection)))
    AgentWorkflowGrant.objects.filter(id=space.grant.id).update(
        expires_at=timezone.now() + timedelta(minutes=1)
    )
    approved = graphql(
        space, _APPROVE, requestId=str(renewal.id), revision=str(renewal.revision), seconds=1200
    )
    assert approved.errors is None, approved.errors
    outcome = approved.data["approveAgentRequestAction"]
    assert outcome["runtimeAction"] == "retry"
    assert outcome["request"]["durationSeconds"] == 600
    assert outcome["request"]["access"]["requestedDurationSeconds"] == 600
    assert outcome["request"]["access"]["grantedDurationSeconds"] == 1200
    assert outcome["request"]["access"]["expiresAt"] is not None
