"""An Agent's rename of a stored secret is checked as a move to another path
is: a sync that skips or treats some names specially reads a renamed value
anew, so a rename may not carry a reference the Workflow cannot read into a
name a sync sends."""

from unittest.mock import MagicMock, patch

import pytest

from api.models import Secret
from api.utils.secrets import compute_key_digest

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
    lab.billing, [lab.billing_prod] = sse_app(
        lab, name="billing", environments=["Production"]
    )
    put_secret(lab.staging, "SHARED", "staging-value")
    put_secret(lab.staging, "VIA", "${Production.SHARED}")
    put_secret(lab.prod, "SHARED", "prod-value")
    put_secret(lab.billing_prod, "TOKEN", "billing-value")
    grant_app(lab, app_connection(lab, [lab.dev], policy=ALLOW_ALL))
    grant_app(lab, app_connection(lab, [lab.staging]))
    lab.client = token_client(lab)
    lab.url = secrets_url(lab.app, "Development")
    return lab


def _rename(lab, secret, key, **members):
    return lab.client.put(
        lab.url,
        {"secrets": [{"id": str(secret.id), "key": key, **members}]},
        format="json",
    )


def _key_digest(secret):
    return Secret.objects.get(pk=secret.pk).key_digest


def _supabase_payload(environment):
    """What a Supabase sync of this environment would send, with every outside
    call it makes replaced before it runs."""

    from api.utils.syncing.secrets import get_environment_secrets
    from api.utils.syncing.supabase.main import sync_supabase_secrets

    ok = MagicMock(status_code=200)
    ok.json.return_value = []
    with patch(
        "api.utils.syncing.supabase.main.get_credentials",
        return_value={"access_token": "test-token"},
    ), patch("api.utils.syncing.supabase.main.requests.get", return_value=ok), patch(
        "api.utils.syncing.supabase.main.requests.delete", return_value=ok
    ), patch(
        "api.utils.syncing.supabase.main.requests.post", return_value=ok
    ) as post:
        sync_supabase_secrets(
            [tuple(item) for item in get_environment_secrets(environment, "/")],
            "credential-id",
            "project-ref",
        )
    return {
        item["name"]: item["value"]
        for call in post.call_args_list
        for item in call.kwargs["json"]
    }


@pytest.mark.django_db
@pytest.mark.parametrize(
    "stored",
    ["${Production.SHARED}", "${Staging.VIA}", "${billing::Production.TOKEN}"],
)
def test_renaming_a_stored_reference_that_leads_out_of_reach_is_refused(writer, stored):
    secret = put_secret(writer.dev, "OLD", stored)
    before = _key_digest(secret)

    refusal(_rename(writer, secret, "RENAMED"), 403, REFUSED)

    assert _key_digest(secret) == before


@pytest.mark.django_db
def test_a_rename_never_starts_a_sync_sending_a_value_out_of_reach(writer):
    # Supabase skips its own SUPABASE_ names, so this value is not sent today.
    secret = put_secret(writer.dev, "SUPABASE_SERVICE_KEY", "${Production.SHARED}")
    assert "prod-value" not in _supabase_payload(writer.dev).values()

    refusal(_rename(writer, secret, "RENAMED"), 403, REFUSED)

    assert "prod-value" not in _supabase_payload(writer.dev).values()
    assert _key_digest(secret) == compute_key_digest(
        "SUPABASE_SERVICE_KEY", writer.dev.id
    )


@pytest.mark.django_db
@pytest.mark.parametrize("stored", ["plain", "${SHARED_DEV}", "${Staging.SHARED}"])
def test_a_value_the_workflow_can_read_to_its_end_is_renamed(writer, stored):
    put_secret(writer.dev, "SHARED_DEV", "dev-value")
    secret = put_secret(writer.dev, "OLD", stored)

    response = _rename(writer, secret, "RENAMED")

    assert response.status_code == 200, response.content
    assert _key_digest(secret) == compute_key_digest("RENAMED", writer.dev.id)


@pytest.mark.django_db
def test_a_rename_with_a_new_readable_value_still_checks_a_sealed_secrets_stored_value(
    writer,
):
    # A sealed secret keeps its stored value whatever the update sends.
    secret = put_secret(writer.dev, "OLD", "${Production.SHARED}")
    Secret.objects.filter(id=secret.id).update(type="sealed")

    refusal(_rename(writer, secret, "RENAMED", value="plain"), 403, REFUSED)

    assert _key_digest(secret) == compute_key_digest("OLD", writer.dev.id)


@pytest.mark.django_db
def test_one_refused_rename_refuses_the_whole_update(writer):
    plain = put_secret(writer.dev, "PLAIN", "before")
    refused = put_secret(writer.dev, "OLD", "${Production.SHARED}")

    response = writer.client.put(
        writer.url,
        {
            "secrets": [
                {"id": str(plain.id), "key": "PLAIN_RENAMED"},
                {"id": str(refused.id), "key": "RENAMED"},
            ]
        },
        format="json",
    )

    refusal(response, 403, REFUSED)
    assert _key_digest(plain) == compute_key_digest("PLAIN", writer.dev.id)
