import json
import logging

from django.http import JsonResponse
from django.views.decorators.http import require_POST

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated

from allauth.socialaccount.models import SocialAccount, SocialToken

from api.models import AuditEvent, OrganisationMember, OrganisationSSOProvider, SCIMUser
from api.emails import send_identity_unlinked_email
from api.utils.access.ip import get_client_ip
from api.utils.audit_logging import log_audit_event
from api.utils.reauth import REAUTH_ERROR, session_is_fresh
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
    """Enabled org-level SSO providers across the user's active memberships,
    paired with their registry metadata."""
    providers = (
        OrganisationSSOProvider.objects.filter(
            enabled=True,
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
    return entries


def _unlink_block(user, social_account, org_entries):
    """Return (reason, org_name) when an org manages this identity.

    An org-configured provider and an instance-level provider of the same
    type share a provider_id, so this can over-block — the safe direction.
    """
    for provider, meta in org_entries:
        if meta["provider_id"] != social_account.provider:
            continue
        if provider.organisation.require_sso:
            return "org_enforced", provider.organisation.name
        if SCIMUser.objects.filter(
            user=user, organisation=provider.organisation, active=True
        ).exists():
            return "scim_managed", provider.organisation.name
    return None, None


def log_org_identity_events(request, user, provider_id, action):
    """Write an AuditEvent into each org whose configured SSO provider
    matches the linked/unlinked identity, so admins tracking an SSO
    migration can see member progress in the existing audit UI."""
    display_name = provider_display_name(provider_id)
    for provider, meta in _org_provider_entries(user):
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


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def identities_view(request):
    """List the session user's linked sign-in identities and the providers
    available to link."""
    from api.views.sso import SSO_PROVIDER_REGISTRY

    user = request.user
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
            {
                "id": str(sa.pk),
                "provider": sa.provider,
                "providerName": provider_display_name(sa.provider),
                "uid": sa.uid,
                "email": identity_email(extra),
                "name": extra.get("name") or "",
                "avatarUrl": _identity_avatar(extra),
                "createdAt": sa.date_joined.isoformat() if sa.date_joined else None,
                "lastUsedAt": sa.last_login.isoformat() if sa.last_login else None,
                "isLastMethod": is_last,
                "managedByOrg": managed_by_org,
                "blockedReason": reason,
                "blockedOrgName": org_name,
            }
        )

    # Authorize URLs are built from registry slugs; SocialAccount.provider
    # stores provider_ids — the frontend needs both to match "Connected".
    available_instance = [
        {"slug": slug, "providerId": config["provider_id"]}
        for slug, config in SSO_PROVIDER_REGISTRY.items()
    ]
    available_org = [
        {
            "id": str(provider.id),
            "provider": provider.provider_type,
            "providerId": meta["provider_id"],
            "providerName": provider.name or meta["label"],
            "organisationName": provider.organisation.name,
        }
        for provider, meta in org_entries
    ]

    return JsonResponse(
        {
            "identities": identities,
            "hasUsablePassword": password_counts,
            "availableToLink": {
                "instance": available_instance,
                "org": available_org,
            },
        }
    )


@require_POST
def unlink_identity(request):
    """Unlink a sign-in identity from the session user's account.

    Plain Django view (mounted with csrf_exempt like logout_view — the
    frontend has no CSRF token plumbing); the JSON content-type
    requirement forces a CORS preflight, blocking form-based CSRF, and
    the fresh-session gate bounds what a riding session can do.
    """
    if not request.user.is_authenticated:
        return JsonResponse(
            {"error": "Authentication required.", "code": "unauthenticated"},
            status=401,
        )
    if not session_is_fresh(request):
        return JsonResponse(REAUTH_ERROR, status=401)

    if not (request.content_type or "").startswith("application/json"):
        return JsonResponse({"error": "JSON body required."}, status=400)

    try:
        body = json.loads(request.body or b"{}")
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON body."}, status=400)

    account_id = body.get("accountId") or body.get("account_id")
    if not account_id:
        return JsonResponse({"error": "accountId is required."}, status=400)

    user = request.user
    try:
        sa = SocialAccount.objects.get(pk=account_id, user=user)
    except (SocialAccount.DoesNotExist, ValueError):
        return JsonResponse({"error": "Identity not found.", "code": "not_found"}, status=404)

    if user.socialaccount_set.count() == 1 and not _password_counts_as_method(user):
        return JsonResponse(
            {
                "error": "You must keep at least one sign-in method.",
                "code": "last_method",
            },
            status=409,
        )

    reason, org_name = _unlink_block(user, sa, _org_provider_entries(user))
    if reason is not None:
        return JsonResponse(
            {
                "error": f"Your organisation {org_name} manages this sign-in method.",
                "code": reason,
                "organisation": org_name,
            },
            status=409,
        )

    provider_id = sa.provider
    display_name = provider_display_name(provider_id)
    unlinked_email = identity_email(sa.extra_data or {})
    uid = sa.uid

    SocialToken.objects.filter(account=sa).delete()
    sa.delete()

    logger.info(
        json.dumps(
            {
                "event": "identity_unlinked",
                "user_id": str(user.userId),
                "provider": provider_id,
                "uid": uid,
                "ip": get_client_ip(request),
            }
        )
    )
    log_org_identity_events(request, user, provider_id, "unlinked")

    try:
        send_identity_unlinked_email(request, user, display_name, unlinked_email)
    except Exception:
        logger.exception("Failed to send identity_unlinked email to %s", user.email)

    return JsonResponse({"ok": True})
