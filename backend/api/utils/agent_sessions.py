"""Security-sensitive primitives for Agent sessions and decoys."""

import base64
import hmac
import math
import re
import secrets
import string
from datetime import timedelta

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone
from nacl.encoding import RawEncoder
from nacl.hash import blake2b

from api.models import (
    Agent,
    AgentDecoy,
    AgentSession,
    AgentToken,
    AgentWorkflow,
)


SESSION_CREDENTIAL_PREFIX = "psx_sess_"
_DECOY_PATTERN = re.compile(r"\{rand:(base64|alnum|hex):(\d+)\}")
_CHARSETS = {
    "alnum": string.ascii_letters + string.digits,
    "hex": string.hexdigits.lower()[:16],
}


def _server_digest_key():
    value = settings.SERVER_SECRET
    try:
        return bytes.fromhex(value)
    except (TypeError, ValueError):
        return str(value).encode("utf-8")


def _urlsafe_digest(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _keyed_digest(value: str) -> bytes:
    return blake2b(
        value.encode("utf-8"),
        key=_server_digest_key(),
        encoder=RawEncoder,
        digest_size=32,
    )


def mint_session_credential(idempotency_key=None):
    """Mint a URL-safe >=256-bit session capability.

    When an idempotency key is supplied, the server deterministically derives
    the same capability. This lets a proxy safely retry a lost POST /sessions
    response without storing #1 in plaintext.
    """
    if idempotency_key:
        digest = _keyed_digest(f"agent-session:{idempotency_key}")
    else:
        digest = secrets.token_bytes(32)
    return SESSION_CREDENTIAL_PREFIX + _urlsafe_digest(digest)


def hash_session_credential(credential):
    return _keyed_digest(credential).hex()


def verify_session_credential(session, credential):
    if not credential or not session.is_active:
        return False
    candidate = hash_session_credential(credential)
    return hmac.compare_digest(session.hashed_session_credential, candidate)


def _validate_idempotent_session(
    existing,
    *,
    agent,
    workflow,
    agent_token,
    opened_by_member,
):
    if str(existing.agent_id) != str(agent.id) or str(
        existing.workflow_id
    ) != str(workflow.id):
        raise ValueError("Session idempotency key belongs to another Workflow")
    expected_authenticator = (
        ("agent_token_id", getattr(agent_token, "id", None)),
        ("opened_by_member_id", getattr(opened_by_member, "id", None)),
    )
    if any(
        (value is not None and str(getattr(existing, field)) != str(value))
        or (value is None and getattr(existing, field) is not None)
        for field, value in expected_authenticator
    ):
        raise ValueError("Session idempotency key belongs to another authenticator")
    if not existing.is_active:
        raise ValueError("Idempotent Agent session is no longer active")
    return existing


@transaction.atomic
def create_agent_session(
    *,
    agent,
    workflow,
    idempotency_key=None,
    client_info=None,
    harness_label="",
    agent_token=None,
    opened_by_member=None,
    ttl_seconds=None,
    max_ttl_seconds=None,
    access_validator=None,
):
    # Stable parent locks serialize session opening with Agent disable/delete
    # and Workflow deletion. All management paths use the same Agent →
    # Workflow → AgentToken → Session order.
    try:
        agent = Agent.objects.select_for_update().get(
            id=agent.id,
            deleted_at__isnull=True,
            status=Agent.ACTIVE,
        )
    except Agent.DoesNotExist as exc:
        raise ValueError("Agent is no longer active") from exc
    try:
        workflow = AgentWorkflow.objects.select_for_update().get(
            id=workflow.id,
            organisation=agent.organisation,
            agent=agent,
            deleted_at__isnull=True,
        )
    except AgentWorkflow.DoesNotExist as exc:
        raise ValueError("Agent Workflow is no longer active") from exc

    if access_validator is not None:
        access_validator(agent, workflow)

    if agent_token is not None:
        try:
            agent_token = AgentToken.objects.select_for_update().get(
                id=agent_token.id,
                deleted_at__isnull=True,
            )
        except AgentToken.DoesNotExist as exc:
            raise ValueError("Agent token is no longer active") from exc
        if agent_token.expires_at and agent_token.expires_at <= timezone.now():
            raise ValueError("Agent token is expired")

    ttl_seconds = int(
        ttl_seconds or getattr(settings, "AGENT_SESSION_TTL_SECONDS", 3600)
    )
    max_ttl_seconds = int(
        max_ttl_seconds
        or getattr(settings, "AGENT_SESSION_MAX_TTL_SECONDS", 86400)
    )
    if ttl_seconds <= 0 or max_ttl_seconds <= 0 or ttl_seconds > max_ttl_seconds:
        raise ValueError("Invalid Agent session TTL")

    if idempotency_key:
        existing = (
            AgentSession.objects.select_for_update()
            .filter(open_idempotency_key=idempotency_key)
            .first()
        )
        if existing is not None:
            _validate_idempotent_session(
                existing,
                agent=agent,
                workflow=workflow,
                agent_token=agent_token,
                opened_by_member=opened_by_member,
            )
            return existing, mint_session_credential(idempotency_key), False

    now = timezone.now()
    credential = mint_session_credential(idempotency_key)
    session = AgentSession(
        organisation=agent.organisation,
        workflow=workflow,
        open_idempotency_key=idempotency_key,
        hashed_session_credential=hash_session_credential(credential),
        expires_at=now + timedelta(seconds=ttl_seconds),
        max_expires_at=now + timedelta(seconds=max_ttl_seconds),
        client_info=client_info or {},
        harness_label=harness_label,
        agent_token=agent_token,
        opened_by_member=opened_by_member,
    )
    try:
        # Keep a savepoint so a cross-Workflow collision on the globally unique
        # key can be recovered without poisoning the outer transaction.
        with transaction.atomic():
            session.full_clean()
            session.save()
    except IntegrityError:
        if not idempotency_key:
            raise
        existing = (
            AgentSession.objects.select_for_update()
            .filter(open_idempotency_key=idempotency_key)
            .first()
        )
        if existing is None:
            raise
        _validate_idempotent_session(
            existing,
            agent=agent,
            workflow=workflow,
            agent_token=agent_token,
            opened_by_member=opened_by_member,
        )
        return existing, mint_session_credential(idempotency_key), False
    return session, credential, True


def rotate_session_credential(session):
    if not session.is_active:
        raise ValueError("Cannot rotate an inactive Agent session")
    credential = mint_session_credential()
    session.hashed_session_credential = hash_session_credential(credential)
    session.config_generation += 1
    session.save(
        update_fields=[
            "hashed_session_credential",
            "config_generation",
        ]
    )
    return credential


def revoke_agent_session(session):
    """Explicitly revoke an Agent session."""

    now = timezone.now()
    with transaction.atomic():
        locked = (
            AgentSession.objects.select_for_update(of=("self",))
            .get(pk=session.pk)
        )
        if locked.revoked_at is None:
            locked.revoked_at = now
            locked.save(update_fields=["revoked_at"])
        else:
            now = locked.revoked_at

    session.revoked_at = now
    return session


def revoke_agent_sessions(sessions):
    """Apply break-glass revocation to an iterable/queryset of sessions."""

    session_ids = list(sessions.values_list("pk", flat=True)) if hasattr(
        sessions, "values_list"
    ) else [getattr(value, "pk", value) for value in sessions]
    for session_id in sorted(session_ids, key=str):
        try:
            revoke_agent_session(AgentSession.objects.get(pk=session_id))
        except AgentSession.DoesNotExist:
            continue
    return len(session_ids)


def _random_fragment(kind, length):
    if kind == "base64":
        size = math.ceil(length * 3 / 4)
        return base64.b64encode(secrets.token_bytes(size)).decode("ascii")[:length]
    charset = _CHARSETS[kind]
    return "".join(secrets.choice(charset) for _ in range(length))


def render_decoy_format(format_string):
    """Render exactly one constrained random placeholder with >=128-bit entropy."""
    if format_string == "{aws_access_key_id}":
        # AWS access-key IDs have a fixed 20-character public identifier shape.
        # This is a correlation decoy, not an authentication capability.
        alphabet = string.ascii_uppercase + string.digits
        return "AKIA" + "".join(secrets.choice(alphabet) for _ in range(16))
    matches = list(_DECOY_PATTERN.finditer(format_string or ""))
    if len(matches) != 1:
        raise ValueError("Decoy format must contain exactly one {rand:kind:length}")
    match = matches[0]
    kind, length_text = match.groups()
    length = int(length_text)
    alphabet_size = 64 if kind == "base64" else len(_CHARSETS[kind])
    if length * math.log2(alphabet_size) < 128:
        raise ValueError("Decoy format must carry at least 128 bits of entropy")
    fragment = _random_fragment(kind, length)
    return format_string[: match.start()] + fragment + format_string[match.end() :]


def create_decoy(*, session, authentication, grant, field_name, kind, format_string):
    """Mint a globally unique decoy, retrying only an astronomically rare collision."""
    scope = {"session": session, "grant": grant, "field_name": field_name}

    for _ in range(8):
        value = render_decoy_format(format_string)
        try:
            # Keep a collision rollback inside its own savepoint so callers can
            # safely invoke this helper from the transaction that opens a
            # complete session.
            with transaction.atomic():
                return AgentDecoy.objects.create(
                    organisation=session.organisation,
                    agent=session.agent,
                    authentication=authentication,
                    grant=grant,
                    session=session,
                    kind=kind,
                    field_name=field_name,
                    decoy_value=value,
                )
        except IntegrityError:
            # A concurrent resolver may have won the stable Grant-scoped slot.
            # Return that canonical decoy;
            # otherwise this was only the globally-unique value collision and
            # a fresh random value is safe to try.
            existing = AgentDecoy.objects.filter(**scope).first()
            if existing is not None:
                return existing
            continue
    raise RuntimeError("Unable to mint a unique Agent decoy")
