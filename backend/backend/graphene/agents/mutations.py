"""Human-only GraphQL mutations for managing AI Agents."""

from collections.abc import Mapping
from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime
import hmac
from uuid import uuid4

import graphene
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.utils import timezone
from graphene.types.generic import GenericScalar
from graphql import GraphQLError

from api.models import (
    Agent,
    AgentConnection,
    AgentEvent,
    AgentMembership,
    AgentOrganisationSettings,
    AgentRequest,
    AgentSession,
    AgentToken,
    AgentWorkflow,
    AgentWorkflowMembership,
    AgentWorkflowGrant,
    AuditEvent,
    OrganisationMember,
    ProviderCredentials,
)
from api.utils.access.permissions import role_has_global_access
from api.utils.agent_access import (
    MAX_DURATION_SECONDS,
    MIN_DURATION_SECONDS,
    DurationError,
    access_record,
    connection_takes_policy,
    end_connection_access,
    grant_connection_access,
    granted_duration,
    iso_timestamp,
)
from api.utils.agent_config.access_policy import (
    live_temporary_allows,
    validate_policy,
)
from api.utils.agent_connection_values import (
    SealedValueError,
    activate_custom_connection,
    discard_connection_secrets,
    update_custom_connection,
)
from api.utils.agent_credentials import (
    CredentialResolutionError,
    resolve_postgres_connection_config,
)
from api.utils.agent_sessions import (
    connection_sessions,
    refresh_workflow_sessions,
    revoke_agent_session,
    revoke_agent_sessions,
)
from api.utils.agents import (
    cancel_pending_requests,
    close_agent_request,
    create_agent_with_default_workflow,
    create_agent_workflow,
    mint_agent_token,
    retire_unused_setup_connection,
)
from api.utils.audit_logging import get_actor_info_from_graphql, log_audit_event
from api.utils.request_actions import ActionError, action_handler
from api.utils.request_actions.agent_workflows import (
    set_workflow_context,
    validate_workflow_context,
)
from api.utils.rest import get_resolver_request_meta
from backend.graphene.agents.common import (
    organisation_for,
    organisation_member,
    require_agent,
    require_role,
    require_workflow,
    same_id,
)
from backend.graphene.agents.types import (
    AgentConnectionType,
    AgentMembershipType,
    AgentRequestType,
    AgentSessionType,
    AgentSettingsType,
    AgentTokenType,
    AgentType,
    AgentWorkflowGrantType,
    AgentWorkflowType,
    MintedAgentTokenType,
)
from api.utils.agent_config import (
    HTTP_SERVICE_TYPE,
    ConfigRegistryError,
    get_config_registry,
    host_rules_require_independent_approval,
    is_custom_service,
    service_for_connection,
)
from api.utils.agent_config.http_definition import bound_hosts
from api.views.agents.runtime import connection_host_rules_are_approved


# How a request was approved. Only a signed-in session exists today; stronger
# levels will be recorded in the same shape.
_SESSION_APPROVAL = {"version": 1, "assurance": "session"}


def _text(value, label, *, maximum=255, allow_empty=False):
    if not isinstance(value, str):
        raise GraphQLError(f"{label} must be a string")
    result = value if allow_empty else value.strip()
    if (not allow_empty and not result) or len(result) > maximum:
        raise GraphQLError(f"{label} must contain at most {maximum} characters")
    return result


def _clean_save(instance):
    try:
        instance.full_clean()
        instance.save()
    except (ValidationError, IntegrityError) as exc:
        if isinstance(exc, ValidationError):
            raise GraphQLError("; ".join(exc.messages)) from exc
        raise GraphQLError(str(exc)) from exc
    return instance


def _parse_expiry(value):
    if value in (None, ""):
        return None
    if not isinstance(value, str):
        raise GraphQLError("expiresAt must be an ISO-8601 timestamp")
    try:
        result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise GraphQLError("expiresAt must be an ISO-8601 timestamp") from exc
    if timezone.is_naive(result):
        result = timezone.make_aware(result)
    if result <= timezone.now():
        raise GraphQLError("expiresAt must be in the future")
    return result


def _providers_for_service(service):
    configured = service.get("credential_providers")
    if configured:
        return set(configured)
    if service.get("service_type") == "aws":
        return {"aws", "aws_assume_role"}
    return {service["provider"]} if service.get("provider") else set()


def _credential_for_connection(organisation, credential_id, service, *, lock=False):
    queryset = ProviderCredentials.objects
    if lock:
        queryset = queryset.select_for_update(of=("self",))
    try:
        credential = queryset.get(
            id=credential_id,
            organisation=organisation,
            deleted_at__isnull=True,
        )
    except (ProviderCredentials.DoesNotExist, ValueError) as exc:
        raise GraphQLError("Integration Credential not found") from exc
    if credential.provider not in _providers_for_service(service):
        raise GraphQLError("Integration Credential is incompatible with this service")
    return credential


def _postgres_config_for_credential(registry, service_type, credential):
    try:
        config = resolve_postgres_connection_config(credential)
        return registry.validate_service_config(service_type, config)
    except CredentialResolutionError as exc:
        raise GraphQLError(
            "PostgreSQL credential is incomplete or invalid"
        ) from exc
    except ConfigRegistryError as exc:
        raise GraphQLError(str(exc)) from exc


def _refresh_workflow_sessions(workflow_ids):
    refresh_workflow_sessions(workflow_ids)


def _revoke_connection_sessions(connection):
    revoke_agent_sessions(connection_sessions([connection.id]))


def _lock_active_agent(agent_id):
    """Lock the Agent so its deletes and Workflow changes run one at a time."""

    try:
        return (
            Agent.objects.select_for_update(of=("self",))
            .select_related("organisation")
            .get(id=agent_id, deleted_at__isnull=True)
        )
    except (Agent.DoesNotExist, ValueError) as exc:
        raise GraphQLError("Agent not found") from exc


def _audit(info, organisation, event_type, resource_type, instance, description, **metadata):
    actor_type, actor_id, actor_metadata = get_actor_info_from_graphql(
        info, organisation=organisation
    )
    ip_address, user_agent = get_resolver_request_meta(info.context)
    log_audit_event(
        organisation=organisation,
        event_type=event_type,
        resource_type=resource_type,
        resource_id=str(instance.id),
        description=description,
        actor_type=actor_type,
        actor_id=actor_id,
        actor_metadata=actor_metadata,
        resource_metadata=metadata,
        ip_address=ip_address,
        user_agent=user_agent,
    )


@contextmanager
def _custom_connection_errors():
    """Report a refused definition, key or sealed value to the caller."""

    try:
        yield
    except (SealedValueError, ConfigRegistryError) as exc:
        raise GraphQLError(str(exc)) from exc
    except ValidationError as exc:
        raise GraphQLError("; ".join(exc.messages)) from exc


def _custom_connection_member(info, connection_id):
    """Authorize a member to change a custom Connection."""

    try:
        initial = AgentConnection.objects.only("organisation_id", "service_type").get(
            id=connection_id, deleted_at__isnull=True
        )
    except (AgentConnection.DoesNotExist, ValueError) as exc:
        raise GraphQLError("Agent Connection not found") from exc
    member = organisation_member(info, initial.organisation_id)
    require_role(member, "update", "AgentConnections")
    if not is_custom_service(initial.service_type):
        raise GraphQLError("This is not a custom Connection")
    return member


def _locked_custom_connection(connection_id):
    try:
        return (
            AgentConnection.objects.select_for_update(of=("self",))
            .select_related("organisation")
            .get(
                id=connection_id,
                service_type=HTTP_SERVICE_TYPE,
                deleted_at__isnull=True,
            )
        )
    except AgentConnection.DoesNotExist as exc:
        raise GraphQLError("Agent Connection not found") from exc


class CreateAgentMutation(graphene.Mutation):
    class Arguments:
        organisation_id = graphene.ID(required=True)
        name = graphene.String(required=True)
        harness_type = graphene.String(required=True)
        default_workflow_name = graphene.String()

    agent = graphene.Field(AgentType, required=True)
    default_workflow = graphene.Field(AgentWorkflowType, required=True)

    @classmethod
    def mutate(cls, root, info, organisation_id, name, harness_type,
               default_workflow_name="Default"):
        organisation, member = organisation_for(
            info, organisation_id, "create", "Agents"
        )
        harness_type = str(harness_type).lower()
        if harness_type not in dict(Agent.HARNESS_CHOICES):
            raise GraphQLError("Unsupported Agent harness type")
        with transaction.atomic():
            agent, workflow = create_agent_with_default_workflow(
                organisation=organisation,
                name=_text(name, "name"),
                harness_type=harness_type,
                created_by=member,
                default_workflow_name=_text(
                    default_workflow_name or "Default", "defaultWorkflowName"
                ),
            )
        _audit(info, organisation, AuditEvent.CREATE, AuditEvent.AGENT,
               agent, f"Created Agent '{agent.name}'", name=agent.name)
        return cls(agent=agent, default_workflow=workflow)


class UpdateAgentMutation(graphene.Mutation):
    class Arguments:
        agent_id = graphene.ID(required=True)
        name = graphene.String()
        harness_type = graphene.String()
        status = graphene.String()

    agent = graphene.Field(AgentType, required=True)

    @classmethod
    def mutate(cls, root, info, agent_id, **changes):
        try:
            agent = Agent.objects.select_related("organisation").get(
                id=agent_id, deleted_at__isnull=True
            )
        except (Agent.DoesNotExist, ValueError) as exc:
            raise GraphQLError("Agent not found") from exc
        member = organisation_member(info, agent.organisation_id)
        require_agent(member, agent, "update")
        if changes.get("name") is not None:
            agent.name = _text(changes["name"], "name")
        if changes.get("harness_type") is not None:
            harness_type = str(changes["harness_type"]).lower()
            if harness_type not in dict(Agent.HARNESS_CHOICES):
                raise GraphQLError("Unsupported Agent harness type")
            agent.harness_type = harness_type
        if changes.get("status") is not None:
            state = str(changes["status"]).lower()
            if state not in dict(Agent.STATUS_CHOICES):
                raise GraphQLError("Unsupported Agent status")
            agent.status = state
        _clean_save(agent)
        if agent.status == Agent.DISABLED:
            revoke_agent_sessions(
                AgentSession.objects.filter(workflow__agent=agent, revoked_at__isnull=True)
            )
        _audit(
            info,
            agent.organisation,
            AuditEvent.UPDATE,
            AuditEvent.AGENT,
            agent,
            f"Updated Agent '{agent.name}'",
            name=agent.name,
        )
        return cls(agent=agent)


class DeleteAgentMutation(graphene.Mutation):
    class Arguments:
        agent_id = graphene.ID(required=True)
    ok = graphene.Boolean(required=True)

    @classmethod
    def mutate(cls, root, info, agent_id):
        try:
            agent = Agent.objects.select_related("organisation").get(
                id=agent_id, deleted_at__isnull=True
            )
        except (Agent.DoesNotExist, ValueError) as exc:
            raise GraphQLError("Agent not found") from exc
        member = organisation_member(info, agent.organisation_id)
        require_agent(member, agent, "delete")
        with transaction.atomic():
            agent = _lock_active_agent(agent.id)
            agent.delete()
        _audit(
            info,
            agent.organisation,
            AuditEvent.DELETE,
            AuditEvent.AGENT,
            agent,
            f"Deleted Agent '{agent.name}'",
            name=agent.name,
        )
        return cls(ok=True)


class CreateAgentWorkflowMutation(graphene.Mutation):
    class Arguments:
        agent_id = graphene.ID(required=True)
        name = graphene.String(required=True)
    workflow = graphene.Field(AgentWorkflowType, required=True)

    @classmethod
    def mutate(cls, root, info, agent_id, name):
        try:
            agent = Agent.objects.select_related("organisation").get(
                id=agent_id, deleted_at__isnull=True
            )
        except (Agent.DoesNotExist, ValueError) as exc:
            raise GraphQLError("Agent not found") from exc
        member = organisation_member(info, agent.organisation_id)
        require_agent(member, agent, "update")
        require_role(member, "create", "AgentWorkflows")
        with transaction.atomic():
            agent = _lock_active_agent(agent.id)
            try:
                workflow = create_agent_workflow(
                    agent=agent,
                    name=_text(name, "name"),
                    created_by=member,
                )
            except ValidationError as exc:
                raise GraphQLError("; ".join(exc.messages)) from exc
            except ValueError as exc:
                raise GraphQLError(str(exc)) from exc
        _audit(
            info,
            agent.organisation,
            AuditEvent.CREATE,
            AuditEvent.AGENT,
            agent,
            f"Created Workflow '{workflow.name}' for Agent '{agent.name}'",
            workflow_id=str(workflow.id),
            workflow_name=workflow.name,
        )
        return cls(workflow=workflow)


class UpdateAgentWorkflowMutation(graphene.Mutation):
    class Arguments:
        workflow_id = graphene.ID(required=True)
        name = graphene.String()
    workflow = graphene.Field(AgentWorkflowType, required=True)

    @classmethod
    def mutate(cls, root, info, workflow_id, **changes):
        try:
            workflow = AgentWorkflow.objects.select_related(
                "organisation", "agent"
            ).get(id=workflow_id, deleted_at__isnull=True)
        except (AgentWorkflow.DoesNotExist, ValueError) as exc:
            raise GraphQLError("Agent Workflow not found") from exc
        member = organisation_member(info, workflow.organisation_id)
        require_workflow(member, workflow, "update")
        previous_name = workflow.name
        if changes.get("name") is not None:
            workflow.name = _text(changes["name"], "name")
        _clean_save(workflow)
        _audit(
            info,
            workflow.organisation,
            AuditEvent.UPDATE,
            AuditEvent.AGENT,
            workflow.agent,
            f"Updated Workflow '{workflow.name}' of Agent '{workflow.agent.name}'",
            workflow_id=str(workflow.id),
            previous_name=previous_name,
            workflow_name=workflow.name,
        )
        return cls(workflow=workflow)


class DeleteAgentWorkflowMutation(graphene.Mutation):
    class Arguments:
        workflow_id = graphene.ID(required=True)
    ok = graphene.Boolean(required=True)

    @classmethod
    def mutate(cls, root, info, workflow_id):
        try:
            workflow = AgentWorkflow.objects.select_related(
                "organisation", "agent"
            ).get(id=workflow_id, deleted_at__isnull=True)
        except (AgentWorkflow.DoesNotExist, ValueError) as exc:
            raise GraphQLError("Agent Workflow not found") from exc
        member = organisation_member(info, workflow.organisation_id)
        require_workflow(member, workflow, "delete")
        with transaction.atomic():
            agent = _lock_active_agent(workflow.agent_id)
            active = agent.workflows.filter(deleted_at__isnull=True)
            if not active.filter(id=workflow.id).exists():
                raise GraphQLError("Agent Workflow not found")
            if active.count() <= 1:
                raise GraphQLError("An Agent must retain at least one active Workflow")
            workflow.delete()
        _audit(
            info,
            workflow.organisation,
            AuditEvent.DELETE,
            AuditEvent.AGENT,
            workflow.agent,
            f"Deleted Workflow '{workflow.name}' of Agent '{workflow.agent.name}'",
            workflow_id=str(workflow.id),
            workflow_name=workflow.name,
        )
        return cls(ok=True)


def _membership_workflows(agent, workflow_ids, *, lock=False):
    ids = [str(value).strip() for value in workflow_ids or []]
    if not ids or any(not value for value in ids):
        raise GraphQLError("At least one Workflow is required")
    if len(ids) != len(set(ids)):
        raise GraphQLError("Workflow IDs must not contain duplicates")
    queryset = AgentWorkflow.objects
    if lock:
        queryset = queryset.select_for_update(of=("self",))
    workflows = list(
        queryset.filter(
            id__in=ids,
            agent=agent,
            organisation=agent.organisation,
            deleted_at__isnull=True,
        ).order_by("created_at", "id")
    )
    if {str(workflow.id) for workflow in workflows} != set(ids):
        raise GraphQLError(
            "One or more Workflows are inactive, unavailable, or belong to another Agent"
        )
    return workflows


def _set_membership_workflows(membership, workflows, assigned_by):
    selected_ids = {str(workflow.id) for workflow in workflows}
    existing = list(
        AgentWorkflowMembership.objects.select_for_update().filter(
            agent_membership=membership,
        ).order_by("-created_at", "id")
    )
    active_by_workflow = {
        str(value.workflow_id): value
        for value in existing
        if value.deleted_at is None
    }
    historical_by_workflow = {}
    for value in existing:
        historical_by_workflow.setdefault(str(value.workflow_id), value)

    for workflow_id, workflow_membership in active_by_workflow.items():
        if workflow_id not in selected_ids:
            workflow_membership.delete()

    for workflow in workflows:
        workflow_id = str(workflow.id)
        if workflow_id in active_by_workflow:
            continue
        workflow_membership = historical_by_workflow.get(workflow_id)
        if workflow_membership is None:
            workflow_membership = AgentWorkflowMembership(
                workflow=workflow,
                agent_membership=membership,
                assigned_by=assigned_by,
            )
        else:
            workflow_membership.deleted_at = None
            workflow_membership.assigned_by = assigned_by
        _clean_save(workflow_membership)


def _membership_target(organisation, member_id):
    try:
        target = OrganisationMember.objects.select_related("role").get(
            id=member_id,
            organisation=organisation,
            deleted_at__isnull=True,
        )
    except (OrganisationMember.DoesNotExist, ValueError) as exc:
        raise GraphQLError("Organisation member not found") from exc
    if role_has_global_access(target.role):
        raise GraphQLError(
            "Owners and Admins already have implicit access to every Agent"
        )
    return target


class AssignAgentMemberMutation(graphene.Mutation):
    class Arguments:
        agent_id = graphene.ID(required=True)
        member_id = graphene.ID(required=True)
        workflow_ids = graphene.List(graphene.NonNull(graphene.ID), required=True)

    membership = graphene.Field(AgentMembershipType, required=True)

    @classmethod
    def mutate(cls, root, info, agent_id, member_id, workflow_ids):
        with transaction.atomic():
            try:
                agent = Agent.objects.select_for_update().select_related(
                    "organisation"
                ).get(id=agent_id, deleted_at__isnull=True)
            except (Agent.DoesNotExist, ValueError) as exc:
                raise GraphQLError("Agent not found") from exc
            actor = organisation_member(info, agent.organisation_id)
            require_agent(actor, agent, "update")
            require_role(actor, "create", "AgentMemberships")
            target = _membership_target(agent.organisation, member_id)
            workflows = _membership_workflows(agent, workflow_ids, lock=True)
            if AgentMembership.objects.filter(
                agent=agent,
                member=target,
                deleted_at__isnull=True,
            ).exists():
                raise GraphQLError("This member is already assigned to the Agent")
            membership = AgentMembership.objects.select_for_update().filter(
                agent=agent,
                member=target,
            ).order_by("-created_at", "id").first()
            if membership is None:
                membership = AgentMembership(
                    agent=agent,
                    member=target,
                    assigned_by=actor,
                )
            else:
                membership.deleted_at = None
                membership.assigned_by = actor
            _clean_save(membership)
            _set_membership_workflows(membership, workflows, actor)
        _audit(
            info,
            agent.organisation,
            AuditEvent.CREATE,
            AuditEvent.AGENT,
            agent,
            f"Assigned a member to Agent '{agent.name}'",
            membership_id=str(membership.id),
            member_id=str(target.id),
            workflow_ids=[str(workflow.id) for workflow in workflows],
        )
        return cls(membership=membership)


class UpdateAgentMemberWorkflowsMutation(graphene.Mutation):
    class Arguments:
        membership_id = graphene.ID(required=True)
        workflow_ids = graphene.List(graphene.NonNull(graphene.ID), required=True)

    membership = graphene.Field(AgentMembershipType, required=True)

    @classmethod
    def mutate(cls, root, info, membership_id, workflow_ids):
        with transaction.atomic():
            try:
                membership = AgentMembership.objects.select_for_update(
                    of=("self",)
                ).select_related("agent__organisation", "member__role").get(
                    id=membership_id, deleted_at__isnull=True
                )
            except (AgentMembership.DoesNotExist, ValueError) as exc:
                raise GraphQLError("Agent membership not found") from exc
            actor = organisation_member(info, membership.agent.organisation_id)
            require_agent(actor, membership.agent, "update")
            require_role(actor, "update", "AgentMemberships")
            if role_has_global_access(membership.member.role):
                raise GraphQLError(
                    "Owner and Admin access is implicit and cannot be scoped"
                )
            workflows = _membership_workflows(
                membership.agent, workflow_ids, lock=True
            )
            _set_membership_workflows(membership, workflows, actor)
        _audit(
            info,
            membership.agent.organisation,
            AuditEvent.UPDATE,
            AuditEvent.AGENT,
            membership.agent,
            f"Updated a member's access to Agent '{membership.agent.name}'",
            membership_id=str(membership.id),
            member_id=str(membership.member_id),
            workflow_ids=[str(workflow.id) for workflow in workflows],
        )
        return cls(membership=membership)


class RemoveAgentMemberMutation(graphene.Mutation):
    class Arguments:
        membership_id = graphene.ID(required=True)

    ok = graphene.Boolean(required=True)

    @classmethod
    def mutate(cls, root, info, membership_id):
        with transaction.atomic():
            try:
                membership = AgentMembership.objects.select_for_update(
                    of=("self",)
                ).select_related("agent__organisation", "member__role").get(
                    id=membership_id, deleted_at__isnull=True
                )
            except (AgentMembership.DoesNotExist, ValueError) as exc:
                raise GraphQLError("Agent membership not found") from exc
            actor = organisation_member(info, membership.agent.organisation_id)
            require_agent(actor, membership.agent, "update")
            require_role(actor, "delete", "AgentMemberships")
            if role_has_global_access(membership.member.role):
                raise GraphQLError(
                    "Owner and Admin access is implicit and cannot be removed"
                )
            agent = membership.agent
            target_id = membership.member_id
            membership.delete()
        _audit(
            info,
            agent.organisation,
            AuditEvent.DELETE,
            AuditEvent.AGENT,
            agent,
            f"Removed a member from Agent '{agent.name}'",
            membership_id=str(membership.id),
            member_id=str(target_id),
        )
        return cls(ok=True)


class CreateAgentConnectionMutation(graphene.Mutation):
    class Arguments:
        organisation_id = graphene.ID(required=True)
        name = graphene.String(required=True)
        service_type = graphene.String(required=True)
        authentication_id = graphene.ID(required=True)
        config = GenericScalar()

    connection = graphene.Field(AgentConnectionType, required=True)

    @classmethod
    def mutate(
        cls,
        root,
        info,
        organisation_id,
        name,
        service_type,
        authentication_id,
        config=None,
    ):
        organisation, member = organisation_for(
            info, organisation_id, "create", "AgentConnections"
        )
        if isinstance(service_type, str) and is_custom_service(
            service_type.strip().lower()
        ):
            raise GraphQLError(
                "Create a custom Connection with createCustomAgentConnection"
            )
        require_role(member, "read", "IntegrationCredentials")
        service_type = _text(service_type, "serviceType", maximum=64).lower()
        registry = get_config_registry()
        try:
            service = registry.get_service(service_type)
        except ConfigRegistryError as exc:
            raise GraphQLError(str(exc)) from exc
        with transaction.atomic():
            credential = _credential_for_connection(
                organisation, authentication_id, service, lock=True
            )
            if service_type == "postgres":
                if config not in (None, {}):
                    raise GraphQLError(
                        "PostgreSQL Connection config is derived from its "
                        "Integration Credential"
                    )
                checked_config = _postgres_config_for_credential(
                    registry, service_type, credential
                )
            else:
                try:
                    checked_config = registry.validate_service_config(
                        service_type, config or {}
                    )
                except ConfigRegistryError as exc:
                    raise GraphQLError(str(exc)) from exc
            connection = AgentConnection(
                organisation=organisation,
                name=_text(name, "name"),
                service_type=service_type,
                config=checked_config,
                authentication=credential,
                state=AgentConnection.ACTIVE,
                host_rules_authored_by=(
                    member if checked_config.get("hosts") else None
                ),
                created_by=member,
                updated_by=member,
            )
            _clean_save(connection)
        _audit(
            info,
            organisation,
            AuditEvent.CREATE,
            AuditEvent.AGENT_CONNECTION,
            connection,
            f"Created Agent Connection '{connection.name}'",
            service_type=service_type,
            credential_id=str(credential.id),
        )
        return cls(connection=connection)


class UpdateAgentConnectionMutation(graphene.Mutation):
    class Arguments:
        connection_id = graphene.ID(required=True)
        name = graphene.String()
        authentication_id = graphene.ID()
        config = GenericScalar()

    connection = graphene.Field(AgentConnectionType, required=True)

    @classmethod
    def mutate(cls, root, info, connection_id, **changes):
        try:
            initial = AgentConnection.objects.select_related("organisation").get(
                id=connection_id, deleted_at__isnull=True
            )
        except (AgentConnection.DoesNotExist, ValueError) as exc:
            raise GraphQLError("Agent Connection not found") from exc
        member = organisation_member(info, initial.organisation_id)
        require_role(member, "update", "AgentConnections")
        if is_custom_service(initial.service_type):
            raise GraphQLError(
                "Change a custom Connection with updateCustomAgentConnection"
            )
        registry = get_config_registry()
        try:
            service = registry.get_service(initial.service_type)
        except ConfigRegistryError as exc:
            raise GraphQLError(str(exc)) from exc
        if initial.service_type == "postgres" and "config" in changes:
            raise GraphQLError(
                "PostgreSQL Connection config is derived from its "
                "Integration Credential"
            )
        security_changed = False
        with transaction.atomic():
            next_credential = None
            if "authentication_id" in changes:
                if not changes["authentication_id"]:
                    raise GraphQLError(
                        "Active Connections require an Integration Credential"
                    )
                require_role(member, "read", "IntegrationCredentials")
                # Credential -> Connection is the canonical lock order shared
                # with request fulfillment.
                next_credential = _credential_for_connection(
                    initial.organisation,
                    changes["authentication_id"],
                    service,
                    lock=True,
                )
            try:
                connection = AgentConnection.objects.select_for_update(
                    of=("self",)
                ).select_related(
                    "organisation",
                    "authentication",
                    "host_rules_authored_by",
                    "host_rules_approved_by",
                ).get(id=connection_id, deleted_at__isnull=True)
            except AgentConnection.DoesNotExist as exc:
                raise GraphQLError("Agent Connection not found") from exc
            if (
                connection.service_type == "postgres"
                and next_credential is not None
            ):
                checked_config = _postgres_config_for_credential(
                    registry, connection.service_type, next_credential
                )
            else:
                try:
                    checked_config = registry.validate_service_config(
                        connection.service_type,
                        changes["config"] if "config" in changes else connection.config,
                    )
                except ConfigRegistryError as exc:
                    raise GraphQLError(str(exc)) from exc

            previous_authentication_id = connection.authentication_id
            previous_config = deepcopy(connection.config or {})
            if "authentication_id" in changes:
                connection.authentication = next_credential
            if changes.get("name") is not None:
                connection.name = _text(changes["name"], "name")

            previous_hosts = previous_config.get("hosts")
            next_hosts = checked_config.get("hosts")
            if previous_hosts != next_hosts:
                connection.host_rules_version = str(uuid4())
                connection.host_rules_approved_version = ""
                connection.host_rules_approved_by = None
                connection.host_rules_authored_by = member if next_hosts else None
            connection.config = checked_config
            connection.state = AgentConnection.ACTIVE
            connection.updated_by = member
            _clean_save(connection)
            security_changed = (
                str(previous_authentication_id) != str(connection.authentication_id)
                or previous_config != (connection.config or {})
            )

        if security_changed:
            _revoke_connection_sessions(connection)
        _audit(
            info,
            connection.organisation,
            AuditEvent.UPDATE,
            AuditEvent.AGENT_CONNECTION,
            connection,
            f"Updated Agent Connection '{connection.name}'",
            service_type=connection.service_type,
            credential_id=str(connection.authentication_id),
        )
        return cls(connection=connection)


class CreateCustomAgentConnectionMutation(graphene.Mutation):
    """Create a Connection for an HTTP service Phase has no integration for.

    The browser generates the Connection keypair, seals the secret to it and
    wraps the private key to the server, so the secret never arrives in the
    clear. No integration credential is involved.
    """

    class Arguments:
        organisation_id = graphene.ID(required=True)
        name = graphene.String(required=True)
        definition = GenericScalar(required=True)
        encryption_public_key = graphene.String(required=True)
        sealed_value = graphene.String(required=True)
        server_wrapped_key = graphene.String(required=True)

    connection = graphene.Field(AgentConnectionType, required=True)

    @classmethod
    def mutate(
        cls,
        root,
        info,
        organisation_id,
        name,
        definition,
        encryption_public_key,
        sealed_value,
        server_wrapped_key,
    ):
        organisation, member = organisation_for(
            info, organisation_id, "create", "AgentConnections"
        )
        connection = AgentConnection(
            organisation=organisation,
            name=_text(name, "name"),
            service_type=HTTP_SERVICE_TYPE,
        )
        with transaction.atomic(), _custom_connection_errors():
            activate_custom_connection(
                connection,
                definition=definition,
                encryption_public_key=encryption_public_key,
                server_wrapped_key=server_wrapped_key,
                sealed_value=sealed_value,
                member=member,
            )
        _audit(
            info,
            organisation,
            AuditEvent.CREATE,
            AuditEvent.AGENT_CONNECTION,
            connection,
            f"Created Agent Connection '{connection.name}'",
            service_type=connection.service_type,
            hosts=bound_hosts(connection.config),
            key_version=connection.key_version,
            value_revision=connection.value_revision,
        )
        return cls(connection=connection)


class UpdateCustomAgentConnectionMutation(graphene.Mutation):
    """Rename a custom Connection, change its definition, replace its secret,
    or any of these together.

    ``sealedValue`` is the secret sealed again; nothing is ever read back. A
    definition that changes the bound hosts or the set of secret fields must
    come with it, sealed over the new definition. A call that changes nothing
    returns the Connection as it is and records nothing.
    """

    class Arguments:
        connection_id = graphene.ID(required=True)
        name = graphene.String()
        definition = GenericScalar()
        sealed_value = graphene.String()

    connection = graphene.Field(AgentConnectionType, required=True)

    @classmethod
    def mutate(
        cls, root, info, connection_id, name=None, definition=None, sealed_value=None
    ):
        member = _custom_connection_member(info, connection_id)
        if name is None and definition is None and sealed_value is None:
            raise GraphQLError("Nothing to change")
        if name is not None:
            name = _text(name, "name")
        with transaction.atomic(), _custom_connection_errors():
            connection = _locked_custom_connection(connection_id)
            changes = update_custom_connection(
                connection,
                member=member,
                name=name,
                definition=definition,
                sealed_value=sealed_value,
            )
        if not any(changes.values()):
            return cls(connection=connection)
        _audit(
            info,
            connection.organisation,
            AuditEvent.UPDATE,
            AuditEvent.AGENT_CONNECTION,
            connection,
            f"Updated Agent Connection '{connection.name}'",
            service_type=connection.service_type,
            hosts=bound_hosts(connection.config),
            key_version=connection.key_version,
            value_revision=connection.value_revision,
            **changes,
        )
        return cls(connection=connection)


class AllowAgentConnectionHostMutation(graphene.Mutation):
    class Arguments:
        event_ingest_seq = graphene.ID(required=True)
        connection_id = graphene.ID(required=True)
        expected_version = graphene.String(required=True)

    connection = graphene.Field(AgentConnectionType, required=True)
    host_rule = GenericScalar(required=True)
    approval_required = graphene.Boolean(required=True)

    @classmethod
    def mutate(cls, root, info, event_ingest_seq, connection_id, expected_version):
        try:
            event = AgentEvent.objects.select_related(
                "organisation", "agent", "workflow"
            ).get(ingest_seq=event_ingest_seq)
        except (AgentEvent.DoesNotExist, ValueError) as exc:
            raise GraphQLError("Blocked Agent event not found") from exc
        member = organisation_member(info, event.organisation_id)
        require_role(member, "update", "AgentConnections")
        if event.agent is None:
            raise GraphQLError("The blocked event no longer has an active Agent")
        require_workflow(member, event.workflow, "update")
        if not (
            event.workflow_id
            and event.event_type == "request"
            and event.connection_id is None
            and event.protocol == "http"
            and event.port is not None
            and event.provider == "proxy"
            and event.status_code == 403
            and event.proxy_decision == AgentEvent.BLOCK
            and event.outcome == "denied"
            and event.reason == "lockdown_unbound_host"
        ):
            raise GraphQLError(
                "Only a Workflow host blocked by the proxy can be added"
            )
        expected_version = _text(expected_version, "expectedVersion", maximum=128)
        host = _text(event.host, "event host", maximum=253).lower().rstrip(".")
        host_rule = {"match": "exact", "value": host, "port": event.port}
        registry = get_config_registry()
        with transaction.atomic():
            try:
                connection = AgentConnection.objects.select_for_update(
                    of=("self",)
                ).select_related("organisation", "authentication").get(
                    id=connection_id,
                    organisation_id=event.organisation_id,
                    deleted_at__isnull=True,
                    state=AgentConnection.ACTIVE,
                    authentication__deleted_at__isnull=True,
                )
            except AgentConnection.DoesNotExist as exc:
                raise GraphQLError("Agent Connection not found") from exc
            if is_custom_service(connection.service_type):
                # Its secret is sealed to its hosts, so a new host has to come
                # with the secret entered again.
                raise GraphQLError(
                    "Add this host by editing the custom Connection"
                )
            if not same_id(connection.host_rules_version, expected_version):
                raise GraphQLError(
                    "The Connection host rules changed; review the current version"
                )
            try:
                service = registry.get_service(connection.service_type)
            except ConfigRegistryError as exc:
                raise GraphQLError(str(exc)) from exc
            # Allowing a host re-authors the list, so it can't carry unreviewed hosts.
            if not connection_host_rules_are_approved(connection, service):
                raise GraphQLError(
                    "This Connection has custom hosts waiting for review; approve "
                    "them before allowing another host"
                )
            grants = list(
                AgentWorkflowGrant.objects.select_related(
                    "connection", "connection__authentication"
                )
                .active()
                .filter(
                    workflow_id=event.workflow_id,
                    connection__deleted_at__isnull=True,
                    connection__state=AgentConnection.ACTIVE,
                    connection__authentication__deleted_at__isnull=True,
                )
            )
            eligible = []
            for grant in grants:
                try:
                    candidate = registry.get_service(grant.connection.service_type)
                except ConfigRegistryError:
                    continue
                if (
                    candidate["protocol"] == "http"
                    and grant.connection.authentication.provider
                    in _providers_for_service(candidate)
                ):
                    eligible.append(grant)
            if len(eligible) != 1 or not same_id(
                eligible[0].connection_id, connection.id
            ):
                raise GraphQLError(
                    "The Workflow must have exactly one eligible HTTP Connection"
                )
            active_workflow_ids = set(
                str(value)
                for value in connection.workflow_grants.active().filter(
                    workflow__deleted_at__isnull=True,
                    workflow__agent__deleted_at__isnull=True,
                    workflow__agent__status=Agent.ACTIVE,
                ).values_list("workflow_id", flat=True)
            )
            if active_workflow_ids != {str(event.workflow_id)}:
                raise GraphQLError(
                    "This Connection is shared; edit it from the Connections page"
                )
            try:
                hosts = registry.resolve_host_rules(
                    connection.service_type, connection.config or {}
                )
                if any(
                    rule["match"] == "exact"
                    and rule["value"] == host
                    and rule.get("port") in (None, event.port)
                    for rule in hosts
                ):
                    raise GraphQLError("The Connection already permits this host")
                config = {**(connection.config or {}), "hosts": [*hosts, host_rule]}
                connection.config = registry.validate_service_config(
                    connection.service_type, config
                )
            except ConfigRegistryError as exc:
                raise GraphQLError(str(exc)) from exc
            connection.host_rules_version = str(uuid4())
            connection.host_rules_approved_version = ""
            connection.host_rules_approved_by = None
            connection.host_rules_authored_by = member
            connection.updated_by = member
            _clean_save(connection)
        _revoke_connection_sessions(connection)
        approval_required = host_rules_require_independent_approval(
            service, connection.config or {}
        )
        _audit(
            info,
            connection.organisation,
            AuditEvent.UPDATE,
            AuditEvent.AGENT_CONNECTION,
            connection,
            f"Allowed {host}:{event.port} on Agent Connection '{connection.name}'",
            host=host,
            port=event.port,
            workflow_id=str(event.workflow_id),
            host_rules_version=str(connection.host_rules_version),
            approval_required=approval_required,
        )
        return cls(
            connection=connection,
            host_rule=host_rule,
            approval_required=approval_required,
        )


class ApproveAgentConnectionHostRulesMutation(graphene.Mutation):
    class Arguments:
        connection_id = graphene.ID(required=True)
        expected_version = graphene.String(required=True)

    connection = graphene.Field(AgentConnectionType, required=True)

    @classmethod
    def mutate(cls, root, info, connection_id, expected_version):
        try:
            initial = AgentConnection.objects.only("organisation_id").get(
                id=connection_id, deleted_at__isnull=True
            )
        except (AgentConnection.DoesNotExist, ValueError) as exc:
            raise GraphQLError("Agent Connection not found") from exc
        member = organisation_member(info, initial.organisation_id)
        require_role(member, "update", "AgentConnections")
        expected_version = _text(expected_version, "expectedVersion", maximum=128)
        with transaction.atomic():
            connection = AgentConnection.objects.select_for_update(of=("self",)).select_related(
                "organisation", "host_rules_authored_by", "host_rules_approved_by"
            ).get(id=connection_id, deleted_at__isnull=True)
            try:
                service = service_for_connection(connection)
            except ConfigRegistryError as exc:
                raise GraphQLError(str(exc)) from exc
            if not host_rules_require_independent_approval(
                service, connection.config or {}
            ):
                raise GraphQLError("This Connection does not require host-rule approval")
            if not same_id(connection.host_rules_version, expected_version):
                raise GraphQLError(
                    "The custom host rules changed; review the current version"
                )
            if not connection.host_rules_authored_by_id:
                raise GraphQLError("The current custom host rules have no author")
            if connection.host_rules_authored_by.user_id == member.user_id:
                raise GraphQLError(
                    "Host-rule author and approver must be different humans"
                )
            connection.host_rules_approved_by = member
            connection.host_rules_approved_version = connection.host_rules_version
            connection.updated_by = member
            _clean_save(connection)
        _refresh_workflow_sessions(
            connection.workflow_grants.active().values_list(
                "workflow_id", flat=True
            )
        )
        _audit(
            info,
            connection.organisation,
            AuditEvent.UPDATE,
            AuditEvent.AGENT_CONNECTION,
            connection,
            f"Approved custom hosts for Agent Connection '{connection.name}'",
            host_rules_version=str(connection.host_rules_version),
            author_id=str(connection.host_rules_authored_by_id),
            hosts=(connection.config or {}).get("hosts"),
        )
        return cls(connection=connection)


class DeleteAgentConnectionMutation(graphene.Mutation):
    class Arguments:
        connection_id = graphene.ID(required=True)

    ok = graphene.Boolean(required=True)

    @classmethod
    def mutate(cls, root, info, connection_id):
        try:
            initial = AgentConnection.objects.select_related("organisation").get(
                id=connection_id, deleted_at__isnull=True
            )
        except (AgentConnection.DoesNotExist, ValueError) as exc:
            raise GraphQLError("Agent Connection not found") from exc
        member = organisation_member(info, initial.organisation_id)
        require_role(member, "delete", "AgentConnections")
        with transaction.atomic():
            connection = AgentConnection.objects.select_for_update().get(
                id=connection_id, deleted_at__isnull=True
            )
            now = timezone.now()
            workflow_ids = [
                grant.workflow_id
                for grant in end_connection_access(
                    connection.workflow_grants.all(), ended_at=now
                )
            ]
            discard_connection_secrets(connection)
            connection.state = AgentConnection.DISABLED
            connection.deleted_at = now
            connection.updated_by = member
            connection.save(
                update_fields=[
                    "state",
                    "deleted_at",
                    "sealed_value",
                    "updated_by",
                    "updated_at",
                ]
            )
        # Separate transaction: fulfilment locks a request before its Connection.
        with transaction.atomic():
            cancel_pending_requests(
                AgentRequest.objects.filter(connection=connection), now
            )
        revoke_agent_sessions(
            AgentSession.objects.filter(
                workflow_id__in=workflow_ids, revoked_at__isnull=True
            )
        )
        _audit(
            info,
            initial.organisation,
            AuditEvent.DELETE,
            AuditEvent.AGENT_CONNECTION,
            connection,
            f"Deleted Agent Connection '{connection.name}'",
            service_type=connection.service_type,
            credential_id=str(connection.authentication_id or ""),
            workflow_ids=[str(workflow_id) for workflow_id in workflow_ids],
        )
        return cls(ok=True)


def _grant_policy(connection, policy):
    """A policy a member gave for a grant of this Connection, as it is stored."""

    try:
        checked = validate_policy(policy)
    except ConfigRegistryError as exc:
        raise GraphQLError(str(exc)) from exc
    if checked and not connection_takes_policy(connection):
        raise GraphQLError("Access policies apply only to HTTP Connections")
    return checked


class GrantAgentWorkflowMutation(graphene.Mutation):
    """Give a Workflow a Connection, or change the grant it already has.

    ``policy`` is the grant's access policy and ``expiresAt`` when access
    stops; a grant a member creates has no expiry unless they give one. On a
    Workflow that already has the Connection, each argument that is given
    replaces what the grant has, and an explicit null ``expiresAt`` removes
    its expiry.
    """

    class Arguments:
        workflow_id = graphene.ID(required=True)
        connection_id = graphene.ID(required=True)
        policy = GenericScalar()
        expires_at = graphene.String()

    grant = graphene.Field(AgentWorkflowGrantType, required=True)

    @classmethod
    def mutate(cls, root, info, workflow_id, connection_id, **options):
        try:
            workflow = AgentWorkflow.objects.select_related(
                "organisation", "agent"
            ).get(id=workflow_id, deleted_at__isnull=True)
        except (AgentWorkflow.DoesNotExist, ValueError) as exc:
            raise GraphQLError("Agent Workflow not found") from exc
        member = organisation_member(info, workflow.organisation_id)
        require_workflow(member, workflow, "update")
        require_role(member, "read", "AgentConnections")
        with transaction.atomic():
            try:
                # ``authentication`` is nullable while a setup request is pending,
                # so Django renders this select_related as an outer join. PostgreSQL
                # cannot lock the nullable side of that join; lock only the reusable
                # Connection row while still hydrating its credential for validation.
                connection = AgentConnection.objects.select_for_update(
                    of=("self",)
                ).select_related("authentication").get(
                    id=connection_id,
                    organisation=workflow.organisation,
                    deleted_at__isnull=True,
                    state=AgentConnection.ACTIVE,
                    authentication__deleted_at__isnull=True,
                )
            except (AgentConnection.DoesNotExist, ValueError) as exc:
                raise GraphQLError("Active Agent Connection not found") from exc
            custom = is_custom_service(connection.service_type)
            if custom:
                if not connection.sealed_value:
                    raise GraphQLError("Active Agent Connection not found")
            else:
                service = get_config_registry().get_service(connection.service_type)
                if connection.authentication.provider not in _providers_for_service(
                    service
                ):
                    raise GraphQLError(
                        "Connection authentication is incompatible with its service"
                    )
            expires_at = _parse_expiry(options.get("expires_at"))
            policy = (
                _grant_policy(connection, options["policy"])
                if "policy" in options
                else None
            )
            with _custom_connection_errors():
                grant, created = grant_connection_access(
                    workflow, connection, member, expires_at=expires_at, policy=policy
                )
            changed = []
            if not created:
                if policy is not None and grant.policy != policy:
                    grant.policy = policy
                    changed.append("policy")
                if "expires_at" in options and grant.expires_at != expires_at:
                    grant.expires_at = expires_at
                    changed.append("expires_at")
                if changed:
                    grant.save(update_fields=[*changed, "updated_at"])
        _refresh_workflow_sessions([workflow.id])
        if created or changed:
            _audit(
                info,
                workflow.organisation,
                AuditEvent.CREATE if created else AuditEvent.UPDATE,
                AuditEvent.AGENT_CONNECTION,
                connection,
                (
                    f"Granted Agent Connection '{connection.name}' to Workflow "
                    if created
                    else f"Changed the grant of Agent Connection '{connection.name}' "
                    "to Workflow "
                )
                + f"'{workflow.name}' of Agent '{workflow.agent.name}'",
                grant_id=str(grant.id),
                workflow_id=str(workflow.id),
                agent_id=str(workflow.agent_id),
                policy=grant.policy,
                expires_at=iso_timestamp(grant.expires_at),
            )
        return cls(grant=grant)


class SetAgentWorkflowGrantPolicyMutation(graphene.Mutation):
    """Set the access policy of a Workflow's grant of an HTTP Connection.

    ``policy`` is ``{version: 1, default, rules}``; null or an empty object
    clears it. Needs what granting the Connection to the Workflow needs.
    """

    class Arguments:
        grant_id = graphene.ID(required=True)
        policy = GenericScalar()

    grant = graphene.Field(AgentWorkflowGrantType, required=True)

    @classmethod
    def mutate(cls, root, info, grant_id, policy=None):
        try:
            initial = (
                AgentWorkflowGrant.objects.select_related(
                    "organisation", "workflow__agent"
                )
                .active()
                .get(id=grant_id)
            )
        except (AgentWorkflowGrant.DoesNotExist, ValueError) as exc:
            raise GraphQLError("Agent Workflow Grant not found") from exc
        member = organisation_member(info, initial.organisation_id)
        workflow = initial.workflow
        require_workflow(member, workflow, "update")
        require_role(member, "read", "AgentConnections")
        with transaction.atomic():
            try:
                grant = (
                    AgentWorkflowGrant.objects.select_for_update(of=("self",))
                    .select_related("connection")
                    .active()
                    .get(id=grant_id)
                )
            except AgentWorkflowGrant.DoesNotExist as exc:
                raise GraphQLError("Agent Workflow Grant not found") from exc
            checked = _grant_policy(grant.connection, policy)
            previous = grant.policy
            changed = previous != checked
            if changed:
                grant.policy = checked
                grant.save(update_fields=["policy", "updated_at"])
        if changed:
            _refresh_workflow_sessions([workflow.id])
            _audit(
                info,
                workflow.organisation,
                AuditEvent.UPDATE,
                AuditEvent.AGENT_CONNECTION,
                grant.connection,
                f"Changed the access policy of Agent Connection "
                f"'{grant.connection.name}' for Workflow '{workflow.name}' of "
                f"Agent '{workflow.agent.name}'",
                grant_id=str(grant.id),
                workflow_id=str(workflow.id),
                agent_id=str(workflow.agent_id),
                policy=grant.policy,
                previous_policy=previous,
            )
        return cls(grant=grant)


class RemoveAgentWorkflowGrantAllowMutation(graphene.Mutation):
    """End one temporary allow of a grant early.

    Needs what setting the grant's access policy needs. An id that is not
    among the grant's live allows is reported as not found.
    """

    class Arguments:
        grant_id = graphene.ID(required=True)
        allow_id = graphene.ID(required=True)

    grant = graphene.Field(AgentWorkflowGrantType, required=True)

    @classmethod
    def mutate(cls, root, info, grant_id, allow_id):
        try:
            initial = (
                AgentWorkflowGrant.objects.select_related(
                    "organisation", "workflow__agent"
                )
                .active()
                .get(id=grant_id)
            )
        except (AgentWorkflowGrant.DoesNotExist, ValueError) as exc:
            raise GraphQLError("Agent Workflow Grant not found") from exc
        member = organisation_member(info, initial.organisation_id)
        workflow = initial.workflow
        require_workflow(member, workflow, "update")
        require_role(member, "read", "AgentConnections")
        with transaction.atomic():
            try:
                grant = (
                    AgentWorkflowGrant.objects.select_for_update(of=("self",))
                    .select_related("connection")
                    .active()
                    .get(id=grant_id)
                )
            except AgentWorkflowGrant.DoesNotExist as exc:
                raise GraphQLError("Agent Workflow Grant not found") from exc
            live = live_temporary_allows(grant.temporary_allows, timezone.now())
            removed = next(
                (entry for entry in live if str(entry.get("id")) == str(allow_id)),
                None,
            )
            if removed is None:
                raise GraphQLError("Temporary allow not found")
            grant.temporary_allows = [
                entry for entry in live if entry is not removed
            ]
            grant.save(update_fields=["temporary_allows", "updated_at"])
        _refresh_workflow_sessions([workflow.id])
        _audit(
            info,
            workflow.organisation,
            AuditEvent.UPDATE,
            AuditEvent.AGENT_CONNECTION,
            grant.connection,
            f"Ended a temporary allow of Agent Connection "
            f"'{grant.connection.name}' for Workflow '{workflow.name}' of "
            f"Agent '{workflow.agent.name}'",
            grant_id=str(grant.id),
            workflow_id=str(workflow.id),
            agent_id=str(workflow.agent_id),
            allow=removed,
        )
        return cls(grant=grant)


class SetAgentWorkflowContextMutation(graphene.Mutation):
    """Replace the markdown context an Agent reads for a Workflow."""

    class Arguments:
        workflow_id = graphene.ID(required=True)
        markdown = graphene.String(required=True)

    workflow = graphene.Field(AgentWorkflowType, required=True)

    @classmethod
    def mutate(cls, root, info, workflow_id, markdown):
        try:
            initial = AgentWorkflow.objects.select_related(
                "organisation", "agent"
            ).get(id=workflow_id, deleted_at__isnull=True)
        except (AgentWorkflow.DoesNotExist, ValueError) as exc:
            raise GraphQLError("Agent Workflow not found") from exc
        member = organisation_member(info, initial.organisation_id)
        require_workflow(member, initial, "update")
        try:
            markdown = validate_workflow_context(markdown)
        except ActionError as exc:
            raise GraphQLError(str(exc)) from exc
        with transaction.atomic():
            try:
                workflow = (
                    AgentWorkflow.objects.select_for_update(of=("self",))
                    .select_related("organisation", "agent")
                    .get(id=workflow_id, deleted_at__isnull=True)
                )
            except AgentWorkflow.DoesNotExist as exc:
                raise GraphQLError("Agent Workflow not found") from exc
            previous_length = len(workflow.context_markdown)
            changed = workflow.context_markdown != markdown
            if changed:
                set_workflow_context(workflow, markdown, member)
        if changed:
            _audit(
                info,
                workflow.organisation,
                AuditEvent.UPDATE,
                AuditEvent.AGENT,
                workflow.agent,
                f"Updated the context of Workflow '{workflow.name}' of Agent "
                f"'{workflow.agent.name}'",
                workflow_id=str(workflow.id),
                previous_length=previous_length,
                length=len(markdown),
            )
        return cls(workflow=workflow)


class UpdateAgentSettingsMutation(graphene.Mutation):
    """Change the organisation's Agent settings.

    Both durations must lie between 300 and 2592000 seconds, and the default
    must not exceed the maximum. Needs ``update`` on AgentRequests: the
    settings bound what a request may ask for, and that is the permission of
    the members who resolve requests.
    """

    class Arguments:
        organisation_id = graphene.ID(required=True)
        max_request_duration_seconds = graphene.Int()
        default_request_duration_seconds = graphene.Int()

    settings = graphene.Field(AgentSettingsType, required=True)

    @classmethod
    def mutate(cls, root, info, organisation_id, **changes):
        organisation, member = organisation_for(
            info, organisation_id, "update", "AgentRequests"
        )
        fields = ("max_request_duration_seconds", "default_request_duration_seconds")
        with transaction.atomic():
            settings, _ = AgentOrganisationSettings.objects.select_for_update(
                of=("self",)
            ).get_or_create(organisation=organisation)
            previous = {name: getattr(settings, name) for name in fields}
            for name in fields:
                value = changes.get(name)
                if value is None:
                    continue
                if not MIN_DURATION_SECONDS <= value <= MAX_DURATION_SECONDS:
                    raise GraphQLError(
                        "Durations must be between "
                        f"{MIN_DURATION_SECONDS} and {MAX_DURATION_SECONDS} seconds"
                    )
                setattr(settings, name, value)
            if (
                settings.default_request_duration_seconds
                > settings.max_request_duration_seconds
            ):
                raise GraphQLError(
                    "The default request duration must not exceed the maximum"
                )
            current = {name: getattr(settings, name) for name in fields}
            if current != previous:
                settings.updated_by = member
                settings.save()
        if current != previous:
            _audit(
                info,
                organisation,
                AuditEvent.UPDATE,
                AuditEvent.ORGANISATION,
                organisation,
                "Updated the Agent request duration settings",
                previous=previous,
                **current,
            )
        return cls(settings=settings)


class RevokeAgentWorkflowGrantMutation(graphene.Mutation):
    class Arguments:
        grant_id = graphene.ID(required=True)

    ok = graphene.Boolean(required=True)

    @classmethod
    def mutate(cls, root, info, grant_id):
        try:
            grant = (
                AgentWorkflowGrant.objects.select_related(
                    "organisation", "workflow__agent"
                )
                .active()
                .get(id=grant_id)
            )
        except (AgentWorkflowGrant.DoesNotExist, ValueError) as exc:
            raise GraphQLError("Agent Workflow Grant not found") from exc
        member = organisation_member(info, grant.organisation_id)
        require_workflow(member, grant.workflow, "update")
        workflow = grant.workflow
        with transaction.atomic():
            if not end_connection_access(
                AgentWorkflowGrant.objects.filter(id=grant_id)
            ):
                raise GraphQLError("Agent Workflow Grant not found")
            grant = AgentWorkflowGrant.objects.select_related("connection").get(
                id=grant_id
            )
        revoke_agent_sessions(
            AgentSession.objects.filter(
                workflow_id=workflow.id, revoked_at__isnull=True
            )
        )
        _audit(
            info,
            workflow.organisation,
            AuditEvent.DELETE,
            AuditEvent.AGENT_CONNECTION,
            grant.connection,
            f"Revoked Agent Connection '{grant.connection.name}' from Workflow "
            f"'{workflow.name}' of Agent '{workflow.agent.name}'",
            grant_id=str(grant.id),
            workflow_id=str(workflow.id),
            agent_id=str(workflow.agent_id),
        )
        return cls(ok=True)


class MintAgentTokenMutation(graphene.Mutation):
    class Arguments:
        agent_id = graphene.ID(required=True)
        workflow_id = graphene.ID(required=True)
        name = graphene.String(required=True)
        expires_at = graphene.String()
    minted = graphene.Field(MintedAgentTokenType, required=True)

    @classmethod
    def mutate(cls, root, info, agent_id, workflow_id, name, expires_at=None):
        try:
            agent = Agent.objects.select_related("organisation").get(
                id=agent_id,
                deleted_at__isnull=True,
                status=Agent.ACTIVE,
            )
        except (Agent.DoesNotExist, ValueError) as exc:
            raise GraphQLError("Agent not found") from exc
        try:
            workflow = AgentWorkflow.objects.select_related(
                "organisation", "agent"
            ).get(id=workflow_id, agent=agent, deleted_at__isnull=True)
        except (AgentWorkflow.DoesNotExist, ValueError) as exc:
            raise GraphQLError("Agent Workflow not found") from exc
        member = organisation_member(info, agent.organisation_id)
        require_workflow(member, workflow, "read")
        require_role(member, "create", "AgentTokens")
        try:
            token, full_token, bearer_token = mint_agent_token(
                agent=agent,
                workflow=workflow,
                name=_text(name, "name", maximum=64),
                expires_at=_parse_expiry(expires_at),
                created_by=member,
            )
        except ValueError as exc:
            raise GraphQLError(str(exc)) from exc
        _audit(
            info,
            agent.organisation,
            AuditEvent.CREATE,
            AuditEvent.AGENT,
            agent,
            f"Minted reveal-once token '{token.name}' for Agent '{agent.name}'",
            workflow_id=str(workflow.id),
            token_id=str(token.id),
            token_name=token.name,
            expires_at=token.expires_at.isoformat() if token.expires_at else None,
        )
        return cls(
            minted=MintedAgentTokenType(
                token=token, full_token=full_token, bearer_token=bearer_token
            )
        )


class RevokeAgentTokenMutation(graphene.Mutation):
    class Arguments:
        token_id = graphene.ID(required=True)
    token = graphene.Field(AgentTokenType, required=True)

    @classmethod
    def mutate(cls, root, info, token_id):
        with transaction.atomic():
            try:
                token = (
                    AgentToken.objects.select_for_update(of=("self",))
                    .select_related("workflow__agent__organisation")
                    .get(id=token_id, deleted_at__isnull=True)
                )
            except (AgentToken.DoesNotExist, ValueError) as exc:
                raise GraphQLError("Agent token not found") from exc
            member = organisation_member(info, token.agent.organisation_id)
            require_workflow(member, token.workflow, "read")
            require_role(member, "delete", "AgentTokens")
            token.delete()
            revoke_agent_sessions(
                AgentSession.objects.filter(
                    agent_token=token,
                    revoked_at__isnull=True,
                )
            )
        _audit(
            info,
            token.agent.organisation,
            AuditEvent.DELETE,
            AuditEvent.AGENT,
            token.agent,
            f"Revoked token '{token.name}' of Agent '{token.agent.name}'",
            workflow_id=str(token.workflow_id),
            token_id=str(token.id),
            token_name=token.name,
        )
        return cls(token=token)


def _request_management_member(info, request_id, *, credentials=False):
    """Authorize a human before any request lifecycle mutation."""

    try:
        initial = AgentRequest.objects.select_related("workflow__agent").get(
            id=request_id
        )
    except (AgentRequest.DoesNotExist, ValueError) as exc:
        raise GraphQLError("Agent request not found") from exc
    member = organisation_member(info, initial.organisation_id)
    require_role(member, "update", "AgentRequests")
    if credentials:
        require_role(member, "read", "IntegrationCredentials")
        require_role(
            member,
            "create" if initial.kind == AgentRequest.SETUP else "update",
            "AgentConnections",
        )
    require_workflow(member, initial.workflow, "update")
    return member, initial.organisation_id


def _expire_pending_request(request_id, organisation_id, now):
    """Commit request/setup cleanup before callers surface an expiry error."""

    with transaction.atomic():
        agent_request = (
            AgentRequest.objects.select_for_update(of=("self",))
            .filter(id=request_id, organisation_id=organisation_id)
            .first()
        )
        if (
            agent_request is None
            or agent_request.status != AgentRequest.PENDING
            or not agent_request.expires_at
            or agent_request.expires_at > now
        ):
            return False
        close_agent_request(agent_request, AgentRequest.EXPIRED, now)
    return True


def _locked_pending_request(
    request_id, expected_revision, *, organisation_id, checked_at=None
):
    try:
        agent_request = (
            AgentRequest.objects.select_for_update(of=("self",))
            .select_related(
                "organisation", "workflow__agent", "connection"
            )
            .get(id=request_id, organisation_id=organisation_id)
        )
    except (AgentRequest.DoesNotExist, ValueError) as exc:
        raise GraphQLError("Agent request not found") from exc
    if not hmac.compare_digest(
        str(agent_request.revision), str(expected_revision or "")
    ):
        raise GraphQLError("Agent request revision changed; refresh and try again")
    if agent_request.status != AgentRequest.PENDING:
        raise GraphQLError("Agent request is no longer pending")
    if agent_request.expires_at and agent_request.expires_at <= (
        checked_at or timezone.now()
    ):
        raise GraphQLError("Agent request has expired")
    return agent_request


class ResolveAgentRequestMutation(graphene.Mutation):
    class Arguments:
        request_id = graphene.ID(required=True)
        expected_revision = graphene.String(required=True)
        approved = graphene.Boolean(required=True)
        resolution_note = graphene.String()
    request = graphene.Field(AgentRequestType, required=True)

    @classmethod
    def mutate(cls, root, info, request_id, expected_revision, approved,
               resolution_note=""):
        if approved:
            raise GraphQLError(
                "Approve setup or credential updates with fulfillAgentRequest"
            )
        member, organisation_id = _request_management_member(info, request_id)
        checked_at = timezone.now()
        if _expire_pending_request(request_id, organisation_id, checked_at):
            raise GraphQLError("Agent request has expired")
        with transaction.atomic():
            agent_request = _locked_pending_request(
                request_id,
                expected_revision,
                organisation_id=organisation_id,
                checked_at=checked_at,
            )
            agent_request.status = AgentRequest.DENIED
            agent_request.resolution_note = _text(
                resolution_note or "", "resolutionNote", maximum=20000,
                allow_empty=True,
            )
            agent_request.resolved_by = member
            agent_request.resolved_at = timezone.now()
            agent_request.progress = {**(agent_request.progress or {}), "stage": "denied"}
            agent_request.save()
            retire_unused_setup_connection(agent_request, agent_request.resolved_at)
        _audit(
            info,
            agent_request.organisation,
            AuditEvent.UPDATE,
            AuditEvent.AGENT_REQUEST,
            agent_request,
            f"Denied Agent request '{agent_request.title}'",
            workflow_id=str(agent_request.workflow_id),
            kind=agent_request.kind,
            status=agent_request.status,
        )
        return cls(request=agent_request)


class FulfillAgentRequestMutation(graphene.Mutation):
    class Arguments:
        request_id = graphene.ID(required=True)
        expected_revision = graphene.String(required=True)
        credential_id = graphene.ID(required=True)
        expected_credential_revision = graphene.String(required=True)
        resolution_note = graphene.String()
        # A setup request only: how long the new grant lasts. Without either,
        # the duration that was asked for is granted.
        duration_seconds = graphene.Int()
        until_revoked = graphene.Boolean()

    request = graphene.Field(AgentRequestType, required=True)
    connection = graphene.Field(AgentConnectionType, required=True)
    grant = graphene.Field(AgentWorkflowGrantType, required=True)
    runtime_action = graphene.String(required=True)

    @classmethod
    def mutate(cls, root, info, request_id, expected_revision, credential_id,
               expected_credential_revision, resolution_note="",
               duration_seconds=None, until_revoked=None):
        member, organisation_id = _request_management_member(
            info, request_id, credentials=True
        )
        checked_at = timezone.now()
        if _expire_pending_request(request_id, organisation_id, checked_at):
            raise GraphQLError("Agent request has expired")
        with transaction.atomic():
            agent_request = _locked_pending_request(
                request_id,
                expected_revision,
                organisation_id=organisation_id,
                checked_at=checked_at,
            )
            if agent_request.action:
                raise GraphQLError(
                    "This request carries an action; approve it with "
                    "approveAgentRequestAction"
                )
            try:
                credential = ProviderCredentials.objects.select_for_update().get(
                    id=credential_id,
                    organisation=agent_request.organisation,
                    deleted_at__isnull=True,
                )
            except (ProviderCredentials.DoesNotExist, ValueError) as exc:
                raise GraphQLError("Integration credential not found") from exc
            if not hmac.compare_digest(
                str(credential.revision), str(expected_credential_revision or "")
            ):
                raise GraphQLError(
                    "Integration credential revision changed; refresh and try again"
                )
            try:
                connection = AgentConnection.objects.select_for_update().get(
                    id=agent_request.connection_id,
                    organisation=agent_request.organisation,
                    deleted_at__isnull=True,
                )
            except AgentConnection.DoesNotExist as exc:
                raise GraphQLError(
                    "The Agent Connection was deleted; start a new request"
                ) from exc
            progress = agent_request.progress or {}
            grant = None
            access = None
            if agent_request.kind == AgentRequest.SETUP:
                try:
                    granted_seconds, grant_expires_at = granted_duration(
                        agent_request,
                        {
                            "durationSeconds": duration_seconds,
                            "untilRevoked": until_revoked,
                        },
                    )
                except DurationError as exc:
                    raise GraphQLError(str(exc)) from exc
                access = access_record(
                    agent_request, granted_seconds, grant_expires_at
                )
            elif duration_seconds is not None or until_revoked:
                raise GraphQLError(
                    "A duration applies only to a request that ends in access"
                )
            if agent_request.kind == AgentRequest.SETUP:
                has_grant = (
                    AgentWorkflowGrant.objects.select_for_update()
                    .active()
                    .filter(connection=connection)
                    .exists()
                )
                if (
                    connection.state != AgentConnection.PENDING_CREDENTIALS
                    or connection.authentication_id is not None
                    or has_grant
                ):
                    raise GraphQLError(
                        "The pending setup Connection changed; start a new request"
                    )
            else:
                baseline_authentication_id = progress.get(
                    "baseline_authentication_id"
                )
                baseline_grant_id = progress.get("baseline_grant_id")
                if (
                    connection.state != AgentConnection.ACTIVE
                    or connection.authentication_id is None
                    or not baseline_authentication_id
                    or not same_id(
                        connection.authentication_id, baseline_authentication_id
                    )
                ):
                    raise GraphQLError(
                        "The Agent Connection credential changed; start a new request"
                    )
                try:
                    grant = (
                        AgentWorkflowGrant.objects.select_for_update()
                        .active()
                        .get(
                            id=agent_request.grant_id,
                            workflow=agent_request.workflow,
                            connection=connection,
                        )
                    )
                except (AgentWorkflowGrant.DoesNotExist, ValueError) as exc:
                    raise GraphQLError(
                        "The Agent Workflow Grant changed; start a new request"
                    ) from exc
                if not baseline_grant_id or not same_id(
                    grant.id, baseline_grant_id
                ):
                    raise GraphQLError(
                        "The Agent Workflow Grant changed; start a new request"
                    )
            try:
                service = get_config_registry().get_service(
                    connection.service_type
                )
            except ConfigRegistryError as exc:
                raise GraphQLError(str(exc)) from exc
            allowed = _providers_for_service(service)
            if credential.provider not in allowed:
                raise GraphQLError(
                    "Integration credential is incompatible with the Connection"
                )
            previous_credential_id = connection.authentication_id
            previous_config = deepcopy(connection.config or {})
            next_config = previous_config
            if credential.provider == "postgres":
                try:
                    next_config = resolve_postgres_connection_config(credential)
                except CredentialResolutionError as exc:
                    raise GraphQLError(
                        "PostgreSQL credential is incomplete or invalid"
                    ) from exc
            try:
                checked_config = get_config_registry().validate_service_config(
                    connection.service_type, next_config
                )
            except ConfigRegistryError as exc:
                raise GraphQLError(str(exc)) from exc

            previous_hosts = previous_config.get("hosts")
            next_hosts = checked_config.get("hosts")
            if previous_hosts != next_hosts:
                connection.host_rules_version = str(uuid4())
                connection.host_rules_approved_version = ""
                connection.host_rules_approved_by = None
                connection.host_rules_authored_by = member if next_hosts else None
            connection.config = checked_config
            connection.authentication = credential
            connection.state = AgentConnection.ACTIVE
            connection.updated_by = member
            _clean_save(connection)

            if agent_request.kind == AgentRequest.SETUP:
                with _custom_connection_errors():
                    grant, _ = grant_connection_access(
                        agent_request.workflow,
                        connection,
                        member,
                        expires_at=grant_expires_at,
                    )
                # What was asked for and what was granted.
                agent_request.applied_action = {"access": access}

            runtime_action = (
                "restart_required"
                if agent_request.kind == AgentRequest.SETUP
                or str(previous_credential_id or "") != str(credential.id)
                or previous_config != (connection.config or {})
                else "retry"
            )
            agent_request.credential = credential
            agent_request.credential_provider = credential.provider
            agent_request.credential_name = credential.name
            agent_request.grant = grant
            agent_request.approval = dict(_SESSION_APPROVAL)
            agent_request.status = AgentRequest.APPROVED
            agent_request.resolution_note = _text(
                resolution_note or "", "resolutionNote", maximum=20000,
                allow_empty=True,
            )
            agent_request.resolved_by = member
            agent_request.resolved_at = timezone.now()
            agent_request.progress = {
                "stage": "complete",
                "credential_id": str(credential.id),
                "credential_name": credential.name,
                "credential_provider": credential.provider,
                "credential_revision": str(credential.revision),
                "connection_id": str(connection.id),
                "grant_id": str(grant.id),
            }
            agent_request.resolution = {
                **agent_request.progress,
                "runtime_action": runtime_action,
            }
            _clean_save(agent_request)
            granted_workflow_ids = list(
                connection.workflow_grants.active().values_list(
                    "workflow_id", flat=True
                )
            )

        # Bump after the Connection lock is released so this never waits on
        # Session rows while holding the grant lock the runtime takes in the
        # opposite order, and reach every Workflow that uses the Connection,
        # not only the requesting one.
        _refresh_workflow_sessions(granted_workflow_ids)

        _audit(
            info,
            agent_request.organisation,
            AuditEvent.UPDATE,
            AuditEvent.AGENT_REQUEST,
            agent_request,
            f"Fulfilled Agent request for '{credential.name}'",
            connection_id=str(connection.id),
            credential_id=str(credential.id),
            grant_id=str(grant.id),
            **({"access": access} if access else {}),
        )
        return cls(
            request=agent_request,
            connection=connection,
            grant=grant,
            runtime_action=runtime_action,
        )


class ApproveAgentRequestActionMutation(graphene.Mutation):
    """Approve a request that carries a typed action, and carry the action out.

    ``action`` is the reviewer's edited version of what was requested; without
    it the request is applied as it stands. ``inputs`` holds what the action's
    handler needs from the reviewer and is never stored, for example a secret
    sealed in their browser.
    """

    class Arguments:
        request_id = graphene.ID(required=True)
        expected_revision = graphene.String(required=True)
        action = GenericScalar()
        inputs = GenericScalar()
        resolution_note = graphene.String()
        # For an action that ends in access: how long it lasts. Without
        # either, the duration that was asked for is granted. A temporary
        # allow always expires, so it refuses ``untilRevoked``.
        duration_seconds = graphene.Int()
        until_revoked = graphene.Boolean()

    request = graphene.Field(AgentRequestType, required=True)
    runtime_action = graphene.String(required=True)

    @classmethod
    def mutate(cls, root, info, request_id, expected_revision, action=None,
               inputs=None, resolution_note="", duration_seconds=None,
               until_revoked=None):
        member, organisation_id = _request_management_member(info, request_id)
        if inputs is not None and not isinstance(inputs, Mapping):
            raise GraphQLError("inputs must be an object")
        # The handler reads the granted duration beside its other inputs.
        inputs = dict(inputs or {})
        if duration_seconds is not None:
            inputs["durationSeconds"] = duration_seconds
        if until_revoked:
            inputs["untilRevoked"] = True
        checked_at = timezone.now()
        if _expire_pending_request(request_id, organisation_id, checked_at):
            raise GraphQLError("Agent request has expired")
        with transaction.atomic():
            agent_request = _locked_pending_request(
                request_id,
                expected_revision,
                organisation_id=organisation_id,
                checked_at=checked_at,
            )
            if not agent_request.action:
                raise GraphQLError(
                    "This request carries no action; fulfil it with "
                    "fulfillAgentRequest"
                )
            try:
                handler = action_handler(agent_request.action)
                if action is not None and action_handler(action) is not handler:
                    raise ActionError(
                        "An approved action must keep the type that was requested"
                    )
                applied = handler.apply(
                    agent_request,
                    handler.validate(
                        agent_request,
                        agent_request.action if action is None else action,
                        member,
                    ),
                    member,
                    inputs,
                )
            except ActionError as exc:
                raise GraphQLError(str(exc)) from exc
            agent_request.applied_action = applied.action
            agent_request.approval = dict(_SESSION_APPROVAL)
            agent_request.status = AgentRequest.APPROVED
            agent_request.resolution_note = _text(
                resolution_note or "", "resolutionNote", maximum=20000,
                allow_empty=True,
            )
            agent_request.resolved_by = member
            agent_request.resolved_at = timezone.now()
            agent_request.progress = {"stage": "complete", **applied.references}
            agent_request.resolution = {
                **agent_request.progress,
                "runtime_action": applied.runtime_action,
            }
            _clean_save(agent_request)

        # The audit entry carries the action exactly as it is stored on the
        # request, so the two never tell different stories.
        _audit(
            info,
            agent_request.organisation,
            AuditEvent.UPDATE,
            AuditEvent.AGENT_REQUEST,
            agent_request,
            f"Approved Agent request '{agent_request.title}'",
            workflow_id=str(agent_request.workflow_id),
            kind=agent_request.kind,
            status=agent_request.status,
            applied_action=agent_request.applied_action,
            approval=agent_request.approval,
            **applied.references,
        )
        return cls(request=agent_request, runtime_action=applied.runtime_action)


class RevokeAgentSessionMutation(graphene.Mutation):
    class Arguments:
        session_uid = graphene.String(required=True)
    session = graphene.Field(AgentSessionType, required=True)

    @classmethod
    def mutate(cls, root, info, session_uid):
        try:
            session = AgentSession.objects.select_related(
                "organisation", "workflow__agent"
            ).get(session_uid=session_uid)
        except (AgentSession.DoesNotExist, ValueError) as exc:
            raise GraphQLError("Agent session not found") from exc
        member = organisation_member(info, session.organisation_id)
        require_workflow(member, session.workflow, "read")
        require_role(member, "delete", "AgentSessions")
        revoke_agent_session(session)
        _audit(
            info,
            session.organisation,
            AuditEvent.DELETE,
            AuditEvent.AGENT,
            session.workflow.agent,
            f"Revoked a session of Agent '{session.workflow.agent.name}'",
            session_uid=str(session.session_uid),
            workflow_id=str(session.workflow_id),
        )
        return cls(session=session)
