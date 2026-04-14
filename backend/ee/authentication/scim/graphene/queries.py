from graphql import GraphQLError
from api.models import OrganisationMember, SCIMEvent, SCIMToken
from api.utils.access.permissions import user_has_permission, user_is_org_member
from datetime import datetime


def resolve_scim_tokens(root, info, organisation_id):
    """Return SCIM tokens for the organisation. Requires SCIM.read permission (Admin+)."""
    user = info.context.user

    if not user_is_org_member(user.userId, organisation_id):
        raise GraphQLError("You don't have access to this organisation")

    org_member = OrganisationMember.objects.get(
        user_id=user.userId, organisation_id=organisation_id, deleted_at=None
    )

    if not user_has_permission(user, "read", "SCIM", org_member.organisation):
        raise GraphQLError("You don't have permission to view SCIM tokens.")

    return SCIMToken.objects.filter(
        organisation_id=organisation_id, deleted_at__isnull=True
    ).order_by("-created_at")


PAGE_SIZE = 25


def resolve_scim_events(
    root,
    info,
    organisation_id,
    start=None,
    end=None,
    event_types=None,
    token_id=None,
    status=None,
):
    """Return SCIM audit events with cursor-based pagination and filtering. Requires SCIM.read permission."""
    user = info.context.user

    if not user_is_org_member(user.userId, organisation_id):
        raise GraphQLError("You don't have access to this organisation")

    org_member = OrganisationMember.objects.get(
        user_id=user.userId, organisation_id=organisation_id, deleted_at=None
    )

    if not user_has_permission(user, "read", "SCIM", org_member.organisation):
        raise GraphQLError("You don't have permission to view SCIM events.")

    qs = SCIMEvent.objects.filter(organisation_id=organisation_id)

    if start is not None:
        qs = qs.filter(timestamp__gte=datetime.fromtimestamp(start / 1000))

    if end is not None:
        qs = qs.filter(timestamp__lte=datetime.fromtimestamp(end / 1000))

    if event_types:
        # Frontend sends uppercase enum values (e.g. USER_CREATED),
        # DB stores lowercase (e.g. user_created)
        lowered = [et.lower() for et in event_types]
        qs = qs.filter(event_type__in=lowered)

    if token_id:
        qs = qs.filter(scim_token_id=token_id)

    if status:
        # Frontend sends uppercase (SUCCESS/ERROR), DB stores lowercase
        qs = qs.filter(status=status.lower())

    count = qs.count()
    events = list(
        qs.select_related("scim_token").order_by("-timestamp", "-id")[:PAGE_SIZE]
    )

    return {"events": events, "count": count}
