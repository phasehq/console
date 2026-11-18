"""What a proxy session receives for a custom HTTP Connection."""

import re

import pytest
from django.utils import timezone

from api.models import (
    AgentConnectionKeyCopy,
    AgentDecoy,
    AgentEvent,
    AgentSession,
    AgentWorkflowMembership,
    ProviderCredentials,
)
from api.utils import agent_credentials
from api.utils.agent_config import load_definition
from api.utils.agent_connection_values import write_custom_connection_value
from api.utils.agent_credentials import (
    CredentialResolutionError,
    resolve_custom_connection,
)
from api.utils.agent_sessions import create_agent_session
from api.utils.agents import mint_agent_token

from backend.graphene.agents.mutations import UpdateCustomAgentConnectionMutation

from ..custom_connections import (
    SECRETS,
    agent_client,
    bearer_definition,
    custom_connection,
    definition,
    grant,
    member_client,
    open_as_proxy,
    open_session,
    seal,
    use_test_server_keypair,
    workspace,
)


@pytest.fixture(autouse=True)
def server_keypair(monkeypatch):
    use_test_server_keypair(monkeypatch)


@pytest.fixture
def space(db):
    space = workspace("runtime")
    space.connection = custom_connection(space)
    space.grant = grant(space, space.connection)
    return space


def _only(payload):
    [connection] = payload["connections"]
    return connection


def _refresh(client, payload, endpoint="config"):
    response = client.get(f"/v1/agents/sessions/{payload['sessionUid']}/{endpoint}/")
    assert response.status_code == 200, response.content
    return response


def test_a_member_session_receives_the_resolved_value(space):
    payload = open_session(member_client(space), space.workflow)
    connection = _only(payload)

    assert connection["connectionId"] == str(space.connection.id)
    assert connection["grantId"] == str(space.grant.id)
    assert connection["connectionName"] == "Example API"
    assert connection["credentialId"] == str(space.connection.id)
    assert connection["credentialName"] == "Example API"
    assert connection["credentialProvider"] == "http"
    assert connection["credentialRevision"] == "1"
    assert connection["materialGeneration"] == "1.1"
    assert connection["serviceType"] == "http"
    assert connection["protocol"] == "http"
    assert connection["onRefresh"] == "none"
    assert connection["hosts"] == definition()["hosts"]
    assert connection["connectionConfig"] == definition()
    assert connection["configEnv"] == {}
    assert connection["identifiers"] == {"username": "alice"}
    assert connection["authorization"]["state"] == "allowed"
    assert connection["allowPlainHttp"] is False
    # The resolved lane holds exactly the secret fields, the same names a
    # sealed value has. Identifiers are never sent as secret material.
    assert connection["secretMaterial"] == SECRETS
    assert "sealedMaterial" not in connection
    assert "agentKey" not in payload


def test_the_payload_carries_the_compiled_injection_list(space):
    connection = _only(open_session(member_client(space), space.workflow))

    assert connection["injections"] == [
        {
            "action": "set_header",
            "name": "X-Api-Key",
            "valueFormat": "Token {value}",
            "valueFrom": {"source": "credential", "field": "token"},
            "whenAbsent": "attach",
        },
        {
            "action": "basic_auth",
            "name": "Authorization",
            "valueFrom": {
                "source": "credential",
                "fields": {"username": "username", "password": "password"},
            },
            "whenAbsent": "block",
        },
        {
            "action": "set_param",
            "name": "api_key",
            "valueFormat": "{value}",
            "valueFrom": {"source": "credential", "field": "token"},
            "whenAbsent": "attach",
        },
    ]
    # Clients that predate the list still validate the singular key.
    assert connection["injection"] == connection["injections"][0]


def test_every_secret_field_gets_a_decoy_and_the_environment_never_a_secret(space):
    connection = _only(open_session(member_client(space), space.workflow))
    decoys = connection["decoyMaterial"]

    assert set(decoys) == {"token", "password"}
    assert re.fullmatch(r"sk-[A-Za-z0-9]{32}", decoys["token"])
    assert re.fullmatch(r"[A-Za-z0-9]{32}", decoys["password"])
    assert connection["agentEnv"] == {
        "EXAMPLE_API_KEY": decoys["token"],
        "EXAMPLE_USER": "alice",
    }
    assert connection["environmentBindings"] == [
        {
            "name": "EXAMPLE_API_KEY",
            "action": "set",
            "source": "decoy",
            "sourceField": "token",
            "sensitive": True,
            "systemManaged": True,
        },
        {
            "name": "EXAMPLE_USER",
            "action": "set",
            "source": "identifier",
            "sourceField": "username",
            "sensitive": False,
            "systemManaged": True,
        },
    ]
    stored = AgentDecoy.objects.filter(grant=space.grant)
    assert {decoy.field_name for decoy in stored} == {"token", "password"}
    assert all(decoy.authentication_id is None for decoy in stored)


def test_an_agent_token_session_receives_the_value_still_sealed(space):
    client, full_token = agent_client(space)

    response = client.post(
        "/v1/agents/sessions/",
        {
            "schemaVersion": 1,
            "idempotencyKey": "sealed-lane-session",
            "client": {
                "supportedSchemaVersions": [1],
                "protocols": ["http"],
                "injectionActions": ["set_header", "set_param", "basic_auth"],
                "features": ["injection_list", "when_absent", "sealed_material"],
            },
        },
        format="json",
    )

    assert response.status_code == 201, response.content
    payload = response.json()
    connection = _only(payload)
    space.connection.refresh_from_db()
    copy = space.connection.key_copies.get(agent=space.agent)
    assert connection["sealedMaterial"] == {
        "version": 1,
        "keyVersion": 1,
        "publicKey": space.connection.encryption_public_key,
        "ciphertext": space.connection.sealed_value,
        "wrappedKey": copy.wrapped_key,
    }
    assert "secretMaterial" not in connection
    assert payload["agentKey"] == {
        "wrappedKeyShare": client.agent_token.wrapped_key_share
    }
    # The server never opened the value, and nothing it sent holds it.
    for secret in SECRETS.values():
        assert secret not in response.content.decode()
    # Identifiers and decoys do not depend on the lane.
    assert connection["identifiers"] == {"username": "alice"}
    assert set(connection["decoyMaterial"]) == {"token", "password"}
    assert connection["materialGeneration"] == "1.1"

    opened = open_as_proxy(full_token, payload, connection)
    assert opened == {
        "v": 1,
        "hosts": [{"match": "exact", "value": "api.example.com", "port": 443}],
        "fields": SECRETS,
    }


def test_the_sealed_lane_needs_both_an_agent_token_and_a_capable_client(space):
    without_feature, _ = agent_client(space)
    as_agent = open_session(
        without_feature, space.workflow, features=["injection_list", "when_absent"]
    )
    as_member = open_session(member_client(space), space.workflow)

    for payload in (as_agent, as_member):
        connection = _only(payload)
        assert connection["secretMaterial"]["token"] == SECRETS["token"]
        assert "sealedMaterial" not in connection
        assert "agentKey" not in payload


def test_the_sealed_lane_falls_back_when_the_agent_holds_no_current_copy(space):
    AgentConnectionKeyCopy.objects.filter(agent=space.agent).update(key_version=7)
    client, _ = agent_client(space)

    payload = open_session(client, space.workflow)

    assert _only(payload)["secretMaterial"]["token"] == SECRETS["token"]
    assert "agentKey" not in payload


def test_a_session_is_refused_when_neither_lane_can_release_the_value(space):
    space.connection.key_copies.filter(
        reader_type=AgentConnectionKeyCopy.SERVER
    ).delete()
    client = member_client(space)

    response = client.post(
        "/v1/agents/sessions/",
        {
            "schemaVersion": 1,
            "workflowId": str(space.workflow.id),
            "idempotencyKey": "no-lane-session",
            "client": {
                "supportedSchemaVersions": [1],
                "protocols": ["http"],
                "injectionActions": ["set_header", "set_param", "basic_auth"],
                "features": ["injection_list", "when_absent", "sealed_material"],
            },
        },
        format="json",
    )

    assert response.status_code == 400, response.content
    error = response.json()["error"]
    assert error["code"] == "credential_resolution_failed"
    assert "cannot be released to this session" in error["details"]["reason"]
    event = AgentEvent.objects.get(event_type="credential_resolution_error")
    assert str(event.connection_id) == str(space.connection.id)
    assert event.provider == "http"

    # An Agent that holds a copy can still open it without the server.
    agent, full_token = agent_client(space)
    payload = open_session(agent, space.workflow)
    assert open_as_proxy(full_token, payload, _only(payload))["fields"] == SECRETS


@pytest.mark.parametrize(
    "features,actions,missing_features,missing_actions",
    [
        (None, None, ["injection_list", "when_absent"], ["basic_auth", "set_param"]),
        (["injection_list"], ["set_header", "set_param"], ["when_absent"], ["basic_auth"]),
        (["sealed_material"], ["set_header", "set_param", "basic_auth"], ["injection_list", "when_absent"], []),
        (["injection_list", "when_absent"], ["set_header"], [], ["basic_auth", "set_param"]),
    ],
)
def test_a_client_that_cannot_enforce_the_connection_is_refused(
    space, features, actions, missing_features, missing_actions
):
    client = {"supportedSchemaVersions": [1], "protocols": ["http"]}
    client["injectionActions"] = ["aws_sigv4", "set_header"] if actions is None else actions
    if features is not None:
        client["features"] = features

    response = member_client(space).post(
        "/v1/agents/sessions/",
        {
            "schemaVersion": 1,
            "workflowId": str(space.workflow.id),
            "idempotencyKey": "capability-mismatch",
            "client": client,
        },
        format="json",
    )

    assert response.status_code == 400, response.content
    error = response.json()["error"]
    assert error["code"] == "client_capability_mismatch"
    assert error["details"] == {
        "missingProtocols": [],
        "missingInjectionActions": missing_actions,
        "missingEnvironmentBindingSources": [],
        "missingFeatures": missing_features,
    }
    assert not AgentSession.objects.filter(workflow=space.workflow).exists()


def test_basic_auth_is_needed_only_by_a_definition_that_uses_it(db):
    space = workspace("bearer")
    grant(space, custom_connection(space, bearer_definition()))

    payload = open_session(
        member_client(space),
        space.workflow,
        features=["injection_list", "when_absent"],
        actions=["set_header"],
    )

    assert _only(payload)["injections"][0]["valueFormat"] == "Bearer {value}"
    assert _only(payload)["secretMaterial"] == {"token": SECRETS["token"]}


def test_features_must_be_a_list_of_strings(space):
    response = member_client(space).post(
        "/v1/agents/sessions/",
        {
            "schemaVersion": 1,
            "workflowId": str(space.workflow.id),
            "idempotencyKey": "malformed-features",
            "client": {
                "supportedSchemaVersions": [1],
                "protocols": ["http"],
                "injectionActions": ["set_header"],
                "features": "injection_list",
            },
        },
        format="json",
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_client"


def test_a_session_whose_client_cannot_enforce_it_is_not_sent_a_new_connection(db):
    """A custom Connection granted after a session opened is left out for a
    client that never said it could enforce one."""

    space = workspace("late-grant")
    old = member_client(space)
    old_session = open_session(old, space.workflow, features=[], actions=["set_header"])
    new = member_client(space)
    new_session = open_session(new, space.workflow)
    assert old_session["connections"] == new_session["connections"] == []

    grant(space, custom_connection(space))

    for endpoint in ("config", "discover"):
        assert _refresh(old, old_session, endpoint).json()["connections"] == []
    assert _only(_refresh(new, new_session).json())["serviceType"] == "http"
    old_context = _refresh(old, old_session, "context").json()["markdown"]
    assert "Example API" not in old_context
    assert "Example API" in _refresh(new, new_session, "context").json()["markdown"]


def test_discover_carries_neither_lane(space):
    client, _ = agent_client(space)
    opened = open_session(client, space.workflow)

    response = _refresh(client, opened, "discover")

    discovered = _only(response.json())
    rendered = response.content.decode()
    for absent in ("secretMaterial", "sealedMaterial", "agentKey", "ciphertext"):
        assert absent not in rendered
    for secret in SECRETS.values():
        assert secret not in rendered
    space.connection.refresh_from_db()
    assert space.connection.sealed_value not in rendered
    for field in (
        "grantId",
        "connectionId",
        "connectionName",
        "credentialId",
        "credentialName",
        "credentialProvider",
        "credentialRevision",
        "materialGeneration",
        "serviceType",
        "protocol",
        "hosts",
        "connectionConfig",
        "configEnv",
        "injection",
        "injections",
        "allowPlainHttp",
        "onRefresh",
        "identifiers",
        "decoyMaterial",
        "agentEnv",
        "environmentBindings",
        "authorization",
    ):
        assert discovered[field] == _only(opened)[field], field


def test_plain_http_is_carried_on_the_connection_when_the_definition_allows_it(db):
    space = workspace("plain-http")
    allowed = {**bearer_definition(), "allowPlainHttp": True}
    grant(space, custom_connection(space, allowed))
    client = member_client(space)

    opened = open_session(client, space.workflow)
    discovered = _refresh(client, opened, "discover").json()

    for payload in (opened, discovered):
        connection = _only(payload)
        assert connection["allowPlainHttp"] is True
        assert connection["connectionConfig"]["allowPlainHttp"] is True
    # The CLI compares the two responses and fails discover when they differ.
    for key in ("injection", "injections", "allowPlainHttp"):
        assert _only(discovered)[key] == _only(opened)[key]


def test_decoys_survive_definition_and_value_changes(space):
    """Decoys belong to the session, the grant and the field, so the Agent's
    environment stays as it was and a running session can take the change."""

    member = member_client(space)
    agent, _ = agent_client(space)
    sessions = [
        (member, open_session(member, space.workflow)),
        (agent, open_session(agent, space.workflow)),
    ]
    before = [
        (_only(opened)["decoyMaterial"], _only(opened)["agentEnv"])
        for _, opened in sessions
    ]
    assert before[0][0] != before[1][0]
    stored = set(AgentDecoy.objects.values_list("id", "decoy_value"))

    def unchanged(generation):
        for (client, opened), (decoys, environment) in zip(sessions, before):
            for endpoint in ("config", "discover"):
                connection = _only(_refresh(client, opened, endpoint).json())
                assert connection["decoyMaterial"] == decoys
                assert connection["agentEnv"] == environment
                assert connection["materialGeneration"] == generation
        assert set(AgentDecoy.objects.values_list("id", "decoy_value")) == stored

    # A definition change: another path, another injection mode, another
    # decoy prefix for a field that already has its decoy.
    changed = definition()
    changed["hosts"][0]["path"] = "/v2/*"
    changed["injections"][0]["whenAbsent"] = "block"
    changed["fields"][0]["decoyPrefix"] = "other-"
    UpdateCustomAgentConnectionMutation.mutate(
        None, space.info, connection_id=space.connection.id, definition=changed
    )
    unchanged("1.1")
    assert _only(_refresh(member, sessions[0][1]).json())["hosts"][0]["path"] == "/v2/*"

    space.connection.refresh_from_db()
    UpdateCustomAgentConnectionMutation.mutate(
        None,
        space.info,
        connection_id=space.connection.id,
        sealed_value=seal(
            changed,
            space.connection.encryption_public_key,
            fields={"token": "second-token", "password": "second-password"},
        ),
    )
    unchanged("1.2")
    refreshed = _refresh(member, sessions[0][1]).json()
    assert _only(refreshed)["secretMaterial"]["token"] == "second-token"


def test_the_proxys_events_for_a_custom_connection_are_accepted(space):
    """The proxy names the first injection's action and ``http`` as provider."""

    client = member_client(space)
    opened = open_session(client, space.workflow)

    response = client.post(
        f"/v1/agents/sessions/{opened['sessionUid']}/events/",
        {
            "schemaVersion": 1,
            "batchId": "custom-connection-events",
            "events": [
                {
                    "eventId": f"event-{index}",
                    "createdAt": "2026-11-13T10:00:00.000000Z",
                    "grantId": str(space.grant.id),
                    "eventType": "request",
                    "protocol": "http",
                    "method": "GET",
                    "host": "api.example.com",
                    "port": 443,
                    "path": "/v1/items",
                    "provider": "http",
                    "statusCode": 200,
                    "proxyDecision": "allow",
                    "outcome": "success",
                    "credentialAction": action,
                }
                for index, action in enumerate(
                    ("basic_auth", "set_header", "set_param")
                )
            ],
        },
        format="json",
    )

    assert response.status_code == 202, response.content
    assert response.json()["accepted"] == 3
    events = AgentEvent.objects.filter(session_id=opened["sessionUid"])
    assert {event.credential_action for event in events} == {
        "basic_auth",
        "set_header",
        "set_param",
    }
    assert {event.provider for event in events} == {"http"}
    assert {str(event.connection_id) for event in events} == {str(space.connection.id)}


def test_a_new_value_reaches_a_refresh_without_changing_the_decoys(space):
    client = member_client(space)
    session = open_session(client, space.workflow)
    opened = _only(session)
    space.connection.refresh_from_db()

    write_custom_connection_value(
        space.connection,
        seal(
            definition(),
            space.connection.encryption_public_key,
            fields={"token": "second-token", "password": "second-password"},
        ),
        space.member,
    )
    refreshed = _only(_refresh(client, session).json())

    assert refreshed["secretMaterial"]["token"] == "second-token"
    assert refreshed["credentialRevision"] == "2"
    assert refreshed["materialGeneration"] == "1.2"
    assert refreshed["decoyMaterial"] == opened["decoyMaterial"]
    assert refreshed["agentEnv"] == opened["agentEnv"]


def test_a_refresh_keeps_sending_the_agent_key_with_a_sealed_value(space):
    client, full_token = agent_client(space)
    opened = open_session(client, space.workflow)

    refreshed = _refresh(client, opened).json()

    assert refreshed["agentKey"] == opened["agentKey"]
    assert open_as_proxy(full_token, refreshed, _only(refreshed))["fields"] == SECRETS


def _direct_session(space, *, with_token):
    token = None
    if with_token:
        token, _, _ = mint_agent_token(
            agent=space.agent,
            workflow=space.workflow,
            name="direct",
            created_by=space.member,
        )
    session, _, _ = create_agent_session(
        agent=space.agent,
        workflow=space.workflow,
        agent_token=token,
        opened_by_member=None if with_token else space.member,
        client_info={"features": ["sealed_material"]},
    )
    return session, token


def _release(space, session, *, sealed):
    return resolve_custom_connection(
        session, space.grant, load_definition(space.connection.config), sealed=sealed
    )


def _no_release(monkeypatch):
    def released(*args, **kwargs):
        pytest.fail("the value was released after an authorization check failed")

    for release in (
        "sealed_material_for_agent",
        "server_key_copy_for_release",
        "open_value_with_server_copy",
    ):
        monkeypatch.setattr(agent_credentials, release, released)


@pytest.mark.parametrize("sealed", [True, False])
def test_both_lanes_recheck_the_agent_token_before_releasing(
    space, monkeypatch, sealed
):
    session, token = _direct_session(space, with_token=True)
    assert _release(space, session, sealed=sealed).generation == "1.1"
    _no_release(monkeypatch)

    token.delete()

    with pytest.raises(CredentialResolutionError, match="no longer active"):
        _release(space, session, sealed=sealed)


@pytest.mark.parametrize("sealed", [True, False])
@pytest.mark.parametrize(
    "revoke,message",
    [
        (
            lambda space, session: AgentWorkflowMembership.objects.filter(
                workflow=space.workflow
            ).update(deleted_at=timezone.now()),
            "access has been revoked",
        ),
        (lambda space, session: space.grant.delete(), "unavailable"),
        (
            lambda space, session: AgentSession.objects.filter(pk=session.pk).update(
                revoked_at=timezone.now()
            ),
            "unavailable",
        ),
        (
            lambda space, session: AgentSession.objects.filter(pk=session.pk).update(
                expires_at=timezone.now()
            ),
            "unavailable",
        ),
        (
            lambda space, session: type(space.connection)
            .objects.filter(pk=space.connection.pk)
            .update(state="disabled"),
            "unavailable",
        ),
        (
            lambda space, session: type(space.agent)
            .objects.filter(pk=space.agent.pk)
            .update(status="disabled"),
            "unavailable",
        ),
    ],
)
def test_both_lanes_recheck_every_binding_before_releasing(
    space, monkeypatch, sealed, revoke, message
):
    session, _ = _direct_session(space, with_token=sealed)
    _no_release(monkeypatch)

    revoke(space, session)

    with pytest.raises(CredentialResolutionError, match=message):
        _release(space, session, sealed=sealed)


def test_a_value_is_not_released_for_hosts_it_was_not_sealed_for(space):
    """The stored hosts and the sealed hosts must describe the same set."""

    session, _ = _direct_session(space, with_token=False)
    moved = definition(
        hosts=[{"match": "exact", "value": "api.attacker.example", "port": 443}]
    )

    # The caller's definition no longer matches what is stored.
    with pytest.raises(CredentialResolutionError, match="changed while"):
        resolve_custom_connection(session, space.grant, moved, sealed=False)

    # The stored definition was moved without re-sealing the value.
    type(space.connection).objects.filter(pk=space.connection.pk).update(config=moved)
    with pytest.raises(CredentialResolutionError, match="different hosts"):
        resolve_custom_connection(session, space.grant, moved, sealed=False)
    response = open_session(member_client(space), space.workflow, expect=400)
    assert response["error"]["code"] == "credential_resolution_failed"
    assert SECRETS["token"] not in str(response)


def test_a_sealed_release_is_also_refused_when_the_definition_moved(space):
    session, _ = _direct_session(space, with_token=True)
    moved = definition(
        hosts=[{"match": "exact", "value": "api.attacker.example", "port": 443}]
    )

    with pytest.raises(CredentialResolutionError, match="changed while"):
        resolve_custom_connection(session, space.grant, moved, sealed=True)


def test_a_custom_connection_must_not_have_an_integration_credential(space):
    credential = ProviderCredentials.objects.create(
        organisation=space.organisation, provider="aws", name="AWS", credentials={}
    )
    type(space.connection).objects.filter(pk=space.connection.pk).update(
        authentication=credential
    )

    response = open_session(member_client(space), space.workflow, expect=400)

    assert response["error"]["code"] == "invalid_workflow_configuration"


def test_a_stored_definition_that_no_longer_validates_fails_closed(space):
    broken = definition()
    broken["specVersion"] = 99
    type(space.connection).objects.filter(pk=space.connection.pk).update(config=broken)

    response = open_session(member_client(space), space.workflow, expect=400)

    assert response["error"]["code"] == "invalid_workflow_configuration"
    assert "specVersion" in response["error"]["message"]


def test_context_describes_a_custom_connection_without_its_secret(space):
    client = member_client(space)
    opened = open_session(client, space.workflow)
    base = f"/v1/agents/sessions/{opened['sessionUid']}/context/"

    everything = client.get(base)
    only_http = client.get(base, {"serviceType": "http"})
    unknown = client.get(base, {"serviceType": "smtp"})

    assert everything.status_code == only_http.status_code == 200
    markdown = only_http.json()["markdown"]
    assert only_http.json()["serviceType"] == "http"
    assert everything.json()["markdown"] == markdown
    assert "### Example API" in markdown
    assert "api.example.com:443/v1/*" in markdown
    assert "the X-Api-Key header" in markdown
    assert "HTTP Basic authentication as alice" in markdown
    assert "EXAMPLE_API_KEY (token)" in markdown
    for secret in SECRETS.values():
        assert secret not in markdown
    assert unknown.status_code == 404


def test_context_for_http_without_a_grant_says_so(db):
    space = workspace("no-grant")
    client = member_client(space)
    opened = open_session(client, space.workflow)

    response = client.get(
        f"/v1/agents/sessions/{opened['sessionUid']}/context/", {"serviceType": "http"}
    )

    assert response.status_code == 200, response.content
    assert response.json()["markdown"].startswith("### Custom HTTP")
    assert "no granted Connection" in response.json()["markdown"]


def test_capabilities_list_only_packaged_services(space):
    """Existing clients reject a service without matchers, so custom
    Connections stay out of this list and travel in the session config."""

    client = member_client(space)
    opened = open_session(client, space.workflow)

    response = _refresh(client, opened, "capabilities")

    services = response.json()["services"]
    assert "http" not in [service["serviceType"] for service in services]
    assert {"aws", "postgres", "github"} <= {
        service["serviceType"] for service in services
    }
    assert all(service["connectionIds"] == [] for service in services)
    assert all(service["clientMatchers"] for service in services)
