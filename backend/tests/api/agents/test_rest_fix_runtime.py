"""What a session is sent is what it may have when it is sent: access is
checked again after a slow provider call, the policy comes from the grant that
was checked, and a grant made after the session opened respects what its client
listed."""

from datetime import timedelta
from uuid import uuid4

import pytest
from django.db import transaction
from django.utils import timezone

from api.models import AgentConnection, AgentSession, AgentWorkflowGrant
from api.utils import agent_credentials
from api.utils.agent_access import (
    end_connection_access,
    iso_timestamp,
)
from api.utils.agent_config import get_config_registry

from .custom_connections import (
    AWS_MATERIAL,
    CLIENT,
    POLICY_FEATURES,
    agent_client,
    bearer_definition,
    custom_connection,
    grant,
    live_packaged_connection,
    open_session,
    provider_credential,
    refused,
    use_test_server_keypair,
    workspace,
)


FRESH_SECRET = "fresh-secret-from-the-provider"


@pytest.fixture(autouse=True)
def no_provider_calls(monkeypatch):
    """No test here reaches AWS: the call is replaced before anything can make
    it, and fails the test unless the test supplies an answer."""

    use_test_server_keypair(monkeypatch)
    calls = []

    def assume_aws_role(*args, **kwargs):
        calls.append(args)
        if assume_aws_role.answer is None:
            raise AssertionError("This test did not expect a call to AWS")
        return assume_aws_role.answer()

    assume_aws_role.answer = None
    assume_aws_role.calls = calls
    monkeypatch.setattr("api.utils.syncing.aws.auth.assume_aws_role", assume_aws_role)
    agent_credentials._ASSUMED_ROLES.clear()
    yield assume_aws_role
    agent_credentials._ASSUMED_ROLES.clear()


@pytest.fixture
def space(db, no_provider_calls):
    space = workspace("rest-fix-runtime")
    space.client, _ = agent_client(space)
    return space


def _config(space, session):
    return space.client.get(f"/v1/agents/sessions/{session['sessionUid']}/config/")


def _temporary_keys():
    return {
        "AccessKeyId": "ASIAFRESHFRESHFRESH1",
        "SecretAccessKey": FRESH_SECRET,
        "SessionToken": "fresh-token",
        "Expiration": timezone.now() + timedelta(hours=1),
    }


# --- Access is checked again after the provider answers ------------------------


@pytest.fixture
def assumed(space, no_provider_calls):
    """A Workflow whose AWS Connection assumes a role, with a session open."""

    no_provider_calls.answer = _temporary_keys
    credential = provider_credential(
        space,
        "aws_assume_role",
        {"role_arn": "arn:aws:iam::123456789012:role/example", "region": "us-east-1"},
    )
    space.connection = AgentConnection.objects.create(
        organisation=space.organisation,
        name="Assumed role",
        service_type="aws",
        config=get_config_registry().validate_service_config("aws", {}),
        authentication=credential,
        state=AgentConnection.ACTIVE,
    )
    space.grant = grant(space, space.connection)
    space.session = open_session(space.client, space.workflow)
    # The next config call asks the provider again.
    agent_credentials._ASSUMED_ROLES.clear()
    return space


def test_assumed_role_keys_reach_a_session_that_still_has_access(assumed):
    response = _config(assumed, assumed.session)

    assert response.status_code == 200, response.content
    [payload] = response.json()["connections"]
    assert payload["secretMaterial"]["secretAccessKey"] == FRESH_SECRET


def _while_the_provider_answers(space, no_provider_calls, change):
    def answer():
        change()
        return _temporary_keys()

    no_provider_calls.answer = answer
    before = len(no_provider_calls.calls)
    response = _config(space, space.session)
    # The provider was asked, so the change happened while it answered.
    assert len(no_provider_calls.calls) == before + 1
    return response


def test_keys_are_not_released_to_a_session_revoked_while_aws_answered(
    assumed, no_provider_calls
):
    uid = assumed.session["sessionUid"]

    response = _while_the_provider_answers(
        assumed,
        no_provider_calls,
        lambda: AgentSession.objects.filter(pk=uid).update(revoked_at=timezone.now()),
    )

    refused(response, "credential_resolution_failed")
    assert FRESH_SECRET.encode() not in response.content
    refused(_config(assumed, assumed.session), "agent_session_revoked", 401)


def test_keys_are_not_released_for_a_grant_removed_while_aws_answered(
    assumed, no_provider_calls
):
    def revoke():
        with transaction.atomic():
            end_connection_access(
                AgentWorkflowGrant.objects.filter(id=assumed.grant.id)
            )

    response = _while_the_provider_answers(assumed, no_provider_calls, revoke)

    refused(response, "credential_resolution_failed")
    assert FRESH_SECRET.encode() not in response.content


def test_config_is_refused_when_the_session_is_revoked_before_it_is_sent(
    assumed, monkeypatch
):
    from api.views.agents import views

    real = views.resolve_workflow_config

    def resolve_then_revoke(session, **options):
        config = real(session, **options)
        AgentSession.objects.filter(pk=session.pk).update(revoked_at=timezone.now())
        return config

    monkeypatch.setattr(views, "resolve_workflow_config", resolve_then_revoke)

    response = _config(assumed, assumed.session)

    refused(response, "agent_session_revoked", 401)
    assert FRESH_SECRET.encode() not in response.content


# --- The policy sent is the one of the grant that was checked -------------------


def _allow(name="first"):
    return {
        "id": name,
        "class": "delete",
        "expiresAt": iso_timestamp(timezone.now() + timedelta(hours=1)),
        "requestId": "r",
    }


ASK_DELETES = {
    "version": 1,
    "default": "allow",
    "rules": [{"class": "delete", "effect": "ask"}],
}


@pytest.mark.parametrize("kind", ["custom", "packaged"])
def test_the_policy_sent_is_read_when_the_secret_is_released(space, monkeypatch, kind):
    from api.views.agents import runtime

    if kind == "custom":
        connection = custom_connection(space, bearer_definition(), name="GitHub")
        resolver = "resolve_custom_connection"
    else:
        connection = live_packaged_connection(space, "aws", AWS_MATERIAL)
        resolver = "resolve_agent_credential"
    AgentConnection.objects.filter(id=connection.id).update(policy=ASK_DELETES)
    granted = grant(space, connection)
    AgentWorkflowGrant.objects.filter(id=granted.id).update(
        temporary_allows=[_allow()]
    )
    session = open_session(space.client, space.workflow, features=POLICY_FEATURES)
    [opened] = session["connections"]
    assert [allow["id"] for allow in opened["policy"]["temporaryAllows"]] == ["first"]
    real = getattr(runtime, resolver)

    def change_then_resolve(*args, **kwargs):
        # A member ends the allow and blocks deletes after the session's
        # grants were listed, and before this one's secret is released.
        AgentWorkflowGrant.objects.filter(id=granted.id).update(temporary_allows=[])
        AgentConnection.objects.filter(id=connection.id).update(
            policy={**ASK_DELETES, "rules": [{"class": "delete", "effect": "block"}]}
        )
        return real(*args, **kwargs)

    monkeypatch.setattr(runtime, resolver, change_then_resolve)

    response = _config(space, session)

    assert response.status_code == 200, response.content
    [payload] = response.json()["connections"]
    assert payload["policy"]["temporaryAllows"] == []
    assert payload["policy"]["rules"] == [{"class": "delete", "effect": "block"}]


# --- A grant made after the session opened --------------------------------------


POSTGRES_MATERIAL = {
    "username": "u",
    "password": "pg-live-password",
    "host": "db.example.com",
}


def _open(space, **client):
    response = space.client.post(
        "/v1/agents/sessions/",
        {
            "schemaVersion": 1,
            "workflowId": str(space.workflow.id),
            "idempotencyKey": f"rest-fix-{uuid4().hex}",
            "client": {**CLIENT, **client},
        },
        format="json",
    )
    return response


@pytest.mark.parametrize(
    "client",
    [
        {"protocols": ["http"]},
        {"injectionActions": ["set_header", "aws_sigv4"]},
    ],
    ids=["protocol", "injection action"],
)
def test_a_later_grant_is_not_sent_to_a_client_that_cannot_enforce_it(space, client):
    opened = _open(space, **client)
    assert opened.status_code == 201, opened.content
    session = opened.json()
    space.client.credentials(
        HTTP_X_PHASE_SESSION_CREDENTIAL=session["sessionCredential"]
    )
    grant(space, live_packaged_connection(space, "postgres", POSTGRES_MATERIAL))

    response = _config(space, session)

    assert response.status_code == 200, response.content
    assert response.json()["connections"] == []
    assert b"pg-live-password" not in response.content
    # The same client is refused when it opens a session with that grant.
    refused(_open(space, **client), "client_capability_mismatch")


def test_a_later_grant_reaches_a_client_that_listed_what_it_needs(space):
    session = open_session(space.client, space.workflow)
    grant(space, live_packaged_connection(space, "postgres", POSTGRES_MATERIAL))

    [payload] = _config(space, session).json()["connections"]

    assert payload["protocol"] == "postgres"
    assert payload["secretMaterial"]["password"] == "pg-live-password"
