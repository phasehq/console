from api.models import OrganisationMember, SCIMUser, ServiceAccountHandler
from api.utils.reauth import session_is_fresh
from backend.graphene.types import (
    AccountDeletionItemType,
    AccountDeletionReadinessType,
)


def compute_account_deletion_blockers(user):
    """Return (blockers, warnings) for deleting this account. Shared by the
    readiness query (advisory UI) and DeleteAccountMutation (authoritative
    server-side recheck)."""
    blockers = []
    warnings = []

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

    # Warn (don't block) when the user is the only handler of a
    # client-side-key service account: existing tokens keep working, but
    # no one can manage the SA's keys until an admin re-provisions
    # handlers via a role change.
    handler_rows = ServiceAccountHandler.objects.filter(
        user__user=user,
        user__deleted_at=None,
        service_account__deleted_at__isnull=True,
        service_account__server_wrapped_keyring__isnull=True,
    ).select_related("service_account", "service_account__organisation")
    for handler in handler_rows:
        handler_count = ServiceAccountHandler.objects.filter(
            service_account=handler.service_account,
            user__deleted_at=None,
        ).count()
        if handler_count == 1:
            warnings.append(
                AccountDeletionItemType(
                    kind="sole_sa_handler",
                    organisation_id=handler.service_account.organisation.id,
                    organisation_name=handler.service_account.organisation.name,
                    detail=(
                        f"You are the only key handler for the service account "
                        f"'{handler.service_account.name}'. Its existing tokens "
                        f"keep working, but its keys will be unmanageable until "
                        f"an admin re-provisions handlers."
                    ),
                )
            )

    return blockers, warnings


def resolve_account_deletion_readiness(root, info):
    user = info.context.user
    blockers, warnings = compute_account_deletion_blockers(user)
    return AccountDeletionReadinessType(
        can_delete=len(blockers) == 0,
        requires_reauth=not session_is_fresh(info.context),
        blockers=blockers,
        warnings=warnings,
    )
