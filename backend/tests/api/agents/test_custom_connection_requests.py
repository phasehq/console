"""Requests that carry a typed action: requesting, reviewing and applying them."""

from datetime import timedelta

import pytest
from django.test import RequestFactory
from django.utils import timezone
from graphql import GraphQLError

from api.models import (
    AgentConnection,
    AgentConnectionKeyCopy,
    AgentMembership,
    AgentRequest,
    AgentSession,
    AgentWorkflowGrant,
    AgentWorkflowMembership,
    AuditEvent,
    ProviderCredentials,
)
from api.utils.agent_config import get_config_registry
from api.utils.agents import create_agent_with_default_workflow, create_agent_workflow
from api.utils.request_actions import (
    ActionError,
    ActionHandler,
    AppliedAction,
    action_handler,
    register,
)
from api.utils import request_actions
from backend.graphene.agents.mutations import (
    ApproveAgentRequestActionMutation,
    FulfillAgentRequestMutation,
    ResolveAgentRequestMutation,
    UpdateCustomAgentConnectionMutation,
)
from backend.schema import schema

from .custom_connections import (
    ACTIONS,
    SECRETS,
    add_member,
    agent_client,
    bearer_definition,
    custom_connection,
    grant,
    info,
    new_keys,
    open_as_proxy,
    open_session,
    seal,
    use_test_server_keypair,
    workspace,
)


_PACKAGED_RESPONSE_KEYS = {
    "schemaVersion",
    "id",
    "revision",
    "title",
    "workflowId",
    "status",
    "kind",
    "markdown",
    "serviceType",
    "credentialProvider",
    "credentialName",
    "connectionId",
    "grantId",
    "credentialId",
    "credentialRevision",
    "progress",
    "resolution",
    "relatedRequestId",
    "resolutionNote",
    "resolvedAt",
    "requestExpiresAt",
    "createdAt",
    "updatedAt",
}


@pytest.fixture(autouse=True)
def server_keypair(monkeypatch):
    use_test_server_keypair(monkeypatch)


@pytest.fixture
def space(db):
    space = workspace("requests")
    space.client, space.full_token = agent_client(space)
    space.session = open_session(space.client, space.workflow)
    return space


def _ask(space, client=None, **body):
    return (client or space.client).post(
        "/v1/agents/requests/", {"schemaVersion": 1, **body}, format="json"
    )


def _create_action(name="Example API", connection_definition=None, **members):
    return {
        "type": "agent_connection.create",
        "version": 1,
        "serviceType": "http",
        "name": name,
        "definition": connection_definition or bearer_definition(),
        **members,
    }


def _action(action_type, connection, **members):
    return {
        "type": f"agent_connection.{action_type}",
        "version": 1,
        "connectionId": str(connection.id),
        **members,
    }


def _granted_connection(space, connection_definition=None, name="Example API"):
    connection = custom_connection(
        space, connection_definition or bearer_definition(path="/v1/*"), name=name
    )
    connection.granted = grant(space, connection)
    return connection


def _filed(response):
    assert response.status_code == 201, response.content
    return AgentRequest.objects.get(id=response.json()["id"])


def _approve(space, agent_request, member_info=None, **arguments):
    return ApproveAgentRequestActionMutation.mutate(
        None,
        member_info or space.info,
        request_id=agent_request.id,
        expected_revision=str(agent_request.revision),
        **arguments,
    )


def _key_inputs(connection_definition, keys=None, **fields):
    keys = keys or new_keys()
    return {
        "encryptionPublicKey": keys.public_key,
        "sealedValue": seal(connection_definition, keys.public_key, **fields),
        "serverWrappedKey": keys.server_wrapped_key,
    }


def _granted_access(agent_request, seconds=3600):
    """The record of what was asked for and granted on an approved request."""

    access = agent_request.applied_action["access"]
    assert access["requestedDurationSeconds"] == agent_request.duration_seconds
    assert access["grantedDurationSeconds"] == seconds
    assert access["expiresAt"].endswith("Z")
    return access


def _pending(agent_request):
    agent_request.refresh_from_db()
    return agent_request.status == AgentRequest.PENDING


def _poll(space, agent_request):
    response = space.client.get(f"/v1/agents/requests/{agent_request.id}/")
    assert response.status_code == 200, response.content
    return response.json()


def _config(space):
    response = space.client.get(
        f"/v1/agents/sessions/{space.session['sessionUid']}/config/"
    )
    assert response.status_code == 200, response.content
    return response.json()


def _assert_names_its_connection_and_grant(space, agent_request, connection):
    """Every approved response carries both ids, whatever the action did."""

    polled = _poll(space, agent_request)
    assert polled["status"] == "approved"
    assert polled["connectionId"] == str(connection.id)
    assert polled["grantId"] == str(connection.granted.id)
    assert polled["resolution"]["connectionId"] == str(connection.id)
    assert polled["resolution"]["grantId"] == str(connection.granted.id)
    return polled


def _generation(space):
    return AgentSession.objects.get(
        pk=space.session["sessionUid"]
    ).config_generation


# Requesting


def test_an_agent_requests_a_new_custom_connection(space):
    response = _ask(space, kind="setup", action=_create_action())

    assert response.status_code == 201, response.content
    body = response.json()
    assert body["status"] == "pending"
    assert body["kind"] == "setup"
    # Free text is optional beside an action, and the title is filled in.
    assert body["markdown"] == ""
    assert body["title"] == "Add Connection: Example API"
    assert body["action"] == _create_action()
    assert "appliedAction" not in body
    assert body["serviceType"] == "http"
    assert body["credentialProvider"] == "http"
    assert body["credentialName"] == "Example API"
    assert body["connectionId"] is None
    assert body["progress"] == {"stage": "awaiting_approval"}
    stored = AgentRequest.objects.get(id=body["id"])
    assert stored.action == _create_action()
    assert stored.applied_action == {}
    assert stored.approval == {}
    # Nothing exists until a member approves and enters the secret.
    assert not AgentConnection.objects.filter(organisation=space.organisation).exists()


def test_the_callers_title_and_markdown_are_kept(space):
    response = _ask(
        space,
        title="  Allow the Example API  ",
        markdown="The deploy step calls it.",
        action=_create_action(),
    )

    body = response.json()
    assert response.status_code == 201, response.content
    assert body["title"] == "Allow the Example API"
    assert body["markdown"] == "The deploy step calls it."
    # The kind follows from the action when it is not given.
    assert body["kind"] == "setup"


@pytest.mark.parametrize(
    "title,code",
    [
        ("x" * 121, "invalid_request_title"),
        ("two\nlines", "invalid_request_title"),
        (7, "invalid_request_title"),
        ("use ghp_" + "a" * 24, "credential_in_request_title"),
    ],
)
def test_a_title_is_short_plain_text(space, title, code):
    response = _ask(space, title=title, action=_create_action())

    assert response.status_code == 400
    assert response.json()["error"]["code"] == code


def test_a_requested_definition_is_stored_canonical(space):
    loose = bearer_definition()
    del loose["injections"][0]["whenAbsent"]
    loose["fields"][0]["decoyPrefix"] = ""

    stored = _filed(_ask(space, action=_create_action(connection_definition=loose)))

    assert stored.action["definition"] == bearer_definition()


def _smuggled_definition(**changes):
    smuggled = bearer_definition()
    for path, value in changes.items():
        target = smuggled
        steps = path.split("__")
        for step in steps[:-1]:
            target = target[int(step) if step.isdigit() else step]
        target[steps[-1]] = value
    return smuggled


@pytest.mark.parametrize(
    "action,code",
    [
        (
            lambda: _create_action(
                connection_definition=_smuggled_definition(fields__0__value="hunter2")
            ),
            "invalid_connection_definition",
        ),
        (
            lambda: _create_action(
                connection_definition=_smuggled_definition(
                    injections__0__prefix="Bearer sk-live-abcdefghijklmnop"
                )
            ),
            "credential_in_request_action",
        ),
        (
            lambda: _create_action(
                connection_definition={
                    **bearer_definition(),
                    "fields": [
                        *bearer_definition()["fields"],
                        {
                            "name": "account",
                            "kind": "identifier",
                            "value": "ghp_" + "a" * 24,
                        },
                    ],
                }
            ),
            "credential_in_request_action",
        ),
        (
            lambda: _create_action(name="AKIAABCDEFGHIJKLMNOP"),
            "credential_in_request_action",
        ),
        (lambda: _create_action(sealedValue="ph:v1:00:AA"), "invalid_request_action"),
        (lambda: _create_action(value="hunter2"), "invalid_request_action"),
        (
            lambda: _create_action(
                connection_definition={**bearer_definition(), "secret": "hunter2"}
            ),
            "invalid_connection_definition",
        ),
    ],
)
def test_a_request_cannot_smuggle_a_secret_value(space, action, code):
    response = _ask(space, action=action())

    assert response.status_code == 400, response.content
    assert response.json()["error"]["code"] == code
    assert not AgentRequest.objects.filter(workflow=space.workflow).exists()


def test_asking_for_a_new_secret_never_carries_one(space):
    connection = _granted_connection(space)

    for smuggled in ("value", "sealedValue", "secret", "fields"):
        response = _ask(
            space, action=_action("secret_update", connection, **{smuggled: "hunter2"})
        )
        assert response.status_code == 400, response.content
        assert response.json()["error"]["code"] == "invalid_request_action"
    assert not AgentRequest.objects.filter(workflow=space.workflow).exists()


@pytest.mark.parametrize("action_type", ["update", "secret_update", "remove"])
def test_an_agent_can_only_target_a_connection_granted_to_its_workflow(
    space, action_type
):
    members = {"name": "Mine now"} if action_type == "update" else {}
    ungranted = custom_connection(space, bearer_definition(), name="Not granted")
    elsewhere = create_agent_workflow(
        agent=space.agent, name="Elsewhere", created_by=space.member
    )
    other_workflows = custom_connection(space, bearer_definition(), name="Elsewhere")
    grant(space, other_workflows, elsewhere)
    revoked = custom_connection(space, bearer_definition(), name="Revoked")
    grant(space, revoked).delete()
    foreign_space = workspace("foreign")
    foreign = custom_connection(foreign_space, bearer_definition())
    grant(foreign_space, foreign)

    for connection in (ungranted, other_workflows, revoked, foreign):
        response = _ask(space, action=_action(action_type, connection, **members))
        assert response.status_code == 404, response.content
        assert response.json()["error"]["code"] == "connection_not_in_workflow"
    response = _ask(
        space, action={**_action(action_type, ungranted, **members), "connectionId": 7}
    )
    assert response.json()["error"]["code"] == "connection_id_required"
    assert not AgentRequest.objects.filter(workflow=space.workflow).exists()


@pytest.mark.parametrize(
    "action",
    [
        {"type": "agent_connection.rotate", "version": 1},
        {"type": "app_environment.grant", "version": 1},
        {"type": 7, "version": 1},
        {"version": 1},
        {**_create_action(), "version": 2},
        {**_create_action(), "version": "1"},
        {**_create_action(), "version": True},
    ],
)
def test_unknown_action_types_and_versions_are_refused(space, action):
    response = _ask(space, action=action)

    assert response.status_code == 400, response.content
    assert response.json()["error"]["code"] == "unsupported_request_action"


def test_an_action_must_be_an_object(space):
    response = _ask(space, action="agent_connection.create")

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_request_action"


def test_the_kind_must_match_the_action(space):
    connection = _granted_connection(space)

    mismatched = _ask(space, kind="setup", action=_action("remove", connection))
    unknown = _ask(space, kind="deletion", action=_action("remove", connection))
    derived = _ask(space, action=_action("remove", connection))

    assert mismatched.json()["error"]["code"] == "request_kind_mismatch"
    assert unknown.json()["error"]["code"] == "invalid_request_kind"
    assert derived.json()["kind"] == "connection_removal"


def test_an_action_names_its_own_target(space):
    connection = _granted_connection(space)

    for packaged in (
        {"connectionId": str(connection.id)},
        {"serviceType": "http"},
        {"credentialName": "Example"},
        {"credentialProvider": "aws"},
        {"credentialId": "anything"},
    ):
        response = _ask(space, action=_action("remove", connection), **packaged)
        assert response.status_code == 400, response.content
        assert response.json()["error"]["code"] == "unexpected_request_field"


def test_the_new_kinds_need_an_action(space):
    for body in (
        {"kind": "connection_update", "markdown": "Please change it."},
        {"kind": "connection_removal", "markdown": "Please remove it."},
        {
            "kind": "setup",
            "serviceType": "http",
            "credentialProvider": "http",
            "credentialName": "Example API",
            "markdown": "Please add it.",
        },
    ):
        response = _ask(space, **body)
        assert response.status_code == 400, response.content
        assert response.json()["error"]["code"] == "action_required"


def test_actions_for_custom_connections_refuse_packaged_ones(space):
    credential = ProviderCredentials.objects.create(
        organisation=space.organisation, provider="aws", name="AWS", credentials={}
    )
    aws = AgentConnection.objects.create(
        organisation=space.organisation,
        name="AWS",
        service_type="aws",
        config=get_config_registry().validate_service_config("aws", {}),
        authentication=credential,
        state=AgentConnection.ACTIVE,
    )
    AgentWorkflowGrant.objects.create(
        organisation=space.organisation,
        workflow=space.workflow,
        connection=aws,
        created_by=space.member,
    )

    packaged_create = _ask(
        space, action={**_create_action(), "serviceType": "aws"}
    )
    update = _ask(space, action=_action("update", aws, name="Renamed"))
    secret = _ask(space, action=_action("secret_update", aws))
    removal = _ask(space, action=_action("remove", aws))

    assert packaged_create.json()["error"]["code"] == "service_not_supported"
    assert update.json()["error"]["code"] == "connection_not_custom"
    assert secret.json()["error"]["code"] == "connection_not_custom"
    # Any granted Connection can be handed back.
    assert removal.status_code == 201, removal.content
    assert removal.json()["title"] == f"Remove AWS from {space.workflow.name}"
    assert removal.json()["credentialProvider"] == "aws"


def test_requests_without_an_action_keep_their_shape(space):
    body = {
        "kind": "setup",
        "serviceType": "aws",
        "credentialProvider": "aws",
        "credentialName": "AWS deploy",
        "dedupKey": "packaged-setup",
    }

    without_markdown = _ask(space, **body)
    filed = _ask(space, markdown="Connect this Workflow to AWS.", **body)

    assert without_markdown.status_code == 400
    assert without_markdown.json()["error"]["code"] == "invalid_request_markdown"
    assert filed.status_code == 201, filed.content
    # A setup ends in access, so it names how long that was asked to last.
    assert set(filed.json()) - {"approvalUrl"} == _PACKAGED_RESPONSE_KEYS | {
        "durationSeconds"
    }
    assert filed.json()["durationSeconds"] == 3600
    stored = AgentRequest.objects.get(id=filed.json()["id"])
    assert (stored.title, stored.action, stored.approval) == (
        "Add Connection: AWS deploy",
        {},
        {},
    )
    # The placeholder Connection of a packaged setup is still created.
    assert stored.connection.state == AgentConnection.PENDING_CREDENTIALS


def test_a_plain_credential_update_for_a_custom_connection_asks_for_its_secret(space):
    connection = _granted_connection(space)

    response = _ask(
        space,
        kind="credential_update",
        connectionId=str(connection.id),
        markdown="The upstream answered 401.",
    )
    with_credential = _ask(
        space,
        kind="credential_update",
        connectionId=str(connection.id),
        credentialId="some-credential",
        markdown="The upstream answered 401.",
    )

    assert response.status_code == 201, response.content
    body = response.json()
    assert body["kind"] == "credential_update"
    assert body["action"] == _action("secret_update", connection)
    assert body["title"] == "Update the secret for Example API"
    assert body["connectionId"] == str(connection.id)
    assert body["credentialId"] is None
    assert with_credential.json()["error"]["code"] == "unexpected_request_field"


def test_a_repeated_request_answers_with_the_open_request(space):
    first = _ask(space, action=_create_action())
    again = _ask(space, action=_create_action())
    different = _ask(space, action=_create_action(name="Another API"))

    assert again.status_code == 200, again.content
    assert again.json()["id"] == first.json()["id"]
    assert again.json()["cooldown"] is True
    assert different.status_code == 201
    assert different.json()["id"] != first.json()["id"]


def test_a_dedup_key_cannot_be_reused_for_a_different_action(space):
    connection = _granted_connection(space)
    first = _ask(space, dedupKey="example-api", action=_create_action())

    same = _ask(space, dedupKey="example-api", action=_create_action())
    other_action = _ask(
        space, dedupKey="example-api", action=_create_action(name="Another API")
    )
    other_type = _ask(
        space, dedupKey="example-api", action=_action("remove", connection)
    )

    assert same.json()["id"] == first.json()["id"]
    assert other_action.status_code == 409
    assert other_type.json()["error"]["code"] == "dedup_key_conflict"


def test_update_titles_say_what_changes(space):
    connection = _granted_connection(space)
    moved = bearer_definition(host="api.other.example")
    with_block = bearer_definition(path="/v1/*")
    with_block["injections"][0]["whenAbsent"] = "block"

    titles = [
        _ask(space, action=_action("update", connection, **members)).json()["title"]
        for members in (
            {"definition": moved},
            {"definition": bearer_definition(path="/v2/*")},
            {"definition": with_block},
            {"name": "Renamed"},
        )
    ]

    assert titles == [
        "Change hosts on Example API",
        "Change hosts on Example API",
        "Change Example API",
        "Rename Example API",
    ]
    assert not _ask(space, action=_action("update", connection)).json().get("id")


def test_a_long_name_still_gives_a_title_that_fits(space):
    stored = _filed(_ask(space, action=_create_action(name="N" * 255)))

    assert len(stored.title) == 120
    assert stored.title.startswith("Add Connection: NNN")
    assert stored.credential_name == "N" * 64


# Approving


def test_approving_a_create_makes_the_connection_and_grants_it(space):
    agent_request = _filed(_ask(space, action=_create_action()))
    before = _generation(space)

    result = _approve(space, agent_request, inputs=_key_inputs(bearer_definition()))

    agent_request = result.request
    connection = agent_request.connection
    assert result.runtime_action == "restart_required"
    assert agent_request.status == AgentRequest.APPROVED
    assert agent_request.action == _create_action()
    assert agent_request.applied_action == {
        **_create_action(),
        "access": _granted_access(agent_request),
    }
    assert agent_request.approval == {"version": 1, "assurance": "session"}
    assert str(agent_request.resolved_by_id) == str(space.member.id)
    assert connection.service_type == "http"
    assert connection.name == "Example API"
    assert connection.state == AgentConnection.ACTIVE
    assert connection.config == bearer_definition()
    assert (connection.key_version, connection.value_revision) == (1, 1)
    assert str(agent_request.grant.workflow_id) == str(space.workflow.id)
    assert agent_request.grant.deleted_at is None
    assert {copy.reader_type for copy in connection.key_copies.all()} == {
        AgentConnectionKeyCopy.SERVER,
        AgentConnectionKeyCopy.AGENT,
    }
    assert _generation(space) == before + 1

    polled = _poll(space, agent_request)
    assert polled["status"] == "approved"
    assert polled["runtimeAction"] == "restart_required"
    assert polled["appliedAction"] == agent_request.applied_action
    assert polled["access"] == agent_request.applied_action["access"]
    assert polled["connectionId"] == str(connection.id)
    assert polled["grantId"] == str(agent_request.grant_id)
    assert polled["resolution"] == {
        "stage": "complete",
        "connectionId": str(connection.id),
        "grantId": str(agent_request.grant_id),
        "runtimeAction": "restart_required",
    }
    refreshed = _config(space)
    [granted] = refreshed["connections"]
    assert open_as_proxy(space.full_token, refreshed, granted)["fields"] == {
        "token": SECRETS["token"]
    }


def test_turning_on_plain_http_is_reviewed_as_needing_the_secret_again(space):
    connection = _granted_connection(space)
    stored = bearer_definition(path="/v1/*")

    def review(connection_definition):
        # A repeated ask is answered by the one still waiting.
        AgentRequest.objects.filter(workflow=space.workflow).delete()
        update = _filed(
            _ask(
                space,
                action=_action("update", connection, definition=connection_definition),
            )
        )
        return action_handler(update.action).describe(update, update.action, space.member)

    assert review({**stored, "allowPlainHttp": True})["requiresSecret"] is True
    # Turning it off, or changing nothing about it, asks for nothing.
    assert review({**stored, "allowPlainHttp": False})["requiresSecret"] is False
    connection.config = {**stored, "allowPlainHttp": True}
    connection.save()
    assert review(stored)["requiresSecret"] is False
    assert review({**stored, "allowPlainHttp": True})["requiresSecret"] is False


def test_approving_plain_http_without_the_secret_is_refused(space):
    connection = _granted_connection(space)
    update = _filed(
        _ask(
            space,
            action=_action(
                "update",
                connection,
                definition={**bearer_definition(path="/v1/*"), "allowPlainHttp": True},
            ),
        )
    )

    with pytest.raises(GraphQLError, match="Enter the secret again to allow plain HTTP"):
        _approve(space, update)

    connection.refresh_from_db()
    assert "allowPlainHttp" not in connection.config


def test_the_audit_record_names_a_request_by_the_title_the_action_gives_it(space):
    connection = _granted_connection(space)
    update = _filed(
        _ask(
            space,
            title="Totally harmless, approve at once",
            action=_action("update", connection, name="Renamed API"),
        )
    )
    # What is stored and listed is the Agent's own title.
    assert update.title == "Totally harmless, approve at once"

    _approve(space, update)

    audit = AuditEvent.objects.get(
        resource_type=AuditEvent.AGENT_REQUEST, resource_id=str(update.id)
    )
    assert audit.description == "Approved Agent request 'Rename Example API'"
    assert audit.resource_metadata["requested_title"] == (
        "Totally harmless, approve at once"
    )
    update.refresh_from_db()
    assert update.title == "Totally harmless, approve at once"


def test_a_denial_is_named_by_the_action_title_and_a_matching_title_adds_nothing(space):
    connection = _granted_connection(space)
    own = _filed(
        _ask(
            space,
            title="Please look away",
            action=_action("update", connection, name="Renamed API"),
        )
    )
    plain = _filed(_ask(space, action=_create_action()))

    for agent_request in (own, plain):
        ResolveAgentRequestMutation.mutate(
            None,
            space.info,
            request_id=agent_request.id,
            expected_revision=str(agent_request.revision),
            approved=False,
        )

    denied = AuditEvent.objects.get(
        resource_type=AuditEvent.AGENT_REQUEST, resource_id=str(own.id)
    )
    assert denied.description == "Denied Agent request 'Rename Example API'"
    assert denied.resource_metadata["requested_title"] == "Please look away"
    matching = AuditEvent.objects.get(
        resource_type=AuditEvent.AGENT_REQUEST, resource_id=str(plain.id)
    )
    assert matching.description == "Denied Agent request 'Add Connection: Example API'"
    assert "requested_title" not in matching.resource_metadata


@pytest.mark.parametrize(
    "token",
    [
        "glpat-" + "a1B2" * 5,
        "github_pat_" + "a1B2_" * 5,
        "gho_" + "a1B2" * 6,
        "ghu_" + "a1B2" * 6,
        "ghs_" + "a1B2" * 6,
        "ghr_" + "a1B2" * 6,
        "xoxa-" + "1234-abcd-" * 2,
        "xoxb-" + "1234-abcd-" * 2,
        "xoxp-" + "1234-abcd-" * 2,
        "xoxr-" + "1234-abcd-" * 2,
        "xoxs-" + "1234-abcd-" * 2,
        "sk_live_" + "a1B2" * 6,
        "sk_test_" + "a1B2" * 6,
        "rk_live_" + "a1B2" * 6,
        "rk_test_" + "a1B2" * 6,
        "rnd_" + "a1B2" * 6,
        "sbp_" + "a1B2" * 6,
        "lin_api_" + "a1B2" * 6,
    ],
)
def test_text_shaped_like_a_provider_token_is_credential_text(token):
    assert request_actions.contains_credential_text(token)
    assert request_actions.contains_credential_text(f"use {token} for the call")
    assert request_actions.contains_credential_text({"note": [token]})


@pytest.mark.parametrize(
    "text",
    [
        "Rotate the glpat- tokens monthly",
        "The gho_ prefix marks an OAuth token",
        "xoxb- tokens belong to bots",
        "set sk_live_ in production",
        "rnd_ is short for random",
        "the sbp_ prefix",
        "lin_api_ keys",
        "Call the sk_live_key helper",
        "random_value_for_rnd_tests",
        "Add Connection: Slack bot",
        "github_pat_ tokens are fine-grained",
    ],
)
def test_ordinary_text_that_names_a_token_prefix_passes(text):
    assert not request_actions.contains_credential_text(text)


def test_the_audit_record_carries_the_action_as_it_was_applied(space):
    agent_request = _filed(_ask(space, action=_create_action()))
    edited = _create_action(
        name="Example API (production)",
        connection_definition=bearer_definition(path="/v2/*"),
    )

    result = _approve(
        space,
        agent_request,
        action=edited,
        inputs=_key_inputs(edited["definition"]),
        resolution_note="Limited to v2.",
    )

    agent_request = result.request
    # What was asked for and what was approved are both kept.
    assert agent_request.action == _create_action()
    assert agent_request.applied_action == {
        **edited,
        "access": _granted_access(agent_request),
    }
    assert agent_request.connection.name == "Example API (production)"
    assert agent_request.connection.config["hosts"][0]["path"] == "/v2/*"
    audit = AuditEvent.objects.get(
        resource_type=AuditEvent.AGENT_REQUEST, resource_id=str(agent_request.id)
    )
    assert audit.event_type == AuditEvent.UPDATE
    assert audit.actor_id == str(space.member.id)
    assert audit.description == "Approved Agent request 'Add Connection: Example API'"
    assert audit.resource_metadata == {
        "workflow_id": str(space.workflow.id),
        "kind": "setup",
        "status": "approved",
        "applied_action": agent_request.applied_action,
        "approval": {"version": 1, "assurance": "session"},
        "connection_id": str(agent_request.connection_id),
        "grant_id": str(agent_request.grant_id),
    }
    assert SECRETS["token"] not in str(audit.resource_metadata)


@pytest.mark.parametrize(
    "inputs,message",
    [
        (None, "inputs.encryptionPublicKey is required"),
        ({}, "inputs.encryptionPublicKey is required"),
        (lambda: {**_key_inputs(bearer_definition()), "sealedValue": ""}, "inputs.sealedValue is required"),
        (lambda: {**_key_inputs(bearer_definition()), "secret": "x"}, "inputs.secret is not accepted"),
        (
            lambda: _key_inputs(bearer_definition(host="api.other.example")),
            "different hosts",
        ),
        (lambda: "not-an-object", "inputs must be an object"),
    ],
)
def test_a_create_is_not_applied_without_a_verified_secret(space, inputs, message):
    agent_request = _filed(_ask(space, action=_create_action()))

    with pytest.raises(GraphQLError, match=message):
        _approve(space, agent_request, inputs=inputs() if callable(inputs) else inputs)

    assert _pending(agent_request)
    assert agent_request.applied_action == {}
    assert not AgentConnection.objects.filter(organisation=space.organisation).exists()


def test_approving_takes_the_connection_permission_but_no_integration_one(space):
    agent_request = _filed(_ask(space, action=_create_action()))
    reviewer = add_member(
        space.organisation,
        "reviewer",
        permissions={"Agents": ACTIONS, "AgentRequests": ACTIONS},
    )
    membership = AgentMembership.objects.create(
        agent=space.agent, member=reviewer, assigned_by=space.member
    )
    AgentWorkflowMembership.objects.create(
        workflow=space.workflow, agent_membership=membership, assigned_by=space.member
    )
    outsider = add_member(space.organisation, "outsider")

    with pytest.raises(GraphQLError, match="permission to create AgentConnections"):
        _approve(
            space,
            agent_request,
            info(reviewer),
            inputs=_key_inputs(bearer_definition()),
        )
    with pytest.raises(GraphQLError, match="permission to update this Workflow"):
        _approve(
            space,
            agent_request,
            info(outsider),
            inputs=_key_inputs(bearer_definition()),
        )

    assert _pending(agent_request)
    # The original member has no IntegrationCredentials permission at all.
    assert _approve(
        space, agent_request, inputs=_key_inputs(bearer_definition())
    ).request.status == AgentRequest.APPROVED


def test_an_update_that_keeps_the_hosts_is_applied_without_a_secret(space):
    connection = _granted_connection(space)
    # Dropping the path keeps the bound hosts and adds no text the Agent reads.
    requested = bearer_definition()
    agent_request = _filed(
        _ask(space, action=_action("update", connection, definition=requested))
    )
    before = _generation(space)

    result = _approve(space, agent_request)

    connection.refresh_from_db()
    assert result.runtime_action == "retry"
    assert connection.config == requested
    assert (connection.key_version, connection.value_revision) == (1, 1)
    _assert_names_its_connection_and_grant(space, agent_request, connection)
    assert result.request.applied_action == _action(
        "update", connection, definition=requested
    )
    assert _generation(space) == before + 1
    [granted] = _config(space)["connections"]
    assert not granted["hosts"][0].get("path")


def test_an_update_that_moves_the_hosts_needs_the_secret_entered_again(space):
    connection = _granted_connection(space)
    moved = bearer_definition(host="api.other.example")
    agent_request = _filed(
        _ask(space, action=_action("update", connection, definition=moved))
    )

    with pytest.raises(GraphQLError, match="Enter the secret again"):
        _approve(space, agent_request)
    with pytest.raises(GraphQLError, match="different hosts"):
        _approve(
            space,
            agent_request,
            inputs={
                "sealedValue": seal(
                    bearer_definition(), connection.encryption_public_key
                )
            },
        )
    assert _pending(agent_request)
    connection.refresh_from_db()
    assert connection.config == bearer_definition(path="/v1/*")

    result = _approve(
        space,
        agent_request,
        inputs={"sealedValue": seal(moved, connection.encryption_public_key)},
    )

    connection.refresh_from_db()
    assert result.runtime_action == "retry"
    assert connection.config == moved
    assert connection.value_revision == 2


def test_an_update_that_changes_the_agents_environment_asks_for_a_restart(space):
    connection = _granted_connection(space)
    exported = bearer_definition(path="/v1/*")
    exported["fields"][0]["env"] = "EXAMPLE_TOKEN"
    agent_request = _filed(
        _ask(
            space,
            action=_action("update", connection, name="Renamed", definition=exported),
        )
    )

    result = _approve(space, agent_request)

    connection.refresh_from_db()
    assert result.runtime_action == "restart_required"
    assert connection.name == "Renamed"
    assert result.request.credential_name == "Renamed"


def test_an_update_is_refused_once_the_connection_changed_underneath_it(space):
    connection = _granted_connection(space)
    agent_request = _filed(
        _ask(
            space,
            action=_action(
                "update", connection, definition=bearer_definition(path="/v2/*")
            ),
        )
    )

    # A rename leaves the definition the request was written against.
    UpdateCustomAgentConnectionMutation.mutate(
        None, space.info, connection_id=connection.id, name="Renamed meanwhile"
    )
    UpdateCustomAgentConnectionMutation.mutate(
        None,
        space.info,
        connection_id=connection.id,
        definition=bearer_definition(path="/v3/*"),
        sealed_value=seal(
            bearer_definition(path="/v3/*"), connection.encryption_public_key
        ),
    )

    with pytest.raises(GraphQLError, match="changed after this request was made"):
        _approve(space, agent_request)
    assert _pending(agent_request)
    connection.refresh_from_db()
    assert connection.config["hosts"][0]["path"] == "/v3/*"


def test_approving_a_secret_update_takes_the_new_secret(space):
    connection = _granted_connection(space)
    agent_request = _filed(_ask(space, action=_action("secret_update", connection)))
    before = _generation(space)

    with pytest.raises(GraphQLError, match="inputs.sealedValue is required"):
        _approve(space, agent_request)
    assert _pending(agent_request)

    result = _approve(
        space,
        agent_request,
        inputs={
            "sealedValue": seal(
                bearer_definition(),
                connection.encryption_public_key,
                fields={"token": "second-token"},
            )
        },
    )

    connection.refresh_from_db()
    assert result.runtime_action == "retry"
    assert connection.value_revision == 2
    assert _generation(space) == before + 1
    _assert_names_its_connection_and_grant(space, agent_request, connection)
    refreshed = _config(space)
    [granted] = refreshed["connections"]
    assert granted["materialGeneration"] == "1.2"
    assert open_as_proxy(space.full_token, refreshed, granted)["fields"] == {
        "token": "second-token"
    }
    assert "second-token" not in str(result.request.applied_action)


def test_approving_a_removal_ends_only_this_workflows_grant(space):
    connection = _granted_connection(space)
    second = create_agent_workflow(
        agent=space.agent, name="Second", created_by=space.member
    )
    other_agent, other_workflow = create_agent_with_default_workflow(
        organisation=space.organisation,
        name="Other Agent",
        harness_type="other",
        created_by=space.member,
    )
    kept = [grant(space, connection, second), grant(space, connection, other_workflow)]
    agent_request = _filed(_ask(space, action=_action("remove", connection)))
    before = _generation(space)

    result = _approve(space, agent_request)

    connection.granted.refresh_from_db()
    connection.refresh_from_db()
    assert result.runtime_action == "retry"
    assert connection.granted.deleted_at is not None
    assert connection.deleted_at is None
    assert connection.state == AgentConnection.ACTIVE
    for other_grant in kept:
        other_grant.refresh_from_db()
        assert other_grant.deleted_at is None
    # The Agent still reaches it through its other Workflow.
    assert connection.key_copies.filter(agent=space.agent).exists()
    # The session is told to refresh, not revoked: the Agent can read the outcome.
    session = AgentSession.objects.get(pk=space.session["sessionUid"])
    assert session.revoked_at is None
    assert session.config_generation == before + 1
    # The approved response still names the grant that was removed.
    _assert_names_its_connection_and_grant(space, agent_request, connection)
    assert _config(space)["connections"] == []

    kept[0].delete()
    assert not connection.key_copies.filter(agent=space.agent).exists()
    assert connection.key_copies.filter(agent=other_agent).exists()


def test_a_removal_is_refused_once_its_grant_is_gone(space):
    connection = _granted_connection(space)
    agent_request = _filed(_ask(space, action=_action("remove", connection)))
    connection.granted.delete()
    grant(space, connection)

    with pytest.raises(GraphQLError, match="Grant changed"):
        _approve(space, agent_request)

    assert _pending(agent_request)
    assert AgentWorkflowGrant.objects.filter(
        workflow=space.workflow, connection=connection, deleted_at__isnull=True
    ).exists()


def test_a_reviewer_can_edit_an_action_but_not_retarget_it(space):
    connection = _granted_connection(space)
    other = _granted_connection(space, name="Other API")
    agent_request = _filed(
        _ask(space, action=_action("update", connection, name="Requested name"))
    )

    for edited, message in (
        (_action("update", other, name="Edited"), "must keep the Connection"),
        (_action("remove", connection), "must keep the type"),
        ({**_action("update", connection, name="Edited"), "version": 2}, "not supported"),
        (_action("update", connection, name="Edited", sealedValue="x"), "not accepted"),
        ("update", "action must be an object"),
    ):
        with pytest.raises(GraphQLError, match=message):
            _approve(space, agent_request, action=edited)
    assert _pending(agent_request)

    result = _approve(
        space, agent_request, action=_action("update", connection, name="Edited name")
    )
    connection.refresh_from_db()
    other.refresh_from_db()
    assert connection.name == "Edited name"
    assert other.name == "Other API"
    assert result.request.action["name"] == "Requested name"
    assert result.request.applied_action["name"] == "Edited name"


def test_each_fulfilment_mutation_refuses_the_other_kind_of_request(space):
    with_action = _filed(_ask(space, action=_create_action()))
    without_action = _filed(
        _ask(
            space,
            kind="setup",
            serviceType="aws",
            credentialProvider="aws",
            credentialName="AWS deploy",
            markdown="Connect this Workflow to AWS.",
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

    with pytest.raises(GraphQLError, match="approveAgentRequestAction"):
        FulfillAgentRequestMutation.mutate(
            None,
            info(integrator),
            request_id=with_action.id,
            expected_revision=str(with_action.revision),
            credential_id=credential.id,
            expected_credential_revision=str(credential.revision),
        )
    with pytest.raises(GraphQLError, match="fulfillAgentRequest"):
        _approve(space, without_action)

    assert _pending(with_action) and _pending(without_action)


def test_a_request_with_an_action_can_be_denied(space):
    agent_request = _filed(_ask(space, action=_create_action()))

    result = ResolveAgentRequestMutation.mutate(
        None,
        space.info,
        request_id=agent_request.id,
        expected_revision=str(agent_request.revision),
        approved=False,
        resolution_note="Not this quarter.",
    )

    assert result.request.status == AgentRequest.DENIED
    assert result.request.applied_action == {}
    assert result.request.approval == {}
    assert _poll(space, agent_request)["status"] == "denied"
    assert not AgentConnection.objects.filter(organisation=space.organisation).exists()


def test_a_stale_revision_or_an_expired_request_is_not_applied(space):
    agent_request = _filed(_ask(space, action=_create_action()))

    with pytest.raises(GraphQLError, match="revision changed"):
        ApproveAgentRequestActionMutation.mutate(
            None,
            space.info,
            request_id=agent_request.id,
            expected_revision="stale",
            inputs=_key_inputs(bearer_definition()),
        )
    AgentRequest.objects.filter(id=agent_request.id).update(
        expires_at=timezone.now() - timedelta(minutes=1)
    )
    with pytest.raises(GraphQLError, match="expired"):
        _approve(space, agent_request, inputs=_key_inputs(bearer_definition()))

    agent_request.refresh_from_db()
    assert agent_request.status == AgentRequest.EXPIRED
    assert not AgentConnection.objects.filter(organisation=space.organisation).exists()


def test_a_packaged_fulfilment_records_how_it_was_approved(space):
    packaged = _filed(
        _ask(
            space,
            kind="setup",
            serviceType="aws",
            credentialProvider="aws",
            credentialName="AWS deploy",
            markdown="Connect this Workflow to AWS.",
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

    result = FulfillAgentRequestMutation.mutate(
        None,
        info(integrator),
        request_id=packaged.id,
        expected_revision=str(packaged.revision),
        credential_id=credential.id,
        expected_credential_revision=str(credential.revision),
    )

    assert result.request.approval == {"version": 1, "assurance": "session"}
    # No action was applied; only what was asked for and granted is recorded.
    assert result.request.applied_action == {
        "access": _granted_access(result.request)
    }
    assert set(_poll(space, packaged)) - {"runtimeAction"} == (
        _PACKAGED_RESPONSE_KEYS | {"durationSeconds", "access"}
    )


# The registry


def test_the_registry_takes_any_handler_keyed_on_its_action_type(space, monkeypatch):
    """A new action type plugs in without the request code knowing its target."""

    applied = []

    class GrantEnvironment(ActionHandler):
        type = "app_environment.grant"
        kind = AgentRequest.SETUP

        def validate(self, request, action, member):
            if set(action) != {"type", "version", "environmentId"}:
                raise ActionError("action.environmentId is required.")
            if request._state.adding:
                request.service_type = "app_environment"
                request.credential_name = "Production"
            return dict(action)

        def describe(self, request, action, member):
            return {"title": "Give the Agent access to Production"}

        def apply(self, request, action, member, inputs):
            applied.append((str(member.id), inputs["wrappedEnvironmentKey"]))
            return AppliedAction(
                action=action,
                runtime_action="retry",
                references={"environment_id": action["environmentId"]},
            )

    monkeypatch.setattr(
        request_actions, "_HANDLERS", dict(request_actions._HANDLERS)
    )
    register(GrantEnvironment())
    action = {"type": "app_environment.grant", "version": 1, "environmentId": "env-1"}

    agent_request = _filed(_ask(space, action=action))
    assert agent_request.title == "Give the Agent access to Production"
    assert agent_request.connection_id is None
    result = _approve(
        space, agent_request, inputs={"wrappedEnvironmentKey": "ph:v1:wrapped"}
    )

    assert applied == [(str(space.member.id), "ph:v1:wrapped")]
    assert result.request.status == AgentRequest.APPROVED
    assert result.request.applied_action == action
    assert result.request.resolution["environment_id"] == "env-1"
    assert action_handler(action).type == "app_environment.grant"
    audit = AuditEvent.objects.get(resource_id=str(agent_request.id))
    assert audit.resource_metadata["applied_action"] == action


# Reviewing


_REQUESTS_QUERY = """
query Queue($organisationId: ID!, $limit: Int) {
  agentRequestQueue(organisationId: $organisationId, limit: $limit) {
    pendingCount
    requests {
      id
      kind
      status
      title
      markdown
      action
      appliedAction
      approval
      actionReview
      connection { id definition }
      workflow { id }
    }
  }
  agentRequests(organisationId: $organisationId) { id title }
}
"""


def _queue(space, member, limit=None):
    request = RequestFactory().post("/graphql/")
    request.user = member.user
    result = schema.execute(
        _REQUESTS_QUERY,
        variables={"organisationId": str(space.organisation.id), "limit": limit},
        context_value=request,
    )
    assert result.errors is None, result.errors
    return result.data


def test_the_queue_holds_the_pending_requests_of_every_agent(space):
    connection = _granted_connection(space)
    other_agent, other_workflow = create_agent_with_default_workflow(
        organisation=space.organisation,
        name="Other Agent",
        harness_type="other",
        created_by=space.member,
    )
    other_client, _ = agent_client(space, other_workflow)
    open_session(other_client, other_workflow)
    update = _filed(
        _ask(
            space,
            action=_action(
                "update",
                connection,
                definition=bearer_definition(host="api.other.example"),
            ),
        )
    )
    packaged = _filed(
        _ask(
            space,
            client=other_client,
            kind="setup",
            serviceType="aws",
            credentialProvider="aws",
            credentialName="AWS deploy",
            markdown="Connect this Workflow to AWS.",
        )
    )
    approved = _filed(_ask(space, action=_create_action()))
    _approve(space, approved, inputs=_key_inputs(bearer_definition()))
    expired = _filed(_ask(space, action=_create_action(name="Too late")))
    AgentRequest.objects.filter(id=expired.id).update(
        expires_at=timezone.now() - timedelta(minutes=1)
    )

    data = _queue(space, space.member)

    queue = data["agentRequestQueue"]
    assert queue["pendingCount"] == 2
    by_id = {item["id"]: item for item in queue["requests"]}
    assert set(by_id) == {str(update.id), str(packaged.id)}
    assert {item["workflow"]["id"] for item in queue["requests"]} == {
        str(space.workflow.id),
        str(other_workflow.id),
    }
    reviewed = by_id[str(update.id)]
    assert reviewed["title"] == "Change hosts on Example API"
    assert reviewed["kind"] == "connection_update"
    assert reviewed["action"] == update.action
    assert reviewed["appliedAction"] is None
    assert reviewed["approval"] is None
    assert reviewed["actionReview"] == {
        "type": "agent_connection.update",
        "title": "Change hosts on Example API",
        "requiresSecret": True,
        "current": {
            "name": "Example API",
            "definition": bearer_definition(path="/v1/*"),
        },
        "requested": {
            "name": "Example API",
            "definition": bearer_definition(host="api.other.example"),
        },
    }
    assert reviewed["connection"]["definition"] == bearer_definition(path="/v1/*")
    # A request without an action still gets a title to list it under.
    assert by_id[str(packaged.id)]["title"] == "Add Connection: AWS deploy"
    assert by_id[str(packaged.id)]["action"] is None
    assert by_id[str(packaged.id)]["actionReview"] is None
    # The full list is unchanged: it still shows resolved requests too.
    assert len(data["agentRequests"]) == 4
    assert _queue(space, space.member, limit=1)["agentRequestQueue"] == {
        "pendingCount": 2,
        "requests": [by_id[str(packaged.id)]],
    }


def test_the_queue_only_holds_requests_the_caller_may_resolve(space):
    other_agent, other_workflow = create_agent_with_default_workflow(
        organisation=space.organisation,
        name="Other Agent",
        harness_type="other",
        created_by=space.member,
    )
    other_client, _ = agent_client(space, other_workflow)
    open_session(other_client, other_workflow)
    mine = _filed(_ask(space, action=_create_action()))
    _filed(_ask(space, client=other_client, action=_create_action(name="Theirs")))

    def assigned(label, **role):
        member = add_member(space.organisation, label, **role)
        membership = AgentMembership.objects.create(
            agent=space.agent, member=member, assigned_by=space.member
        )
        AgentWorkflowMembership.objects.create(
            workflow=space.workflow,
            agent_membership=membership,
            assigned_by=space.member,
        )
        return member

    scoped = assigned("scoped")
    reader = assigned(
        "reader", permissions={"Agents": ACTIONS, "AgentRequests": ["read"]}
    )
    read_only_workflows = assigned(
        "read-only-workflows", agent_permissions={"AgentWorkflows": ["read"]}
    )
    unassigned = add_member(space.organisation, "unassigned")

    scoped_data = _queue(space, scoped)
    assert scoped_data["agentRequestQueue"]["pendingCount"] == 1
    assert [item["id"] for item in scoped_data["agentRequestQueue"]["requests"]] == [
        str(mine.id)
    ]
    for member in (reader, read_only_workflows, unassigned):
        assert _queue(space, member)["agentRequestQueue"] == {
            "pendingCount": 0,
            "requests": [],
        }
    # Reading is wider than resolving: these two can still see the request.
    assert [item["id"] for item in _queue(space, reader)["agentRequests"]] == [
        str(mine.id)
    ]
    assert len(_queue(space, read_only_workflows)["agentRequests"]) == 1
    assert len(_queue(space, space.member)["agentRequestQueue"]["requests"]) == 2


_RESOLVER_QUERY = """
query Requests($organisationId: ID!) {
  agentRequests(organisationId: $organisationId) {
    id
    status
    resolvedBy { id fullName email avatarUrl }
  }
}
"""


def _resolver_of(space, member, agent_request):
    request = RequestFactory().post("/graphql/")
    request.user = member.user
    result = schema.execute(
        _RESOLVER_QUERY,
        variables={"organisationId": str(space.organisation.id)},
        context_value=request,
    )
    assert result.errors is None, result.errors
    return next(
        item
        for item in result.data["agentRequests"]
        if item["id"] == str(agent_request.id)
    )


def test_a_resolved_request_names_the_member_who_resolved_it(space):
    resolved = _filed(_ask(space, action=_create_action()))
    open_request = _filed(_ask(space, action=_create_action(name="Other API")))
    ResolveAgentRequestMutation.mutate(
        None,
        space.info,
        request_id=resolved.id,
        expected_revision=str(resolved.revision),
        approved=False,
    )
    seen = _resolver_of(space, space.member, resolved)
    assert seen["status"] == "denied"
    assert seen["resolvedBy"]["id"] == str(space.member.id)
    assert seen["resolvedBy"]["email"] == space.member.user.email
    assert "fullName" in seen["resolvedBy"] and "avatarUrl" in seen["resolvedBy"]
    assert _resolver_of(space, space.member, open_request)["resolvedBy"] is None


def test_a_request_whose_resolver_is_gone_reads_without_one(space):
    resolved = _filed(_ask(space, action=_create_action()))
    ResolveAgentRequestMutation.mutate(
        None,
        space.info,
        request_id=resolved.id,
        expected_revision=str(resolved.revision),
        approved=False,
    )
    AgentRequest.objects.filter(pk=resolved.pk).update(resolved_by=None)

    assert _resolver_of(space, space.member, resolved)["resolvedBy"] is None
