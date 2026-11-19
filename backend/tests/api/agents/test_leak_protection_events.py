"""Leak protection events in an Agent's log.

The Phase CLI reports what it replaced in a request to a model provider as
``leak_protection`` events, naming the placeholders it used. The log can be
narrowed to them, and a placeholder that carries the id of one of the
organisation's secrets is shown with the app and environment the secret is
in, to a member who can access them. A secret's key and value never leave.
"""

import json
from uuid import uuid4

import pytest
from django.db import connection as db_connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from api.models import AgentEvent
from backend.graphene.agents.types import AgentEventType

from .app_secrets import lab, member, put_secret, sse_app  # noqa: F401
from .custom_connections import (
    agent_client,
    graphql,
    info,
    open_session,
    workspace,
)


APP = "orders-service"
EVENTS = """query(
  $org: ID!
  $agent: ID!
  $eventType: String
  $proxyDecision: String
  $order: String
  $cursor: String
) {
  agentEvents(
    organisationId: $org
    agentId: $agent
    eventType: $eventType
    proxyDecision: $proxyDecision
    order: $order
    cursor: $cursor
  ) {
    events { eventId detail }
  }
}"""


def viewer(space, label, **access):
    """A member on the Agent's Workflow who may read its log, with the given
    access to apps and environments."""

    created = member(space, label, **access)
    if not created.role.is_default:
        created.role.permissions["permissions"]["Logs"] = ["read"]
        created.role.save()
    return created


def event(space, event_id, *, event_type="leak_protection", placeholders=(), **fields):
    detail = fields.pop("detail", {"mode": "censor", "harness": "claude"})
    if placeholders:
        detail = {**detail, "placeholders": ",".join(placeholders)}
    values = {
        "protocol": "http",
        "method": "POST",
        "host": "api.anthropic.com",
        "port": 443,
        "path": "/v1/messages",
        "provider": "proxy",
        "proxy_decision": AgentEvent.ALLOW,
        "outcome": "censored",
        "reason": "secret_in_request",
        **fields,
    }
    return AgentEvent.objects.create(
        event_id=event_id,
        organisation=space.organisation,
        agent=space.agent,
        workflow=space.workflow,
        proxy_created_at=timezone.now(),
        event_type=event_type,
        detail=detail,
        **values,
    )


def placeholder(secret, kind="secret"):
    return f"ph:{kind}:{secret.id}"


def listed(space, reader, **variables):
    result = graphql(
        space,
        EVENTS,
        member=reader,
        org=str(space.organisation.id),
        agent=str(space.agent.id),
        **variables,
    )
    assert result.errors is None, result.errors
    return result.data["agentEvents"]["events"]


def details(space, reader, **variables):
    return {
        row["eventId"]: row["detail"] for row in listed(space, reader, **variables)
    }


@pytest.fixture
def scene(lab):
    """A secret in Production, in a folder, and the members who read the log:
    one with the app and every environment, one with the app and Development
    only, one without the app, and an owner."""

    lab.secret = put_secret(lab.prod, "STRIPE_KEY", "sk-value-0001", path="/billing")
    lab.full = viewer(lab, "full", app=lab.app, environments=lab.envs)
    lab.partial = viewer(lab, "partial", app=lab.app, environments=[lab.dev])
    lab.outsider = viewer(lab, "outsider")
    lab.owner = viewer(lab, "owner", managed_key="owner")
    return lab


@pytest.mark.django_db
def test_an_event_the_cli_ships_is_listed_with_where_its_secret_lives(scene):
    client, _ = agent_client(scene)
    session = open_session(client, scene.workflow)
    found = {
        "mode": "censor",
        "harness": "claude",
        "capture": "proxy",
        "severity": "high",
        "where": "body",
        "labels": "aws_access_key_id",
        "placeholders": f"{placeholder(scene.secret)},ph:aws_access_key_id:1",
    }
    counts = {
        "inventoryHits": 2,
        "ruleRedactions": 1,
        "ruleAlerts": 1,
        "signedFindings": 1,
        "placeholderCount": 2,
    }
    response = client.post(
        f"/v1/agents/sessions/{session['sessionUid']}/events/",
        {
            "schemaVersion": 1,
            "batchId": "batch-leak-0001",
            "events": [
                {
                    "eventId": "event-leak-0001",
                    "createdAt": "2026-11-19T10:00:00.123456789Z",
                    "eventType": "leak_protection",
                    "protocol": "http",
                    "method": "POST",
                    "host": "api.anthropic.com",
                    "port": 443,
                    "path": "/v1/messages",
                    "provider": "proxy",
                    "proxyDecision": "allow",
                    "outcome": "censored",
                    "reason": "secret_in_request",
                    "detail": {**found, **counts},
                }
            ],
        },
        format="json",
    )
    assert response.status_code == 202, response.content

    detail = details(scene, scene.full, eventType="leak_protection")["event-leak-0001"]

    # The ingest stores detail keys in snake case, whatever the CLI sent.
    assert detail == {
        **found,
        "inventory_hits": 2,
        "rule_redactions": 1,
        "rule_alerts": 1,
        "signed_findings": 1,
        "placeholder_count": 2,
        "secrets": [
            {
                "placeholder": placeholder(scene.secret),
                "app_id": str(scene.app.id),
                "app_name": APP,
                "environment_id": str(scene.prod.id),
                "environment_name": "Production",
                "secret_id": str(scene.secret.id),
                "path": "/billing",
            }
        ],
    }


@pytest.mark.django_db
def test_the_log_narrows_to_leak_protection_events(scene):
    event(scene, "request", event_type="request", outcome="ok")
    event(scene, "censored")
    event(
        scene,
        "blocked",
        proxy_decision=AgentEvent.BLOCK,
        outcome="denied",
        status_code=403,
    )

    def ids(**variables):
        return [row["eventId"] for row in listed(scene, scene.full, **variables)]

    assert ids() == ["request", "censored", "blocked"]
    assert ids(eventType="leak_protection") == ["censored", "blocked"]
    assert ids(eventType="request") == ["request"]
    assert ids(eventType="no_such_type") == []
    # With the decision filter, and when paging history as well as tailing.
    assert ids(eventType="leak_protection", proxyDecision="block") == ["blocked"]
    assert ids(eventType="leak_protection", order="newest") == ["blocked", "censored"]
    newest = str(AgentEvent.objects.get(event_id="censored").ingest_seq)
    assert ids(eventType="leak_protection", cursor=newest) == ["blocked"]


@pytest.mark.django_db
@pytest.mark.parametrize("reader", ["full", "owner"])
def test_a_member_with_access_sees_where_the_secret_lives(scene, reader):
    event(scene, "leak", placeholders=[placeholder(scene.secret)])

    detail = details(scene, getattr(scene, reader))["leak"]

    assert detail["secrets"] == [
        {
            "placeholder": placeholder(scene.secret),
            "app_id": str(scene.app.id),
            "app_name": APP,
            "environment_id": str(scene.prod.id),
            "environment_name": "Production",
            "secret_id": str(scene.secret.id),
            "path": "/billing",
        }
    ]
    # What the CLI sent stays as it was.
    assert detail["placeholders"] == placeholder(scene.secret)
    assert detail["harness"] == "claude"


@pytest.mark.django_db
def test_a_member_without_the_app_sees_no_name(scene):
    event(scene, "leak", placeholders=[placeholder(scene.secret)])

    detail = details(scene, scene.outsider)["leak"]

    assert detail["secrets"] == [
        {"placeholder": placeholder(scene.secret), "app_restricted": True}
    ]
    text = json.dumps(detail)
    for withheld in (APP, "Production", "/billing", scene.app.id, scene.prod.id):
        assert str(withheld) not in text, withheld


@pytest.mark.django_db
def test_a_member_without_the_environment_sees_the_app_only(scene):
    event(scene, "leak", placeholders=[placeholder(scene.secret)])

    detail = details(scene, scene.partial)["leak"]

    assert detail["secrets"] == [
        {
            "placeholder": placeholder(scene.secret),
            "app_id": str(scene.app.id),
            "app_name": APP,
            "environment_restricted": True,
        }
    ]
    text = json.dumps(detail)
    for withheld in ("Production", "/billing", scene.prod.id):
        assert str(withheld) not in text, withheld


@pytest.mark.django_db
def test_only_a_secret_of_the_organisation_resolves(scene):
    elsewhere = workspace("elsewhere")
    _, (foreign_environment, *_) = sse_app(elsewhere, name="billing")
    foreign = put_secret(foreign_environment, "API_KEY", "value-elsewhere-01")
    deleted = put_secret(scene.dev, "OLD_KEY", "value-deleted-0001")
    deleted.deleted_at = timezone.now()
    deleted.save()
    event(
        scene,
        "leak",
        placeholders=[
            # A token format the CLI replaced, an id that is no secret, a
            # personal login's key name, and placeholders without a usable id.
            "ph:aws_access_key_id:1",
            f"ph:secret:{uuid4()}",
            "ph:secret:STRIPE_KEY",
            "ph:secret:",
            "ph:secret",
            f"secret:{scene.secret.id}",
            f"ph:secret:{scene.secret.id}:extra",
            placeholder(foreign),
            placeholder(deleted),
        ],
    )

    for reader in (scene.full, scene.owner):
        assert "secrets" not in details(scene, reader)["leak"]


@pytest.mark.django_db
def test_placeholders_resolve_in_the_order_sent_with_the_rest_left_out(scene):
    sealed = put_secret(scene.dev, "SIGNING_KEY", "value-sealed-0001")
    event(
        scene,
        "leak",
        placeholders=[
            placeholder(sealed, "sealed"),
            "ph:github_token:2",
            placeholder(scene.secret),
        ],
    )

    secrets = details(scene, scene.partial)["leak"]["secrets"]

    assert [entry["placeholder"] for entry in secrets] == [
        placeholder(sealed, "sealed"),
        placeholder(scene.secret),
    ]
    assert secrets[0]["environment_name"] == "Development"
    assert secrets[0]["path"] == "/"
    assert secrets[1]["environment_restricted"] is True


@pytest.mark.django_db
def test_a_secrets_key_and_value_are_never_read(scene):
    event(scene, "leak", placeholders=[placeholder(scene.secret)])

    with CaptureQueriesContext(db_connection) as queries:
        text = json.dumps(listed(scene, scene.full))

    assert "/billing" in text
    stored = (scene.secret.key, scene.secret.value)
    for private in ("STRIPE_KEY", "sk-value-0001", *stored):
        assert private not in text
    [lookup] = [
        query["sql"] for query in queries if 'FROM "api_secret"' in query["sql"]
    ]
    for column in ("key", "key_digest", "value", "comment"):
        assert f'"api_secret"."{column}"' not in lookup


@pytest.mark.django_db
@pytest.mark.parametrize("order", ["newest", None], ids=["history", "tail"])
def test_a_page_looks_its_placeholders_up_in_one_query(scene, order):
    def load(reader):
        with CaptureQueriesContext(db_connection) as queries:
            rows = listed(scene, reader, order=order)
        lookups = [query for query in queries if 'FROM "api_secret"' in query["sql"]]
        return rows, len(lookups), len(queries)

    def leak(event_id, key):
        other = put_secret(scene.dev, key, f"value-of-{key.lower()}-0001")
        event(
            scene,
            event_id,
            placeholders=[placeholder(other), placeholder(scene.secret)],
        )

    # Another kind of event costs no lookup, whatever its detail holds.
    event(
        scene,
        "request",
        event_type="request",
        outcome="ok",
        placeholders=[placeholder(scene.secret)],
    )
    _, lookups, _ = load(scene.partial)
    assert lookups == 0

    leak("leak-0", "FIRST_KEY")
    _, lookups, baseline = load(scene.partial)
    assert lookups == 1

    for index in range(1, 4):
        leak(f"leak-{index}", f"KEY_{index}")
    rows, lookups, grown = load(scene.partial)

    leaks = [row for row in rows if row["eventId"] != "request"]
    assert len(rows) == 5 and len(leaks) == 4
    assert all(len(row["detail"]["secrets"]) == 2 for row in leaks)
    assert lookups == 1
    # Access is checked once for each app and environment, not for each event.
    assert grown == baseline


@pytest.mark.django_db
def test_an_event_cannot_bring_its_own_secrets(scene):
    spoofed = {"mode": "censor", "secrets": "orders-service / Production"}
    event(scene, "unresolved", detail=dict(spoofed), placeholders=["ph:jwt:1"])
    event(
        scene,
        "resolved",
        detail=dict(spoofed),
        placeholders=[placeholder(scene.secret)],
    )

    shown = details(scene, scene.outsider)

    assert "secrets" not in shown["unresolved"]
    assert shown["resolved"]["secrets"] == [
        {"placeholder": placeholder(scene.secret), "app_restricted": True}
    ]


@pytest.mark.django_db
def test_an_event_names_at_most_twenty_placeholders(scene):
    extra = put_secret(scene.dev, "LAST_KEY", "value-twenty-first")
    filler = [f"ph:secret:{uuid4()}" for _ in range(19)]
    event(
        scene,
        "leak",
        placeholders=[*filler, placeholder(scene.secret), placeholder(extra)],
    )

    [entry] = details(scene, scene.full)["leak"]["secrets"]

    assert entry["placeholder"] == placeholder(scene.secret)


@pytest.mark.django_db
def test_other_events_keep_their_detail(scene):
    # Only a leak protection event's placeholders are looked up.
    request = event(
        scene,
        "request",
        event_type="request",
        outcome="ok",
        detail={"secrets": "as sent"},
        placeholders=[placeholder(scene.secret)],
    )

    with CaptureQueriesContext(db_connection) as queries:
        detail = AgentEventType.resolve_detail(request, info(scene.full))

    assert detail == {"secrets": "as sent", "placeholders": placeholder(scene.secret)}
    assert len(queries) == 0


@pytest.mark.django_db
def test_an_event_resolved_on_its_own_looks_up_its_placeholders(scene):
    leak = event(scene, "leak", placeholders=[placeholder(scene.secret)])

    detail = AgentEventType.resolve_detail(leak, info(scene.full))

    assert detail["secrets"][0]["environment_name"] == "Production"
