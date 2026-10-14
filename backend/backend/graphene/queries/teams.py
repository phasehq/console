from graphql import GraphQLError
from api.models import Team, OrganisationMember
from api.utils.access.permissions import (
    user_has_permission,
    user_is_org_member,
)


def resolve_teams(root, info, organisation_id, team_id=None):
    """Return teams visible to the requesting user."""
    user = info.context.user

    if not user_is_org_member(user.userId, organisation_id):
        raise GraphQLError("You don't have access to this organisation")

    org_member = OrganisationMember.objects.get(
        user_id=user.userId, organisation_id=organisation_id, deleted_at=None
    )

    if not user_has_permission(user, "read", "Teams", org_member.organisation):
        return []

    qs = (
        Team.objects.filter(organisation_id=organisation_id, deleted_at__isnull=True)
        .select_related(
            "member_role", "service_account_role", "owner__user", "created_by__user"
        )
        .prefetch_related(
            "owner__user__socialaccount_set",
            "owner__scimuser_set",
            "created_by__user__socialaccount_set",
            "created_by__scimuser_set",
        )
        .order_by("name")
    )

    if team_id:
        qs = qs.filter(id=team_id)

    return qs
