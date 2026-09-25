"""Principal-authenticated Agent management endpoints used by the CLI."""

from datetime import datetime

from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response

from api.models import Agent, AgentWorkflow, AuditEvent
from api.utils.access.permissions import (
    account_can_access_agent,
    account_can_access_workflow,
    role_has_permission,
)
from api.utils.agents import create_agent_with_default_workflow, mint_agent_token
from api.utils.audit_logging import get_actor_info, log_audit_event
from api.utils.rest import get_resolver_request_meta
from api.utils.agent_config import get_config_registry
from api.views.agents.base import AgentRuntimeError, SCHEMA_VERSION
from api.views.agents.views import AgentRuntimeAPIView


def _principal(request):
    if request.auth.get("auth_type") == "User":
        return request.auth["org_member"]
    raise AgentRuntimeError(
        "agent_management_forbidden",
        "Only organisation members can use Agent management endpoints.",
        status.HTTP_403_FORBIDDEN,
    )


def _require_permission(principal, action, resource):
    if not role_has_permission(principal.role, action, resource):
        raise AgentRuntimeError(
            "agent_management_forbidden",
            f"The authenticated principal cannot {action} {resource}.",
            status.HTTP_403_FORBIDDEN,
        )


def _audit_management(request, event_type, instance, description, **metadata):
    actor_type, actor_id, actor_metadata = get_actor_info(request)
    ip_address, user_agent = get_resolver_request_meta(request)
    log_audit_event(
        organisation=instance.organisation,
        event_type=event_type,
        resource_type=AuditEvent.AGENT,
        resource_id=instance.id,
        actor_type=actor_type,
        actor_id=actor_id,
        actor_metadata=actor_metadata,
        resource_metadata=metadata,
        description=description,
        ip_address=ip_address,
        user_agent=user_agent,
    )


def _agent_payload(agent, principal):
    workflows = [
        {
            "id": str(workflow.id),
            "name": workflow.name,
            "created_at": workflow.created_at,
        }
        for workflow in agent.workflows.filter(deleted_at__isnull=True)
        .select_related("agent")
        .order_by("created_at")
        if account_can_access_workflow(principal, workflow)
    ]
    return {
        "id": str(agent.id),
        "name": agent.name,
        "harness_type": agent.harness_type,
        "status": agent.status,
        "last_seen_at": agent.last_seen_at,
        "created_at": agent.created_at,
        "workflows": workflows,
    }


class AgentCollectionView(AgentRuntimeAPIView):
    def get(self, request):
        principal = _principal(request)
        agents = Agent.objects.prefetch_related("workflows").filter(
            organisation=request.auth["organisation"], deleted_at__isnull=True
        )
        visible = [
            _agent_payload(agent, principal)
            for agent in agents.order_by("name", "id")
            if account_can_access_agent(principal, agent)
        ]
        return Response({"schema_version": SCHEMA_VERSION, "agents": visible})

    def post(self, request):
        principal = _principal(request)
        _require_permission(principal, "create", "Agents")
        name = request.data.get("name")
        harness_type = request.data.get("harness_type", Agent.OTHER)
        workflow_name = request.data.get("default_workflow_name", "Default")
        if not isinstance(name, str) or not name.strip() or len(name.strip()) > 255:
            raise AgentRuntimeError(
                "invalid_agent_name", "name must contain 1-255 characters."
            )
        if harness_type not in dict(Agent.HARNESS_CHOICES):
            raise AgentRuntimeError(
                "invalid_harness_type", "The requested harnessType is not supported."
            )
        if (
            not isinstance(workflow_name, str)
            or not workflow_name.strip()
            or len(workflow_name.strip()) > 255
        ):
            raise AgentRuntimeError(
                "invalid_workflow_name",
                "defaultWorkflowName must contain 1-255 characters.",
            )
        agent, workflow = create_agent_with_default_workflow(
            organisation=request.auth["organisation"],
            name=name.strip(),
            harness_type=harness_type,
            created_by=principal,
            default_workflow_name=workflow_name.strip(),
        )
        _audit_management(
            request,
            AuditEvent.CREATE,
            agent,
            f"Created Agent '{agent.name}'",
            name=agent.name,
            workflow_id=str(workflow.id),
        )
        payload = _agent_payload(agent, principal)
        payload["default_workflow_id"] = str(workflow.id)
        return Response(payload, status=status.HTTP_201_CREATED)


def _parse_expiry(value):
    if value in (None, ""):
        return None
    if not isinstance(value, str):
        raise AgentRuntimeError("invalid_token_expiry", "expiresAt must be an ISO timestamp.")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise AgentRuntimeError(
            "invalid_token_expiry", "expiresAt must be an ISO timestamp."
        ) from exc
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed)
    if parsed <= timezone.now():
        raise AgentRuntimeError(
            "invalid_token_expiry", "expiresAt must be in the future."
        )
    return parsed


class AgentTokenCreateView(AgentRuntimeAPIView):
    def post(self, request, agent_id):
        principal = _principal(request)
        try:
            agent = Agent.objects.get(
                id=agent_id,
                organisation=request.auth["organisation"],
                deleted_at__isnull=True,
                status=Agent.ACTIVE,
            )
        except (Agent.DoesNotExist, ValueError):
            raise AgentRuntimeError(
                "agent_not_found", "The Agent was not found.", status.HTTP_404_NOT_FOUND
            )
        workflow_id = request.data.get("workflow_id")
        name = request.data.get("name")
        if not workflow_id:
            raise AgentRuntimeError(
                "workflow_required", "workflowId is required for an Agent token."
            )
        if not isinstance(name, str) or not name.strip() or len(name.strip()) > 64:
            raise AgentRuntimeError(
                "invalid_token_name", "name must contain 1-64 characters."
            )
        try:
            workflow = AgentWorkflow.objects.select_related("agent").get(
                id=workflow_id, agent=agent, deleted_at__isnull=True
            )
        except (AgentWorkflow.DoesNotExist, ValueError):
            raise AgentRuntimeError(
                "workflow_not_found",
                "The Workflow was not found for this Agent.",
                status.HTTP_404_NOT_FOUND,
            )
        if not account_can_access_workflow(
            principal,
            workflow,
            "create",
            resource="AgentTokens",
        ):
            raise AgentRuntimeError(
                "agent_token_create_forbidden",
                "The authenticated principal cannot create tokens for this Workflow.",
                status.HTTP_403_FORBIDDEN,
            )
        token, full_token, bearer_token = mint_agent_token(
            agent=agent,
            workflow=workflow,
            name=name.strip(),
            expires_at=_parse_expiry(request.data.get("expires_at")),
            created_by=principal,
        )
        _audit_management(
            request,
            AuditEvent.CREATE,
            agent,
            f"Minted reveal-once token '{token.name}' for Agent '{agent.name}'",
            name=agent.name,
            workflow_id=str(workflow.id),
            token_id=str(token.id),
            token_name=token.name,
        )
        return Response(
            {
                "id": str(token.id),
                "agent_id": str(agent.id),
                "workflow_id": str(workflow.id),
                "name": token.name,
                "expires_at": token.expires_at,
                "full_token": full_token,
                "bearer_token": bearer_token,
            },
            status=status.HTTP_201_CREATED,
        )


class AgentRegistryView(AgentRuntimeAPIView):
    def get(self, request):
        # Safe for Agent auth: registry metadata contains no configured hosts,
        # credential values, grants, or organisation data.
        return Response(get_config_registry().as_dict())
