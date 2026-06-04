import logging
import uuid

from django.utils import timezone

from api.models import (
    CustomUser,
    OrganisationMember,
    Role,
    SCIMUser,
    TeamMembership,
)
from api.utils.keys import revoke_team_environment_keys
from ee.authentication.scim.exceptions import (
    SCIMDeactivationForbidden,
    SCIMProvisioningConflict,
)

logger = logging.getLogger(__name__)


def resolve_external_id(provided):
    """externalId is OPTIONAL per RFC 7643 §3.1. If the client omitted it,
    synthesize a stable UUID so the resource still has a queryable
    externalId for later operations — applied to both Users and Groups."""
    if isinstance(provided, str) and provided.strip():
        return provided.strip()
    return str(uuid.uuid4())


def provision_scim_user(organisation, external_id, email, display_name, scim_data=None):
    """
    Create or link a SCIM user to a Phase CustomUser + OrganisationMember.

    - If a CustomUser with this email exists, link to it; otherwise create one.
    - If an ACTIVE empty-crypto OrganisationMember exists (pending invite),
      adopt it.
    - If any soft-deleted OM exists for this (user, org), it's ignored — a
      fresh OM is created so re-provisioning a previously-removed user
      doesn't carry over stale teams, roles, or crypto state.
    - Otherwise create a fresh OM.

    Raises SCIMProvisioningConflict when an ACTIVE OrganisationMember has
    crypto material or is already linked to a SCIMUser — adopting it would
    let SCIM deactivation wipe a user-keyed identity (identity-bricking).
    Soft-deleted OMs are out of scope for this guard since they're already
    unreachable to the user.

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

    # Try to find existing OrganisationMember (skip soft-deleted ones — a
    # previously-removed member shouldn't block SCIM from re-provisioning the
    # same email; we want a fresh OM created below).
    org_member = OrganisationMember.objects.filter(
        user=user, organisation=organisation, deleted_at__isnull=True
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
    else:
        # Refuse adoption if the OM is already SCIM-managed — caller should
        # PUT/PATCH the existing SCIMUser instead of creating a new one.
        if SCIMUser.objects.filter(org_member=org_member).exists():
            logger.warning(
                "SCIM provisioning refused: org_member %s already linked to a SCIMUser (org=%s, email=%s)",
                org_member.id, organisation.id, email,
            )
            raise SCIMProvisioningConflict(
                f"User '{email}' is already SCIM-managed in this organisation"
            )

        # Refuse adoption if the OM has crypto material — wiping it on
        # deactivate would permanently brick the user's identity.
        if org_member.identity_key:
            logger.warning(
                "SCIM provisioning refused: org_member %s has existing crypto material (org=%s, email=%s)",
                org_member.id, organisation.id, email,
            )
            raise SCIMProvisioningConflict(
                f"User '{email}' already exists in this organisation with an active identity"
            )

        # Empty-crypto ACTIVE OM — safe to adopt (e.g. a member invited via the
        # console who hasn't completed key ceremony yet). Soft-deleted OMs are
        # never reached here — they're filtered out upstream.
        logger.warning(
            "SCIM adopting pre-existing empty org_member %s (org=%s, email=%s)",
            org_member.id, organisation.id, email,
        )

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

    Raises SCIMDeactivationForbidden if the linked OM is an organisation
    owner — the IdP cannot deprovision an Owner. The check runs before any
    state change so partial mutations don't happen on the reject path.
    """
    if scim_user.org_member:
        role = scim_user.org_member.role
        if role and getattr(role, "name", "") and role.name.lower() == "owner":
            logger.warning(
                "SCIM deactivation refused: org_member %s is an organisation owner (org=%s, email=%s)",
                scim_user.org_member.id,
                scim_user.organisation.id,
                scim_user.email,
            )
            raise SCIMDeactivationForbidden(
                f"Cannot deactivate '{scim_user.email}' — they are an organisation owner. "
                "Transfer ownership in Phase before deprovisioning."
            )

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

        # Remove team memberships so reactivation doesn't restore stale teams.
        # The IdP's group push will re-add the user to the correct teams.
        team_memberships.delete()

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
