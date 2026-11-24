"""Agent, Workflow, and reveal-once token helpers."""

from datetime import timedelta

from django.db import models, transaction
from django.utils import timezone
from nacl.encoding import RawEncoder
from nacl.hash import blake2b

from api.models import (
    Agent,
    AgentConnection,
    AgentMembership,
    AgentRequest,
    AgentSession,
    AgentToken,
    AgentWorkflow,
    AgentWorkflowMembership,
    Organisation,
    OrganisationMember,
)
from api.utils.access.permissions import role_has_global_access, role_has_permission
from api.utils.crypto import (
    ed25519_to_kx,
    random_hex,
    split_secret_hex,
    wrap_share_hex,
)
from api.utils.service_accounts import (
    generate_server_managed_sa_keys,
    unwrap_server_managed_sa_keyring,
)
from backend.quotas import PLAN_CONFIG, can_add_agent, can_add_agent_workflow


class InvalidAgentKeyring(ValueError):
    """The Agent's server-wrapped keyring does not open to its identity key."""


class AgentPlanLimitReached(ValueError):
    """The organisation's plan does not allow another Agent or Workflow."""


class AgentTokenNotAllowed(ValueError):
    """The token's creator may not mint it as they are now: their role or
    their assignment to the Workflow changed."""


def hash_agent_token_lookup(token_value):
    """Return a 32-byte BLAKE2b digest for an Agent bearer secret."""

    return blake2b(
        token_value.encode("utf-8"),
        encoder=RawEncoder,
        digest_size=32,
    ).hex()


def retire_unused_setup_connection(agent_request, now):
    """Remove the placeholder Connection a setup request created, once the
    request is closed without being fulfilled. Call inside a transaction."""

    if agent_request.kind != AgentRequest.SETUP or not agent_request.connection_id:
        return
    connection = AgentConnection.objects.select_for_update().get(
        id=agent_request.connection_id
    )
    if (
        connection.state != AgentConnection.PENDING_CREDENTIALS
        or connection.deleted_at is not None
        or connection.workflow_grants.active().exists()
    ):
        return
    connection.state = AgentConnection.DISABLED
    connection.deleted_at = now
    connection.save(update_fields=["state", "deleted_at", "updated_at"])


# How long a request waits for a member before it expires.
REQUEST_LIFETIME = timedelta(days=7)


def file_action_request(
    draft, *, workflow, title, action, markdown, dedup_key, related_request, now
):
    """File a pending request that carries an action its handler has checked.

    Call inside a transaction. Used for Agent requests and for approvals left undecided.
    """

    draft.workflow = workflow
    draft.title = title
    draft.action = action
    draft.markdown = markdown.strip()
    draft.dedup_key = dedup_key
    draft.related_request = related_request
    draft.progress = {"stage": "awaiting_approval", **(draft.progress or {})}
    draft.expires_at = now + REQUEST_LIFETIME
    draft.full_clean()
    draft.save()
    return draft


def close_agent_request(agent_request, status, now):
    """Close a locked pending request as expired or cancelled."""

    agent_request.status = status
    agent_request.resolved_at = now
    agent_request.save(update_fields=["status", "resolved_at", "updated_at"])
    retire_unused_setup_connection(agent_request, now)


def cancel_pending_requests(queryset, now):
    """Cancel the pending requests of a deleted target. Call inside a transaction."""

    pending = queryset.select_for_update(of=("self",)).filter(
        status=AgentRequest.PENDING
    )
    for agent_request in pending.order_by("id"):
        close_agent_request(agent_request, AgentRequest.CANCELLED, now)


def expire_overdue_requests(queryset, now, *, batch_size=100):
    """Expire a bounded batch of overdue pending requests."""

    with transaction.atomic():
        expired = (
            queryset.select_for_update(of=("self",))
            .filter(status=AgentRequest.PENDING, expires_at__lte=now)
            .order_by("expires_at", "id")[:batch_size]
        )
        for agent_request in expired:
            close_agent_request(agent_request, AgentRequest.EXPIRED, now)


@transaction.atomic
def retire_member_agent_authentication(
    *,
    member_id,
    agent_id=None,
    workflow_id=None,
    retired_at=None,
):
    """Permanently retire a member's Agent tokens and live sessions in scope.

    Membership rows may be reactivated, but tokens must never be: a reassigned member needs a new token.
    """

    from api.utils.agent_sessions import revoke_agent_sessions

    now = retired_at or timezone.now()
    token_filter = {
        "created_by_id": member_id,
        "deleted_at__isnull": True,
    }
    session_filter = models.Q(opened_by_member_id=member_id) | models.Q(
        agent_token__created_by_id=member_id
    )
    if workflow_id is not None:
        token_filter["workflow_id"] = workflow_id
        session_filter &= models.Q(workflow_id=workflow_id)
    elif agent_id is not None:
        token_filter["workflow__agent_id"] = agent_id
        session_filter &= models.Q(workflow__agent_id=agent_id)

    token_count = AgentToken.objects.filter(**token_filter).update(
        deleted_at=now,
        updated_at=now,
        wrapped_key_share="",
    )
    session_ids = list(
        AgentSession.objects.filter(
            session_filter,
            revoked_at__isnull=True,
        ).values_list("pk", flat=True)
    )
    revoke_agent_sessions(session_ids)
    return token_count, len(session_ids)


@transaction.atomic
def retire_organisation_member_agent_access(member, *, retired_at=None):
    """Retire all Agent access owned by one OrganisationMember."""

    now = retired_at or timezone.now()
    AgentWorkflowMembership.objects.filter(
        agent_membership__member_id=member.id,
        deleted_at__isnull=True,
    ).update(deleted_at=now, updated_at=now)
    AgentMembership.objects.filter(
        member_id=member.id,
        deleted_at__isnull=True,
    ).update(deleted_at=now, updated_at=now)
    return retire_member_agent_authentication(
        member_id=member.id,
        retired_at=now,
    )


@transaction.atomic
def create_agent_workflow(
    *,
    agent,
    name,
    created_by=None,
):
    if not can_add_agent_workflow(agent):
        plan = PLAN_CONFIG[agent.organisation.plan]
        raise AgentPlanLimitReached(
            f"The {plan['name']} plan is limited to "
            f"{plan['max_workflows_per_agent']} Workflows per Agent."
        )
    workflow = AgentWorkflow(
        organisation=agent.organisation,
        agent=agent,
        name=name,
        created_by=created_by,
    )
    workflow.full_clean()
    workflow.save()
    if created_by is not None and not role_has_global_access(created_by.role):
        membership = AgentMembership.objects.filter(
            agent=agent,
            member=created_by,
            deleted_at__isnull=True,
        ).first()
        if membership is None:
            raise ValueError("Workflow creator must be an active Agent member")
        workflow_membership = AgentWorkflowMembership.objects.filter(
            workflow=workflow,
            agent_membership=membership,
        ).order_by("-created_at").first()
        if workflow_membership is None:
            workflow_membership = AgentWorkflowMembership(
                workflow=workflow,
                agent_membership=membership,
                assigned_by=created_by,
            )
        else:
            workflow_membership.deleted_at = None
            workflow_membership.assigned_by = created_by
        workflow_membership.full_clean()
        workflow_membership.save()
    return workflow


@transaction.atomic
def create_agent_with_default_workflow(
    *,
    organisation,
    name,
    harness_type,
    created_by=None,
    default_workflow_name="Default",
):
    if created_by is None:
        raise ValueError("Agent creator is required")
    # Locked so two Agents created at once are counted one after the other.
    organisation = Organisation.objects.select_for_update().get(pk=organisation.pk)
    if not can_add_agent(organisation):
        plan = PLAN_CONFIG[organisation.plan]
        raise AgentPlanLimitReached(
            f"The {plan['name']} plan is limited to {plan['max_agents']} Agents."
        )
    identity_key, server_wrapped_keyring, server_wrapped_recovery = (
        generate_server_managed_sa_keys()
    )
    agent = Agent(
        organisation=organisation,
        name=name,
        harness_type=harness_type,
        identity_key=identity_key,
        server_wrapped_keyring=server_wrapped_keyring,
        server_wrapped_recovery=server_wrapped_recovery,
        created_by=created_by,
    )
    agent.full_clean()
    agent.save()

    if not role_has_global_access(created_by.role):
        membership = AgentMembership(
            agent=agent,
            member=created_by,
            assigned_by=created_by,
        )
        membership.full_clean()
        membership.save()

    workflow = create_agent_workflow(
        agent=agent,
        name=default_workflow_name,
        created_by=created_by,
    )
    return agent, workflow


@transaction.atomic
def mint_agent_token(
    *,
    agent,
    workflow,
    name,
    expires_at=None,
    created_by,
):
    """Mint a v1 token carrying a share of the Agent's key exchange private key.

    The server enforces the token's Workflow binding; only the digest and wrapped share are stored.
    """

    # Removing the creator from the Agent locks this row before it retires
    # their tokens, so it either retires this one or is seen by the check below.
    membership = None
    if created_by is not None:
        membership = (
            AgentMembership.objects.select_for_update(of=("self",))
            .filter(agent=agent, member=created_by, deleted_at__isnull=True)
            .first()
        )
        # The creator's role as it is now: one changed since the caller
        # checked it decides.
        created_by = (
            OrganisationMember.objects.select_related("role")
            .filter(pk=created_by.pk, deleted_at__isnull=True)
            .first()
        )
        if created_by is None or not role_has_permission(
            created_by.role, "create", "AgentTokens"
        ):
            raise AgentTokenNotAllowed(
                "You no longer have permission to create Agent tokens"
            )
    assigned = created_by is not None and not role_has_global_access(created_by.role)
    try:
        workflow = (
            AgentWorkflow.objects.select_for_update(of=("self",))
            .select_related("agent")
            .get(
                id=workflow.id,
                agent=agent,
                organisation=agent.organisation,
                deleted_at__isnull=True,
                agent__deleted_at__isnull=True,
                agent__status=Agent.ACTIVE,
            )
        )
    except AgentWorkflow.DoesNotExist as exc:
        raise ValueError("Workflow does not belong to an active Agent") from exc
    if assigned and not (
        membership is not None
        and membership.workflow_memberships.filter(
            workflow=workflow, deleted_at__isnull=True
        ).exists()
    ):
        raise AgentTokenNotAllowed("You no longer have access to this Workflow")

    try:
        keyring = unwrap_server_managed_sa_keyring(
            workflow.agent.server_wrapped_keyring, workflow.agent.identity_key
        )
    except ValueError as exc:
        raise InvalidAgentKeyring("Invalid Agent keyring") from exc
    kx_pub, kx_priv = ed25519_to_kx(keyring["publicKey"], keyring["privateKey"])

    wrap_key = random_hex(32)
    token_value = random_hex(32)
    share_a, share_b = split_secret_hex(kx_priv)
    token = AgentToken(
        workflow=workflow,
        name=name,
        token=hash_agent_token_lookup(token_value),
        identity_key=kx_pub,
        wrapped_key_share=wrap_share_hex(share_b, wrap_key),
        expires_at=expires_at,
        created_by=created_by,
    )
    token.full_clean()
    token.save()

    full_token = f"pss_agent:v1:{token_value}:{kx_pub}:{share_a}:{wrap_key}"
    return token, full_token, f"Agent {token_value}"
