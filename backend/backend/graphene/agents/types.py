import graphene
from django.utils import timezone
from graphene.types.generic import GenericScalar
from graphene_django import DjangoObjectType

from api.models import (
    Agent,
    AgentConnection,
    AgentEvent,
    AgentMembership,
    AgentRequest,
    AgentSession,
    AgentToken,
    AgentWorkflow,
    AgentWorkflowGrant,
    OrganisationMember,
)
from api.utils.access.permissions import (
    account_can_access_agent,
    account_can_access_workflow,
    role_has_global_access,
    role_has_permission,
)
from api.views.agents.runtime import connection_host_rules_are_approved
from api.utils.agent_config import (
    ConfigCompatibilityError,
    ConfigRegistryError,
    get_config_registry,
)
from backend.graphene.types import (
    OrganisationMemberType,
    ProviderCredentialsType,
)


def _member_for(info, organisation):
    if info is None or getattr(info, "context", None) is None:
        return None
    cached = getattr(info.context, "_org_member", None)
    if (
        cached is not None
        and str(cached.organisation_id) == str(organisation.id)
        and cached.deleted_at is None
    ):
        return cached
    user = getattr(info.context, "user", None)
    if getattr(user, "pk", None) is None:
        return None
    return (
        OrganisationMember.objects.select_related("role")
        .filter(
            organisation=organisation,
            user=user,
            deleted_at__isnull=True,
        )
        .first()
    )


def _iso_datetime(value):
    """Return a JSON-safe GraphQL GenericScalar datetime value."""

    return value.isoformat() if value is not None else None


class AgentTokenType(DjangoObjectType):
    class Meta:
        model = AgentToken
        fields = (
            "id",
            "name",
            "workflow",
            "created_at",
            "updated_at",
            "expires_at",
            "last_used_at",
            "deleted_at",
        )


class AgentSessionType(DjangoObjectType):
    id = graphene.String(required=True)
    agent = graphene.Field(lambda: AgentType, required=True)
    client_info = GenericScalar()

    class Meta:
        model = AgentSession
        fields = (
            "session_uid",
            "workflow",
            "expires_at",
            "max_expires_at",
            "revoked_at",
            "config_generation",
            "client_info",
            "harness_label",
            "created_at",
            "last_seen_at",
        )

    def resolve_id(self, info):
        return self.pk

    def resolve_agent(self, info):
        return self.workflow.agent


class AgentWorkflowType(DjangoObjectType):
    class Meta:
        model = AgentWorkflow
        fields = (
            "id",
            "organisation",
            "agent",
            "name",
            "created_at",
            "updated_at",
            "grants",
        )

    def resolve_grants(self, info):
        member = _member_for(info, self.organisation)
        if (
            member is None
            or not account_can_access_workflow(member, self, "read")
            or not role_has_permission(member.role, "read", "AgentConnections")
        ):
            return self.grants.none()
        return self.grants.filter(deleted_at__isnull=True).order_by(
            "created_at", "id"
        )


class AgentMembershipType(DjangoObjectType):
    member = graphene.Field(OrganisationMemberType, required=True)
    assigned_by = graphene.Field(OrganisationMemberType)
    workflows = graphene.List(
        graphene.NonNull(AgentWorkflowType), required=True
    )

    class Meta:
        model = AgentMembership
        fields = (
            "id",
            "agent",
            "member",
            "assigned_by",
            "created_at",
            "updated_at",
        )

    def resolve_workflows(self, info):
        return AgentWorkflow.objects.filter(
            memberships__agent_membership=self,
            memberships__deleted_at__isnull=True,
            deleted_at__isnull=True,
        ).order_by("created_at", "id")


class AgentType(DjangoObjectType):
    workflows = graphene.List(AgentWorkflowType, required=True)
    tokens = graphene.List(AgentTokenType, required=True)
    sessions = graphene.List(AgentSessionType, required=True)
    memberships = graphene.List(AgentMembershipType, required=True)
    created_by = graphene.Field(OrganisationMemberType)
    can_manage_members = graphene.Boolean(required=True)
    viewer_workflow_ids = graphene.List(graphene.NonNull(graphene.ID), required=True)
    token_count = graphene.Int(required=True)
    session_count = graphene.Int(required=True)
    active_session_count = graphene.Int(required=True)

    class Meta:
        model = Agent
        fields = (
            "id",
            "organisation",
            "name",
            "harness_type",
            "status",
            "last_seen_at",
            "created_at",
            "updated_at",
            "workflows",
            "tokens",
            "sessions",
            "memberships",
            "created_by",
        )

    def _viewer_workflow_ids(self, member, action="read"):
        cache_name = f"_viewer_{action}_workflow_ids_{member.id}"
        cached = getattr(self, cache_name, None)
        if cached is None:
            if not role_has_permission(member.role, action, "AgentWorkflows"):
                cached = []
            else:
                workflows = self.workflows.filter(deleted_at__isnull=True)
                if not role_has_global_access(member.role):
                    workflows = workflows.filter(
                        memberships__agent_membership__member=member,
                        memberships__agent_membership__deleted_at__isnull=True,
                        memberships__deleted_at__isnull=True,
                    )
                cached = list(
                    workflows.order_by("created_at", "id").values_list(
                        "id", flat=True
                    )
                )
            setattr(self, cache_name, cached)
        return cached

    def resolve_workflows(self, info):
        member = _member_for(info, self.organisation)
        if member is None:
            return []
        return self.workflows.filter(
            id__in=self._viewer_workflow_ids(member),
            deleted_at__isnull=True,
        ).order_by("created_at", "id")

    def resolve_tokens(self, info):
        member = _member_for(info, self.organisation)
        if (
            member is None
            or not role_has_permission(member.role, "read", "AgentTokens")
        ):
            return []
        return AgentToken.objects.select_related("workflow").filter(
            workflow__agent=self,
            deleted_at__isnull=True,
            workflow_id__in=self._viewer_workflow_ids(member),
            workflow__deleted_at__isnull=True,
        ).order_by("-created_at")

    def resolve_sessions(self, info):
        member = _member_for(info, self.organisation)
        if (
            member is None
            or not role_has_permission(member.role, "read", "AgentSessions")
        ):
            return []
        return AgentSession.objects.select_related("workflow").filter(
            workflow__agent=self,
            workflow_id__in=self._viewer_workflow_ids(member)
        ).order_by("-created_at")[:100]

    def resolve_memberships(self, info):
        member = _member_for(info, self.organisation)
        if (
            member is None
            or not account_can_access_agent(member, self, "read")
            or not role_has_permission(member.role, "read", "AgentMemberships")
        ):
            return []
        return self.memberships.select_related(
            "member", "member__user", "member__role", "assigned_by"
        ).filter(deleted_at__isnull=True).order_by("created_at", "id")

    def resolve_can_manage_members(self, info):
        member = _member_for(info, self.organisation)
        return bool(
            member is not None
            and account_can_access_agent(member, self, "update")
            and role_has_permission(member.role, "create", "AgentMemberships")
            and role_has_permission(member.role, "update", "AgentMemberships")
            and role_has_permission(member.role, "delete", "AgentMemberships")
        )

    def resolve_viewer_workflow_ids(self, info):
        member = _member_for(info, self.organisation)
        if member is None:
            return []
        return self._viewer_workflow_ids(member)

    def resolve_token_count(self, info):
        member = _member_for(info, self.organisation)
        if (
            member is None
            or not role_has_permission(member.role, "read", "AgentTokens")
        ):
            return 0
        return AgentToken.objects.filter(
            workflow__agent=self,
            deleted_at__isnull=True,
            workflow_id__in=self._viewer_workflow_ids(member),
            workflow__deleted_at__isnull=True,
        ).count()

    def resolve_session_count(self, info):
        member = _member_for(info, self.organisation)
        if (
            member is None
            or not role_has_permission(member.role, "read", "AgentSessions")
        ):
            return 0
        return AgentSession.objects.filter(
            workflow__agent=self,
            workflow_id__in=self._viewer_workflow_ids(member)
        ).count()

    def resolve_active_session_count(self, info):
        member = _member_for(info, self.organisation)
        if (
            member is None
            or not role_has_permission(member.role, "read", "AgentSessions")
        ):
            return 0
        return AgentSession.objects.filter(
            workflow__agent=self,
            workflow_id__in=self._viewer_workflow_ids(member),
            revoked_at__isnull=True,
            expires_at__gt=timezone.now(),
        ).count()


class AgentConnectionType(DjangoObjectType):
    authentication = graphene.Field(ProviderCredentialsType)
    config = GenericScalar(required=True)

    class Meta:
        model = AgentConnection
        fields = (
            "id",
            "organisation",
            "name",
            "service_type",
            "state",
            "authentication",
            "config",
            "host_rules_authored_by",
            "host_rules_approved_by",
            "host_rules_version",
            "host_rules_approved_version",
            "created_at",
            "updated_at",
        )


class AgentWorkflowGrantType(DjangoObjectType):
    class Meta:
        model = AgentWorkflowGrant
        fields = (
            "id",
            "workflow",
            "connection",
            "created_at",
            "updated_at",
        )


class AgentRequestType(DjangoObjectType):
    agent = graphene.Field(lambda: AgentType, required=True)
    progress = GenericScalar(required=True)
    resolution = GenericScalar(required=True)
    revision = graphene.String(required=True)
    kind = graphene.String(required=True)
    status = graphene.String(required=True)

    class Meta:
        model = AgentRequest
        fields = (
            "id",
            "workflow",
            "connection",
            "grant",
            "credential",
            "kind",
            "service_type",
            "credential_provider",
            "credential_name",
            "markdown",
            "status",
            "resolution_note",
            "resolved_by",
            "resolved_at",
            "expires_at",
            "created_at",
            "updated_at",
        )

    def resolve_agent(self, info):
        return self.workflow.agent


class AgentEventType(DjangoObjectType):
    detail = GenericScalar(required=True)

    class Meta:
        model = AgentEvent
        fields = "__all__"


class AgentEventPageType(graphene.ObjectType):
    events = graphene.List(AgentEventType, required=True)
    next_cursor = graphene.String()
    has_more = graphene.Boolean(required=True)


class AgentServiceTemplateType(graphene.ObjectType):
    service_type = graphene.String(required=True)
    display_name = graphene.String(required=True)
    protocol = graphene.String(required=True)
    provider = graphene.String()
    proxy_only = graphene.Boolean(required=True)
    hosts = GenericScalar(required=True)
    host_rules_mode = graphene.String(required=True)
    config_schema = GenericScalar(required=True)
    injection = GenericScalar(required=True)
    fields = GenericScalar(required=True)
    environment_bindings = GenericScalar(required=True)
    decoy_format = GenericScalar(required=True)
    credential_providers = graphene.List(graphene.String, required=True)


class MintedAgentTokenType(graphene.ObjectType):
    token = graphene.Field(AgentTokenType, required=True)
    full_token = graphene.String(required=True)
    bearer_token = graphene.String(required=True)
