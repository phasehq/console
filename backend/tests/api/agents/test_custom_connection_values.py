"""Storage of custom Connection secrets: sealing, updates and key copies."""

import json

import pytest
from django.test import RequestFactory
from graphql import GraphQLError

from api.models import (
    AgentConnection,
    AgentConnectionKeyCopy,
    AgentEvent,
    AgentSession,
    AgentWorkflowGrant,
    AuditEvent,
)
from api.utils.agent_access import end_connection_access
from api.utils.agent_connection_values import SealedValueError, ensure_agent_key_copy
from api.utils.agent_sessions import create_agent_session
from api.utils.agents import create_agent_with_default_workflow, create_agent_workflow
from api.utils.crypto import decrypt_asymmetric, encrypt_asymmetric
from backend.graphene.agents.mutations import (
    AllowAgentConnectionHostMutation,
    ApproveAgentConnectionHostRulesMutation,
    CreateAgentConnectionMutation,
    CreateCustomAgentConnectionMutation,
    DeleteAgentConnectionMutation,
    GrantAgentWorkflowMutation,
    RevokeAgentWorkflowGrantMutation,
    UpdateAgentConnectionMutation,
    UpdateCustomAgentConnectionMutation,
)
from backend.schema import schema

from .custom_connections import (
    SECRETS,
    SERVER_KEYPAIR,
    add_member,
    agent_private_key,
    bearer_definition,
    definition,
    grant,
    info,
    new_keys,
    seal,
    use_test_server_keypair,
    workspace,
)


@pytest.fixture(autouse=True)
def server_keypair(monkeypatch):
    use_test_server_keypair(monkeypatch)


@pytest.fixture
def space(db):
    return workspace("values")


def _create(space, connection_definition=None, *, keys=None, sealed_value=None, **changes):
    connection_definition = connection_definition or definition()
    keys = keys or new_keys()
    arguments = {
        "organisation_id": space.organisation.id,
        "name": "Example API",
        "definition": connection_definition,
        "encryption_public_key": keys.public_key,
        "sealed_value": (
            seal(connection_definition, keys.public_key)
            if sealed_value is None
            else sealed_value
        ),
        "server_wrapped_key": keys.server_wrapped_key,
    }
    arguments.update(changes)
    result = CreateCustomAgentConnectionMutation.mutate(None, space.info, **arguments)
    result.connection.test_keys = keys
    return result.connection


def _session(space, workflow=None):
    workflow = workflow or space.workflow
    session, _, _ = create_agent_session(
        agent=workflow.agent, workflow=workflow, opened_by_member=space.member
    )
    return session


def _generation(session):
    return AgentSession.objects.get(pk=session.pk).config_generation


def _stored_value(connection):
    """Open the stored value with the server copy, as the server would."""

    connection.refresh_from_db()
    copy = connection.key_copies.get(reader_type=AgentConnectionKeyCopy.SERVER)
    private_key = decrypt_asymmetric(
        copy.wrapped_key, SERVER_KEYPAIR[1].hex(), SERVER_KEYPAIR[0].hex()
    )
    return json.loads(
        decrypt_asymmetric(
            connection.sealed_value, private_key, connection.encryption_public_key
        )
    )


def _agent_copy_opens(connection, agent):
    """Whether the Agent's copy unwraps to the Connection's current key."""

    connection.refresh_from_db()
    copy = connection.key_copies.get(agent=agent)
    public_key, private_key = agent_private_key(agent)
    connection_key = decrypt_asymmetric(copy.wrapped_key, private_key, public_key)
    plaintext = decrypt_asymmetric(
        connection.sealed_value, connection_key, connection.encryption_public_key
    )
    return (
        copy.reader_type == AgentConnectionKeyCopy.AGENT
        and copy.key_version == connection.key_version
        and copy.wrapped_with == public_key
        and json.loads(plaintext)["fields"] == SECRETS
    )


def test_create_stores_the_sealed_value_and_a_server_key_copy(space):
    connection = _create(space)
    connection.refresh_from_db()

    assert connection.service_type == "http"
    assert connection.authentication_id is None
    assert connection.state == AgentConnection.ACTIVE
    assert connection.config == definition()
    assert (connection.key_version, connection.value_revision) == (1, 1)
    assert connection.encryption_public_key == connection.test_keys.public_key
    assert str(connection.value_updated_by_id) == str(space.member.id)
    assert connection.value_updated_at is not None
    assert str(connection.host_rules_authored_by_id) == str(space.member.id)
    [copy] = connection.key_copies.all()
    assert copy.reader_type == AgentConnectionKeyCopy.SERVER
    assert copy.key_version == 1
    assert copy.wrapped_with == SERVER_KEYPAIR[0].hex()
    assert _stored_value(connection)["fields"] == SECRETS
    audit = AuditEvent.objects.get(resource_id=str(connection.id))
    assert audit.event_type == AuditEvent.CREATE
    assert SECRETS["token"] not in json.dumps(audit.resource_metadata)


def test_custom_connections_do_not_need_the_integration_credentials_permission(space):
    assert "IntegrationCredentials" not in space.member.role.permissions["permissions"]
    connection = _create(space)

    UpdateCustomAgentConnectionMutation.mutate(
        None,
        space.info,
        connection_id=connection.id,
        sealed_value=seal(definition(), connection.encryption_public_key),
    )
    GrantAgentWorkflowMutation.mutate(
        None, space.info, workflow_id=space.workflow.id, connection_id=connection.id
    )

    with pytest.raises(GraphQLError, match="permission to read IntegrationCredentials"):
        CreateAgentConnectionMutation.mutate(
            None,
            space.info,
            organisation_id=space.organisation.id,
            name="AWS",
            service_type="aws",
            authentication_id="missing",
        )


def test_changing_a_custom_connection_needs_the_connections_permission(space):
    connection = _create(space)
    reader = add_member(
        space.organisation, "reader", permissions={"AgentConnections": ["read"]}
    )

    for mutation, arguments in (
        (UpdateCustomAgentConnectionMutation, {"name": "Renamed"}),
        (
            UpdateCustomAgentConnectionMutation,
            {"sealed_value": seal(definition(), connection.encryption_public_key)},
        ),
    ):
        with pytest.raises(GraphQLError, match="permission to update AgentConnections"):
            mutation.mutate(None, info(reader), connection_id=connection.id, **arguments)
    with pytest.raises(GraphQLError, match="permission to create AgentConnections"):
        _create(type(space)(**{**vars(space), "info": info(reader)}))


def _other_keys_wrapped_key():
    return new_keys().server_wrapped_key


@pytest.mark.parametrize(
    "broken,message",
    [
        # Wrapped to a key the server does not hold.
        (
            lambda keys: {
                "server_wrapped_key": encrypt_asymmetric(
                    keys.private_key, new_keys().public_key
                )
            },
            "does not open",
        ),
        # Opens, but is the private half of some other keypair.
        (
            lambda keys: {"server_wrapped_key": _other_keys_wrapped_key()},
            "private half",
        ),
        (lambda keys: {"server_wrapped_key": "not-a-ciphertext"}, "serverWrappedKey"),
        (lambda keys: {"encryption_public_key": "zz" * 32}, "encryptionPublicKey"),
        (lambda keys: {"encryption_public_key": "AB" * 32}, "encryptionPublicKey"),
        # Sealed to a different Connection key.
        (
            lambda keys: {"sealed_value": seal(definition(), new_keys().public_key)},
            "does not open",
        ),
        (lambda keys: {"sealed_value": "ph:v1:zz:zz"}, "sealedValue"),
        (lambda keys: {"sealed_value": ""}, "sealedValue"),
    ],
)
def test_create_refuses_keys_or_a_value_that_do_not_verify(space, broken, message):
    keys = new_keys()

    with pytest.raises(GraphQLError, match=message):
        _create(space, keys=keys, **broken(keys))

    assert not AgentConnection.objects.filter(organisation=space.organisation).exists()
    assert not AgentConnectionKeyCopy.objects.exists()


@pytest.mark.parametrize(
    "payload,message",
    [
        ({"v": 2}, "unsupported version"),
        ({"v": True}, "unsupported version"),
        ({"hosts": [{"match": "exact", "value": "evil.example.com", "port": 443}]}, "different hosts"),
        ({"hosts": [{"match": "exact", "value": "api.example.com"}]}, "different hosts"),
        ({"hosts": []}, "different hosts"),
        ({"hosts": [{"match": "exact", "value": "api.example.com", "port": 443, "path": "/v1/*"}]}, "malformed"),
        ({"fields": {"token": "t"}}, "exactly this Connection's secret fields"),
        ({"fields": {**SECRETS, "extra": "x"}}, "exactly this Connection's secret fields"),
        ({"fields": {**SECRETS, "token": ""}}, "token must be 8 to 16384 bytes"),
        ({"fields": {**SECRETS, "token": "a\x00b"}}, "token must be 8 to 16384 bytes"),
        ({"fields": {**SECRETS, "token": "a" * 16385}}, "token must be 8 to 16384 bytes"),
        ({"fields": {**SECRETS, "token": "é" * 8193}}, "token must be 8 to 16384 bytes"),
        ({"fields": {**SECRETS, "token": 5}}, "token must be 8 to 16384 bytes"),
        ({"fields": {**SECRETS, "token": "a" * 7}}, "token must be 8 to 16384 bytes"),
        ({"extra": 1}, "must hold v, hosts and fields"),
    ],
)
def test_create_refuses_a_value_that_does_not_fit_the_definition(
    space, payload, message
):
    keys = new_keys()

    with pytest.raises(GraphQLError, match=message):
        _create(
            space, keys=keys, sealed_value=seal(definition(), keys.public_key, **payload)
        )

    assert not AgentConnection.objects.filter(organisation=space.organisation).exists()


def test_create_refuses_a_value_that_is_not_json_without_echoing_it(space):
    keys = new_keys()
    plaintext = "plain secret, not JSON"

    with pytest.raises(GraphQLError, match="not valid JSON") as failure:
        _create(
            space,
            keys=keys,
            sealed_value=encrypt_asymmetric(plaintext, keys.public_key),
        )

    assert plaintext not in str(failure.value)
    # Nothing chained to the error still holds the decrypted text.
    assert failure.value.__cause__.__cause__ is None
    assert failure.value.__cause__.__context__ is None


def test_sealed_values_at_the_size_limits_are_accepted(space):
    keys = new_keys()
    fields = {"token": "a" * 16384, "password": "b" * 8}

    connection = _create(
        space, keys=keys, sealed_value=seal(definition(), keys.public_key, fields=fields)
    )

    assert _stored_value(connection)["fields"] == fields


def _leaky(place, secret):
    """A definition whose Agent-visible text holds one of its own secrets."""

    leaky = definition()
    if place == "identifier":
        leaky["fields"][2]["value"] = f"user-{secret}-suffix"
    elif place == "decoy prefix":
        leaky["fields"][0]["decoyPrefix"] = secret
    else:
        leaky["injections"][0]["prefix"] = f"Token {secret} "
    return leaky


@pytest.mark.parametrize(
    "place,message",
    [
        ("identifier", "also appears in the value of username"),
        ("decoy prefix", "also appears in the decoy prefix of token"),
        ("header prefix", "also appears in the prefix of the X-Api-Key header"),
    ],
)
def test_a_secret_must_not_occur_in_text_the_agent_can_read(space, place, message):
    secrets = {"token": "tok-12345", "password": "pw-secret-1"}
    keys = new_keys()
    connection = _create(
        space, keys=keys, sealed_value=seal(definition(), keys.public_key, fields=secrets)
    )

    for field, secret in secrets.items():
        leaky = _leaky(place, secret)
        # At creation.
        with pytest.raises(GraphQLError, match=message) as failure:
            fresh = new_keys()
            _create(
                space,
                leaky,
                keys=fresh,
                sealed_value=seal(leaky, fresh.public_key, fields=secrets),
            )
        assert secret not in str(failure.value)
        assert f"The secret for {field}" in str(failure.value)
        # When only the definition changes and the stored value stays.
        with pytest.raises(GraphQLError, match=message):
            UpdateCustomAgentConnectionMutation.mutate(
                None, space.info, connection_id=connection.id, definition=leaky
            )
    # When only the value changes.
    UpdateCustomAgentConnectionMutation.mutate(
        None,
        space.info,
        connection_id=connection.id,
        definition=_leaky(place, "harmless"),
    )
    with pytest.raises(GraphQLError, match=message):
        UpdateCustomAgentConnectionMutation.mutate(
            None,
            space.info,
            connection_id=connection.id,
            sealed_value=seal(
                _leaky(place, "harmless"),
                keys.public_key,
                fields={**secrets, "token": "harmless"},
            ),
        )

    connection.refresh_from_db()
    assert connection.value_revision == 1
    assert AgentConnection.objects.filter(organisation=space.organisation).count() == 1


def test_create_refuses_an_invalid_definition(space):
    broken = definition()
    broken["fields"][0]["value"] = "smuggled"

    with pytest.raises(GraphQLError, match="never carries a value"):
        _create(space, broken, sealed_value=seal(definition(), new_keys().public_key))


def test_a_change_that_keeps_the_bound_hosts_needs_no_new_secret(space):
    connection = _create(space, bearer_definition(path="/v1/*"))
    grant(space, connection)
    session = _session(space)
    before = _generation(session)
    version = connection.host_rules_version

    result = UpdateCustomAgentConnectionMutation.mutate(
        None,
        space.info,
        connection_id=connection.id,
        name="Renamed API",
        definition=bearer_definition(path="/v2/*"),
    )

    connection = result.connection
    assert connection.name == "Renamed API"
    assert connection.config["hosts"][0]["path"] == "/v2/*"
    assert (connection.key_version, connection.value_revision) == (1, 1)
    # The path list is still executable host configuration with an author.
    assert connection.host_rules_version != version
    assert _generation(session) == before + 1
    assert _stored_value(connection)["fields"] == {"token": SECRETS["token"]}


def test_a_host_change_without_a_new_secret_is_refused(space):
    connection = _create(space, bearer_definition())
    moved = bearer_definition(host="api.other.example")

    with pytest.raises(GraphQLError, match="Enter the secret again to change the hosts"):
        UpdateCustomAgentConnectionMutation.mutate(
            None, space.info, connection_id=connection.id, definition=moved
        )
    # A value sealed over the old hosts does not count either.
    with pytest.raises(GraphQLError, match="different hosts"):
        UpdateCustomAgentConnectionMutation.mutate(
            None,
            space.info,
            connection_id=connection.id,
            definition=moved,
            sealed_value=seal(bearer_definition(), connection.encryption_public_key),
        )

    connection.refresh_from_db()
    assert connection.config == bearer_definition()
    assert connection.value_revision == 1


def test_a_host_change_with_a_secret_sealed_over_the_new_hosts_is_stored(space):
    connection = _create(space, bearer_definition())
    moved = bearer_definition(host="api.other.example")

    result = UpdateCustomAgentConnectionMutation.mutate(
        None,
        space.info,
        connection_id=connection.id,
        definition=moved,
        sealed_value=seal(
            moved, connection.encryption_public_key, fields={"token": "new-token"}
        ),
    )

    assert result.connection.config == moved
    assert (result.connection.key_version, result.connection.value_revision) == (1, 2)
    stored = _stored_value(connection)
    assert stored["hosts"] == [{"match": "exact", "value": "api.other.example", "port": 443}]
    assert stored["fields"] == {"token": "new-token"}


def test_a_port_change_rebinds_the_secret_too(space):
    connection = _create(space, bearer_definition())
    moved = bearer_definition()
    moved["hosts"][0]["port"] = 8443

    with pytest.raises(GraphQLError, match="Enter the secret again"):
        UpdateCustomAgentConnectionMutation.mutate(
            None, space.info, connection_id=connection.id, definition=moved
        )


def test_changing_the_secret_fields_without_a_new_secret_is_refused(space):
    connection = _create(space)
    fewer = definition()
    del fewer["fields"][1]
    del fewer["injections"][1]

    with pytest.raises(
        GraphQLError, match="Enter the secret again to change the secret fields"
    ):
        UpdateCustomAgentConnectionMutation.mutate(
            None, space.info, connection_id=connection.id, definition=fewer
        )

    result = UpdateCustomAgentConnectionMutation.mutate(
        None,
        space.info,
        connection_id=connection.id,
        definition=fewer,
        sealed_value=seal(fewer, connection.encryption_public_key),
    )
    assert result.connection.config == fewer


def test_an_update_with_nothing_to_change_is_refused(space):
    connection = _create(space)

    with pytest.raises(GraphQLError, match="Nothing to change"):
        UpdateCustomAgentConnectionMutation.mutate(
            None, space.info, connection_id=connection.id
        )


def test_an_update_with_only_a_new_secret_replaces_the_stored_value(space):
    connection = _create(space)
    grant(space, connection)
    session = _session(space)
    before = _generation(session)
    version = connection.host_rules_version
    fields = {"token": "second-token", "password": "second-password"}

    result = UpdateCustomAgentConnectionMutation.mutate(
        None,
        space.info,
        connection_id=connection.id,
        sealed_value=seal(definition(), connection.encryption_public_key, fields=fields),
    )

    connection = result.connection
    assert (connection.key_version, connection.value_revision) == (1, 2)
    assert connection.config == definition()
    assert connection.host_rules_version == version
    assert _stored_value(connection)["fields"] == fields
    assert _generation(session) == before + 1
    audit = AuditEvent.objects.get(
        resource_id=str(connection.id), event_type=AuditEvent.UPDATE
    )
    assert audit.resource_metadata["value_written"] is True
    assert audit.resource_metadata["definition_changed"] is False
    assert audit.resource_metadata["value_revision"] == 2
    assert "second-token" not in json.dumps(audit.resource_metadata)


def test_an_update_that_changes_nothing_writes_nothing(space):
    connection = _create(space)
    grant(space, connection)
    session = _session(space)
    before = AgentConnection.objects.filter(pk=connection.pk).values().get()
    generation = _generation(session)
    audits = AuditEvent.objects.filter(resource_id=str(connection.id)).count()
    other = add_member(space.organisation, "other-editor")

    for arguments in (
        {"name": connection.name},
        {"definition": definition()},
        {"name": connection.name, "definition": definition()},
    ):
        result = UpdateCustomAgentConnectionMutation.mutate(
            None, info(other), connection_id=connection.id, **arguments
        )
        assert str(result.connection.id) == str(connection.id)
        assert result.connection.name == connection.name

    # Nothing was saved: the same revisions, timestamps, host-rule version and
    # last editor as before.
    assert AgentConnection.objects.filter(pk=connection.pk).values().get() == before
    assert _generation(session) == generation
    assert AuditEvent.objects.filter(resource_id=str(connection.id)).count() == audits


def test_a_secret_write_bumps_the_sessions_of_every_granted_workflow(space):
    connection = _create(space)
    second = create_agent_workflow(
        agent=space.agent, name="Second", created_by=space.member
    )
    other_agent, other_workflow = create_agent_with_default_workflow(
        organisation=space.organisation,
        name="Unrelated Agent",
        harness_type="other",
        created_by=space.member,
    )
    grant(space, connection)
    grant(space, connection, second)
    granted = [_session(space), _session(space, second)]
    unrelated = _session(space, other_workflow)
    revoked = _session(space)
    AgentSession.objects.filter(pk=revoked.pk).update(revoked_at=revoked.created_at)
    before = [_generation(session) for session in granted]
    writer = add_member(space.organisation, "writer")

    result = UpdateCustomAgentConnectionMutation.mutate(
        None,
        info(writer),
        connection_id=connection.id,
        sealed_value=seal(
            definition(),
            connection.encryption_public_key,
            fields={"token": "rotated-token", "password": "rotated-password"},
        ),
    )

    assert [_generation(session) for session in granted] == [
        generation + 1 for generation in before
    ]
    assert _generation(unrelated) == unrelated.config_generation
    assert _generation(revoked) == revoked.config_generation
    assert (result.connection.key_version, result.connection.value_revision) == (1, 2)
    assert str(result.connection.value_updated_by_id) == str(writer.id)
    assert _stored_value(connection)["fields"]["token"] == "rotated-token"
    audits = AuditEvent.objects.filter(resource_id=str(connection.id))
    assert "rotated-token" not in json.dumps(
        [audit.resource_metadata for audit in audits]
    )


def test_a_secret_write_is_checked_against_the_stored_definition(space):
    connection = _create(space)
    session = _session(space)
    grant(space, connection)

    for sealed_value, message in (
        (seal(bearer_definition(), connection.encryption_public_key), "secret fields"),
        (seal(definition(), new_keys().public_key), "does not open"),
        ("ph:v1:00:AA", "sealedValue"),
    ):
        with pytest.raises(GraphQLError, match=message):
            UpdateCustomAgentConnectionMutation.mutate(
                None, space.info, connection_id=connection.id, sealed_value=sealed_value
            )

    connection.refresh_from_db()
    assert connection.value_revision == 1
    assert _generation(session) == session.config_generation


def test_granting_a_workflow_gives_its_agent_a_key_copy(space):
    connection = _create(space)
    second = create_agent_workflow(
        agent=space.agent, name="Second", created_by=space.member
    )

    GrantAgentWorkflowMutation.mutate(
        None, space.info, workflow_id=space.workflow.id, connection_id=connection.id
    )
    GrantAgentWorkflowMutation.mutate(
        None, space.info, workflow_id=second.id, connection_id=connection.id
    )

    # One copy per Agent, however many of its Workflows are granted.
    assert connection.key_copies.filter(agent=space.agent).count() == 1
    assert _agent_copy_opens(connection, space.agent)


def test_an_agent_keeps_its_copy_until_its_last_grant_goes(space):
    connection = _create(space)
    second = create_agent_workflow(
        agent=space.agent, name="Second", created_by=space.member
    )
    other_agent, other_workflow = create_agent_with_default_workflow(
        organisation=space.organisation,
        name="Other Agent",
        harness_type="other",
        created_by=space.member,
    )
    first_grant = grant(space, connection)
    second_grant = grant(space, connection, second)
    grant(space, connection, other_workflow)

    RevokeAgentWorkflowGrantMutation.mutate(None, space.info, grant_id=first_grant.id)
    assert connection.key_copies.filter(agent=space.agent).exists()

    RevokeAgentWorkflowGrantMutation.mutate(None, space.info, grant_id=second_grant.id)
    assert not connection.key_copies.filter(agent=space.agent).exists()
    assert connection.key_copies.filter(agent=other_agent).exists()
    assert connection.key_copies.filter(
        reader_type=AgentConnectionKeyCopy.SERVER
    ).exists()

    with pytest.raises(GraphQLError, match="Agent Workflow Grant not found"):
        RevokeAgentWorkflowGrantMutation.mutate(
            None, space.info, grant_id=second_grant.id
        )


def test_every_way_access_ends_removes_the_copy_and_bumps_sessions(space):
    """Grant, Workflow, Agent and Connection deletion share one path."""

    connections = [_create(space, name=f"API {index}") for index in range(4)]
    workflows = [space.workflow] + [
        create_agent_workflow(agent=space.agent, name=name, created_by=space.member)
        for name in ("Second", "Third")
    ]
    other_agent, other_workflow = create_agent_with_default_workflow(
        organisation=space.organisation,
        name="Other Agent",
        harness_type="other",
        created_by=space.member,
    )
    by_helper = grant(space, connections[0], workflows[0])
    by_model = grant(space, connections[1], workflows[0])
    grant(space, connections[2], workflows[1])
    grant(space, connections[3], other_workflow)
    kept = grant(space, connections[3], workflows[2])
    session = _session(space, workflows[0])

    def copies(connection, agent):
        return connection.key_copies.filter(agent=agent).count()

    before = _generation(session)
    ended = end_connection_access(AgentWorkflowGrant.objects.filter(id=by_helper.id))
    assert [str(item.id) for item in ended] == [str(by_helper.id)]
    assert copies(connections[0], space.agent) == 0
    assert _generation(session) == before + 1
    # Ending it again is a no-op.
    assert end_connection_access(AgentWorkflowGrant.objects.filter(id=by_helper.id)) == []
    assert _generation(session) == before + 1

    by_model.delete()
    assert by_model.deleted_at is not None
    assert copies(connections[1], space.agent) == 0
    assert _generation(session) == before + 2

    workflows[1].delete()
    assert copies(connections[2], space.agent) == 0
    assert not AgentWorkflowGrant.objects.filter(
        workflow=workflows[1], deleted_at__isnull=True
    ).exists()

    other_agent.delete()
    assert copies(connections[3], other_agent) == 0
    assert copies(connections[3], space.agent) == 1

    DeleteAgentConnectionMutation.mutate(
        None, space.info, connection_id=connections[3].id
    )
    connections[3].refresh_from_db()
    kept.refresh_from_db()
    assert kept.deleted_at is not None
    assert connections[3].deleted_at is not None
    assert connections[3].sealed_value == ""
    assert not connections[3].key_copies.exists()


def test_a_key_copy_is_not_made_for_an_agent_without_a_usable_key(space):
    connection = _create(space)
    space.agent.identity_key = "not-a-key"
    space.agent.save(update_fields=["identity_key"])

    with pytest.raises(SealedValueError, match="no usable identity key"):
        ensure_agent_key_copy(connection, space.agent)
    with pytest.raises(GraphQLError, match="no usable identity key"):
        GrantAgentWorkflowMutation.mutate(
            None, space.info, workflow_id=space.workflow.id, connection_id=connection.id
        )

    assert not AgentWorkflowGrant.objects.filter(connection=connection).exists()


def test_mutations_for_packaged_connections_point_at_the_custom_ones(space):
    connection = _create(space)
    grant(space, connection)

    with pytest.raises(GraphQLError, match="createCustomAgentConnection"):
        CreateAgentConnectionMutation.mutate(
            None,
            space.info,
            organisation_id=space.organisation.id,
            name="Custom",
            service_type="HTTP",
            authentication_id="unused",
        )
    with pytest.raises(GraphQLError, match="updateCustomAgentConnection"):
        UpdateAgentConnectionMutation.mutate(
            None, space.info, connection_id=connection.id, name="Renamed"
        )
    with pytest.raises(GraphQLError, match="does not require host-rule approval"):
        ApproveAgentConnectionHostRulesMutation.mutate(
            None,
            space.info,
            connection_id=connection.id,
            expected_version=connection.host_rules_version,
        )


def test_a_blocked_host_cannot_be_added_to_a_custom_connection(space):
    connection = _create(space, bearer_definition())
    grant(space, connection)
    session = _session(space)
    event = AgentEvent.objects.create(
        event_id="blocked-host",
        organisation=space.organisation,
        agent=space.agent,
        workflow=space.workflow,
        session=session,
        proxy_created_at=session.created_at,
        event_type="request",
        protocol="http",
        host="api.other.example",
        port=443,
        provider="proxy",
        status_code=403,
        proxy_decision=AgentEvent.BLOCK,
        outcome="denied",
        reason="lockdown_unbound_host",
    )

    with pytest.raises(GraphQLError, match="editing the custom Connection"):
        AllowAgentConnectionHostMutation.mutate(
            None,
            space.info,
            event_ingest_seq=event.ingest_seq,
            connection_id=connection.id,
            expected_version=connection.host_rules_version,
        )

    connection.refresh_from_db()
    assert connection.config == bearer_definition()


_CONNECTION_QUERY = """
query Connections($organisationId: ID!) {
  agentConnections(organisationId: $organisationId) {
    id
    name
    serviceType
    state
    config
    definition
    encryptionPublicKey
    keyVersion
    valueRevision
    valueUpdatedAt
    valueUpdatedBy { id }
    authentication { id }
  }
}
"""


def test_the_connection_type_exposes_everything_but_the_secret(space):
    connection = _create(space)
    request = RequestFactory().post("/graphql/")
    request.user = space.member.user

    result = schema.execute(
        _CONNECTION_QUERY,
        variables={"organisationId": str(space.organisation.id)},
        context_value=request,
    )

    assert result.errors is None, result.errors
    [listed] = result.data["agentConnections"]
    assert listed["serviceType"] == "http"
    assert listed["state"] == "ACTIVE"
    assert listed["definition"] == definition()
    assert listed["config"] == definition()
    assert listed["encryptionPublicKey"] == connection.encryption_public_key
    assert (listed["keyVersion"], listed["valueRevision"]) == (1, 1)
    assert listed["valueUpdatedAt"] is not None
    assert listed["valueUpdatedBy"] == {"id": str(space.member.id)}
    assert listed["authentication"] is None
    rendered = json.dumps(result.data)
    connection.refresh_from_db()
    assert connection.sealed_value not in rendered
    assert connection.key_copies.get().wrapped_key not in rendered
    for secret in SECRETS.values():
        assert secret not in rendered


def test_the_schema_offers_no_field_that_returns_the_sealed_value():
    fields = schema.graphql_schema.type_map["AgentConnectionType"].fields

    assert {"definition", "encryptionPublicKey"} <= set(fields)
    assert not {"sealedValue", "keyCopies", "wrappedKey"} & set(fields)
