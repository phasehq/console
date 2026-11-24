"""Who can be asked to review a change request, and asking them.

Only a member who could approve a request can be asked to review it. That is decided by the checks
approving the request runs, so it follows every role, custom roles included, with no ranking of roles.
Asking someone puts the request in front of them; it gives no access, and anyone else who may
approve the request still can.
"""

from api.models import AgentRequest, AgentRequestReviewer, OrganisationMember
from api.utils.access.permissions import (
    account_can_access_workflow,
    role_has_permission,
)
from api.utils.request_actions import ActionError, action_handler

MAX_REVIEWERS = 10


class ReviewerError(Exception):
    pass


def member_name(member):
    return member.user.full_name or member.user.email


def can_approve(member, agent_request):
    """Whether ``member`` could approve ``agent_request`` as it stands.

    The checks approving runs: permission to update change requests and the request's Workflow (as
    a member of it, or with a role that reaches every Agent), then what the request asks of whoever
    approves it, such as access to every environment an app request covers.
    """

    if member is None or member.deleted_at is not None:
        return False
    if str(member.organisation_id) != str(agent_request.organisation_id):
        return False
    if not role_has_permission(member.role, "update", "AgentRequests"):
        return False
    if not account_can_access_workflow(member, agent_request.workflow, "update"):
        return False
    if not agent_request.action:
        # Fulfilled with an Integration Credential, as fulfillAgentRequest checks.
        return role_has_permission(
            member.role, "read", "IntegrationCredentials"
        ) and role_has_permission(
            member.role,
            "create" if agent_request.kind == AgentRequest.SETUP else "update",
            "AgentConnections",
        )
    try:
        action_handler(agent_request.action).check_approver(agent_request, member)
    except (ActionError, NotImplementedError):
        return False
    return True


def review_candidates(agent_request):
    """The organisation's members who could approve the request, by name."""

    members = OrganisationMember.objects.select_related("role", "user").filter(
        organisation_id=agent_request.organisation_id, deleted_at__isnull=True
    )
    return sorted(
        (member for member in members if can_approve(member, agent_request)),
        key=lambda member: (member_name(member).lower(), str(member.id)),
    )


def set_reviewers(agent_request, member_ids, requested_by):
    """Make ``member_ids`` the members asked to review the request.

    Call it with the request row locked. A member newly asked must be able to approve the request;
    one asked earlier stays until they are taken off. Returns the members added and removed.
    """

    wanted = list(dict.fromkeys(str(member_id) for member_id in member_ids))
    if len(wanted) > MAX_REVIEWERS:
        raise ReviewerError(f"A request can have at most {MAX_REVIEWERS} reviewers.")
    current = {
        str(reviewer.member_id): reviewer
        for reviewer in agent_request.reviewers.select_related("member__user")
    }
    new_ids = [member_id for member_id in wanted if member_id not in current]
    members = {
        str(member.id): member
        for member in OrganisationMember.objects.select_related("role", "user").filter(
            organisation_id=agent_request.organisation_id,
            deleted_at__isnull=True,
            id__in=new_ids,
        )
    }
    if len(members) != len(new_ids):
        raise ReviewerError("Member not found.")
    for member_id in new_ids:
        if not can_approve(members[member_id], agent_request):
            raise ReviewerError(
                f"{member_name(members[member_id])} can't approve this request, "
                "so they can't be asked to review it."
            )
    removed = [
        reviewer for member_id, reviewer in current.items() if member_id not in wanted
    ]
    AgentRequestReviewer.objects.filter(
        id__in=[reviewer.id for reviewer in removed]
    ).delete()
    AgentRequestReviewer.objects.bulk_create(
        [
            AgentRequestReviewer(
                request=agent_request,
                member=members[member_id],
                requested_by=requested_by,
            )
            for member_id in new_ids
        ]
    )
    return [members[member_id] for member_id in new_ids], [
        reviewer.member for reviewer in removed
    ]
