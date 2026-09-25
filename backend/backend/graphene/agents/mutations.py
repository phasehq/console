"""Human-only GraphQL mutations for managing AI Agents."""

from copy import deepcopy
from datetime import datetime
import hmac
from uuid import uuid4

import graphene
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import F
from django.utils import timezone
from graphene.types.generic import GenericScalar
from graphql import GraphQLError

from api.models import (
    Agent,
    AgentConnection,
    AgentEvent,
    AgentMembership,
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
from api.utils.agent_credentials import (
    CredentialResolutionError,
    resolve_postgres_connection_config,
)
from api.utils.agent_sessions import revoke_agent_session, revoke_agent_sessions
from api.utils.agents import (
    close_agent_request,
    create_agent_with_default_workflow,
    create_agent_workflow,
    mint_agent_token,
    retire_unused_setup_connection,
)
from api.utils.audit_logging import get_actor_info_from_graphql, log_audit_event
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
    AgentTokenType,
    AgentType,
    AgentWorkflowGrantType,
    AgentWorkflowType,
    MintedAgentTokenType,
)
from api.utils.agent_config import (
    ConfigRegistryError,
    get_config_registry,
    host_rules_require_independent_approval,
)


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
    AgentSession.objects.filter(
        workflow_id__in=set(workflow_ids),
        revoked_at__isnull=True,
        expires_at__gt=timezone.now(),
    ).update(config_generation=F("config_generation") + 1)


def _revoke_connection_sessions(connection):
    workflow_ids = connection.workflow_grants.filter(
        deleted_at__isnull=True
    ).values_list("workflow_id", flat=True)
    revoke_agent_sessions(
        AgentSession.objects.filter(
            workflow_id__in=workflow_ids,
            revoked_at__isnull=True,
        )
    )


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
        agent.delete()
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
        try:
            workflow = create_agent_workflow(
                agent=agent,
                name=_text(name, "name"),
                created_by=member,
            )
        except ValueError as exc:
            raise GraphQLError(str(exc)) from exc
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
        if changes.get("name") is not None:
            workflow.name = _text(changes["name"], "name")
        _clean_save(workflow)
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
        if workflow.agent.workflows.filter(deleted_at__isnull=True).count() <= 1:
            raise GraphQLError("An Agent must retain at least one active Workflow")
        workflow.delete()
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
            if not same_id(connection.host_rules_version, expected_version):
                raise GraphQLError(
                    "The Connection host rules changed; review the current version"
                )
            grants = list(
                AgentWorkflowGrant.objects.select_related(
                    "connection", "connection__authentication"
                ).filter(
                    workflow_id=event.workflow_id,
                    deleted_at__isnull=True,
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
                for value in connection.workflow_grants.filter(
                    deleted_at__isnull=True,
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
                service = registry.get_service(connection.service_type)
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
            connection = AgentConnection.objects.select_for_update().select_related(
                "organisation", "host_rules_authored_by", "host_rules_approved_by"
            ).get(id=connection_id, deleted_at__isnull=True)
            try:
                service = get_config_registry().get_service(connection.service_type)
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
            connection.workflow_grants.filter(
                deleted_at__isnull=True
            ).values_list("workflow_id", flat=True)
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
            workflow_ids = list(
                connection.workflow_grants.filter(
                    deleted_at__isnull=True
                ).values_list("workflow_id", flat=True)
            )
            now = timezone.now()
            connection.workflow_grants.filter(deleted_at__isnull=True).update(
                deleted_at=now, updated_at=now
            )
            connection.state = AgentConnection.DISABLED
            connection.deleted_at = now
            connection.updated_by = member
            connection.save(
                update_fields=["state", "deleted_at", "updated_by", "updated_at"]
            )
        revoke_agent_sessions(
            AgentSession.objects.filter(
                workflow_id__in=workflow_ids, revoked_at__isnull=True
            )
        )
        return cls(ok=True)


class GrantAgentWorkflowMutation(graphene.Mutation):
    class Arguments:
        workflow_id = graphene.ID(required=True)
        connection_id = graphene.ID(required=True)

    grant = graphene.Field(AgentWorkflowGrantType, required=True)

    @classmethod
    def mutate(cls, root, info, workflow_id, connection_id):
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
            service = get_config_registry().get_service(connection.service_type)
            if connection.authentication.provider not in _providers_for_service(service):
                raise GraphQLError(
                    "Connection authentication is incompatible with its service"
                )
            grant = AgentWorkflowGrant.objects.filter(
                workflow=workflow,
                connection=connection,
                deleted_at__isnull=True,
            ).first()
            if grant is None:
                grant = AgentWorkflowGrant(
                    organisation=workflow.organisation,
                    workflow=workflow,
                    connection=connection,
                    created_by=member,
                )
                _clean_save(grant)
        _refresh_workflow_sessions([workflow.id])
        return cls(grant=grant)


class RevokeAgentWorkflowGrantMutation(graphene.Mutation):
    class Arguments:
        grant_id = graphene.ID(required=True)

    ok = graphene.Boolean(required=True)

    @classmethod
    def mutate(cls, root, info, grant_id):
        try:
            grant = AgentWorkflowGrant.objects.select_related(
                "organisation", "workflow__agent"
            ).get(id=grant_id, deleted_at__isnull=True)
        except (AgentWorkflowGrant.DoesNotExist, ValueError) as exc:
            raise GraphQLError("Agent Workflow Grant not found") from exc
        member = organisation_member(info, grant.organisation_id)
        require_workflow(member, grant.workflow, "update")
        workflow_id = grant.workflow_id
        with transaction.atomic():
            grant = AgentWorkflowGrant.objects.select_for_update().get(
                id=grant_id, deleted_at__isnull=True
            )
            grant.delete()
        revoke_agent_sessions(
            AgentSession.objects.filter(
                workflow_id=workflow_id, revoked_at__isnull=True
            )
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
        return cls(request=agent_request)


class FulfillAgentRequestMutation(graphene.Mutation):
    class Arguments:
        request_id = graphene.ID(required=True)
        expected_revision = graphene.String(required=True)
        credential_id = graphene.ID(required=True)
        expected_credential_revision = graphene.String(required=True)
        resolution_note = graphene.String()

    request = graphene.Field(AgentRequestType, required=True)
    connection = graphene.Field(AgentConnectionType, required=True)
    grant = graphene.Field(AgentWorkflowGrantType, required=True)
    runtime_action = graphene.String(required=True)

    @classmethod
    def mutate(cls, root, info, request_id, expected_revision, credential_id,
               expected_credential_revision, resolution_note=""):
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
            connection = AgentConnection.objects.select_for_update().get(
                id=agent_request.connection_id,
                organisation=agent_request.organisation,
                deleted_at__isnull=True,
            )
            progress = agent_request.progress or {}
            grant = None
            if agent_request.kind == AgentRequest.SETUP:
                has_grant = AgentWorkflowGrant.objects.select_for_update().filter(
                    connection=connection,
                    deleted_at__isnull=True,
                ).exists()
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
                    grant = AgentWorkflowGrant.objects.select_for_update().get(
                        id=agent_request.grant_id,
                        workflow=agent_request.workflow,
                        connection=connection,
                        deleted_at__isnull=True,
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
                grant = AgentWorkflowGrant(
                    organisation=agent_request.organisation,
                    workflow=agent_request.workflow,
                    connection=connection,
                    created_by=member,
                )
                _clean_save(grant)

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
            AgentSession.objects.filter(
                workflow=agent_request.workflow,
                revoked_at__isnull=True,
                expires_at__gt=timezone.now(),
            ).update(config_generation=F("config_generation") + 1)

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
        )
        return cls(
            request=agent_request,
            connection=connection,
            grant=grant,
            runtime_action=runtime_action,
        )


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
        return cls(session=session)
