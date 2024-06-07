from django.conf import settings
from api.models import ActivatedPhaseLicense
from graphql import GraphQLError
from api.utils.permissions import user_is_org_member


def resolve_license(root, info):
    return settings.PHASE_LICENSE


def resolve_organisation_license(root, info, organisation_id):
    if not user_is_org_member(info.context.user.userId, organisation_id):
        raise GraphQLError("You don't have access to this organisation")

    return (
        ActivatedPhaseLicense.objects.filter(organisation__id=organisation_id)
        .order_by("-activated_at")
        .first()
    )
