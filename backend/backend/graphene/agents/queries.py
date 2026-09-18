"""Human-console GraphQL queries for the AI Agents management plane."""

from django.db.models import Case, IntegerField, Value, When
from graphql import GraphQLError

from api.models import (
    Agent,
    AgentConnection,
    AgentEvent,
    AgentMembership,
    AgentRequest,
    AgentSession,
    AgentWorkflow,
)
from api.utils.access.permissions import (
    role_has_global_access,
    role_has_permission,
)
from api.utils.agent_config import get_config_registry
from backend.graphene.agents.common import (
    organisation_for,
    organisation_member,
    require_agent,
    require_role,
)
from backend.graphene.agents.types import (
    AgentEventPageType,
    AgentServiceTemplateType,
)


def _visible_agents(member, queryset, action="read"):
    if not role_has_permission(member.role, action, "Agents"):
        return queryset.none()
    if role_has_global_access(member.role):
        return queryset
    return queryset.filter(
        memberships__member=member,
        memberships__deleted_at__isnull=True,
    ).distinct()


def _accessible_workflow_ids(member, organisation, action="read"):
    workflows = AgentWorkflow.objects.select_related("agent").filter(
        organisation=organisation,
        agent__deleted_at__isnull=True,
        deleted_at__isnull=True,
    )
    if not role_has_permission(member.role, action, "AgentWorkflows"):
        return []
    if not role_has_global_access(member.role):
        workflows = workflows.filter(
            memberships__agent_membership__member=member,
            memberships__agent_membership__deleted_at__isnull=True,
            memberships__deleted_at__isnull=True,
        )
    return list(workflows.values_list("id", flat=True))


def resolve_agents(root, info, organisation_id, agent_id=None):
    member = organisation_member(info, organisation_id)
    organisation = member.organisation
    queryset = (
        Agent.objects.select_related("created_by", "created_by__user")
        .prefetch_related(
            "workflows",
            "tokens__workflow",
            "sessions__workflow",
            "memberships__member__user",
            "memberships__member__role",
            "memberships__workflow_memberships__workflow",
        )
        .filter(organisation=organisation, deleted_at__isnull=True)
        .order_by("name", "id")
    )
    if agent_id:
        queryset = queryset.filter(id=agent_id)
    return _visible_agents(member, queryset)


def resolve_agent_workflows(
    root, info, organisation_id, agent_id=None, workflow_id=None
):
    member = organisation_member(info, organisation_id)
    organisation = member.organisation
    accessible_ids = _accessible_workflow_ids(member, organisation)
    queryset = (
        AgentWorkflow.objects.select_related("agent")
        .prefetch_related("grants")
        .filter(
            organisation=organisation,
            id__in=accessible_ids,
            deleted_at__isnull=True,
        )
        .order_by("agent__name", "name", "id")
    )
    if agent_id:
        queryset = queryset.filter(agent_id=agent_id)
    if workflow_id:
        queryset = queryset.filter(id=workflow_id)
    return queryset


def resolve_agent_memberships(
    root,
    info,
    organisation_id,
    agent_id,
    membership_id=None,
    member_id=None,
):
    member = organisation_member(info, organisation_id)
    require_role(member, "read", "AgentMemberships")
    try:
        agent = Agent.objects.get(
            id=agent_id,
            organisation=member.organisation,
            deleted_at__isnull=True,
        )
    except (Agent.DoesNotExist, ValueError) as exc:
        raise GraphQLError("Agent not found") from exc
    require_agent(member, agent, "read")
    queryset = AgentMembership.objects.select_related(
        "agent",
        "member",
        "member__user",
        "member__role",
        "assigned_by",
    ).prefetch_related("workflow_memberships__workflow").filter(
        agent=agent,
        member__deleted_at__isnull=True,
        deleted_at__isnull=True,
    )
    if membership_id:
        queryset = queryset.filter(id=membership_id)
    if member_id:
        queryset = queryset.filter(member_id=member_id)
    return queryset.order_by("created_at", "id")


def resolve_agent_connections(root, info, organisation_id, connection_id=None):
    organisation, _ = organisation_for(
        info, organisation_id, "read", "AgentConnections"
    )
    queryset = AgentConnection.objects.select_related("authentication").filter(
        organisation=organisation, deleted_at__isnull=True
    )
    if connection_id:
        queryset = queryset.filter(id=connection_id)
    return queryset.order_by("name", "id")


def resolve_agent_requests(
    root,
    info,
    organisation_id,
    request_id=None,
    agent_id=None,
    workflow_id=None,
    status=None,
):
    organisation, member = organisation_for(
        info, organisation_id, "read", "AgentRequests"
    )
    accessible_workflow_ids = _accessible_workflow_ids(member, organisation)
    queryset = AgentRequest.objects.select_related(
        "workflow__agent",
        "connection__authentication",
        "connection__host_rules_authored_by",
        "connection__host_rules_approved_by",
        "credential",
        "resolved_by",
    ).filter(
        organisation=organisation,
        workflow_id__in=accessible_workflow_ids,
    )
    if request_id:
        queryset = queryset.filter(id=request_id)
    if agent_id:
        queryset = queryset.filter(workflow__agent_id=agent_id)
    if workflow_id:
        queryset = queryset.filter(workflow_id=workflow_id)
    if status:
        status = status.lower()
        if status not in dict(AgentRequest.STATUS_CHOICES):
            raise GraphQLError("Unsupported Agent request status")
        queryset = queryset.filter(status=status)
    return queryset.annotate(
        _pending_first=Case(
            When(status=AgentRequest.PENDING, then=Value(0)),
            default=Value(1),
            output_field=IntegerField(),
        )
    ).order_by("_pending_first", "-created_at", "id")


def resolve_agent_sessions(
    root,
    info,
    organisation_id,
    agent_id=None,
    workflow_id=None,
    active_only=False,
):
    organisation, member = organisation_for(
        info, organisation_id, "read", "AgentSessions"
    )
    accessible_workflow_ids = _accessible_workflow_ids(member, organisation)
    queryset = AgentSession.objects.select_related("workflow__agent").filter(
        organisation=organisation,
        workflow_id__in=accessible_workflow_ids,
    )
    if agent_id:
        queryset = queryset.filter(workflow__agent_id=agent_id)
    if workflow_id:
        queryset = queryset.filter(workflow_id=workflow_id)
    if active_only:
        from django.utils import timezone

        queryset = queryset.filter(
            revoked_at__isnull=True, expires_at__gt=timezone.now()
        )
    return queryset.order_by("-created_at", "id")[:500]


def resolve_agent_events(
    root,
    info,
    organisation_id,
    cursor=None,
    limit=100,
    agent_id=None,
    workflow_id=None,
    session_uid=None,
    proxy_decision=None,
    provider=None,
):
    member = organisation_member(info, organisation_id)
    organisation = member.organisation
    if not role_has_permission(member.role, "read", "Logs"):
        return AgentEventPageType(
            events=[], next_cursor=str(cursor or 0), has_more=False
        )
    try:
        after = int(cursor or 0)
    except (TypeError, ValueError) as exc:
        raise GraphQLError("Agent event cursor must be a non-negative integer") from exc
    if after < 0:
        raise GraphQLError("Agent event cursor must be a non-negative integer")
    if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 200:
        raise GraphQLError("Agent event limit must be between 1 and 200")

    queryset = AgentEvent.objects.select_related(
        "agent", "workflow", "connection", "session"
    ).filter(
        organisation=organisation,
        ingest_seq__gt=after,
    )
    if not role_has_global_access(member.role):
        queryset = queryset.filter(
            workflow_id__in=_accessible_workflow_ids(member, organisation)
        )
    if agent_id:
        queryset = queryset.filter(agent_id=agent_id)
    if workflow_id:
        queryset = queryset.filter(workflow_id=workflow_id)
    if session_uid:
        queryset = queryset.filter(session__session_uid=session_uid)
    if proxy_decision:
        proxy_decision = proxy_decision.lower()
        if proxy_decision not in dict(AgentEvent.DECISION_CHOICES):
            raise GraphQLError("Unsupported Agent event proxy decision")
        queryset = queryset.filter(proxy_decision=proxy_decision)
    if provider:
        queryset = queryset.filter(provider=provider)

    page = list(queryset.order_by("ingest_seq")[: limit + 1])
    has_more = len(page) > limit
    events = page[:limit]
    next_cursor = str(events[-1].ingest_seq) if events else str(after)
    return AgentEventPageType(
        events=events, next_cursor=next_cursor, has_more=has_more
    )


def _service_type(template):
    # GenericScalar does not recursively apply Graphene's camel-case naming.
    # Build the public, value-free wire shape explicitly so Console previews
    # and runtime clients see the same stable contract without exposing an
    # accidentally added registry key in the future.
    environment_bindings = []
    for binding in template["environment_bindings"]:
        public_binding = {
            "name": binding["name"],
            "action": binding["action"],
            "source": binding["source"],
            "sensitive": binding["sensitive"],
            "systemManaged": binding["system_managed"],
        }
        if "source_field" in binding:
            public_binding["sourceField"] = binding["source_field"]
        environment_bindings.append(public_binding)
    return AgentServiceTemplateType(
        service_type=template["service_type"],
        display_name=template["display_name"],
        protocol=template["protocol"],
        provider=template.get("provider"),
        proxy_only=template["proxy_only"],
        hosts=template["hosts"],
        host_rules_mode=template["host_rules_mode"],
        config_schema=template["config_schema"],
        injection=template["injection"],
        fields=template["fields"],
        environment_bindings=environment_bindings,
        # Decoy formats are value-free pattern strings (e.g. "PHX{rand:base64:37}")
        # used by the Console to preview what an Agent will see in place of the
        # real secret material.
        decoy_format=template.get("decoy_format", {}),
        credential_providers=template["credential_providers"],
    )


def resolve_agent_service_templates(root, info, organisation_id, service_type=None):
    organisation_for(info, organisation_id, "read", "AgentConnections")
    services = {
        key: value
        for key, value in get_config_registry().services.items()
        if value["credential_providers"]
    }
    if service_type:
        service_type = service_type.lower()
        template = services.get(service_type)
        return [_service_type(template)] if template else []
    return [_service_type(services[key]) for key in sorted(services)]
