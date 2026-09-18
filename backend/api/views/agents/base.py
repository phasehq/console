"""Shared authentication and error primitives for the Agent runtime API."""

from dataclasses import dataclass

from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import AuthenticationFailed, NotAuthenticated
from rest_framework.response import Response

from api.models import Agent, AgentSession, AgentWorkflow
from api.utils.access.permissions import account_can_access_workflow
from api.utils.agent_sessions import hash_session_credential, verify_session_credential


SCHEMA_VERSION = 1
SESSION_CREDENTIAL_HEADER = "X-Phase-Session-Credential"
SESSION_CREDENTIAL_HEADER_ALIASES = (
    SESSION_CREDENTIAL_HEADER,
    "X-Phase-Agent-Session-Credential",
)


@dataclass
class AgentRuntimeError(Exception):
    code: str
    message: str
    http_status: int = status.HTTP_400_BAD_REQUEST
    retryable: bool = False
    details: dict | None = None


def error_response(exc):
    if not isinstance(exc, AgentRuntimeError):
        exc = AgentRuntimeError(
            "agent_runtime_error",
            "The Agent runtime request could not be completed.",
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            True,
        )
    return Response(
        {
            "error": {
                "code": exc.code,
                "message": exc.message,
                "retryable": exc.retryable,
                "details": exc.details or {},
            }
        },
        status=exc.http_status,
    )


def authentication_error_response(exc):
    """Return the versioned Agent error envelope for DRF auth failures."""

    if not isinstance(exc, (AuthenticationFailed, NotAuthenticated)):
        return None
    response = error_response(
        AgentRuntimeError(
            "agent_authentication_failed",
            (
                "The Phase authentication token is invalid, expired, deleted, "
                "or no longer active. Authenticate again with a current token."
            ),
            status.HTTP_401_UNAUTHORIZED,
        )
    )
    response["WWW-Authenticate"] = "Bearer"
    return response


def _management_account(request):
    if request.auth.get("auth_type") == "User":
        return request.auth.get("org_member")
    return None


def session_human_account(session):
    """Return the live human principal that authorized a runtime Session."""

    if session.agent_token_id is not None:
        return (
            session.agent_token.created_by
            if session.agent_token is not None
            else None
        )
    return session.opened_by_member


def require_session_workflow_permission(
    session,
    action,
    resource,
    *,
    code="agent_workflow_forbidden",
    message="Agent Workflow access has been revoked.",
):
    """Recheck both human RBAC and exact Workflow membership at use time."""

    if not account_can_access_workflow(
        session_human_account(session),
        session.workflow,
        action,
        resource=resource,
    ):
        raise AgentRuntimeError(
            code,
            message,
            status.HTTP_403_FORBIDDEN,
        )


def validate_workflow_open_access(request, agent, workflow):
    """Revalidate Workflow membership and RBAC under locks."""

    auth_type = request.auth.get("auth_type")
    if str(workflow.agent_id) != str(agent.id):
        raise AgentRuntimeError(
            "workflow_scope_mismatch",
            "The Agent token is scoped to a different Workflow.",
            status.HTTP_403_FORBIDDEN,
        )
    if auth_type == "Agent":
        scoped_workflow = request.auth.get("workflow")
        if scoped_workflow is None or str(scoped_workflow.id) != str(workflow.id):
            raise AgentRuntimeError(
                "workflow_scope_mismatch",
                "The Agent token is scoped to a different Workflow.",
                status.HTTP_403_FORBIDDEN,
            )
        token = request.auth.get("agent_token")
        account = token.created_by if token is not None else None
    else:
        account = _management_account(request)
    if not account_can_access_workflow(
        account,
        workflow,
        "create",
        resource="AgentSessions",
    ):
        raise AgentRuntimeError(
            "agent_workflow_forbidden",
            "The authenticated principal cannot use this Agent Workflow.",
            status.HTTP_403_FORBIDDEN,
        )


def resolve_workflow_for_open(request, workflow_id):
    auth_type = request.auth.get("auth_type")
    if auth_type == "Agent":
        workflow = request.auth["workflow"]
        if workflow_id and str(workflow_id) != str(workflow.id):
            raise AgentRuntimeError(
                "workflow_scope_mismatch",
                "The Agent token is scoped to a different Workflow.",
                status.HTTP_403_FORBIDDEN,
            )
        validate_workflow_open_access(request, workflow.agent, workflow)
        return workflow

    if not workflow_id:
        raise AgentRuntimeError(
            "workflow_required",
            "workflowId is required for User authentication.",
        )

    organisation = request.auth.get("organisation")
    try:
        workflow = AgentWorkflow.objects.select_related("agent", "organisation").get(
            id=workflow_id,
            organisation=organisation,
            deleted_at__isnull=True,
            agent__deleted_at__isnull=True,
            agent__status=Agent.ACTIVE,
        )
    except (AgentWorkflow.DoesNotExist, ValueError):
        # Organisation-scoping intentionally avoids a cross-tenant existence
        # oracle.
        raise AgentRuntimeError(
            "workflow_not_found",
            "The Agent Workflow was not found.",
            status.HTTP_404_NOT_FOUND,
        )

    validate_workflow_open_access(request, workflow.agent, workflow)
    return workflow


def session_credential_from_request(request):
    for header in SESSION_CREDENTIAL_HEADER_ALIASES:
        value = request.headers.get(header)
        if value:
            return value.strip()
    return None


def _principal_owns_session(request, session):
    auth_type = request.auth.get("auth_type")
    if auth_type == "Agent":
        token = request.auth.get("agent_token")
        return token is not None and str(session.agent_token_id) == str(token.id)
    if auth_type == "User":
        member = request.auth.get("org_member")
        return member is not None and str(session.opened_by_member_id) == str(member.id)
    return False


def resolve_session_for_request(
    request,
    session_uid,
    *,
    require_credential=True,
    require_active=True,
    touch=True,
):
    organisation = request.auth.get("organisation")
    try:
        session = AgentSession.objects.select_related(
            "workflow__agent",
            "agent_token__created_by__role",
            "opened_by_member__user",
            "opened_by_member__role",
            "organisation",
        ).get(session_uid=session_uid, organisation=organisation)
    except (AgentSession.DoesNotExist, ValueError):
        raise AgentRuntimeError(
            "agent_session_not_found",
            "The Agent session was not found.",
            status.HTTP_404_NOT_FOUND,
        )

    if not _principal_owns_session(request, session):
        raise AgentRuntimeError(
            "agent_session_forbidden",
            "The authenticated principal does not own this Agent session.",
            status.HTTP_403_FORBIDDEN,
        )

    if request.auth.get("auth_type") == "Agent":
        token = session.agent_token
        now = timezone.now()
        if (
            token is None
            or token.deleted_at is not None
            or (token.expires_at is not None and token.expires_at <= now)
        ):
            raise AgentRuntimeError(
                "agent_session_revoked",
                "The Agent token that opened this session is no longer active.",
                status.HTTP_401_UNAUTHORIZED,
            )

    require_session_workflow_permission(
        session,
        "create",
        "AgentSessions",
    )

    if (
        session.agent.deleted_at is not None
        or session.agent.status != Agent.ACTIVE
        or session.workflow.deleted_at is not None
    ):
        raise AgentRuntimeError(
            "agent_session_revoked",
            "The Agent session is no longer in an active management scope.",
            status.HTTP_401_UNAUTHORIZED,
        )

    if session.revoked_at is not None:
        raise AgentRuntimeError(
            "agent_session_revoked",
            "The Agent session has been revoked.",
            status.HTTP_401_UNAUTHORIZED,
        )
    if require_active and session.expires_at <= timezone.now():
        raise AgentRuntimeError(
            "agent_session_expired",
            "The Agent session has expired.",
            status.HTTP_401_UNAUTHORIZED,
        )

    if require_credential:
        credential = session_credential_from_request(request)
        if not verify_session_credential(session, credential):
            raise AgentRuntimeError(
                "invalid_session_credential",
                "A valid session credential is required.",
                status.HTTP_401_UNAUTHORIZED,
            )

    if touch:
        now = timezone.now()
        AgentSession.objects.filter(pk=session.pk).update(
            last_seen_at=now
        )
        Agent.objects.filter(id=session.agent_id).update(last_seen_at=now)
        session.last_seen_at = now
    request.auth["agent_session"] = session
    return session


def resolve_session_from_request_credential(request, *, touch=True):
    """Resolve the active Session from its capability, without a client UID."""

    credential = session_credential_from_request(request)
    if not credential:
        raise AgentRuntimeError(
            "session_credential_required",
            "The Agent session credential is required.",
            status.HTTP_401_UNAUTHORIZED,
        )
    digest = hash_session_credential(credential)
    candidates = list(
        AgentSession.objects.filter(
            organisation=request.auth.get("organisation"),
            hashed_session_credential=digest,
        ).values_list("session_uid", flat=True)[:2]
    )
    if len(candidates) != 1:
        raise AgentRuntimeError(
            "invalid_session_credential",
            "The Agent session credential is invalid or no longer active.",
            status.HTTP_401_UNAUTHORIZED,
        )
    return resolve_session_for_request(
        request,
        candidates[0],
        require_credential=True,
        require_active=True,
        touch=touch,
    )


def session_authenticator_kwargs(request):
    auth_type = request.auth.get("auth_type")
    if auth_type == "Agent":
        return {"agent_token": request.auth["agent_token"]}
    if auth_type == "User":
        return {"opened_by_member": request.auth["org_member"]}
    raise AgentRuntimeError(
        "unsupported_authentication",
        "This authentication mode cannot open Agent sessions.",
        status.HTTP_403_FORBIDDEN,
    )
