"""Every call an Agent token makes to the secrets API leaves an event, also
one the API itself fails."""

import pytest

from api.models import AgentEvent

from .app_secrets import (
    app_connection,
    grant_app,
    lab,  # noqa: F401
    put_secret,
    secrets_url,
    token_client,
)


ALLOW_ALL = {"version": 1, "default": "allow", "rules": []}


@pytest.fixture
def writer(lab):
    grant_app(lab, app_connection(lab, [lab.dev], policy=ALLOW_ALL))
    lab.client = token_client(lab)
    lab.url = secrets_url(lab.app, "Development")
    return lab


def _post(lab, value, key="NEW"):
    return lab.client.post(
        lab.url, {"secrets": [{"key": key, "value": value}]}, format="json"
    )

@pytest.mark.django_db
def test_calls_the_secrets_api_fails_itself_are_recorded(writer):
    put_secret(writer.dev, "DUP", "v")

    duplicate = _post(writer, "x", key="DUP")
    missing = writer.client.put(
        writer.url,
        {"secrets": [{"id": "00000000-0000-0000-0000-000000000000", "value": "x"}]},
        format="json",
    )
    malformed = writer.client.post(writer.url, {"secrets": []}, format="json")

    assert (duplicate.status_code, missing.status_code, malformed.status_code) == (
        409,
        404,
        400,
    )
    events = list(
        AgentEvent.objects.filter(
            workflow=writer.workflow, event_type="app_secrets"
        ).order_by("ingest_seq")
    )
    assert [(event.method, event.status_code) for event in events] == [
        ("POST", 409),
        ("PUT", 404),
        ("POST", 400),
    ]
    for event in events:
        # Allowed by the grant; the call itself failed.
        assert (event.proxy_decision, event.outcome) == (AgentEvent.ALLOW, "error")
        assert event.detail["environment_name"] == "Development"
        assert event.session_id is None
