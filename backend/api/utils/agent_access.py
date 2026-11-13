"""The one path that ends a Workflow's access to a Connection."""

from django.utils import timezone

from api.models import AgentWorkflowGrant
from api.utils.agent_connection_values import prune_agent_key_copies
from api.utils.agent_sessions import refresh_workflow_sessions


def end_connection_access(grants, *, ended_at=None):
    """End the active grants in a queryset.

    Everything that takes a Connection away from a Workflow goes through here:
    a grant revoked by a member or at an Agent's request, a deleted Connection,
    a deleted Workflow or Agent, and any job that ends grants later. It
    soft-deletes the grants, removes an Agent's copy of a custom Connection's
    key once its last grant on that Connection is gone, and tells the live
    sessions of the affected Workflows to fetch their config again.

    Call inside a transaction. Returns the grants it ended.
    """

    now = ended_at or timezone.now()
    candidates = list(
        grants.filter(deleted_at__isnull=True).values_list("id", "workflow_id")
    )
    if not candidates:
        return []
    # Sessions before grants: the runtime locks a session before its grant.
    refresh_workflow_sessions({workflow_id for _, workflow_id in candidates})
    ended = list(
        AgentWorkflowGrant.objects.select_for_update(of=("self",))
        .filter(
            id__in=[grant_id for grant_id, _ in candidates],
            deleted_at__isnull=True,
        )
        .order_by("id")
    )
    if not ended:
        return []
    AgentWorkflowGrant.objects.filter(id__in=[grant.id for grant in ended]).update(
        deleted_at=now, updated_at=now
    )
    for grant in ended:
        grant.deleted_at = now
    prune_agent_key_copies({grant.connection_id for grant in ended})
    return ended
