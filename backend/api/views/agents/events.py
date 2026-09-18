"""Bounded, idempotent audit-event ingestion for Agent proxy sessions.

The proxy delivers this stream at least once.  We therefore serialize writes
per AgentSession, de-duplicate by the client-generated event ID, and commit the
batch before returning 202.  Keeping the durable write synchronous avoids an
acknowledged-but-lost gap when Redis/RQ is unavailable; ``bulk_create`` keeps
the bounded hot path inexpensive.
"""

from __future__ import annotations

from io import BytesIO
import math
import re

from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from djangorestframework_camel_case.parser import CamelCaseJSONParser
from djangorestframework_camel_case.render import CamelCaseJSONRenderer
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.auth import AgentAPIAuthentication
from api.models import AgentEvent, AgentSession, AgentWorkflowGrant
from api.throttling import PlanBasedRateThrottle
from api.utils.access.middleware import IsIPAllowed
from api.utils.agent_sessions import verify_session_credential
from api.views.agents.base import (
    AgentRuntimeError,
    SCHEMA_VERSION,
    authentication_error_response,
    error_response,
    resolve_session_for_request,
    session_credential_from_request,
)


_MAX_BODY_BYTES = 1024 * 1024
_MAX_BATCH_SIZE = 250
_MAX_DETAIL_KEYS = 16
_MAX_DETAIL_VALUE_LENGTH = 512
_MAX_PATH_LENGTH = 4096
_MAX_BIGINT = (1 << 63) - 1
_MAX_POSITIVE_INTEGER = (1 << 31) - 1

_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:/-]+$")
_CONTROL_CHARACTERS = re.compile(r"[\x00-\x1f\x7f]")

_TOP_LEVEL_FIELDS = {"schema_version", "batch_id", "events"}
_EVENT_FIELDS = {
    "event_id",
    "created_at",
    "grant_id",
    "event_type",
    "protocol",
    "method",
    "host",
    "port",
    "path",
    "provider",
    "status_code",
    "proxy_decision",
    "outcome",
    "latency_ms",
    "credential_action",
    "bytes_in",
    "bytes_out",
    "reason",
    "detail",
}


class BoundedAgentEventJSONParser(CamelCaseJSONParser):
    """Camel-case parser that caps the decoded request before JSON parsing."""

    def parse(self, stream, media_type=None, parser_context=None):
        body = stream.read(_MAX_BODY_BYTES + 1)
        if len(body) > _MAX_BODY_BYTES:
            raise AgentRuntimeError(
                "agent_event_body_too_large",
                f"Event batches must not exceed {_MAX_BODY_BYTES} bytes.",
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            )
        return super().parse(
            BytesIO(body), media_type=media_type, parser_context=parser_context
        )


class _AgentEventAPIView(APIView):
    authentication_classes = [AgentAPIAuthentication]
    permission_classes = [IsAuthenticated, IsIPAllowed]
    throttle_classes = [PlanBasedRateThrottle]
    parser_classes = [BoundedAgentEventJSONParser]
    renderer_classes = [CamelCaseJSONRenderer]

    def handle_exception(self, exc):
        if isinstance(exc, AgentRuntimeError):
            return error_response(exc)
        if response := authentication_error_response(exc):
            return response
        return super().handle_exception(exc)


def _invalid(message, *, index=None, field=None, code="invalid_agent_event_batch"):
    details = {}
    if index is not None:
        details["event_index"] = index
    if field is not None:
        details["field"] = field
    raise AgentRuntimeError(code, message, details=details)


def _strict_fields(value, allowed, *, index=None):
    if not isinstance(value, dict):
        _invalid(
            (
                "Each event must be an object."
                if index is not None
                else "Body must be an object."
            ),
            index=index,
        )
    unknown = sorted(set(value) - allowed)
    if unknown:
        _invalid(
            "Unknown fields are not accepted.",
            index=index,
            field=unknown[0],
            code="unknown_agent_event_field",
        )


def _string(
    event,
    field,
    *,
    index,
    maximum,
    required=False,
    default="",
    identifier=False,
    control_safe=False,
):
    value = event.get(field, default)
    if value is None and not required:
        return default
    if not isinstance(value, str) or (required and not value):
        _invalid(
            f"{field} must be a{' non-empty' if required else ''} string.",
            index=index,
            field=field,
        )
    if len(value) > maximum:
        _invalid(
            f"{field} exceeds its {maximum}-character limit.",
            index=index,
            field=field,
        )
    if identifier and value and not _ID_PATTERN.fullmatch(value):
        _invalid(
            f"{field} contains unsupported characters.", index=index, field=field
        )
    if (identifier or control_safe) and _CONTROL_CHARACTERS.search(value):
        _invalid(f"{field} contains control characters.", index=index, field=field)
    return value


def _integer(
    event,
    field,
    *,
    index,
    default=None,
    minimum=0,
    maximum=_MAX_POSITIVE_INTEGER,
):
    value = event.get(field, default)
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        _invalid(f"{field} must be an integer.", index=index, field=field)
    if value < minimum or value > maximum:
        _invalid(
            f"{field} is outside the supported range.", index=index, field=field
        )
    return value


def _detail(event, *, index):
    """A flat object of short scalar values, e.g. ``{"aws_sigv4_failure": ...}``."""

    value = event.get("detail")
    if value is None:
        return {}
    if not isinstance(value, dict):
        _invalid("detail must be an object.", index=index, field="detail")
    if len(value) > _MAX_DETAIL_KEYS:
        _invalid(
            f"detail must not have more than {_MAX_DETAIL_KEYS} keys.",
            index=index,
            field="detail",
        )
    for key, item in value.items():
        if len(key) > 64 or not _ID_PATTERN.fullmatch(key):
            _invalid(
                "detail keys must be identifiers of at most 64 characters.",
                index=index,
                field="detail",
            )
        if isinstance(item, str):
            if len(item) > _MAX_DETAIL_VALUE_LENGTH:
                _invalid(
                    "detail values must not exceed "
                    f"{_MAX_DETAIL_VALUE_LENGTH} characters.",
                    index=index,
                    field="detail",
                )
        elif isinstance(item, float) and not math.isfinite(item):
            _invalid(
                "detail must contain finite JSON numbers.",
                index=index,
                field="detail",
            )
        elif item is not None and not isinstance(item, (bool, int, float)):
            _invalid(
                "detail values must be strings, numbers, booleans or null.",
                index=index,
                field="detail",
            )
    return value


def _timestamp(event, *, index):
    value = event.get("created_at")
    if not isinstance(value, str):
        _invalid(
            "created_at must be an ISO-8601 string.",
            index=index,
            field="created_at",
        )
    try:
        parsed = parse_datetime(value)
    except ValueError:
        parsed = None
    if parsed is None or timezone.is_naive(parsed):
        _invalid(
            "created_at must include a valid timezone offset.",
            index=index,
            field="created_at",
        )
    return parsed


def _validate_event(event, index):
    _strict_fields(event, _EVENT_FIELDS, index=index)
    event_id = _string(
        event,
        "event_id",
        index=index,
        maximum=128,
        required=True,
        identifier=True,
    )
    grant_id = event.get("grant_id")
    if grant_id is not None:
        grant_id = _string(
            event,
            "grant_id",
            index=index,
            maximum=128,
            required=True,
            identifier=True,
        )
    proxy_decision = _string(
        event,
        "proxy_decision",
        index=index,
        maximum=32,
        required=True,
        identifier=True,
    )
    if proxy_decision not in dict(AgentEvent.DECISION_CHOICES):
        _invalid(
            "proxy_decision is not supported.",
            index=index,
            field="proxy_decision",
        )

    return {
        "event_id": event_id,
        "proxy_created_at": _timestamp(event, index=index),
        "grant_id": grant_id,
        "event_type": _string(
            event,
            "event_type",
            index=index,
            maximum=64,
            required=True,
            identifier=True,
        ),
        "protocol": _string(
            event,
            "protocol",
            index=index,
            maximum=32,
            required=True,
            identifier=True,
        ),
        "method": _string(
            event, "method", index=index, maximum=32, identifier=True
        ),
        "host": _string(
            event,
            "host",
            index=index,
            maximum=512,
            required=True,
            control_safe=True,
        ),
        "port": _integer(
            event, "port", index=index, minimum=1, maximum=65535
        ),
        "path": _string(event, "path", index=index, maximum=_MAX_PATH_LENGTH),
        "provider": _string(
            event,
            "provider",
            index=index,
            maximum=64,
            required=True,
            identifier=True,
        ),
        "status_code": _integer(
            event, "status_code", index=index, minimum=0, maximum=999
        ),
        "proxy_decision": proxy_decision,
        "outcome": _string(
            event, "outcome", index=index, maximum=32, identifier=True
        ),
        "latency_ms": _integer(event, "latency_ms", index=index),
        "credential_action": _string(
            event,
            "credential_action",
            index=index,
            maximum=64,
            identifier=True,
        ),
        "bytes_in": _integer(
            event, "bytes_in", index=index, default=0, maximum=_MAX_BIGINT
        ),
        "bytes_out": _integer(
            event, "bytes_out", index=index, default=0, maximum=_MAX_BIGINT
        ),
        "reason": _string(event, "reason", index=index, maximum=512),
        "detail": _detail(event, index=index),
    }


def validate_event_batch(data):
    _strict_fields(data, _TOP_LEVEL_FIELDS)
    schema_version = data.get("schema_version")
    if isinstance(schema_version, bool) or schema_version != SCHEMA_VERSION:
        raise AgentRuntimeError(
            "unsupported_schema_version",
            "schemaVersion 1 is required.",
            details={"supported": [SCHEMA_VERSION]},
        )
    batch_id = data.get("batch_id")
    if (
        not isinstance(batch_id, str)
        or not 8 <= len(batch_id) <= 128
        or not _ID_PATTERN.fullmatch(batch_id)
    ):
        _invalid(
            "batchId must be an 8-128 character URL-safe identifier.",
            field="batch_id",
        )
    events = data.get("events")
    if not isinstance(events, list) or not events:
        _invalid("events must be a non-empty array.", field="events")
    if len(events) > _MAX_BATCH_SIZE:
        raise AgentRuntimeError(
            "agent_event_batch_too_large",
            f"Event batches must contain at most {_MAX_BATCH_SIZE} events.",
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
        )
    return batch_id, [
        _validate_event(event, index) for index, event in enumerate(events)
    ]


def _grant_connections(session, events):
    grant_ids = {event["grant_id"] for event in events if event["grant_id"]}
    if not grant_ids:
        return {}
    grants = AgentWorkflowGrant.objects.filter(
        id__in=grant_ids,
        workflow=session.workflow,
        organisation=session.organisation,
        deleted_at__isnull=True,
        connection__deleted_at__isnull=True,
    ).values_list("id", "connection_id")
    mapping = {str(grant_id): connection_id for grant_id, connection_id in grants}
    missing = sorted(
        str(grant_id)
        for grant_id in grant_ids
        if str(grant_id) not in mapping
    )
    if missing:
        # Do not disclose whether the ID exists in another Workflow or tenant.
        raise AgentRuntimeError(
            "agent_event_grant_not_found",
            "An event references a grant outside this Agent Workflow.",
            status.HTTP_404_NOT_FOUND,
            details={
                "event_indexes": [
                    index
                    for index, event in enumerate(events)
                    if event["grant_id"] is not None
                    and str(event["grant_id"]) in missing
                ]
            },
        )
    return mapping


def persist_event_batch(session, events, session_credential):
    """Persist one validated batch and return ``(accepted, duplicates)``."""

    with transaction.atomic():
        # Serializing per session makes accepted/duplicate counts exact even
        # when the proxy retries the same batch concurrently.
        locked_session = AgentSession.objects.select_for_update().get(pk=session.pk)
        if not locked_session.is_active or not verify_session_credential(
            locked_session, session_credential
        ):
            raise AgentRuntimeError(
                "invalid_session_credential",
                "The Agent session is no longer active or its credential changed.",
                status.HTTP_401_UNAUTHORIZED,
            )

        grant_connections = _grant_connections(locked_session, events)
        event_ids = [event["event_id"] for event in events]
        existing_ids = set(
            AgentEvent.objects.filter(
                session=locked_session, event_id__in=event_ids
            ).values_list("event_id", flat=True)
        )
        seen = set()
        duplicates = 0
        rows = []
        for event in events:
            event_id = event["event_id"]
            if event_id in existing_ids or event_id in seen:
                duplicates += 1
                continue
            seen.add(event_id)
            event_data = dict(event)
            grant_id = event_data.pop("grant_id")
            rows.append(
                AgentEvent(
                    organisation=locked_session.organisation,
                    agent=locked_session.agent,
                    workflow=locked_session.workflow,
                    connection_id=(
                        grant_connections.get(str(grant_id)) if grant_id else None
                    ),
                    session=locked_session,
                    **event_data,
                )
            )

        if rows:
            AgentEvent.objects.bulk_create(rows, batch_size=_MAX_BATCH_SIZE)
        return len(rows), duplicates


class AgentSessionEventsView(_AgentEventAPIView):
    """POST ``/v1/agents/sessions/{uid}/events``."""

    def post(self, request, session_uid):
        session = resolve_session_for_request(request, session_uid)
        batch_id, events = validate_event_batch(request.data)
        session_credential = session_credential_from_request(request)
        accepted, duplicates = persist_event_batch(
            session, events, session_credential
        )
        return Response(
            {
                "schema_version": SCHEMA_VERSION,
                "batch_id": batch_id,
                "session_uid": str(session.session_uid),
                "accepted": accepted,
                "duplicates": duplicates,
            },
            status=status.HTTP_202_ACCEPTED,
        )
