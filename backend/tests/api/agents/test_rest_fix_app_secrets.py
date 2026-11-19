"""A reference an Agent writes, or moves to another path, is followed to its
end before the write is accepted."""

import pytest

from api.models import AgentEvent, Secret
from api.utils.crypto import decrypt_asymmetric
from api.utils.secrets import get_environment_keys

from .app_secrets import (
    SERVER_KEYPAIR,
    app_connection,
    grant_app,
    lab,  # noqa: F401
    put_secret,
    refusal,
    secrets_url,
    sse_app,
    token_client,
)


ALLOW_ALL = {"version": 1, "default": "allow", "rules": []}
REFUSED = "agent_reference_not_readable"


@pytest.fixture
def writer(lab, monkeypatch):
    """The Workflow may write in Development and read Development and
    Staging; Production and the billing app are out of its reach."""

    monkeypatch.setattr(
        "api.utils.syncing.secrets.get_server_keypair", lambda: SERVER_KEYPAIR
    )
    lab.billing, [lab.billing_prod] = sse_app(lab, name="billing", environments=["Production"])
    put_secret(lab.dev, "LOCAL", "local-value")
    put_secret(lab.staging, "SHARED", "staging-value")
    put_secret(lab.prod, "SHARED", "prod-value")
    put_secret(lab.billing_prod, "TOKEN", "billing-value")
    grant_app(lab, app_connection(lab, [lab.dev], policy=ALLOW_ALL))
    grant_app(lab, app_connection(lab, [lab.staging]))
    lab.client = token_client(lab)
    lab.url = secrets_url(lab.app, "Development")
    return lab


def _post(lab, value, key="NEW"):
    return lab.client.post(
        lab.url, {"secrets": [{"key": key, "value": value}]}, format="json"
    )


def _synced(environment, path="/"):
    """What a sync of this environment and path would send, by key."""

    from api.utils.syncing.secrets import get_environment_secrets

    return {key: value for key, value, _ in get_environment_secrets(environment, path)}


def _stored(secret):
    public_key, private_key = get_environment_keys(secret.environment_id)
    secret.refresh_from_db()
    return decrypt_asymmetric(secret.value, private_key, public_key)


def _keys(environment):
    return Secret.objects.filter(environment=environment, deleted_at__isnull=True).count()


# --- A reference is followed through the secret it names ----------------------


CHAINS_OUT_OF_REACH = {
    "one step": [("staging", "VIA", "${Production.SHARED}")],
    "another app": [("staging", "VIA", "${billing::Production.TOKEN}")],
    "beside readable text": [("staging", "VIA", "${SHARED}-${Production.SHARED}")],
    "two steps": [
        ("staging", "VIA", "${Staging.DEEPER}"),
        ("staging", "DEEPER", "${Production.SHARED}"),
    ],
    "back through the written environment": [
        ("staging", "VIA", "${Development.HOP}"),
        ("dev", "HOP", "${Production.SHARED}"),
    ],
    "a cycle with a way out": [
        ("staging", "VIA", "${Staging.BACK} ${Production.SHARED}"),
        ("staging", "BACK", "${Staging.VIA}"),
    ],
}


@pytest.mark.django_db
@pytest.mark.parametrize("chain", CHAINS_OUT_OF_REACH.values(), ids=CHAINS_OUT_OF_REACH)
@pytest.mark.parametrize("method", ["post", "put"])
def test_a_reference_that_leads_out_of_reach_is_refused(writer, chain, method):
    for environment, key, value in chain:
        put_secret(getattr(writer, environment), key, value)
    existing = put_secret(writer.dev, "EXISTING", "before")
    count = _keys(writer.dev)
    body = (
        {"key": "CHAINED", "value": "${Staging.VIA}"}
        if method == "post"
        else {"id": str(existing.id), "value": "${Staging.VIA}"}
    )

    response = getattr(writer.client, method)(
        writer.url, {"secrets": [body]}, format="json"
    )

    assert set(refusal(response, 403, REFUSED)) == {"error", "code"}
    assert _keys(writer.dev) == count
    assert _stored(existing) == "before"
    [event] = [
        event
        for event in AgentEvent.objects.filter(workflow=writer.workflow)
        if event.reason == REFUSED
    ]
    assert (event.proxy_decision, event.outcome) == (AgentEvent.BLOCK, "denied")


@pytest.mark.django_db
def test_a_local_reference_is_followed_too(writer):
    put_secret(writer.dev, "HOP", "${Production.SHARED}")

    refusal(_post(writer, "prefix-${HOP}"), 403, REFUSED)
    refusal(_post(writer, "${Development.HOP}"), 403, REFUSED)


@pytest.mark.django_db
def test_a_chain_the_workflow_can_read_to_its_end_is_written_and_synced(writer):
    put_secret(writer.staging, "VIA", "${Staging.DEEPER}-${Development.LOCAL}")
    put_secret(writer.staging, "DEEPER", "${SHARED}")

    response = _post(writer, "${Staging.VIA}", key="CHAINED")

    assert response.status_code == 200, response.content
    assert _synced(writer.dev)["CHAINED"] == "staging-value-local-value"


@pytest.mark.django_db
def test_a_cycle_within_reach_ends_and_names_nothing_out_of_reach(writer):
    put_secret(writer.staging, "VIA", "${Staging.BACK}")
    put_secret(writer.staging, "BACK", "${Staging.VIA}")

    assert _post(writer, "${Staging.VIA}").status_code == 200


@pytest.mark.django_db
def test_a_chain_that_ends_at_nothing_is_still_written(writer):
    put_secret(writer.staging, "VIA", "${Nowhere.KEY} ${Staging.NOT_YET}")

    assert _post(writer, "${Staging.NOT_YET}").status_code == 200
    assert _post(writer, "${Staging.VIA}", key="CHAINED").status_code == 200


@pytest.mark.django_db
def test_a_chain_becomes_writable_once_the_workflow_can_read_its_end(writer):
    put_secret(writer.staging, "VIA", "${Production.SHARED}")
    refusal(_post(writer, "${Staging.VIA}"), 403, REFUSED)

    grant_app(writer, app_connection(writer, [writer.prod]))

    assert _post(writer, "${Staging.VIA}", key="CHAINED").status_code == 200
    assert _synced(writer.dev)["CHAINED"] == "prod-value"


# --- Moving a stored value to another path -------------------------------------


def _move(lab, secret, **members):
    return lab.client.put(
        lab.url, {"secrets": [{"id": str(secret.id), **members}]}, format="json"
    )


@pytest.mark.django_db
@pytest.mark.parametrize(
    "stored",
    ["${Production.SHARED}", "${Staging.VIA}", "${billing::Production.TOKEN}"],
)
def test_moving_a_stored_reference_that_leads_out_of_reach_is_refused(writer, stored):
    put_secret(writer.staging, "VIA", "${Production.SHARED}")
    secret = put_secret(writer.dev, "OLD", stored, path="/unsynced")

    response = _move(writer, secret, path="/synced")

    refusal(response, 403, REFUSED)
    secret.refresh_from_db()
    assert secret.path == "/unsynced"
    assert _synced(writer.dev, "/synced") == {}


@pytest.mark.django_db
def test_a_sealed_secret_keeps_its_stored_value_so_a_move_checks_it(writer):
    secret = put_secret(writer.dev, "OLD", "${Production.SHARED}", path="/unsynced")
    Secret.objects.filter(id=secret.id).update(type="sealed")

    refusal(_move(writer, secret, path="/synced", value="plain"), 403, REFUSED)
    secret.refresh_from_db()
    assert secret.path == "/unsynced"


@pytest.mark.django_db
def test_one_refused_move_refuses_the_whole_update(writer):
    refused = put_secret(writer.dev, "OLD", "${Production.SHARED}", path="/unsynced")
    plain = put_secret(writer.dev, "PLAIN", "before", path="/unsynced")

    response = writer.client.put(
        writer.url,
        {
            "secrets": [
                {"id": str(plain.id), "value": "after"},
                {"id": str(refused.id), "path": "/synced"},
            ]
        },
        format="json",
    )

    refusal(response, 403, REFUSED)
    assert _stored(plain) == "before"


@pytest.mark.django_db
@pytest.mark.parametrize("stored", ["plain", "${LOCAL}", "${Staging.SHARED}"])
def test_a_value_the_workflow_can_read_to_its_end_moves(writer, stored):
    secret = put_secret(writer.dev, "OLD", stored, path="/unsynced")

    response = _move(writer, secret, path="/synced")

    assert response.status_code == 200, response.content
    secret.refresh_from_db()
    assert secret.path == "/synced"


@pytest.mark.django_db
@pytest.mark.parametrize(
    "members",
    [{"comment": "x"}, {"path": "/unsynced"}, {"path": "unsynced/"}, {"key": "RENAMED"}],
)
def test_an_update_that_moves_nothing_leaves_a_stored_reference_alone(writer, members):
    secret = put_secret(writer.dev, "OLD", "${Production.SHARED}", path="/unsynced")

    response = _move(writer, secret, **members)

    assert response.status_code == 200, response.content
    assert _stored(secret) == "${Production.SHARED}"


@pytest.mark.django_db
def test_an_update_of_an_unknown_or_malformed_id_is_answered_by_the_view(writer):
    for identifier in ("00000000-0000-0000-0000-000000000000", "not-an-id", 7, None):
        response = writer.client.put(
            writer.url,
            {"secrets": [{"id": identifier, "path": "/synced"}]},
            format="json",
        )
        assert response.status_code == 404, response.content
