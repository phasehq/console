"""Agent, Workflow, and reveal-once token helpers."""

from django.db import models, transaction
from django.utils import timezone
from nacl.encoding import RawEncoder
from nacl.hash import blake2b

from api.models import (
    Agent,
    AgentMembership,
    AgentSession,
    AgentToken,
    AgentWorkflow,
    AgentWorkflowMembership,
)
from api.utils.access.permissions import role_has_global_access
from api.utils.crypto import random_hex


def hash_agent_token_lookup(token_value):
    """Return a 32-byte BLAKE2b digest for an Agent bearer secret."""

    return blake2b(
        token_value.encode("utf-8"),
        encoder=RawEncoder,
        digest_size=32,
    ).hex()


@transaction.atomic
def retire_member_agent_authentication(
    *,
    member_id,
    agent_id=None,
    workflow_id=None,
    retired_at=None,
):
    """Permanently retire a member's Agent tokens and live sessions in scope.

    Membership rows may be reactivated by a later assignment. Token rows must
    never be: a newly assigned member has to mint a new bearer token.
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
    agent = Agent(
        organisation=organisation,
        name=name,
        harness_type=harness_type,
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
    """Mint an opaque v1 token and persist only its one-way digest."""

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

    token_value = random_hex(32)
    token = AgentToken(
        workflow=workflow,
        name=name,
        token=hash_agent_token_lookup(token_value),
        expires_at=expires_at,
        created_by=created_by,
    )
    token.full_clean()
    token.save()

    return token, f"pss_agent:v1:{token_value}", f"Agent {token_value}"
