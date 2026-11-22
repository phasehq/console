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
from api.utils.agent_access import (
    MAX_DURATION_SECONDS,
    MIN_DURATION_SECONDS,
    applied_access,
    connection_takes_policy,
    expired_connections,
    iso_timestamp,
)
from api.utils.agent_app_access import connection_environments, grant_access
from api.utils.agent_leak_events import LEAK_PROTECTION_EVENT, placeholder_secrets
from api.utils.asset_visibility import asset_visibility
from api.utils.agent_config import (
    ConfigRegistryError,
    is_app_service,
    is_custom_service,
    upgrade_definition,
)
from api.utils.agent_config.access_policy import (
    full_policy,
    live_temporary_allows,
    managed_policies,
)
from api.utils.request_actions import ActionError, action_handler
from backend.graphene.types import (
    OrganisationMemberType,
    ProviderCredentialsType,
)


def _member_for(info, organisation):
    return _member_in(info, organisation.id)


def _member_in(info, organisation_id):
    """The viewer's membership of an organisation, looked up once a request."""

    if info is None or getattr(info, "context", None) is None:
        return None
    cached = getattr(info.context, "_org_member", None)
    if (
        cached is not None
        and str(cached.organisation_id) == str(organisation_id)
        and cached.deleted_at is None
    ):
        return cached
    user = getattr(info.context, "user", None)
    if getattr(user, "pk", None) is None:
        return None
    members = getattr(info.context, "_agent_viewers", None)
    if not isinstance(members, dict):
        members = {}
        try:
            info.context._agent_viewers = members
        except AttributeError:
            pass
    key = str(organisation_id)
    if key not in members:
        members[key] = (
            OrganisationMember.objects.select_related("role")
            .filter(
                organisation_id=organisation_id,
                user=user,
                deleted_at__isnull=True,
            )
            .first()
        )
    return members[key]


def _viewer_visibility(info, organisation_id):
    return asset_visibility(_member_in(info, organisation_id))


def _viewer_may_read(info, organisation_id, resource):
    """Whether the viewer's role may read a resource. For fields nested under
    a type whose own query does not ask for that permission."""

    member = _member_in(info, organisation_id)
    return bool(
        member is not None and role_has_permission(member.role, "read", resource)
    )


def _connection_view(connection, info):
    """The app Connection's app and environments as the viewer may see them;
    None for any other Connection."""

    if not is_app_service(connection.service_type):
        return None
    cached = getattr(connection, "_viewer_app_view", None)
    if cached is None:
        environments = (
            connection_environments(connection) if connection.app_id else []
        )
        cached = _viewer_visibility(info, connection.organisation_id).app_view(
            connection.app, environments
        )
        connection._viewer_app_view = cached
    return cached


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


def _may_read_grants(workflow, info):
    member = _member_for(info, workflow.organisation)
    return bool(
        member is not None
        and account_can_access_workflow(member, workflow, "read")
        and role_has_permission(member.role, "read", "AgentConnections")
    )


def _may_read_workflow(workflow, info):
    """Whether the viewer may read this Workflow, as the agentWorkflows query
    decides; cached on the instance for the several fields that ask."""

    cached = getattr(workflow, "_viewer_may_read", None)
    if cached is None:
        member = _member_for(info, workflow.organisation)
        cached = bool(
            member is not None
            and account_can_access_workflow(member, workflow, "read")
        )
        workflow._viewer_may_read = cached
    return cached


class AgentWorkflowType(DjangoObjectType):
    # Markdown notes the Workflow's Agent reads. Untrusted text: render it
    # only through the hardened markdown component.
    context_markdown = graphene.String(required=True)
    context_updated_by = graphene.Field(OrganisationMemberType)
    # Connections this Workflow lost to an expiry in the last 30 days and has
    # not been granted again: [{connectionId, connectionName, serviceType,
    # expiredAt}].
    expired_connections = GenericScalar(required=True)

    class Meta:
        model = AgentWorkflow
        fields = (
            "id",
            "organisation",
            "agent",
            "name",
            "context_markdown",
            "context_updated_at",
            "context_updated_by",
            "created_at",
            "updated_at",
            "grants",
        )

    def resolve_context_markdown(self, info):
        return self.context_markdown if _may_read_workflow(self, info) else ""

    def resolve_context_updated_at(self, info):
        return self.context_updated_at if _may_read_workflow(self, info) else None

    def resolve_context_updated_by(self, info):
        return self.context_updated_by if _may_read_workflow(self, info) else None

    def resolve_expired_connections(self, info):
        if not _may_read_grants(self, info):
            return []
        items = expired_connections(self)
        app_connections = {
            str(connection.id): connection
            for connection in AgentConnection.objects.select_related("app").filter(
                id__in=[
                    item["connection_id"]
                    for item in items
                    if is_app_service(item["service_type"])
                ]
            )
        }

        def shown_name(item):
            connection = app_connections.get(item["connection_id"])
            if connection is None:
                return item["connection_name"]
            return _connection_view(connection, info).connection_name(
                item["connection_name"]
            )

        return [
            {
                "connectionId": item["connection_id"],
                "connectionName": shown_name(item),
                "serviceType": item["service_type"],
                "expiredAt": iso_timestamp(item["expired_at"]),
            }
            for item in items
        ]

    def resolve_grants(self, info):
        if not _may_read_grants(self, info):
            return self.grants.none()
        if hasattr(self, "active_grants"):
            return self.active_grants
        return (
            self.grants.select_related("connection__authentication")
            .active()
            .order_by("created_at", "id")
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


def _viewer_workflow_ids(agent, member, action="read"):
    """Workflow IDs of this Agent the member may act on, cached on the instance.

    Resolvers receive the model instance, so this cannot be a method of AgentType.
    """

    cache_name = f"_viewer_{action}_workflow_ids_{member.id}"
    cached = getattr(agent, cache_name, None)
    if cached is None:
        if not role_has_permission(member.role, action, "AgentWorkflows"):
            cached = []
        else:
            workflows = agent.workflows.filter(deleted_at__isnull=True)
            if not role_has_global_access(member.role):
                workflows = workflows.filter(
                    memberships__agent_membership__member=member,
                    memberships__agent_membership__deleted_at__isnull=True,
                    memberships__deleted_at__isnull=True,
                )
            cached = list(
                workflows.order_by("created_at", "id").values_list("id", flat=True)
            )
        setattr(agent, cache_name, cached)
    return cached


class AgentType(DjangoObjectType):
    workflows = graphene.List(AgentWorkflowType, required=True)
    tokens = graphene.List(AgentTokenType, required=True)
    sessions = graphene.List(AgentSessionType, required=True)
    memberships = graphene.List(AgentMembershipType, required=True)
    created_by = graphene.Field(OrganisationMemberType)
    can_manage_members = graphene.Boolean(required=True)
    viewer_workflow_ids = graphene.List(graphene.NonNull(graphene.ID), required=True)
    token_count = graphene.Int(required=True)
    workflow_count = graphene.Int(required=True)
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

    def resolve_workflows(self, info):
        member = _member_for(info, self.organisation)
        if member is None:
            return []
        return self.workflows.filter(
            id__in=_viewer_workflow_ids(self, member),
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
            workflow_id__in=_viewer_workflow_ids(self, member),
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
            workflow_id__in=_viewer_workflow_ids(self, member)
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
        return _viewer_workflow_ids(self, member)

    def resolve_workflow_count(self, info):
        # Every active Workflow counts towards the plan limit, including ones
        # the viewer is not assigned to.
        if _member_for(info, self.organisation) is None:
            return 0
        return self.workflows.filter(deleted_at__isnull=True).count()

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
            workflow_id__in=_viewer_workflow_ids(self, member),
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
            workflow_id__in=_viewer_workflow_ids(self, member)
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
            workflow_id__in=_viewer_workflow_ids(self, member),
            revoked_at__isnull=True,
            expires_at__gt=timezone.now(),
        ).count()


class AgentConnectionAppType(graphene.ObjectType):
    """The app an app Connection covers."""

    id = graphene.ID(required=True)
    name = graphene.String(required=True)
    sse_enabled = graphene.Boolean(required=True)


class AgentConnectionEnvironmentType(graphene.ObjectType):
    """One environment an app Connection covers."""

    id = graphene.ID(required=True)
    name = graphene.String(required=True)
    env_type = graphene.String(required=True)


class AppVisibilityFields:
    """``app`` and ``environments`` as the viewer may see them. A member who
    cannot access the app gets ``app: null`` with ``appRestricted``; the
    environments they cannot access are left out and counted."""

    app = graphene.Field(AgentConnectionAppType)
    environments = graphene.List(
        graphene.NonNull(AgentConnectionEnvironmentType), required=True
    )
    app_restricted = graphene.Boolean(required=True)
    hidden_environment_count = graphene.Int(required=True)


def _view_app(view):
    return view.app if view else None


def _view_environments(view):
    return list(view.environments) if view else []


def _view_app_restricted(view):
    return bool(view and view.app_restricted)


def _view_hidden_count(view):
    return view.hidden_environment_count if view else 0


class AgentConnectionType(AppVisibilityFields, DjangoObjectType):
    authentication = graphene.Field(ProviderCredentialsType)
    # App Connections ("phase_app") only: the app and the environments whose
    # secrets the Console serves to the Workflows granted this Connection, as
    # the viewer may see them. ``app`` is also null once the app is deleted.
    config = GenericScalar(required=True)
    # Custom Connections only: the definition in its latest version, and what
    # a browser needs to seal a new secret. The secret itself is write-only.
    definition = GenericScalar()
    encryption_public_key = graphene.String()
    key_version = graphene.Int()
    value_revision = graphene.Int()
    value_updated_by = graphene.Field(OrganisationMemberType)
    # False for a PostgreSQL Connection, which cannot carry an access policy.
    takes_policy = graphene.Boolean(required=True)
    # The Connection's access policy written out in full:
    # {version, default, rules}. Default allow with no rules when none is set.
    # It applies to every Workflow granted the Connection.
    policy = GenericScalar(required=True)
    # Always-on entries no member can change, to show as locked rows:
    # [{id: "secret_guard", locked: true, rules: [...]}]. Empty for a
    # Connection that takes no policy.
    managed_policies = GenericScalar(required=True)

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
            "value_updated_at",
            "value_updated_by",
            "created_at",
            "updated_at",
        )

    def resolve_name(self, info):
        view = _connection_view(self, info)
        return view.connection_name(self.name) if view else self.name

    def resolve_app(self, info):
        return _view_app(_connection_view(self, info))

    def resolve_environments(self, info):
        return _view_environments(_connection_view(self, info))

    def resolve_app_restricted(self, info):
        return _view_app_restricted(_connection_view(self, info))

    def resolve_hidden_environment_count(self, info):
        return _view_hidden_count(_connection_view(self, info))

    def resolve_definition(self, info):
        if not is_custom_service(self.service_type):
            return None
        try:
            return upgrade_definition(self.config)
        except ConfigRegistryError:
            return None

    def resolve_encryption_public_key(self, info):
        return self.encryption_public_key or None

    def resolve_key_version(self, info):
        return self.key_version if is_custom_service(self.service_type) else None

    def resolve_value_revision(self, info):
        return self.value_revision if is_custom_service(self.service_type) else None

    def resolve_takes_policy(self, info):
        return connection_takes_policy(self)

    def resolve_policy(self, info):
        return full_policy(self.policy)

    def resolve_managed_policies(self, info):
        # The secret guard is the proxy's; app secrets never pass through it.
        if is_app_service(self.service_type) or not connection_takes_policy(self):
            return []
        return managed_policies(self.service_type)


class AgentWorkflowGrantType(AppVisibilityFields, DjangoObjectType):
    # Approved exceptions, for this Workflow only, to ``ask`` rules of the
    # Connection's access policy, that have not expired:
    # [{id, class | match | operation, expiresAt, requestId}].
    temporary_allows = GenericScalar(required=True)
    created_by = graphene.Field(OrganisationMemberType)
    # App Connections only, null otherwise: the app and environments as the
    # viewer may see them, and what the Workflow may do at this moment, by
    # class: {read|create|update|delete: {effect, until?}}; ``until`` is set
    # where a temporary allow lifts an ``ask``.
    access = GenericScalar()

    class Meta:
        model = AgentWorkflowGrant
        fields = (
            "id",
            "workflow",
            "connection",
            "expires_at",
            "created_by",
            "created_at",
            "updated_at",
        )

    def resolve_temporary_allows(self, info):
        return live_temporary_allows(self.temporary_allows, timezone.now())

    def resolve_app(self, info):
        return _view_app(_connection_view(self.connection, info))

    def resolve_environments(self, info):
        return _view_environments(_connection_view(self.connection, info))

    def resolve_app_restricted(self, info):
        return _view_app_restricted(_connection_view(self.connection, info))

    def resolve_hidden_environment_count(self, info):
        return _view_hidden_count(_connection_view(self.connection, info))

    def resolve_access(self, info):
        if not is_app_service(self.connection.service_type):
            return None
        return grant_access(self)


class AgentResourceRefType(graphene.ObjectType):
    id = graphene.ID(required=True)
    name = graphene.String(required=True)


class AppAgentAccessType(graphene.ObjectType):
    """One Agent Workflow's access to an app, through one app Connection."""

    # The grant's id.
    id = graphene.ID(required=True)
    agent = graphene.Field(AgentResourceRefType, required=True)
    workflow = graphene.Field(AgentResourceRefType, required=True)
    connection = graphene.Field(AgentResourceRefType, required=True)
    # The environments the viewer can access; the others are counted.
    environments = graphene.List(
        graphene.NonNull(AgentConnectionEnvironmentType), required=True
    )
    hidden_environment_count = graphene.Int(required=True)
    # {read|create|update|delete: {effect, until?}}, as the grant has it now.
    access = GenericScalar(required=True)
    expires_at = graphene.DateTime()


# Shown in place of a member's or an Agent's free text that names an app or
# environment the viewer cannot access.
WITHHELD_TEXT = "Not shown: this names an app or environment you can't access."


def _request_view(agent_request, info):
    """The app and environments a request is about, as the viewer may see
    them; None for a request about no app."""

    if not hasattr(agent_request, "_viewer_app_view"):
        view = None
        if agent_request.action:
            try:
                asset = action_handler(agent_request.action).asset(
                    agent_request, agent_request.action
                )
            except ActionError:
                asset = None
            if asset is not None and asset[0] is not None:
                view = _viewer_visibility(
                    info, agent_request.organisation_id
                ).app_view(*asset)
        agent_request._viewer_app_view = view
    return agent_request._viewer_app_view


def _may_read_target(handler, agent_request, info):
    """Whether the viewer may see an action's target as it is now, as the
    target's own query decides."""

    if handler.target_resource == "AgentWorkflows":
        return _may_read_workflow(agent_request.workflow, info)
    return _viewer_may_read(
        info, agent_request.organisation_id, handler.target_resource
    )


def _without_current(review):
    """A review with the target as it is now left out, including what the
    request keeps unchanged and so repeats from it."""

    current = review.get("current")
    if not isinstance(current, dict):
        return review
    requested = review.get("requested")
    if isinstance(requested, dict):
        requested = {
            key: None if key in current and value == current[key] else value
            for key, value in requested.items()
        }
    return {**review, "current": None, "requested": requested}


def _request_review(agent_request, info):
    if not hasattr(agent_request, "_viewer_review"):
        review = None
        if agent_request.action:
            try:
                handler = action_handler(agent_request.action)
                review = handler.describe(
                    agent_request,
                    agent_request.action,
                    _member_in(info, agent_request.organisation_id),
                    view=_request_view(agent_request, info),
                )
            except ActionError:
                review = None
            if review is not None and not _may_read_target(
                handler, agent_request, info
            ):
                review = _without_current(review)
        agent_request._viewer_review = review
    return agent_request._viewer_review


class AgentRequestType(DjangoObjectType):
    agent = graphene.Field(lambda: AgentType, required=True)
    # A request about an app: whether the viewer cannot access the app, and
    # how many of its environments they cannot access. Names they cannot see
    # are left out of every field, titles included.
    app_restricted = graphene.Boolean(required=True)
    hidden_environment_count = graphene.Int(required=True)
    # The member who approved or denied the request, if they are still a member.
    resolved_by = graphene.Field(OrganisationMemberType)
    progress = GenericScalar(required=True)
    resolution = GenericScalar(required=True)
    revision = graphene.String(required=True)
    kind = graphene.String(required=True)
    status = graphene.String(required=True)
    title = graphene.String(required=True)
    # The typed action as requested and, once approved, as applied.
    action = GenericScalar()
    applied_action = GenericScalar()
    approval = GenericScalar()
    # The requested action set against its target as it is now.
    action_review = GenericScalar()
    # How long the access this request ends in was asked to last. Null for a
    # request that does not end in access.
    duration_seconds = graphene.Int()
    # Once approved: {requestedDurationSeconds, grantedDurationSeconds,
    # expiresAt}; the last two are null for access granted until revoked.
    access = GenericScalar()

    class Meta:
        model = AgentRequest
        fields = (
            "id",
            "workflow",
            "connection",
            "grant",
            "credential",
            "kind",
            "duration_seconds",
            "service_type",
            "credential_provider",
            "credential_name",
            "title",
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

    # The Workflow was checked by whoever returned the request; its Connection
    # and grant also need what the agentConnections query needs.
    def resolve_connection(self, info):
        if not _viewer_may_read(info, self.organisation_id, "AgentConnections"):
            return None
        return self.connection

    def resolve_grant(self, info):
        if not _viewer_may_read(info, self.organisation_id, "AgentConnections"):
            return None
        return self.grant

    def resolve_action(self, info):
        return self.action or None

    def resolve_applied_action(self, info):
        return self.applied_action or None

    def resolve_approval(self, info):
        return self.approval or None

    def resolve_access(self, info):
        return applied_access(self.applied_action)

    def resolve_action_review(self, info):
        return _request_review(self, info)

    def resolve_app_restricted(self, info):
        return _view_app_restricted(_request_view(self, info))

    def resolve_hidden_environment_count(self, info):
        return _view_hidden_count(_request_view(self, info))

    def resolve_title(self, info):
        view = _request_view(self, info)
        if view is None or not view.mentions_withheld(self.title):
            return self.title
        review = _request_review(self, info)
        return review["title"] if review else WITHHELD_TEXT

    def resolve_credential_name(self, info):
        view = _request_view(self, info)
        if view is None:
            return self.credential_name
        return view.connection_name(self.credential_name)

    def resolve_markdown(self, info):
        view = _request_view(self, info)
        return view.scrub(self.markdown, WITHHELD_TEXT) if view else self.markdown

    def resolve_resolution_note(self, info):
        view = _request_view(self, info)
        if view is None or not self.resolution_note:
            return self.resolution_note
        return view.scrub(self.resolution_note, WITHHELD_TEXT)


class AgentRequestQueueType(graphene.ObjectType):
    requests = graphene.List(graphene.NonNull(AgentRequestType), required=True)
    pending_count = graphene.Int(required=True)


class AgentEventType(DjangoObjectType):
    detail = GenericScalar(required=True)

    class Meta:
        model = AgentEvent
        fields = "__all__"

    # The log needs only Logs; these need what their own queries need.
    def resolve_connection(self, info):
        if not _viewer_may_read(info, self.organisation_id, "AgentConnections"):
            return None
        return self.connection

    def resolve_session(self, info):
        if not _viewer_may_read(info, self.organisation_id, "AgentSessions"):
            return None
        return self.session

    def resolve_detail(self, info):
        detail = dict(self.detail or {})
        if self.event_type == LEAK_PROTECTION_EVENT:
            # ``secrets`` is the Console's: where the secrets behind the
            # event's placeholders live, as far as the viewer may see.
            detail.pop("secrets", None)
            secrets = placeholder_secrets(
                self, _viewer_visibility(info, self.organisation_id)
            )
            if secrets:
                detail["secrets"] = secrets
        # An app secrets call names its app and environment; leave out what
        # the viewer cannot access.
        if not detail.get("app_id"):
            return detail
        visibility = _viewer_visibility(info, self.organisation_id)
        if not visibility.can_see_app(detail["app_id"]):
            detail.update(app_name=None, app_restricted=True)
        if detail.get("environment_id") and not visibility.can_see_environment(
            detail["app_id"], detail["environment_id"]
        ):
            detail.update(environment_name=None, environment_restricted=True)
        return detail


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
    # How an access policy classifies this service's calls where the method
    # alone would mislead: [{match: {methods, path}, class}], first match
    # wins. Empty when the service has none.
    operation_classes = GenericScalar(required=True)


class AgentSettingsType(graphene.ObjectType):
    """Organisation-wide Agent settings, with the bounds a change must keep."""

    max_request_duration_seconds = graphene.Int(required=True)
    default_request_duration_seconds = graphene.Int(required=True)
    # What both settings must stay within.
    min_duration_seconds = graphene.Int(required=True)
    max_duration_seconds = graphene.Int(required=True)
    updated_at = graphene.DateTime()
    updated_by = graphene.Field(OrganisationMemberType)

    def resolve_min_duration_seconds(self, info):
        return MIN_DURATION_SECONDS

    def resolve_max_duration_seconds(self, info):
        return MAX_DURATION_SECONDS


class AgentConnectionPresetType(graphene.ObjectType):
    """A provider preset that pre-fills the custom HTTP Connection form."""

    id = graphene.ID(required=True)
    name = graphene.String(required=True)
    description = graphene.String(required=True)
    docs_url = graphene.String(required=True)
    category = graphene.String(required=True)
    # Host rules; empty when the member has to enter the host.
    hosts = GenericScalar(required=True)
    hosts_editable = graphene.Boolean(required=True)
    # {secret field name: label for its input}.
    labels = GenericScalar(required=True)
    # A complete custom HTTP definition without any secret.
    definition = GenericScalar(required=True)


class MintedAgentTokenType(graphene.ObjectType):
    token = graphene.Field(AgentTokenType, required=True)
    full_token = graphene.String(required=True)
    bearer_token = graphene.String(required=True)
