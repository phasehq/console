"""Agent tokens on the public secrets API, through app Connections.

Each call is decided from the token's Workflow grants. A temporary allow lifts an ask but
never a block, and expiry or revocation applies to the next call.
"""

import json
from datetime import timedelta

import pytest
from django.utils import timezone

from api.models import (
    AgentConnection,
    AgentEvent,
    AgentWorkflowGrant,
    PersonalSecret,
    Secret,
    SecretEvent,
)
from api.utils.agent_access import end_connection_access

from .app_secrets import (
    app_connection,
    grant_app,
    lab,  # noqa: F401
    put_secret,
    refusal,
    secrets_url,
    sse_app,
    token_client,
)


ALL_CLASSES = ["read", "create", "update", "delete"]
ALLOW_ALL = {"version": 1, "default": "allow", "rules": []}


def _values(response):
    assert response.status_code == 200, response.content
    return {item["key"]: item["value"] for item in response.json()}


def _events(lab):
    return list(
        AgentEvent.objects.filter(workflow=lab.workflow, event_type="app_secrets")
        .order_by("ingest_seq")
    )


# --- The per-call decision ---------------------------------------------------


@pytest.mark.django_db
def test_default_policy_allows_reads_and_records_them_for_the_agent(lab):
    put_secret(lab.dev, "DATABASE_URL", "postgres://dev")
    connection = app_connection(lab, [lab.dev])
    grant_app(lab, connection)
    client = token_client(lab)

    response = client.get(secrets_url(lab.app, "development"))

    assert _values(response) == {"DATABASE_URL": "postgres://dev"}
    event = SecretEvent.objects.get(environment=lab.dev)
    assert event.event_type == SecretEvent.READ
    assert str(event.agent_id) == str(lab.agent.id)
    assert str(event.agent_token_id) == str(client.agent_token.id)
    assert str(event.agent_workflow_id) == str(lab.workflow.id)
    assert event.user_id is None and event.service_account_id is None
    [agent_event] = _events(lab)
    assert agent_event.proxy_decision == AgentEvent.ALLOW
    assert agent_event.outcome == "allowed"
    assert str(agent_event.connection_id) == str(connection.id)
    assert agent_event.detail["class"] == "read"
    assert agent_event.detail["environment_name"] == "Development"
    recorded = json.dumps(
        [agent_event.detail, agent_event.path, agent_event.reason, agent_event.host]
    )
    assert "DATABASE_URL" not in recorded and "postgres://dev" not in recorded


@pytest.mark.django_db
@pytest.mark.parametrize(
    "method,access_class",
    [("post", "create"), ("put", "update"), ("delete", "delete")],
)
def test_default_policy_asks_for_writes(lab, method, access_class):
    connection = app_connection(lab, [lab.dev])
    grant_app(lab, connection)
    client = token_client(lab)

    response = getattr(client, method)(
        secrets_url(lab.app, "Development"),
        {"secrets": [{"key": "NEW", "value": "v"}]},
        format="json",
    )

    body = refusal(response, 403, "agent_access_ask")
    assert body["request"] == {
        "kind": "access_change",
        "title": f"Allow {access_class} secrets on {connection.name}",
        "action": {
            "type": "agent_grant.allow",
            "version": 1,
            "connectionId": str(connection.id),
            "allow": {"classes": [access_class]},
        },
    }
    assert not Secret.objects.filter(environment=lab.dev).exists()
    [event] = _events(lab)
    assert event.proxy_decision == AgentEvent.ASK
    assert event.detail["class"] == access_class
    assert event.reason == "agent_access_ask"


@pytest.mark.django_db
def test_a_temporary_allow_lifts_ask_for_each_write(lab):
    connection = app_connection(lab, [lab.dev])
    grant_app(lab, connection, allows=["create", "update", "delete"])
    client = token_client(lab)
    url = secrets_url(lab.app, "Development")

    created = client.post(url, {"secrets": [{"key": "api_key", "value": "one"}]}, format="json")
    assert created.status_code == 200, created.content
    secret_id = created.json()[0]["id"]
    assert created.json()[0]["value"] == "one"
    updated = client.put(url, {"secrets": [{"id": secret_id, "value": "two"}]}, format="json")
    assert updated.status_code == 200, updated.content
    assert _values(client.get(url)) == {"API_KEY": "two"}
    deleted = client.delete(url, {"secrets": [secret_id]}, format="json")
    assert deleted.status_code == 200, deleted.content

    kinds = [
        (event_type, str(agent_id))
        for event_type, agent_id in SecretEvent.objects.filter(environment=lab.dev)
        .order_by("timestamp")
        .values_list("event_type", "agent_id")
    ]
    agent_id = str(lab.agent.id)
    assert kinds == [
        (SecretEvent.CREATE, agent_id),
        (SecretEvent.UPDATE, agent_id),
        (SecretEvent.READ, agent_id),
        (SecretEvent.DELETE, agent_id),
    ]
    assert [event.proxy_decision for event in _events(lab)] == [AgentEvent.ALLOW] * 4
    assert all("API_KEY" not in json.dumps(event.detail) for event in _events(lab))


@pytest.mark.django_db
def test_a_temporary_allow_never_lifts_a_block(lab):
    policy = {
        "version": 1,
        "default": "allow",
        "rules": [{"class": "delete", "effect": "block"}],
    }
    secret = put_secret(lab.dev, "KEEP", "x")
    connection = app_connection(lab, [lab.dev], policy=policy, name="Orders dev")
    grant_app(lab, connection, allows=["delete"])

    response = token_client(lab).delete(
        secrets_url(lab.app, "Development"), {"secrets": [secret.id]}, format="json"
    )

    body = refusal(response, 403, "agent_access_blocked")
    assert body["connectionName"] == "Orders dev"
    assert body["class"] == "delete"
    assert "request" not in body
    secret.refresh_from_db()
    assert secret.deleted_at is None
    assert _events(lab)[0].proxy_decision == AgentEvent.BLOCK


@pytest.mark.django_db
def test_an_expired_temporary_allow_asks_again(lab):
    connection = app_connection(lab, [lab.dev])
    grant = grant_app(lab, connection, allows=["create"])
    grant.temporary_allows[0]["expiresAt"] = "2000-01-01T00:00:00Z"
    grant.save(update_fields=["temporary_allows"])

    response = token_client(lab).post(
        secrets_url(lab.app, "Development"),
        {"secrets": [{"key": "K", "value": "v"}]},
        format="json",
    )

    refusal(response, 403, "agent_access_ask")


@pytest.mark.django_db
def test_no_covering_grant_returns_a_ready_app_access_request(lab):
    # A grant on other environments does not cover this one.
    grant_app(lab, app_connection(lab, [lab.staging]))
    client = token_client(lab)

    read = refusal(
        client.get(secrets_url(lab.app, "Development")), 403, "agent_grant_missing"
    )
    write = refusal(
        client.post(
            secrets_url(lab.app, "Development"),
            {"secrets": [{"key": "K", "value": "v"}]},
            format="json",
        ),
        403,
        "agent_grant_missing",
    )

    assert read["request"] == {
        "kind": "setup",
        "title": "Read secrets in orders-service (Development)",
        "action": {
            "type": "agent_connection.app_access",
            "version": 1,
            "appId": str(lab.app.id),
            "environments": ["Development"],
            "access": "read",
        },
    }
    assert write["request"]["action"]["access"] == "read_write"
    assert write["request"]["title"] == (
        "Read and write secrets in orders-service (Development)"
    )


@pytest.mark.django_db
def test_an_expired_grant_returns_a_ready_renew_request(lab):
    connection = app_connection(lab, [lab.dev])
    grant_app(lab, connection, expires_at=timezone.now() - timedelta(minutes=5))

    body = refusal(
        token_client(lab).get(secrets_url(lab.app, "Development")),
        403,
        "agent_grant_expired",
    )

    assert body["request"] == {
        "kind": "access_change",
        "title": f"Renew access to {connection.name}",
        "action": {
            "type": "agent_grant.renew",
            "version": 1,
            "connectionId": str(connection.id),
        },
    }


@pytest.mark.django_db
def test_expiry_takes_effect_on_the_next_call(lab):
    put_secret(lab.dev, "K", "v")
    grant = grant_app(
        lab,
        app_connection(lab, [lab.dev]),
        expires_at=timezone.now() + timedelta(minutes=5),
    )
    client = token_client(lab)
    assert _values(client.get(secrets_url(lab.app, "Development"))) == {"K": "v"}

    AgentWorkflowGrant.objects.filter(pk=grant.pk).update(
        expires_at=timezone.now() - timedelta(seconds=1)
    )

    refusal(client.get(secrets_url(lab.app, "Development")), 403, "agent_grant_expired")


@pytest.mark.django_db
def test_a_revoked_grant_is_missing_on_the_next_call(lab):
    put_secret(lab.dev, "K", "v")
    grant = grant_app(lab, app_connection(lab, [lab.dev]))
    client = token_client(lab)
    assert _values(client.get(secrets_url(lab.app, "Development"))) == {"K": "v"}

    end_connection_access(AgentWorkflowGrant.objects.filter(pk=grant.pk))

    refusal(client.get(secrets_url(lab.app, "Development")), 403, "agent_grant_missing")


@pytest.mark.django_db
@pytest.mark.parametrize("change", ["disabled", "deleted"])
def test_a_disabled_or_deleted_connection_covers_nothing(lab, change):
    connection = app_connection(lab, [lab.dev])
    grant_app(lab, connection)
    if change == "disabled":
        connection.state = AgentConnection.DISABLED
    else:
        connection.deleted_at = timezone.now()
    connection.save()

    refusal(
        token_client(lab).get(secrets_url(lab.app, "Development")),
        403,
        "agent_grant_missing",
    )


@pytest.mark.django_db
def test_two_connections_on_one_environment_allow_when_either_allows(lab):
    put_secret(lab.dev, "K", "v")
    blocks_reads = {
        "version": 1,
        "default": "allow",
        "rules": [{"class": "read", "effect": "block"}],
    }
    grant_app(lab, app_connection(lab, [lab.dev], policy=blocks_reads))
    grant_app(lab, app_connection(lab, [lab.dev, lab.staging]))
    client = token_client(lab)

    assert _values(client.get(secrets_url(lab.app, "Development"))) == {"K": "v"}
    # Neither allows a write: one asks and the other blocks, so it asks.
    blocks_writes = {
        "version": 1,
        "default": "allow",
        "rules": [{"class": "create", "effect": "block"}],
    }
    other = app_connection(lab, [lab.staging], policy=blocks_writes)
    grant_app(lab, other)
    refusal(
        client.post(
            secrets_url(lab.app, "Staging"),
            {"secrets": [{"key": "K", "value": "v"}]},
            format="json",
        ),
        403,
        "agent_access_ask",
    )


@pytest.mark.django_db
def test_a_member_policy_change_applies_to_the_next_call(lab):
    connection = app_connection(lab, [lab.dev])
    grant_app(lab, connection)
    client = token_client(lab)
    url = secrets_url(lab.app, "Development")
    body = {"secrets": [{"key": "K", "value": "v"}]}
    refusal(client.post(url, body, format="json"), 403, "agent_access_ask")

    connection.policy = ALLOW_ALL
    connection.save()

    assert client.post(url, body, format="json").status_code == 200


# --- Authentication and the endpoints an Agent token never reaches -----------


@pytest.mark.django_db
def test_an_unknown_token_is_invalid(lab):
    from rest_framework.test import APIClient

    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION="Bearer Agent not-a-real-token")

    body = refusal(client.get(secrets_url(lab.app, "Development")), 401, "invalid_token")
    assert not _events(lab)
    assert body["error"]


@pytest.mark.django_db
@pytest.mark.parametrize("change", ["agent_disabled", "workflow_deleted", "token_revoked"])
def test_tokens_of_a_disabled_agent_or_workflow_are_invalid(lab, change):
    grant_app(lab, app_connection(lab, [lab.dev]))
    client = token_client(lab)
    assert client.get(secrets_url(lab.app, "Development")).status_code == 200

    if change == "agent_disabled":
        lab.agent.status = lab.agent.DISABLED
        lab.agent.save()
    elif change == "workflow_deleted":
        lab.workflow.deleted_at = timezone.now()
        lab.workflow.save()
    else:
        client.agent_token.delete()

    refusal(client.get(secrets_url(lab.app, "Development")), 401, "invalid_token")


@pytest.mark.django_db
@pytest.mark.parametrize(
    "path",
    [
        "/secrets/",
        "/v1/apps/",
        "/v1/environments/",
        "/v1/service-accounts/",
        "/v1/members/",
    ],
)
def test_an_agent_token_reaches_no_other_endpoint(lab, path):
    grant_app(lab, app_connection(lab, [lab.dev], policy=ALLOW_ALL))
    client = token_client(lab)

    response = client.get(f"{path}?app_id={lab.app.id}&env=Development")

    assert response.status_code == 401, (path, response.content)


@pytest.mark.django_db
def test_an_app_without_sse_is_refused(lab):
    plain, [environment] = sse_app(lab, name="plain", environments=["Development"], sse=False)

    body = refusal(
        token_client(lab).get(secrets_url(plain, "Development")), 409, "sse_required"
    )
    assert "server-side encryption" in body["error"]


@pytest.mark.django_db
def test_unknown_apps_and_environments_are_not_found(lab):
    client = token_client(lab)

    refusal(client.get(secrets_url(lab.app, "nope")), 404, "environment_not_found")
    refusal(
        client.get("/v1/secrets/?app_id=00000000-0000-0000-0000-000000000000&env=Development"),
        404,
        "environment_not_found",
    )


@pytest.mark.django_db
def test_an_app_of_another_organisation_is_not_found(lab):
    from .custom_connections import workspace

    other = workspace("app-secrets-other")
    other_app, _ = sse_app(other, name="theirs", environments=["Development"])

    refusal(
        token_client(lab).get(secrets_url(other_app, "Development")),
        404,
        "environment_not_found",
    )


@pytest.mark.django_db
def test_agents_name_the_environment_by_app_and_name(lab):
    secret = put_secret(lab.dev, "K", "v")
    grant_app(lab, app_connection(lab, [lab.dev]))
    client = token_client(lab)

    refusal(client.get(f"/v1/secrets/?secret_id={secret.id}"), 400, "environment_required")
    refusal(
        client.get("/v1/secrets/", HTTP_ENVIRONMENT=str(lab.dev.id)),
        400,
        "environment_required",
    )


@pytest.mark.django_db
@pytest.mark.parametrize(
    "path",
    [
        "/v1/secrets/?dynamic=true",
        "/v1/secrets/?include_dynamic=true",
        "/v1/secrets/?lease=true",
        "/v1/secrets/dynamic/",
        "/v1/secrets/dynamic/leases/",
    ],
)
def test_dynamic_secrets_are_refused(lab, path):
    grant_app(lab, app_connection(lab, [lab.dev], policy=ALLOW_ALL))
    separator = "&" if "?" in path else "?"

    response = token_client(lab).get(
        f"{path}{separator}app_id={lab.app.id}&env=Development"
    )

    body = refusal(response, 403, "agent_dynamic_unsupported")
    assert body["error"] == "Dynamic secrets are not available to Agents yet."


# --- Values, references and overrides -----------------------------------------


@pytest.mark.django_db
def test_references_resolve_only_inside_what_the_workflow_may_read(lab):
    other_app, [other_env] = sse_app(lab, name="billing", environments=["Production"])
    put_secret(lab.staging, "SHARED", "staging-value")
    put_secret(lab.prod, "SHARED", "prod-value")
    put_secret(other_env, "TOKEN", "billing-value")
    put_secret(lab.dev, "LOCAL", "local-value")
    put_secret(lab.dev, "FROM_LOCAL", "${LOCAL}")
    put_secret(lab.dev, "FROM_STAGING", "${Staging.SHARED}")
    put_secret(lab.dev, "FROM_PROD", "${Production.SHARED}")
    put_secret(lab.dev, "FROM_BILLING", "${billing::Production.TOKEN}")
    grant_app(lab, app_connection(lab, [lab.dev, lab.staging]))
    client = token_client(lab)

    values = _values(client.get(secrets_url(lab.app, "Development")))

    assert values["FROM_LOCAL"] == "local-value"
    assert values["FROM_STAGING"] == "staging-value"
    assert values["FROM_PROD"] == "${Production.SHARED}"
    assert values["FROM_BILLING"] == "${billing::Production.TOKEN}"
    assert "prod-value" not in json.dumps(values)
    assert "billing-value" not in json.dumps(values)

    # Once the Workflow may read billing, the reference resolves.
    grant_app(lab, app_connection(lab, [other_env], app=other_app))
    values = _values(client.get(secrets_url(lab.app, "Development")))
    assert values["FROM_BILLING"] == "billing-value"


@pytest.mark.django_db
def test_a_reference_to_an_environment_whose_reads_are_blocked_stays_unresolved(lab):
    put_secret(lab.staging, "SHARED", "staging-value")
    put_secret(lab.dev, "FROM_STAGING", "${Staging.SHARED}")
    grant_app(lab, app_connection(lab, [lab.dev]))
    grant_app(
        lab,
        app_connection(
            lab,
            [lab.staging],
            policy={"version": 1, "default": "allow", "rules": [{"class": "read", "effect": "block"}]},
        ),
    )

    values = _values(token_client(lab).get(secrets_url(lab.app, "Development")))

    assert values["FROM_STAGING"] == "${Staging.SHARED}"


@pytest.mark.django_db
def test_raw_returns_values_as_stored(lab):
    put_secret(lab.dev, "LOCAL", "local-value")
    put_secret(lab.dev, "FROM_LOCAL", "${LOCAL}")
    grant_app(lab, app_connection(lab, [lab.dev]))

    values = _values(token_client(lab).get(secrets_url(lab.app, "Development", raw="true")))

    assert values == {"LOCAL": "local-value", "FROM_LOCAL": "${LOCAL}"}


@pytest.mark.django_db
def test_sealed_values_are_returned_like_any_other(lab):
    secret = put_secret(lab.dev, "SEALED_ONE", "sealed-value")
    Secret.objects.filter(pk=secret.pk).update(type="sealed")
    grant_app(lab, app_connection(lab, [lab.dev]))

    response = token_client(lab).get(secrets_url(lab.app, "Development"))

    assert _values(response) == {"SEALED_ONE": "sealed-value"}


@pytest.mark.django_db
def test_overrides_are_refused_on_write_and_absent_on_read(lab):
    secret = put_secret(lab.dev, "K", "v")
    PersonalSecret.objects.create(secret=secret, user=lab.approver, value="x")
    grant_app(lab, app_connection(lab, [lab.dev], policy=ALLOW_ALL))
    client = token_client(lab)
    url = secrets_url(lab.app, "Development")

    [listed] = client.get(url).json()
    assert listed["override"] is None
    body = {"key": "NEW", "value": "v", "override": {"value": "mine", "isActive": True}}
    refusal(client.post(url, {"secrets": [body]}, format="json"), 400, "agent_override_unsupported")
    refusal(
        client.put(
            url,
            {"secrets": [{"id": secret.id, "override": {"value": "m", "isActive": True}}]},
            format="json",
        ),
        400,
        "agent_override_unsupported",
    )
    assert not Secret.objects.filter(environment=lab.dev, deleted_at__isnull=True).exclude(pk=secret.pk).exists()
    assert PersonalSecret.objects.count() == 1


# --- Writing references ---
# Other readers skip the access check, so an Agent may write a reference only where it can read.


@pytest.fixture
def writer(lab):
    """The Workflow may write in Development and read Development and
    Staging; Production and the billing app are out of its reach."""

    lab.billing, [lab.billing_prod] = sse_app(lab, name="billing", environments=["Production"])
    put_secret(lab.dev, "LOCAL", "local-value")
    put_secret(lab.staging, "SHARED", "staging-value")
    put_secret(lab.prod, "SHARED", "prod-value")
    put_secret(lab.billing_prod, "TOKEN", "billing-value")
    grant_app(lab, app_connection(lab, [lab.dev], policy=ALLOW_ALL))
    grant_app(lab, app_connection(lab, [lab.staging]))
    lab.client = token_client(lab)
    lab.url = secrets_url(lab.app, "Development")
    lab.existing = put_secret(lab.dev, "EXISTING", "before")
    return lab


def _write(lab, method, values):
    if method == "post":
        body = [{"key": f"NEW_{index}", "value": value} for index, value in enumerate(values)]
    else:
        existing = [lab.existing] + [
            put_secret(lab.dev, f"OTHER_{index}", "before") for index in range(len(values) - 1)
        ]
        body = [
            {"id": str(secret.id), "value": value}
            for secret, value in zip(existing, values)
        ]
    return getattr(lab.client, method)(lab.url, {"secrets": body}, format="json")


def _stored_values(environment):
    """Values as stored, references left as written."""

    from api.utils.crypto import decrypt_asymmetric
    from api.utils.secrets import get_environment_keys

    public_key, private_key = get_environment_keys(environment.id)
    return sorted(
        decrypt_asymmetric(secret.value, private_key, public_key)
        for secret in Secret.objects.filter(environment=environment, deleted_at__isnull=True)
    )


ALLOWED_REFERENCES = [
    "${LOCAL}",
    "${/LOCAL}",
    "prefix-${LOCAL}-suffix",
    "${Development.LOCAL}",
    "${Staging.SHARED}",
    "${staging.SHARED}",
    "${Staging./folder/SHARED}",
    "${orders-service::Staging.SHARED}",
    "${ORDERS-SERVICE::development.LOCAL}",
    "${LOCAL} and ${Staging.SHARED}",
]
REFUSED_REFERENCES = [
    "${Production.SHARED}",
    "${production.SHARED}",
    "${Production./folder/SHARED}",
    "${orders-service::Production.SHARED}",
    "${billing::Production.TOKEN}",
    "${Staging.SHARED}-${Production.SHARED}",
    "${LOCAL}${billing::Production.TOKEN}",
    # Targets that do not exist are refused the same way.
    "${Nowhere.SHARED}",
    "${ghost-app::Production.SHARED}",
    "${billing::Nowhere.TOKEN}",
]
# Text that is not a reference to the resolver stays plain text.
PLAIN_TEXT = [
    "${{ RAILWAY_VALUE }}",
    "${{Production.SHARED}}",
    "cost: ${",
    "${}",
    "$Production.SHARED",
    "{Production.SHARED}",
    "${Production{.SHARED}",
]


@pytest.mark.django_db
@pytest.mark.parametrize("method", ["post", "put"])
@pytest.mark.parametrize("value", ALLOWED_REFERENCES + PLAIN_TEXT)
def test_an_agent_may_write_references_it_can_read_and_plain_text(writer, method, value):
    response = _write(writer, method, [value])

    assert response.status_code == 200, response.content
    assert value in _stored_values(writer.dev)


@pytest.mark.django_db
@pytest.mark.parametrize("method", ["post", "put"])
@pytest.mark.parametrize("value", REFUSED_REFERENCES)
def test_an_agent_may_not_write_a_reference_it_cannot_read(writer, method, value):
    before = _stored_values(writer.dev)

    response = _write(writer, method, [value])

    body = refusal(response, 403, "agent_reference_not_readable")
    assert set(body) == {"error", "code"}
    assert body["error"] == (
        "A value refers to a secret in an environment this Agent cannot read."
    )
    assert _stored_values(writer.dev) == before
    [event] = [e for e in _events(writer) if e.reason == "agent_reference_not_readable"]
    assert event.proxy_decision == AgentEvent.BLOCK
    assert event.outcome == "denied"
    assert event.detail["class"] == ("create" if method == "post" else "update")
    recorded = json.dumps([event.detail, event.path, event.reason])
    assert "SHARED" not in recorded and "TOKEN" not in recorded


@pytest.mark.django_db
@pytest.mark.parametrize("method", ["post", "put"])
def test_one_unreadable_reference_refuses_the_whole_write(writer, method):
    count = Secret.objects.filter(environment=writer.dev).count()
    values = ["plain", "${Staging.SHARED}", "${Production.SHARED}", "${LOCAL}"]

    response = _write(writer, method, values)

    refusal(response, 403, "agent_reference_not_readable")
    stored = _stored_values(writer.dev)
    assert not set(values) & set(stored)
    if method == "post":
        assert len(stored) == count
    else:
        assert stored.count("before") == len(values)
    assert not SecretEvent.objects.filter(environment=writer.dev).exists()


@pytest.mark.django_db
def test_a_reference_becomes_writable_once_the_workflow_can_read_its_target(writer):
    refusal(_write(writer, "post", ["${billing::Production.TOKEN}"]), 403, "agent_reference_not_readable")

    grant_app(writer, app_connection(writer, [writer.billing_prod], app=writer.billing))

    assert _write(writer, "post", ["${billing::Production.TOKEN}"]).status_code == 200


@pytest.mark.django_db
def test_a_reference_to_an_environment_whose_reads_ask_is_refused(writer):
    asks_reads = {
        "version": 1,
        "default": "allow",
        "rules": [{"class": "read", "effect": "ask"}],
    }
    grant_app(writer, app_connection(writer, [writer.prod], policy=asks_reads))

    refusal(_write(writer, "post", ["${Production.SHARED}"]), 403, "agent_reference_not_readable")


@pytest.mark.django_db
def test_a_local_reference_needs_read_access_to_the_environment_itself(lab):
    write_only = {
        "version": 1,
        "default": "allow",
        "rules": [{"class": "read", "effect": "block"}],
    }
    put_secret(lab.dev, "LOCAL", "local-value")
    grant_app(lab, app_connection(lab, [lab.dev], policy=write_only))
    url = secrets_url(lab.app, "Development")
    client = token_client(lab)

    refusal(
        client.post(url, {"secrets": [{"key": "K", "value": "${LOCAL}"}]}, format="json"),
        403,
        "agent_reference_not_readable",
    )
    assert client.post(url, {"secrets": [{"key": "K", "value": "plain"}]}, format="json").status_code == 200


@pytest.mark.django_db
def test_an_update_without_a_value_is_not_checked_for_references(writer):
    response = writer.client.put(
        writer.url,
        {"secrets": [{"id": str(writer.existing.id), "comment": "${Production.SHARED}"}]},
        format="json",
    )

    assert response.status_code == 200, response.content


@pytest.mark.django_db
def test_members_still_write_any_reference(lab):
    from rest_framework.test import APIClient

    client = APIClient()
    client.force_authenticate(
        user=lab.approver.user,
        token={
            "auth_type": "User",
            "org_member": lab.approver,
            "service_account": None,
            "service_account_token": None,
            "agent": None,
            "agent_token": None,
            "workflow": None,
            "organisation": lab.organisation,
            "environment": lab.dev,
            "app": lab.app,
        },
    )

    response = client.post(
        secrets_url(lab.app, "Development"),
        {"secrets": [{"key": "K", "value": "${Production.SHARED}"}]},
        format="json",
    )

    assert response.status_code == 200, response.content
    assert _stored_values(lab.dev) == ["${Production.SHARED}"]


@pytest.mark.django_db
def test_a_write_never_reads_back_what_the_workflow_may_not_read(lab):
    policy = {
        "version": 1,
        "default": "allow",
        "rules": [{"class": "read", "effect": "block"}],
    }
    secret = put_secret(lab.dev, "HIDDEN_NAME", "existing-value", path="/folder", comment="a comment")
    grant_app(lab, app_connection(lab, [lab.dev], policy=policy))
    client = token_client(lab)
    url = secrets_url(lab.app, "Development")

    updated = client.put(
        url, {"secrets": [{"id": secret.id, "comment": "x"}]}, format="json"
    )
    created = client.post(
        url, {"secrets": [{"key": "NEW", "value": "v", "tags": ["t"]}]}, format="json"
    )

    # Ids alone: not the value or comment, nor a key name, path or tag.
    assert updated.status_code == 200, updated.content
    assert updated.json() == [{"id": str(secret.id)}]
    assert created.status_code == 200, created.content
    [item] = created.json()
    assert set(item) == {"id"}
    assert Secret.objects.filter(id=item["id"], environment=lab.dev).exists()
    refusal(client.get(url), 403, "agent_access_blocked")


@pytest.mark.django_db
def test_a_write_reads_back_the_secret_where_the_workflow_may_read(lab):
    secret = put_secret(lab.dev, "K", "existing-value", path="/folder")
    grant_app(lab, app_connection(lab, [lab.dev], policy=ALLOW_ALL))

    response = token_client(lab).put(
        secrets_url(lab.app, "Development"),
        {"secrets": [{"id": secret.id, "comment": "x"}]},
        format="json",
    )

    assert response.status_code == 200, response.content
    [item] = response.json()
    assert (item["key"], item["path"], item["value"]) == ("K", "/folder", "existing-value")


# --- What the Workflow can use: GET /v1/agents/app-access/ ------------------------


@pytest.mark.django_db
def test_app_access_lists_what_the_workflow_can_use_now(lab):
    expires = timezone.now() + timedelta(hours=1)
    connection = app_connection(lab, [lab.staging, lab.dev], name="Orders")
    grant = grant_app(lab, connection, expires_at=expires, allows=["create"])
    gone = app_connection(lab, [lab.prod], name="Orders prod")
    grant_app(lab, gone, expires_at=timezone.now() - timedelta(minutes=1))

    response = token_client(lab).get("/v1/agents/app-access/")

    assert response.status_code == 200, response.content
    body = response.json()
    assert body["schemaVersion"] == 1
    [entry] = body["apps"]
    assert entry["connectionId"] == str(connection.id)
    assert entry["connectionName"] == "Orders"
    assert entry["grantId"] == str(grant.id)
    assert entry["app"] == {"id": str(lab.app.id), "name": "orders-service"}
    assert entry["environments"] == [
        {"id": str(lab.dev.id), "name": "Development", "envType": "dev"},
        {"id": str(lab.staging.id), "name": "Staging", "envType": "staging"},
    ]
    assert entry["access"]["read"] == {"effect": "allow"}
    assert entry["access"]["create"]["effect"] == "allow"
    assert entry["access"]["create"]["until"] == grant.temporary_allows[0]["expiresAt"]
    assert entry["access"]["update"] == {"effect": "ask"}
    assert entry["access"]["delete"] == {"effect": "ask"}
    assert entry["grantExpiresAt"].startswith(expires.strftime("%Y-%m-%dT%H:%M"))
    [expired] = body["expired"]
    assert expired["connectionId"] == str(gone.id)
    assert expired["app"] == {"id": str(lab.app.id), "name": "orders-service"}
    assert expired["expiredAt"]


@pytest.mark.django_db
def test_app_access_is_for_agent_tokens_only(lab):
    from .custom_connections import member_client

    refusal(member_client(lab).get("/v1/agents/app-access/"), 403, "agent_token_required")
    from rest_framework.test import APIClient

    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION="Bearer Agent not-a-real-token")
    refusal(client.get("/v1/agents/app-access/"), 401, "invalid_token")


@pytest.mark.django_db
def test_rate_limits_apply_to_agent_tokens(lab):
    from unittest import mock

    from api.throttling import PlanBasedRateThrottle

    grant_app(lab, app_connection(lab, [lab.dev]))
    client = token_client(lab)
    with mock.patch.object(
        PlanBasedRateThrottle, "allow_request", return_value=False
    ), mock.patch.object(PlanBasedRateThrottle, "wait", return_value=30):
        response = client.get(secrets_url(lab.app, "Development"))

    assert response.status_code == 429
    assert response["Retry-After"] == "30"
