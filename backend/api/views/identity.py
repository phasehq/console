"""Shared helpers for linked sign-in identities. The enumeration and
unlink operations live in GraphQL (queries/account.py, mutations/account.py);
these helpers also serve the REST SSO link callback."""

import logging

from api.models import AuditEvent, OrganisationMember, OrganisationSSOProvider, SCIMUser
from api.utils.access.ip import get_client_ip
from api.utils.audit_logging import log_audit_event
from api.utils.sso import get_org_provider_meta

logger = logging.getLogger(__name__)

# Human-readable names keyed by SocialAccount.provider (provider_id space).
PROVIDER_DISPLAY_NAMES = {
    "google": "Google",
    "google-oidc": "Google",
    "github": "GitHub",
    "github-enterprise": "GitHub Enterprise",
    "gitlab": "GitLab",
    "microsoft": "Microsoft Entra ID",
    "jumpcloud-oidc": "JumpCloud",
    "okta-oidc": "Okta",
    "authentik": "Authentik",
    "authelia": "Authelia",
}


def provider_display_name(provider):
    return PROVIDER_DISPLAY_NAMES.get(provider, provider)


def identity_email(extra_data):
    return (
        extra_data.get("email")
        or extra_data.get("mail")  # Microsoft Graph
        or extra_data.get("userPrincipalName")
        or ""
    )


def _identity_avatar(extra_data):
    return (
        extra_data.get("avatar_url")  # GitHub
        or extra_data.get("picture")  # Google, standard OIDC
        or extra_data.get("photo")  # Microsoft Entra ID
        or extra_data.get("avatar")  # GitLab
    )


def _password_counts_as_method(user):
    from api.views.auth_password import _password_auth_enabled

    return user.has_usable_password() and _password_auth_enabled()


def _org_provider_entries(user):
    """Org-level SSO providers across the user's active memberships, with
    registry metadata. Disabled configs are included so identities linked
    through a previous provider keep their org attribution; consumers wanting
    the active provider filter on `provider.enabled`. Active providers sort
    first so attribution prefers them on a provider_id tie."""
    providers = (
        OrganisationSSOProvider.objects.filter(
            organisation__users__user=user,
            organisation__users__deleted_at=None,
        )
        .select_related("organisation")
        .distinct()
    )
    entries = []
    for provider in providers:
        meta = get_org_provider_meta(provider.provider_type)
        if meta:
            entries.append((provider, meta))
    entries.sort(key=lambda entry: not entry[0].enabled)
    return entries


def _unlink_block(user, social_account, org_entries):
    """Return (reason, org_name) when an org manages this identity.

    An org-configured provider and an instance-level provider of the same
    type share a provider_id, so this can over-block — the safe direction.
    """
    for provider, meta in org_entries:
        # Only the org's active provider can enforce SSO or carry SCIM.
        if not provider.enabled:
            continue
        if meta["provider_id"] != social_account.provider:
            continue
        if provider.organisation.require_sso:
            return "org_enforced", provider.organisation.name
        if SCIMUser.objects.filter(
            user=user, organisation=provider.organisation, active=True
        ).exists():
            return "scim_managed", provider.organisation.name
    return None, None


def _org_name_for_identity(social_account, org_entries):
    """The org whose enabled SSO provider matches this identity's
    provider_id, if any — used to label org-level identities on the
    account page. Instance- and org-level identities of the same
    provider_id are indistinguishable, so this can over-attribute; the
    same safe-direction tradeoff as _unlink_block."""
    for provider, meta in org_entries:
        if meta["provider_id"] == social_account.provider:
            return provider.organisation.name
    return None


def log_org_identity_events(request, user, provider_id, action):
    """Write an AuditEvent into each org whose configured SSO provider
    matches the linked/unlinked identity, so admins tracking an SSO
    migration can see member progress in the existing audit UI."""
    display_name = provider_display_name(provider_id)
    for provider, meta in _org_provider_entries(user):
        # Only the org's active provider is worth a migration-tracking event.
        if not provider.enabled:
            continue
        if meta["provider_id"] != provider_id:
            continue
        member = OrganisationMember.objects.filter(
            user=user, organisation=provider.organisation, deleted_at=None
        ).first()
        if member is None:
            continue
        log_audit_event(
            organisation=provider.organisation,
            event_type=AuditEvent.UPDATE,
            resource_type=AuditEvent.ORG_MEMBER,
            resource_id=member.id,
            actor_type="user",
            actor_id=member.id,
            actor_metadata={"email": user.email, "username": user.username},
            description=f"{action.capitalize()} {display_name} sign-in identity",
            ip_address=get_client_ip(request),
            user_agent=request.META.get("HTTP_USER_AGENT", ""),
        )
