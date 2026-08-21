from api.models import OrganisationMember, SCIMUser
from api.utils.reauth import session_is_fresh
from backend.graphene.types import (
    AccountDeletionItemType,
    AccountDeletionReadinessType,
)


def compute_account_deletion_blockers(user):
    """Return the list of blockers for deleting this account. Shared by the
    readiness query (advisory UI) and DeleteAccountMutation (authoritative
    server-side recheck)."""
    blockers = []

    memberships = OrganisationMember.objects.filter(
        user=user, deleted_at=None
    ).select_related("organisation", "role")

    for membership in memberships:
        role_name = getattr(membership.role, "name", "") or ""
        if role_name.lower() != "owner":
            continue
        other_owners = (
            OrganisationMember.objects.filter(
                organisation=membership.organisation,
                role__name__iexact="owner",
                deleted_at=None,
            )
            .exclude(user=user)
            .count()
        )
        # Co-owned orgs don't block — someone else retains control.
        if other_owners == 0:
            blockers.append(
                AccountDeletionItemType(
                    kind="sole_owner",
                    organisation_id=membership.organisation.id,
                    organisation_name=membership.organisation.name,
                    detail=(
                        "You are the owner of this organisation. You must "
                        "transfer ownership to another user before your "
                        "account can be deleted."
                    ),
                )
            )

    # The IdP is the source of truth for SCIM-managed access — the account
    # must be deprovisioned there, not self-deleted here.
    scim_rows = SCIMUser.objects.filter(
        user=user, active=True, org_member__deleted_at=None
    ).select_related("organisation")
    for scim_user in scim_rows:
        blockers.append(
            AccountDeletionItemType(
                kind="scim_managed",
                organisation_id=scim_user.organisation.id,
                organisation_name=scim_user.organisation.name,
                detail=(
                    "Your account in this organisation is managed by its "
                    "identity provider. Contact your administrator to be "
                    "deprovisioned."
                ),
            )
        )

    # NOTE: sole-service-account-handler is intentionally NOT a blocker or
    # warning. Org owners and admins have global access to every SA's keys,
    # so a user can only be the sole handler when they're the org's sole
    # owner — already covered by the sole_owner blocker above.

    return blockers


def resolve_account_deletion_readiness(root, info):
    user = info.context.user
    blockers = compute_account_deletion_blockers(user)
    return AccountDeletionReadinessType(
        can_delete=len(blockers) == 0,
        requires_reauth=not session_is_fresh(info.context),
        blockers=blockers,
    )
