from api.models import OrganisationMember, OrganisationMemberInvite, ServiceAccount
from django.utils import timezone


def get_organisation_seats(organisation):
    seats = (
        OrganisationMember.objects.filter(
            organisation=organisation, deleted_at=None
        ).count()
        + OrganisationMemberInvite.objects.filter(
            organisation=organisation, valid=True, expires_at__gte=timezone.now()
        ).count()
        + ServiceAccount.objects.filter(
            organisation=organisation, deleted_at=None
        ).count()
    )

    return seats
