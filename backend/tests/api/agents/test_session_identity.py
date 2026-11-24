import pytest

from tests.api.agents.test_runtime_authorization import _client, _runtime

CLIENT = {
    "name": "phase-cli",
    "version": "2.0.0",
    "supportedSchemaVersions": [1],
    "protocols": ["http"],
    "injectionActions": ["aws_sigv4"],
    "features": ["provider_rules"],
}


def _open(client, runtime, key):
    return client.post(
        "/v1/agents/sessions/",
        {
            "schemaVersion": 1,
            "workflowId": str(runtime["workflow"].id),
            "idempotencyKey": key,
            "client": CLIENT,
        },
        format="json",
    )


def _expected_principal(runtime, auth_type):
    if auth_type == "Agent":
        return {"type": "agent", "id": str(runtime["agent"].id)}
    return {"type": "user", "id": str(runtime["member"].id)}


def _session_responses(runtime, auth_type, key):
    client = _client(runtime, auth_type=auth_type)
    opened = _open(client, runtime, key)
    assert opened.status_code == 201, opened.content
    session_uid = opened.json()["sessionUid"]
    client.credentials(
        HTTP_X_PHASE_SESSION_CREDENTIAL=opened.json()["sessionCredential"]
    )
    config = client.get(f"/v1/agents/sessions/{session_uid}/config/")
    discover = client.get(f"/v1/agents/sessions/{session_uid}/discover/")
    assert config.status_code == 200, config.content
    assert discover.status_code == 200, discover.content
    return {"open": opened, "config": config, "discover": discover}


@pytest.mark.django_db
@pytest.mark.parametrize("auth_type", ["Agent", "User"])
def test_session_responses_name_the_organisation_and_principal(auth_type):
    runtime = _runtime(f"identity-{auth_type.lower()}", ["read"])

    for name, response in _session_responses(
        runtime, auth_type, f"identity-{auth_type.lower()}"
    ).items():
        body = response.json()
        assert body["schemaVersion"] == 1, name
        assert body["organisation"] == {"id": str(runtime["organisation"].id)}, name
        assert body["principal"] == _expected_principal(runtime, auth_type), name


@pytest.mark.django_db
def test_an_agent_principal_is_the_agent_not_the_member_who_minted_the_token():
    runtime = _runtime("identity-agent-not-member", ["read"])

    body = _open(_client(runtime), runtime, "identity-agent-not-member").json()

    assert body["principal"]["id"] == str(runtime["agent"].id)
    assert body["principal"]["id"] != str(runtime["member"].id)


@pytest.mark.django_db
@pytest.mark.parametrize("auth_type", ["Agent", "User"])
def test_a_session_never_names_another_organisation(auth_type):
    first = _runtime(f"identity-a-{auth_type.lower()}", ["read"])
    second = _runtime(f"identity-b-{auth_type.lower()}", ["read"])

    for runtime, other in ((first, second), (second, first)):
        responses = _session_responses(
            runtime, auth_type, f"identity-{runtime['organisation'].id}"
        )
        for name, response in responses.items():
            text = response.content.decode()
            body = response.json()
            assert body["organisation"]["id"] == str(runtime["organisation"].id), name
            assert str(other["organisation"].id) not in text, name
            assert str(other["agent"].id) not in text, name
            assert str(other["member"].id) not in text, name


@pytest.mark.django_db
def test_other_session_responses_do_not_carry_the_identity():
    runtime = _runtime("identity-elsewhere", ["read"])
    client = _client(runtime)
    session_uid = runtime["session"].session_uid

    for path in (
        f"/v1/agents/sessions/{session_uid}/context/",
        f"/v1/agents/sessions/{session_uid}/capabilities/",
    ):
        body = client.get(path).json()
        assert "organisation" not in body, path
        assert "principal" not in body, path
