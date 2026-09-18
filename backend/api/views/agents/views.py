"""Session-centric REST contract consumed by the Phase proxy and SDK."""

from collections.abc import Mapping
from datetime import timedelta
import json
import re
from urllib.parse import quote, urlencode

from django.conf import settings
from django.db import transaction
from django.db.models import F
from django.utils import timezone
from djangorestframework_camel_case.parser import CamelCaseJSONParser
from djangorestframework_camel_case.render import CamelCaseJSONRenderer
from nacl.encoding import RawEncoder
from nacl.hash import blake2b
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.auth import AgentAPIAuthentication
from api.models import (
    AgentConnection,
    AgentRequest,
    AgentSession,
    AgentWorkflow,
    ProviderCredentials,
)
from api.throttling import PlanBasedRateThrottle
from api.utils.access.middleware import IsIPAllowed
from api.utils.agent_sessions import (
    SESSION_TTL,
    create_agent_session,
    revoke_agent_session,
    rotate_session_credential,
    verify_session_credential,
)
from api.utils.agents import close_agent_request
from api.utils.agent_config import (
    CLIENT_MATCHER_SCHEMA_VERSION,
    ConfigCompatibilityError,
    ConfigRegistryError,
    get_config_registry,
)
from api.views.agents.base import (
    AgentRuntimeError,
    SCHEMA_VERSION,
    authentication_error_response,
    error_response,
    resolve_session_from_request_credential,
    resolve_session_for_request,
    resolve_workflow_for_open,
    require_session_workflow_permission,
    session_authenticator_kwargs,
    session_credential_from_request,
    validate_workflow_open_access,
)
from api.views.agents.runtime import (
    compose_context,
    negotiate_client,
    prepare_workflow,
    resolve_runtime_capabilities,
    resolve_workflow_config,
)


_IDEMPOTENCY_KEY = re.compile(r"^[A-Za-z0-9._:/-]{8,128}$")
_CREDENTIAL_TEXT = re.compile(
    r"(?:pss_(?:agent|user|service):v[0-9]+:[A-Za-z0-9:]+|"
    r"psx_sess_[A-Za-z0-9_-]+|"
    r"AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{20,}|"
    r"\bsk-(?:proj-|admin-)?[A-Za-z0-9_-]{16,}|"
    r"-----BEGIN [A-Z ]+PRIVATE KEY-----|"
    r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})"
)
_REQUEST_ID = re.compile(r"^[A-Za-z0-9._:/-]{1,128}$")
_REQUEST_SERVICE_TYPE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
# Request bodies and query strings arrive snake_cased by the camelCase parser
# and middleware, so only snake_case names need handling here.
_REQUEST_FIELDS = frozenset(
    {
        "schema_version",
        "kind",
        "service_type",
        "credential_provider",
        "credential_name",
        "credential_id",
        "connection_id",
        "markdown",
        "dedup_key",
        "related_request_id",
    }
)
_MAX_REQUEST_MARKDOWN = 20000
_MAX_PENDING_REQUESTS = 20
_REQUEST_LIFETIME = timedelta(days=7)
_REQUEST_PAGE_SIZE = 100
_EXPIRY_BATCH_SIZE = 100


class AgentRuntimeAPIView(APIView):
    authentication_classes = [AgentAPIAuthentication]
    permission_classes = [IsAuthenticated, IsIPAllowed]
    throttle_classes = [PlanBasedRateThrottle]
    parser_classes = [CamelCaseJSONParser]
    renderer_classes = [CamelCaseJSONRenderer]

    def handle_exception(self, exc):
        if isinstance(exc, AgentRuntimeError):
            return error_response(exc)
        if response := authentication_error_response(exc):
            return response
        return super().handle_exception(exc)


class AgentIdentityView(AgentRuntimeAPIView):
    """Return the workflow-scoped identity represented by an Agent token."""

    def get(self, request):
        if request.auth.get("auth_type") != "Agent":
            raise AgentRuntimeError(
                "agent_identity_forbidden",
                "Agent identity is available only to Agent tokens.",
                status.HTTP_403_FORBIDDEN,
            )

        agent = request.auth["agent"]
        workflow = request.auth["workflow"]
        organisation = request.auth["organisation"]
        return Response(
            {
                "schema_version": SCHEMA_VERSION,
                "principal_type": "agent",
                "agent": {"id": str(agent.id), "name": agent.name},
                "workflow": {
                    "id": str(workflow.id),
                    "name": workflow.name,
                },
                "organization": {
                    "id": str(organisation.id),
                    "name": organisation.name,
                },
            }
        )


def _same_request_target(
    agent_request,
    *,
    kind,
    connection,
    service_type,
    credential_provider,
    credential_name,
    credential_id=None,
    related_request_id=None,
):
    """Whether a request reusing a dedupKey asks for the same thing."""

    stored = [
        agent_request.kind,
        agent_request.related_request_id,
        agent_request.service_type,
        agent_request.credential_provider,
        agent_request.credential_name,
    ]
    requested = [
        kind,
        related_request_id,
        service_type,
        credential_provider,
        credential_name,
    ]
    if kind != AgentRequest.SETUP:
        stored += [agent_request.connection_id, agent_request.credential_id]
        requested += [getattr(connection, "id", None), credential_id]
    return [str(value or "") for value in stored] == [
        str(value or "") for value in requested
    ]


_PROGRESS_FIELDS = frozenset({
    "revision", "stage", "credential_id", "credential_name",
    "credential_provider", "credential_revision", "connection_id", "grant_id",
})
_RESOLUTION_FIELDS = _PROGRESS_FIELDS | frozenset({"runtime_action"})


def _safe_request_metadata(value, allowed_fields):
    """The allowlisted identifier fields of saved request state."""

    if not isinstance(value, Mapping):
        return {}
    return {
        key: item
        for key, item in value.items()
        if key in allowed_fields and isinstance(item, str)
    }


def _request_queryset(session):
    return AgentRequest.objects.filter(
        workflow=session.workflow,
        organisation=session.organisation,
    )


def _expire_pending_requests(queryset, now):
    """Expire a bounded batch of overdue pending requests."""

    with transaction.atomic():
        expired = (
            queryset.select_for_update(of=("self",))
            .filter(status=AgentRequest.PENDING, expires_at__lte=now)
            .order_by("expires_at", "id")[:_EXPIRY_BATCH_SIZE]
        )
        for agent_request in expired:
            close_agent_request(agent_request, AgentRequest.EXPIRED, now)


def _request_approval_url(agent_request):
    """Console page where a human reviews this request."""

    origins = settings.CORS_ALLOWED_ORIGINS
    origin = str(origins[0]).strip().rstrip("/") if origins else ""
    if not origin:
        return None
    organisation_path = quote(agent_request.organisation.name, safe="")
    # The console opens the same dialog for setup and credential replacement.
    query = urlencode({"request": str(agent_request.id), "action": "setup"})
    return f"{origin}/{organisation_path}/agents/requests?{query}"


def _session_response(session, config, *, session_credential=None):
    payload = {
        "schema_version": SCHEMA_VERSION,
        "session_uid": str(session.session_uid),
        "expires_at": session.expires_at,
        "max_expires_at": session.max_expires_at,
        "config_generation": session.config_generation,
        **config,
    }
    if session_credential is not None:
        payload["session_credential"] = session_credential
    return payload


def _request_response(agent_request):
    credential = agent_request.credential
    if credential is None and agent_request.connection_id:
        credential = agent_request.connection.authentication
    pending = agent_request.status == AgentRequest.PENDING
    payload = {
        "schema_version": SCHEMA_VERSION,
        "id": str(agent_request.id),
        "revision": str(agent_request.revision),
        "workflow_id": str(agent_request.workflow_id),
        "status": agent_request.status,
        "kind": agent_request.kind,
        "markdown": agent_request.markdown,
        "service_type": agent_request.service_type,
        "credential_provider": (
            credential.provider
            if credential and not pending
            else agent_request.credential_provider
        ),
        "credential_name": (
            credential.name
            if credential and not pending
            else agent_request.credential_name
        ),
        "connection_id": (
            str(agent_request.connection_id) if agent_request.connection_id else None
        ),
        "grant_id": str(agent_request.grant_id) if agent_request.grant_id else None,
        "credential_id": str(credential.id) if credential else None,
        "credential_revision": str(credential.revision) if credential else None,
        "progress": _safe_request_metadata(agent_request.progress, _PROGRESS_FIELDS),
        "resolution": _safe_request_metadata(
            agent_request.resolution, _RESOLUTION_FIELDS
        ),
        "related_request_id": (
            str(agent_request.related_request_id)
            if agent_request.related_request_id
            else None
        ),
        "resolution_note": agent_request.resolution_note,
        "resolved_at": agent_request.resolved_at,
        "request_expires_at": agent_request.expires_at,
        "created_at": agent_request.created_at,
        "updated_at": agent_request.updated_at,
    }
    runtime_action = (agent_request.resolution or {}).get("runtime_action")
    if agent_request.status == AgentRequest.APPROVED and runtime_action in {
        "retry", "restart_required"
    }:
        payload["runtime_action"] = runtime_action
    if agent_request.status == AgentRequest.PENDING:
        approval_url = _request_approval_url(agent_request)
        if approval_url:
            payload["approval_url"] = approval_url
    return payload


class AgentSessionCollectionView(AgentRuntimeAPIView):
    def post(self, request):
        if request.data.get("schema_version") != SCHEMA_VERSION:
            raise AgentRuntimeError(
                "unsupported_schema_version",
                "schemaVersion 1 is required.",
                details={"supported": [SCHEMA_VERSION]},
            )
        workflow_id = request.data.get("workflow_id")
        idempotency_key = request.data.get("idempotency_key")
        client = request.data.get("client", {})
        harness_label = request.data.get("harness_label", "")
        if not isinstance(idempotency_key, str) or not _IDEMPOTENCY_KEY.fullmatch(
            idempotency_key
        ):
            raise AgentRuntimeError(
                "invalid_idempotency_key",
                "idempotencyKey must be 8-128 URL-safe characters.",
            )
        if not isinstance(harness_label, str) or len(harness_label) > 128:
            raise AgentRuntimeError(
                "invalid_harness_label",
                "harnessLabel must be a string of at most 128 characters.",
            )
        if not isinstance(client, dict):
            raise AgentRuntimeError("invalid_client", "client must be an object.")
        if len(str(client.get("name", ""))) > 128 or len(
            str(client.get("version", ""))
        ) > 64:
            raise AgentRuntimeError("invalid_client", "client metadata is too long.")

        workflow = resolve_workflow_for_open(request, workflow_id)
        prepared = prepare_workflow(workflow)
        negotiate_client(client, prepared)
        authenticator = session_authenticator_kwargs(request)

        def revalidate_open_access(agent, locked_workflow):
            validate_workflow_open_access(request, agent, locked_workflow)

        try:
            # Commit the session before resolving its grants and decoys so an
            # idempotent retry can safely finish an interrupted open.
            session, session_credential, _ = create_agent_session(
                agent=workflow.agent,
                workflow=workflow,
                idempotency_key=idempotency_key,
                client_info=client,
                harness_label=harness_label,
                access_validator=revalidate_open_access,
                **authenticator,
            )
            # Check the Workflow again now that the session holds its locks. The
            # check above only gives early feedback; access may have changed
            # while this request waited.
            prepared = prepare_workflow(session.workflow)
            negotiate_client(client, prepared)
            config = resolve_workflow_config(
                session,
                include_secrets=True,
                prepared_grants=prepared,
            )
        except AgentRuntimeError:
            raise
        except ValueError as exc:
            raise AgentRuntimeError(
                "agent_session_open_failed", str(exc)
            ) from exc
        return Response(
            _session_response(
                session, config, session_credential=session_credential
            ),
            status=status.HTTP_201_CREATED,
        )


class AgentSessionConfigView(AgentRuntimeAPIView):
    def get(self, request, session_uid):
        session = resolve_session_for_request(request, session_uid)
        config = resolve_workflow_config(
            session,
            include_secrets=True,
        )
        hard_limit = session.max_expires_at or session.expires_at
        next_expiry = min(timezone.now() + SESSION_TTL, hard_limit)
        update = {"config_generation": F("config_generation") + 1}
        if next_expiry > session.expires_at:
            update["expires_at"] = next_expiry
        AgentSession.objects.filter(pk=session.pk, revoked_at__isnull=True).update(
            **update
        )
        session.refresh_from_db()
        return Response(_session_response(session, config))


class AgentSessionContextView(AgentRuntimeAPIView):
    def get(self, request, session_uid):
        session = resolve_session_for_request(request, session_uid)
        if set(request.query_params) - {"service_type"}:
            raise AgentRuntimeError(
                "unsupported_context_query",
                "Context accepts only one optional serviceType parameter.",
            )
        if len(request.query_params.getlist("service_type")) > 1:
            raise AgentRuntimeError(
                "invalid_context_service_type",
                "serviceType must occur at most once.",
            )
        service_type = request.query_params.get("service_type")
        if service_type is not None:
            if (
                not isinstance(service_type, str)
                or not _REQUEST_SERVICE_TYPE.fullmatch(service_type)
            ):
                raise AgentRuntimeError(
                    "invalid_context_service_type",
                    "serviceType must be a valid service identifier.",
                )
            service_type = service_type.lower()
            try:
                service = get_config_registry().get_service(service_type)
            except ConfigRegistryError as exc:
                raise AgentRuntimeError(
                    "unknown_context_service_type",
                    "The requested serviceType is not supported.",
                    status.HTTP_404_NOT_FOUND,
                ) from exc
            if not service["credential_providers"]:
                raise AgentRuntimeError(
                    "unknown_context_service_type",
                    "The requested serviceType is not available for Agent Connections.",
                    status.HTTP_404_NOT_FOUND,
                )
        payload = {
            "schema_version": SCHEMA_VERSION,
            "session_uid": str(session.session_uid),
            "markdown": compose_context(session, service_type=service_type),
        }
        if service_type is not None:
            payload["service_type"] = service_type
        return Response(payload)


class AgentSessionCapabilitiesView(AgentRuntimeAPIView):
    def get(self, request, session_uid):
        if request.query_params:
            raise AgentRuntimeError(
                "unsupported_capabilities_query",
                "Capabilities does not accept query parameters.",
            )
        session = resolve_session_for_request(request, session_uid)
        return Response(
            {
                "schema_version": SCHEMA_VERSION,
                "matcher_schema_version": CLIENT_MATCHER_SCHEMA_VERSION,
                "kind": "phase.ai.capabilities",
                "session_uid": str(session.session_uid),
                "services": resolve_runtime_capabilities(session),
            }
        )


class AgentSessionDiscoverView(AgentRuntimeAPIView):
    def get(self, request, session_uid):
        session = resolve_session_for_request(request, session_uid)
        config = resolve_workflow_config(
            session,
            include_secrets=False,
        )
        return Response(
            {
                "schema_version": SCHEMA_VERSION,
                "session_uid": str(session.session_uid),
                "config_generation": session.config_generation,
                **config,
            }
        )


class AgentSessionRevokeView(AgentRuntimeAPIView):
    def post(self, request, session_uid):
        session = resolve_session_for_request(request, session_uid)
        session = revoke_agent_session(session)
        return Response(
            {
                "schema_version": SCHEMA_VERSION,
                "session_uid": str(session.session_uid),
                "revoked_at": session.revoked_at,
            }
        )


class AgentSessionRotateView(AgentRuntimeAPIView):
    def post(self, request, session_uid):
        with transaction.atomic():
            session = resolve_session_for_request(request, session_uid)
            session = AgentSession.objects.select_for_update().get(pk=session.pk)
            # The first verification happened before the row lock. Another
            # rotate request may have won while this request was waiting, so
            # the presented capability must be checked again against the
            # locked row before replacing it.
            if not verify_session_credential(
                session, session_credential_from_request(request)
            ):
                raise AgentRuntimeError(
                    "invalid_session_credential",
                    "The Agent session is no longer active or its credential changed.",
                    status.HTTP_401_UNAUTHORIZED,
                )
            credential = rotate_session_credential(session)
        return Response(
            {
                "schema_version": SCHEMA_VERSION,
                "session_uid": str(session.session_uid),
                "session_credential": credential,
                "expires_at": session.expires_at,
                "config_generation": session.config_generation,
            }
        )


class AgentRequestCollectionView(AgentRuntimeAPIView):
    def get(self, request):
        session = resolve_session_from_request_credential(request)
        require_session_workflow_permission(
            session,
            "read",
            "AgentRequests",
            code="agent_request_forbidden",
            message=(
                "The authenticated principal cannot read Agent requests for this "
                "Workflow."
            ),
        )
        if set(request.query_params) - {"workflow_id", "status"}:
            raise AgentRuntimeError(
                "unsupported_request_field", "The query contains an unsupported field."
            )
        if any(
            len(request.query_params.getlist(key)) != 1
            for key in request.query_params
        ):
            raise AgentRuntimeError(
                "invalid_request_query", "Query fields must occur exactly once."
            )
        workflow_id = request.query_params.get("workflow_id")
        if workflow_id is not None and workflow_id != str(session.workflow_id):
            raise AgentRuntimeError(
                "workflow_scope_mismatch",
                "Requests are scoped to the authenticated Workflow.",
                status.HTTP_403_FORBIDDEN,
            )
        requested_status = request.query_params.get("status", AgentRequest.PENDING)
        if requested_status not in dict(AgentRequest.STATUS_CHOICES):
            raise AgentRuntimeError(
                "invalid_request_status", "The requested status is unsupported."
            )
        queryset = _request_queryset(session)
        _expire_pending_requests(queryset, timezone.now())
        requests = (
            queryset.filter(status=requested_status)
            .select_related(
                "organisation", "connection__authentication", "grant", "credential"
            )
            .order_by("-created_at", "id")[:_REQUEST_PAGE_SIZE]
        )
        return Response(
            {
                "schema_version": SCHEMA_VERSION,
                "requests": [_request_response(item) for item in requests],
            }
        )

    def post(self, request):
        session = resolve_session_from_request_credential(request)
        require_session_workflow_permission(
            session,
            "create",
            "AgentRequests",
            code="agent_request_forbidden",
            message=(
                "The authenticated principal cannot create Agent requests for this "
                "Workflow."
            ),
        )
        if not isinstance(request.data, Mapping):
            raise AgentRuntimeError(
                "invalid_request_body", "The request body must be a JSON object."
            )
        unknown_fields = sorted(set(request.data) - _REQUEST_FIELDS)
        if unknown_fields:
            raise AgentRuntimeError(
                "unsupported_request_field",
                "The request contains an unsupported field.",
                details={"field": unknown_fields[0]},
            )
        if "schema_version" in request.data:
            schema_version = request.data["schema_version"]
            if isinstance(schema_version, bool) or schema_version != SCHEMA_VERSION:
                raise AgentRuntimeError(
                    "unsupported_schema_version",
                    "schemaVersion 1 is required.",
                    details={"supported": [SCHEMA_VERSION]},
                )

        kind = request.data.get("kind")
        if kind not in {AgentRequest.SETUP, AgentRequest.CREDENTIAL_UPDATE}:
            raise AgentRuntimeError(
                "invalid_request_kind",
                "kind must be setup or credential_update.",
            )
        markdown = request.data.get("markdown", "")
        if (
            not isinstance(markdown, str)
            or not markdown.strip()
            or len(markdown) > _MAX_REQUEST_MARKDOWN
        ):
            raise AgentRuntimeError(
                "invalid_request_markdown",
                "markdown must contain 1-20,000 characters.",
            )
        if _CREDENTIAL_TEXT.search(markdown):
            raise AgentRuntimeError(
                "credential_in_request_markdown",
                "Request markdown must not contain credential-shaped values.",
            )

        dedup_key = request.data.get("dedup_key", "")
        if not isinstance(dedup_key, str) or len(dedup_key) > 128:
            raise AgentRuntimeError("invalid_dedup_key", "dedupKey is too long.")
        related_request_id = request.data.get("related_request_id")
        if related_request_id is not None and (
            not isinstance(related_request_id, str)
            or not _REQUEST_ID.fullmatch(related_request_id)
        ):
            raise AgentRuntimeError(
                "invalid_related_request",
                "relatedRequestId must be a valid request identifier.",
            )

        service_type = request.data.get("service_type")
        credential_provider = request.data.get("credential_provider")
        credential_name = request.data.get("credential_name", "")
        credential_id = request.data.get("credential_id")
        connection_id = request.data.get("connection_id")

        connection = None
        grant = None
        proposed_credential = None
        if kind == AgentRequest.SETUP:
            if connection_id is not None or credential_id is not None:
                raise AgentRuntimeError(
                    "unexpected_request_field",
                    "setup creates its own pending Connection and cannot target an "
                    "existing credential.",
                )
            if (
                not isinstance(service_type, str)
                or not _REQUEST_SERVICE_TYPE.fullmatch(service_type)
            ):
                raise AgentRuntimeError(
                    "service_type_required",
                    "serviceType must be a 1-64 character identifier.",
                )
            service_type = service_type.lower()
            try:
                service = get_config_registry().get_service(service_type)
            except ConfigRegistryError as exc:
                raise AgentRuntimeError(
                    "service_not_supported",
                    str(exc),
                ) from exc
            compatible_providers = set(service.get("credential_providers") or [])
            if credential_provider not in compatible_providers:
                raise AgentRuntimeError(
                    "credential_provider_not_supported",
                    "credentialProvider is incompatible with this service.",
                )
            if (
                not isinstance(credential_name, str)
                or not credential_name.strip()
                or len(credential_name.strip()) > 64
            ):
                raise AgentRuntimeError(
                    "invalid_credential_name",
                    "credentialName must contain 1-64 characters.",
                )
            credential_name = credential_name.strip()
        else:
            if "service_type" in request.data:
                raise AgentRuntimeError(
                    "unexpected_service_type",
                    "serviceType is valid only for setup requests.",
                )
            if (
                not isinstance(connection_id, str)
                or not _REQUEST_ID.fullmatch(connection_id)
            ):
                raise AgentRuntimeError(
                    "connection_id_required",
                    "credential_update requires connectionId.",
                )
            grant = (
                session.workflow.grants.select_related(
                    "connection__authentication"
                )
                .filter(
                    connection_id=connection_id,
                    deleted_at__isnull=True,
                    connection__deleted_at__isnull=True,
                )
                .first()
            )
            if grant is None:
                raise AgentRuntimeError(
                    "connection_not_in_workflow",
                    "The requested Connection is not bound to this Workflow.",
                    status.HTTP_404_NOT_FOUND,
                )
            connection = grant.connection
            service_type = connection.service_type
            try:
                service = get_config_registry().get_service(service_type)
            except ConfigRegistryError as exc:
                raise AgentRuntimeError(
                    "service_not_supported", str(exc)
                ) from exc
            compatible_providers = set(service.get("credential_providers") or [])
            if credential_provider is None:
                credential_provider = connection.authentication.provider
            if credential_provider not in compatible_providers:
                raise AgentRuntimeError(
                    "credential_provider_not_supported",
                    "credentialProvider is incompatible with this Connection.",
                )
            if credential_name is None or credential_name == "":
                credential_name = connection.authentication.name
            if not isinstance(credential_name, str) or len(credential_name) > 64:
                raise AgentRuntimeError(
                    "invalid_credential_name", "credentialName is too long."
                )
            if credential_id is not None:
                proposed_credential = ProviderCredentials.objects.filter(
                    id=credential_id,
                    organisation=session.organisation,
                    deleted_at__isnull=True,
                ).first()
                if (
                    proposed_credential is None
                    or proposed_credential.provider not in compatible_providers
                ):
                    raise AgentRuntimeError(
                        "credential_not_found",
                        "The proposed integration credential is unavailable.",
                        status.HTTP_404_NOT_FOUND,
                    )

        if not dedup_key:
            intent = {
                "kind": kind,
                "connection": str(connection_id or ""),
                "service": service_type,
                "credential_provider": credential_provider,
                "credential_name": credential_name,
                "credential_id": str(credential_id or ""),
                "related_request": str(related_request_id or ""),
            }
            dedup_key = "intent-" + blake2b(
                json.dumps(intent, sort_keys=True).encode(),
                encoder=RawEncoder,
                digest_size=32,
            ).hex()

        now = timezone.now()
        scoped_requests = _request_queryset(session)
        # Commit expiry on its own so a later error in this request can't undo it.
        _expire_pending_requests(scoped_requests, now)

        with transaction.atomic():
            try:
                workflow = AgentWorkflow.objects.select_for_update().get(
                    id=session.workflow_id,
                    organisation=session.organisation,
                    agent=session.agent,
                    deleted_at__isnull=True,
                )
            except AgentWorkflow.DoesNotExist as exc:
                raise AgentRuntimeError(
                    "agent_workflow_not_found",
                    "The Agent Workflow is no longer active.",
                    status.HTTP_404_NOT_FOUND,
                ) from exc

            related_request = None
            if related_request_id:
                related_request = scoped_requests.filter(
                    id=related_request_id
                ).first()
                if related_request is None:
                    raise AgentRuntimeError(
                        "related_request_not_found",
                        "The related request was not found in this Workflow.",
                        status.HTTP_404_NOT_FOUND,
                    )

            existing = scoped_requests.filter(dedup_key=dedup_key).order_by(
                "-created_at"
            ).first()
            if existing is not None:
                if not _same_request_target(
                    existing,
                    kind=kind,
                    connection=connection,
                    service_type=service_type,
                    credential_provider=credential_provider,
                    credential_name=credential_name,
                    credential_id=credential_id,
                    related_request_id=related_request_id,
                ):
                    raise AgentRuntimeError(
                        "dedup_key_conflict",
                        "dedupKey is already in use for a different request target.",
                        status.HTTP_409_CONFLICT,
                    )
                return Response(_request_response(existing))

            pending_count = scoped_requests.filter(
                status=AgentRequest.PENDING
            ).count()
            if pending_count >= _MAX_PENDING_REQUESTS:
                raise AgentRuntimeError(
                    "pending_request_limit",
                    f"This Workflow already has {_MAX_PENDING_REQUESTS} pending "
                    "requests.",
                    status.HTTP_429_TOO_MANY_REQUESTS,
                    True,
                )

            if kind == AgentRequest.SETUP:
                connection = AgentConnection(
                    organisation=session.organisation,
                    name=credential_name,
                    service_type=service_type,
                    # Required endpoint config is derived from the selected
                    # ProviderCredential when a human fulfills the request.
                    config={},
                    state=AgentConnection.PENDING_CREDENTIALS,
                )
                connection.full_clean()
                connection.save()

            progress = {
                "stage": "awaiting_credentials",
                "connection_id": str(connection.id),
                "credential_provider": credential_provider,
                "credential_name": credential_name,
            }
            if kind == AgentRequest.CREDENTIAL_UPDATE:
                progress.update(
                    {
                        "baseline_authentication_id": str(
                            connection.authentication_id
                        ),
                        "baseline_grant_id": str(grant.id),
                    }
                )
            agent_request = AgentRequest(
                organisation=session.organisation,
                workflow=workflow,
                connection=connection,
                grant=grant,
                credential=proposed_credential,
                kind=kind,
                service_type=service_type,
                credential_provider=credential_provider,
                credential_name=credential_name,
                markdown=markdown.strip(),
                dedup_key=dedup_key,
                related_request=related_request,
                progress=progress,
                expires_at=now + _REQUEST_LIFETIME,
            )
            agent_request.full_clean()
            agent_request.save()

        return Response(
            _request_response(agent_request), status=status.HTTP_201_CREATED
        )


class AgentRequestDetailView(AgentRuntimeAPIView):
    def get(self, request, request_id):
        session = resolve_session_from_request_credential(request)
        require_session_workflow_permission(
            session,
            "read",
            "AgentRequests",
            code="agent_request_forbidden",
            message=(
                "The authenticated principal cannot read Agent requests for this "
                "Workflow."
            ),
        )
        queryset = _request_queryset(session)
        _expire_pending_requests(queryset.filter(id=request_id), timezone.now())
        try:
            agent_request = queryset.select_related(
                "connection__authentication", "grant", "credential"
            ).get(
                id=request_id,
            )
        except (AgentRequest.DoesNotExist, ValueError):
            raise AgentRuntimeError(
                "agent_request_not_found",
                "The Agent request was not found in this Workflow.",
                status.HTTP_404_NOT_FOUND,
            )
        return Response(_request_response(agent_request))


class AgentRequestCancelView(AgentRuntimeAPIView):
    """Cancel only pending work; an approval that won the race stays intact."""

    def post(self, request, request_id):
        session = resolve_session_from_request_credential(request)
        require_session_workflow_permission(
            session,
            "delete",
            "AgentRequests",
            code="agent_request_forbidden",
            message=(
                "The authenticated principal cannot cancel Agent requests for this "
                "Workflow."
            ),
        )
        if not isinstance(request.data, Mapping) or request.data:
            raise AgentRuntimeError(
                "invalid_request_body", "Cancellation requires an empty JSON object."
            )
        with transaction.atomic():
            try:
                agent_request = (
                    _request_queryset(session)
                    .select_for_update(of=("self",))
                    .get(id=request_id)
                )
            except (AgentRequest.DoesNotExist, ValueError) as exc:
                raise AgentRuntimeError(
                    "agent_request_not_found",
                    "The Agent request was not found in this Workflow.",
                    status.HTTP_404_NOT_FOUND,
                ) from exc
            if agent_request.status == AgentRequest.PENDING:
                now = timezone.now()
                expired = agent_request.expires_at and agent_request.expires_at <= now
                close_agent_request(
                    agent_request,
                    AgentRequest.EXPIRED if expired else AgentRequest.CANCELLED,
                    now,
                )
            payload = _request_response(agent_request)
        return Response(payload)
