from graphql import GraphQLError

from api.models import CustomUser, OrganisationMember
from api.utils.access.permissions import (
    account_can_access_agent,
    account_can_access_workflow,
    role_has_permission,
)


def organisation_member(info, organisation_id):
    user = getattr(info.context, "user", None)
    if not isinstance(user, CustomUser):
        raise GraphQLError("AI Agent Console operations require human authentication")
    try:
        member = OrganisationMember.objects.select_related("role", "organisation").get(
            organisation_id=organisation_id,
            user=user,
            deleted_at__isnull=True,
        )
    except OrganisationMember.DoesNotExist as exc:
        raise GraphQLError("You don't have access to this organisation") from exc
    info.context._org_member = member
    return member


def organisation_for(info, organisation_id, action, resource):
    member = organisation_member(info, organisation_id)
    require_role(member, action, resource)
    return member.organisation, member


def require_role(member, action, resource):
    if not role_has_permission(member.role, action, resource):
        raise GraphQLError(f"You don't have permission to {action} {resource}")


def require_agent(member, agent, action="read"):
    if not account_can_access_agent(member, agent, action):
        raise GraphQLError(f"You don't have permission to {action} this Agent")
    return agent


def require_workflow(member, workflow, action="read"):
    if not account_can_access_workflow(member, workflow, action):
        raise GraphQLError(f"You don't have permission to {action} this Workflow")
    return workflow


def same_id(left, right):
    return str(left) == str(right)
