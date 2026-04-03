import logging

from django.utils import timezone

from api.models import (
    CustomUser,
    OrganisationMember,
    Role,
    SCIMUser,
    TeamMembership,
)
from api.utils.keys import revoke_team_environment_keys

logger = logging.getLogger(__name__)


def provision_scim_user(organisation, external_id, email, display_name, scim_data=None):
    """
    Create or link a SCIM user to a Phase CustomUser + OrganisationMember.

    - If a CustomUser with this email exists, link to it.
    - If an OrganisationMember exists but is soft-deleted, reactivate it.
    - Otherwise create both from scratch.

    Returns the SCIMUser instance.
    """
    email = email.lower().strip()

    # Get default role for SCIM-provisioned users
    default_role = Role.objects.get(
        organisation=organisation, name__iexact="developer"
    )

    # Try to find existing CustomUser by email
    user = CustomUser.objects.filter(email__iexact=email).first()

    if user is None:
        # Create new CustomUser (no password — SSO-only)
        user = CustomUser.objects.create(
            username=email,
            email=email,
        )
        user.set_unusable_password()
        user.save()

    # Try to find existing OrganisationMember
    org_member = OrganisationMember.objects.filter(
        user=user, organisation=organisation
    ).first()

    if org_member is None:
        # Create pre-provisioned OrgMember (no identity_key yet)
        org_member = OrganisationMember.objects.create(
            user=user,
            organisation=organisation,
            role=default_role,
            identity_key="",
            wrapped_keyring="",
            wrapped_recovery="",
        )
    elif org_member.deleted_at is not None:
        # Reactivate soft-deleted member
        org_member.deleted_at = None
        org_member.save(update_fields=["deleted_at"])

    scim_user = SCIMUser.objects.create(
        external_id=external_id,
        organisation=organisation,
        user=user,
        org_member=org_member,
        email=email,
        display_name=display_name or "",
        active=True,
        scim_data=scim_data or {},
    )

    return scim_user


def deactivate_scim_user(scim_user):
    """
    Deactivate a SCIM user: soft-delete OrgMember and revoke team keys.
    Does NOT delete CustomUser (may belong to other orgs).
    """
    scim_user.active = False
    scim_user.save(update_fields=["active"])

    if scim_user.org_member:
        # Revoke team environment keys for all teams
        team_memberships = TeamMembership.objects.filter(
            org_member=scim_user.org_member,
            team__deleted_at__isnull=True,
        ).select_related("team")

        for tm in team_memberships:
            revoke_team_environment_keys(tm.team, member=scim_user.org_member)

        # Wipe crypto material so user must redo key ceremony if reactivated
        scim_user.org_member.identity_key = ""
        scim_user.org_member.wrapped_keyring = ""
        scim_user.org_member.wrapped_recovery = ""

        # Soft-delete the org member
        scim_user.org_member.deleted_at = timezone.now()
        scim_user.org_member.save(update_fields=[
            "identity_key", "wrapped_keyring", "wrapped_recovery", "deleted_at",
        ])


def reactivate_scim_user(scim_user):
    """
    Reactivate a previously deactivated SCIM user.
    Team keys will be provisioned at next login via provision_pending_team_keys().
    """
    scim_user.active = True
    scim_user.save(update_fields=["active"])

    if scim_user.org_member and scim_user.org_member.deleted_at is not None:
        scim_user.org_member.deleted_at = None
        scim_user.org_member.save(update_fields=["deleted_at"])
