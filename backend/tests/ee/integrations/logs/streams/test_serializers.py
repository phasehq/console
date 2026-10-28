"""Envelope serialization.

The hard rule under test: SecretEvent's E2EE ciphertext fields (key, value,
comment) and the key digest must never appear in an exported envelope.
"""

import json
from datetime import datetime, timezone
from types import SimpleNamespace

from ee.integrations.logs.streams.serializers import (
    audit_event_to_envelope,
    secret_event_to_envelope,
)

_TS = datetime(2026, 7, 30, 12, 0, 0, tzinfo=timezone.utc)


def _org():
    return SimpleNamespace(id="org-1", name="Acme Corp")


def _audit_event(**overrides):
    defaults = dict(
        id="evt-1",
        event_type="R",
        actor_type="user",
        actor_id="member-1",
        actor_metadata={
            "email": "dev@example.com",
            "username": "dev",
            "token": {"id": "tok-1", "name": "ci-token", "type": "user_token"},
        },
        resource_type="app",
        resource_id="app-1",
        resource_metadata={"name": "backend"},
        old_values=None,
        new_values={"name": "backend"},
        description="Read app backend",
        ip_address="203.0.113.7",
        user_agent="phase-cli/1.18",
        timestamp=_TS,
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def _secret_event(**overrides):
    environment = SimpleNamespace(
        id="env-1",
        name="Production",
        env_type="PROD",
        app=SimpleNamespace(
            id="app-1", name="backend", organisation=SimpleNamespace(name="Acme Corp")
        ),
    )
    user = SimpleNamespace(
        user=SimpleNamespace(email="dev@example.com", full_name="Dev Eloper")
    )
    defaults = dict(
        id="sev-1",
        event_type="R",
        secret_id="secret-1",
        environment=environment,
        path="/api/payments",
        version=3,
        type="secret",
        # E2EE ciphertext — must never leak into the envelope
        key="CIPHERTEXT_KEY_SENTINEL",
        key_digest="DIGEST_SENTINEL",
        value="CIPHERTEXT_VALUE_SENTINEL",
        comment="CIPHERTEXT_COMMENT_SENTINEL",
        user_id="member-1",
        user=user,
        service_account_id=None,
        service_account=None,
        service_account_token_id=None,
        service_account_token=None,
        service_token_id=None,
        service_token=None,
        ip_address="203.0.113.7",
        user_agent="phase-cli/1.18",
        timestamp=_TS,
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def test_audit_envelope_shape():
    envelope = audit_event_to_envelope(_audit_event(), _org())

    assert envelope["schema_version"] == 1
    assert envelope["event"] == {"id": "evt-1", "category": "org_audit", "type": "read"}
    assert envelope["timestamp"] == _TS.isoformat()
    assert envelope["client"]["address"] == "203.0.113.7"
    assert envelope["user_agent"]["original"] == "phase-cli/1.18"
    assert envelope["user"] == {"id": "member-1", "email": "dev@example.com", "name": "dev"}
    assert envelope["actor"]["token"]["name"] == "ci-token"
    assert envelope["phase"]["organisation"] == {"id": "org-1", "name": "Acme Corp"}
    assert envelope["phase"]["resource"]["type"] == "app"


def test_audit_envelope_ships_readable_resource_type_and_fallback_description():
    """DB resource codes ("rs", "pat"…) never leak into exports, and events
    whose call site omitted a description still get a readable content line."""
    event = _audit_event(
        event_type="U",
        resource_type="rs",
        resource_metadata={"name": "stripe-key"},
        description="",
    )
    envelope = audit_event_to_envelope(event, _org())

    assert envelope["phase"]["resource"]["type"] == "rotating_secret"
    assert envelope["phase"]["description"] == "Updated rotating secret 'stripe-key'"


def test_audit_envelope_fallback_description_without_resource_name():
    event = _audit_event(
        event_type="D", resource_type="policy", resource_metadata={}, description=""
    )
    envelope = audit_event_to_envelope(event, _org())

    assert envelope["phase"]["resource"]["type"] == "network_access_policy"
    assert envelope["phase"]["description"] == "Deleted network access policy"


def test_audit_envelope_service_account_actor_has_no_user_block():
    event = _audit_event(actor_type="sa", actor_metadata={"name": "ci-bot"})
    envelope = audit_event_to_envelope(event, _org())

    assert envelope["actor"]["type"] == "service_account"
    assert envelope["actor"]["name"] == "ci-bot"
    assert "user" not in envelope


def test_secret_envelope_shape():
    envelope = secret_event_to_envelope(_secret_event(), _org())

    assert envelope["event"] == {"id": "sev-1", "category": "secrets", "type": "read"}
    assert envelope["phase"]["secret"] == {
        "id": "secret-1",
        "path": "/api/payments",
        "version": 3,
        "type": "secret",
    }
    assert envelope["phase"]["app"] == {"id": "app-1", "name": "backend"}
    assert envelope["phase"]["environment"]["name"] == "Production"
    assert envelope["user"] == {
        "id": "member-1",
        "email": "dev@example.com",
        "name": "Dev Eloper",
    }
    # The description is the destination's human-scannable content line —
    # locates the secret without its E2EE name.
    assert (
        envelope["phase"]["description"]
        == "Secret read in backend / Production at /api/payments by Dev Eloper"
    )


def test_secret_envelope_never_ships_ciphertext_or_digest():
    envelope = secret_event_to_envelope(_secret_event(), _org())
    serialized = json.dumps(envelope)

    for sentinel in (
        "CIPHERTEXT_KEY_SENTINEL",
        "DIGEST_SENTINEL",
        "CIPHERTEXT_VALUE_SENTINEL",
        "CIPHERTEXT_COMMENT_SENTINEL",
    ):
        assert sentinel not in serialized

    secret_block = envelope["phase"]["secret"]
    for forbidden in ("key", "key_digest", "value", "comment"):
        assert forbidden not in secret_block


def test_secret_envelope_service_account_actor():
    event = _secret_event(
        user_id=None,
        user=None,
        service_account_id="sa-1",
        service_account=SimpleNamespace(name="deploy-bot"),
        service_account_token_id="sat-1",
        service_account_token=SimpleNamespace(name="gh-actions"),
    )
    envelope = secret_event_to_envelope(event, _org())

    assert envelope["actor"]["type"] == "service_account"
    assert envelope["actor"]["name"] == "deploy-bot"
    assert envelope["actor"]["token"]["name"] == "gh-actions"
    assert "user" not in envelope


def test_secret_envelope_engine_driven_event_renders_phase_actor():
    event = _secret_event(user_id=None, user=None)
    envelope = secret_event_to_envelope(event, _org())

    assert envelope["actor"] == {"type": "phase", "id": "", "name": "Phase"}
    assert (
        envelope["phase"]["description"]
        == "Secret read in backend / Production at /api/payments by Phase"
    )


def test_secret_envelope_root_path_omitted_from_description():
    event = _secret_event(path="/")
    envelope = secret_event_to_envelope(event, _org())

    assert (
        envelope["phase"]["description"]
        == "Secret read in backend / Production by Dev Eloper"
    )
