from api.models import OrganisationMember, SCIMUser, UserRecoveryCode, UserTOTP
from api.utils.reauth import session_is_fresh
from backend.graphene.types import (
    AccountDeletionItemType,
    AccountDeletionReadinessType,
    AccountIdentitiesType,
    AvailableInstanceProviderType,
    AvailableOrgProviderType,
    LinkedIdentityType,
    MfaStatusType,
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

    # SCIM-managed accounts must be deprovisioned at the IdP, not deleted
    # here. Scope to scim_enabled orgs: a disabled-SCIM org can't
    # deprovision via its IdP, so blocking would dead-end with no remediation.
    scim_rows = SCIMUser.objects.filter(
        user=user,
        active=True,
        organisation__scim_enabled=True,
        org_member__deleted_at=None,
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

    # Sole-service-account-handler is intentionally NOT a blocker: only the
    # org's sole owner can be sole handler, already covered by sole_owner.

    return blockers


def resolve_account_deletion_readiness(root, info):
    user = info.context.user
    blockers = compute_account_deletion_blockers(user)
    return AccountDeletionReadinessType(
        can_delete=len(blockers) == 0,
        requires_reauth=not session_is_fresh(info.context),
        blockers=blockers,
    )


def resolve_account_identities(root, info):
    """The session user's linked sign-in identities and the providers
    available to link. Identity helpers live in api.views.identity, shared
    with the (REST) SSO link callback."""
    from api.views.identity import (
        _identity_avatar,
        _org_name_for_identity,
        _org_provider_entries,
        _password_counts_as_method,
        _unlink_block,
        identity_email,
        provider_display_name,
    )
    from api.views.sso import SSO_PROVIDER_REGISTRY

    user = info.context.user
    accounts = list(user.socialaccount_set.all().order_by("date_joined"))
    password_counts = _password_counts_as_method(user)
    org_entries = _org_provider_entries(user)

    identities = []
    for sa in accounts:
        extra = sa.extra_data or {}
        is_last = len(accounts) == 1 and not password_counts
        reason, org_name = _unlink_block(user, sa, org_entries)
        managed_by_org = reason is not None
        if reason is None and is_last:
            reason = "last_method"
        identities.append(
            LinkedIdentityType(
                id=str(sa.pk),
                provider=sa.provider,
                provider_name=provider_display_name(sa.provider),
                uid=sa.uid,
                email=identity_email(extra),
                name=extra.get("name") or "",
                avatar_url=_identity_avatar(extra),
                created_at=sa.date_joined,
                last_used_at=sa.last_login,
                is_last_method=is_last,
                managed_by_org=managed_by_org,
                blocked_reason=reason,
                blocked_org_name=org_name,
                organisation_name=_org_name_for_identity(sa, org_entries),
            )
        )

    # Authorize URLs are built from registry slugs; SocialAccount.provider
    # stores provider_ids — the frontend needs both to match "Connected".
    available_instance = [
        AvailableInstanceProviderType(slug=slug, provider_id=config["provider_id"])
        for slug, config in SSO_PROVIDER_REGISTRY.items()
    ]
    # A disabled config can't start a link flow — list it only when already
    # linked, so its org group still shows the Connected chip.
    linked_provider_ids = {sa.provider for sa in accounts}
    available_org = [
        AvailableOrgProviderType(
            id=str(provider.id),
            provider=provider.provider_type,
            provider_id=meta["provider_id"],
            provider_name=provider.name or meta["label"],
            organisation_name=provider.organisation.name,
        )
        for provider, meta in org_entries
        if provider.enabled or meta["provider_id"] in linked_provider_ids
    ]

    return AccountIdentitiesType(
        identities=identities,
        has_usable_password=password_counts,
        available_instance_providers=available_instance,
        available_org_providers=available_org,
    )


def resolve_mfa_status(root, info):
    user = info.context.user
    user_totp = UserTOTP.objects.filter(user=user, activated_at__isnull=False).first()
    return MfaStatusType(
        enabled=user_totp is not None,
        activated_at=user_totp.activated_at if user_totp else None,
        recovery_codes_remaining=UserRecoveryCode.objects.filter(
            user=user, used_at__isnull=True
        ).count(),
    )
