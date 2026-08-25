import os
import json
import time
import base64
import secrets
import logging
import threading
import requests as http_requests
from urllib.parse import urlencode, urlparse, quote

from django.conf import settings
from django.contrib.auth import login, get_user_model
from django.http import JsonResponse
from django.shortcuts import redirect
from django.views import View

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.throttling import AnonRateThrottle

from allauth.socialaccount.models import (
    SocialApp,
    SocialAccount,
    SocialToken,
    SocialLogin,
)
from api.models import OrganisationSSOProvider
from api.utils.mfa import user_has_active_totp
from api.utils.network import validate_url_is_safe
from api.utils.reauth import (
    auth_fresh_until,
    is_safe_redirect_path,
    session_is_fresh,
    stamp_auth_time,
)
from django.core.exceptions import ValidationError

logger = logging.getLogger(__name__)

FRONTEND_URL = os.getenv("ALLOWED_ORIGINS", "").split(",")[0].strip()

# Email domain whitelist — restricts which email domains can log in.
# Comma-separated list from env, e.g. "acme.com,example.org"
_domain_whitelist_raw = os.getenv("USER_EMAIL_DOMAIN_WHITELIST", "")
DOMAIN_WHITELIST = [
    d.strip().lower() for d in _domain_whitelist_raw.split(",") if d.strip()
]


# --- Rate Limiting ---


class AuthLoginThrottle(AnonRateThrottle):
    rate = "10/min"


class AuthResolveThrottle(AnonRateThrottle):
    rate = "20/min"


def _maybe_add_admin_contact(message: str, suffix: str = " Contact your administrator.") -> str:
    """Append admin-contact guidance to a user-facing error message
    unless running in cloud mode — cloud users reach out to Phase
    support directly, not a separate org admin."""
    if settings.APP_HOST == "cloud":
        return message
    return message + suffix


# --- OIDC Discovery Cache ---

_oidc_cache = {}
_oidc_cache_lock = threading.Lock()
_OIDC_CACHE_TTL = 3600  # 1 hour


def _safe_oidc_request(method, url, **kwargs):
    """Wrapper around requests.{get,post} that blocks SSRF to private
    IPs when running on cloud. Redirects are disabled so a 30x response
    can't pivot the fetch to an internal service after validation.

    Self-hosted deployments bypass the IP allowlist — customers may
    legitimately point at internal OIDC servers — but redirects are
    still disabled for consistency.

    DNS TOCTOU (rebinding between validate_url_is_safe's resolution and
    requests' resolution) is a known limitation; mitigating it would
    require a custom transport that pins the resolved IP.
    """
    if settings.APP_HOST == "cloud":
        try:
            validate_url_is_safe(url)
        except ValidationError:
            raise ValueError(f"URL rejected by safety check: {url}")
    kwargs.setdefault("allow_redirects", False)
    return http_requests.request(method, url, **kwargs)


def _get_oidc_endpoints(issuer):
    """Fetch OIDC discovery document with a TTL cache."""
    now = time.time()

    with _oidc_cache_lock:
        cached = _oidc_cache.get(issuer)
        if cached and (now - cached["fetched_at"]) < _OIDC_CACHE_TTL:
            return cached["endpoints"]

    discovery_url = f"{issuer.rstrip('/')}/.well-known/openid-configuration"
    try:
        resp = _safe_oidc_request("GET", discovery_url, timeout=10)
        resp.raise_for_status()
        config = resp.json()
        authorize_url = config["authorization_endpoint"]
        token_url = config["token_endpoint"]
        # Validate endpoints returned by discovery before trusting them —
        # a hostile discovery doc could otherwise point token_endpoint at
        # an internal service to exfil client_secret.
        if settings.APP_HOST == "cloud":
            try:
                validate_url_is_safe(token_url)
            except ValidationError:
                raise ValueError(
                    f"Discovery returned unsafe token_endpoint: {token_url}"
                )
        endpoints = {
            "authorize_url": authorize_url,
            "token_url": token_url,
        }
        with _oidc_cache_lock:
            _oidc_cache[issuer] = {"endpoints": endpoints, "fetched_at": now}
        return endpoints
    except Exception:
        logger.warning(f"OIDC discovery failed for {issuer}")
        # Return stale cache if available
        with _oidc_cache_lock:
            if cached:
                return cached["endpoints"]
        return None


# --- Domain whitelist check ---


def _check_email_domain_allowed(email):
    """Check if an email's domain is allowed by the whitelist.
    Returns True if no whitelist is configured or if the domain is allowed."""
    if not DOMAIN_WHITELIST:
        return True
    domain = email.split("@")[-1].lower()
    return domain in DOMAIN_WHITELIST


# --- Helper: get provider config from settings ---

SSO_PROVIDER_REGISTRY = {}


def _build_provider_registry():
    """Build the SSO provider registry from Django settings on startup."""
    providers = settings.SOCIALACCOUNT_PROVIDERS

    # Google OAuth2
    google_cfg = providers.get("google", {}).get("APP", {})
    if google_cfg.get("client_id"):
        SSO_PROVIDER_REGISTRY["google"] = {
            "client_id": google_cfg["client_id"],
            "client_secret": google_cfg.get("secret", ""),
            "authorize_url": "https://accounts.google.com/o/oauth2/v2/auth",
            "token_url": "https://oauth2.googleapis.com/token",
            "scopes": "openid profile email",
            "adapter_module": "api.authentication.adapters.google",
            "adapter_class": "CustomGoogleOAuth2Adapter",
            "provider_id": "google",
            "token_auth_method": "client_secret_post",
            "extra_auth_params": {"access_type": "online"},
        }

    # GitHub OAuth2
    github_cfg = providers.get("github", {}).get("APP", {})
    if github_cfg.get("client_id"):
        SSO_PROVIDER_REGISTRY["github"] = {
            "client_id": github_cfg["client_id"],
            "client_secret": github_cfg.get("secret", ""),
            "authorize_url": "https://github.com/login/oauth/authorize",
            "token_url": "https://github.com/login/oauth/access_token",
            "scopes": "user:email read:user",
            "adapter_module": "api.authentication.adapters.github",
            "adapter_class": "CustomGitHubOAuth2Adapter",
            "provider_id": "github",
            "token_auth_method": "client_secret_post",
        }

    # GitHub Enterprise
    ghe_cfg = providers.get("github-enterprise", {}).get("APP", {})
    ghe_url = providers.get("github-enterprise", {}).get(
        "GITHUB_URL", os.getenv("GITHUB_ENTERPRISE_BASE_URL", "")
    )
    if ghe_cfg.get("client_id") and ghe_url:
        SSO_PROVIDER_REGISTRY["github-enterprise"] = {
            "client_id": ghe_cfg["client_id"],
            "client_secret": ghe_cfg.get("secret", ""),
            "authorize_url": f"{ghe_url}/login/oauth/authorize",
            "token_url": f"{ghe_url}/login/oauth/access_token",
            "scopes": "user:email read:user",
            "adapter_module": "ee.authentication.sso.oauth.github_enterprise.views",
            "adapter_class": "GitHubEnterpriseOAuth2Adapter",
            "provider_id": "github-enterprise",
            "token_auth_method": "client_secret_post",
        }

    # GitLab OAuth2
    gitlab_cfg = providers.get("gitlab", {}).get("APP", {})
    gitlab_url = gitlab_cfg.get("settings", {}).get(
        "gitlab_url", os.getenv("GITLAB_AUTH_URL", "https://gitlab.com")
    )
    if gitlab_cfg.get("client_id"):
        SSO_PROVIDER_REGISTRY["gitlab"] = {
            "client_id": gitlab_cfg["client_id"],
            "client_secret": gitlab_cfg.get("secret", ""),
            "authorize_url": f"{gitlab_url}/oauth/authorize",
            "token_url": f"{gitlab_url}/oauth/token",
            "scopes": "read_user",
            "adapter_module": "api.authentication.adapters.gitlab",
            "adapter_class": "CustomGitLabOAuth2Adapter",
            "provider_id": "gitlab",
            "token_auth_method": "client_secret_post",
        }

    # OIDC providers
    oidc_providers = {
        "google-oidc": {
            "issuer": "https://accounts.google.com",
            "adapter_module": "ee.authentication.sso.oidc.util.google.views",
            "adapter_class": "GoogleOpenIDConnectAdapter",
            "provider_id": "google-oidc",
            "token_auth_method": "client_secret_post",
        },
        "jumpcloud-oidc": {
            "issuer": "https://oauth.id.jumpcloud.com",
            "adapter_module": "ee.authentication.sso.oidc.util.jumpcloud.views",
            "adapter_class": "JumpCloudOpenIDConnectAdapter",
            "provider_id": "jumpcloud-oidc",
            "token_auth_method": "client_secret_post",
        },
        "entra-id-oidc": {
            "issuer": f"https://login.microsoftonline.com/{os.getenv('ENTRA_ID_OIDC_TENANT_ID', 'common')}/v2.0",
            "adapter_module": "ee.authentication.sso.oidc.entraid.views",
            "adapter_class": "CustomMicrosoftGraphOAuth2Adapter",
            "provider_id": "microsoft",
            "token_auth_method": "client_secret_post",
            "extra_scopes": ["User.Read"],
        },
        "authentik": {
            "issuer": f"{os.getenv('AUTHENTIK_URL', '')}/application/o/{os.getenv('AUTHENTIK_APP_SLUG', '')}",
            "adapter_module": "api.authentication.providers.authentik.views",
            "adapter_class": "AuthentikOpenIDConnectAdapter",
            "provider_id": "authentik",
            "token_auth_method": "client_secret_post",
        },
        "authelia": {
            "issuer": os.getenv("AUTHELIA_URL", ""),
            "adapter_module": "api.authentication.providers.authelia.views",
            "adapter_class": "AutheliaOpenIDConnectAdapter",
            "provider_id": "authelia",
            "token_auth_method": "client_secret_post",
        },
        "okta-oidc": {
            "issuer": os.getenv("OKTA_OIDC_ISSUER", ""),
            "adapter_module": "ee.authentication.sso.oidc.okta.views",
            "adapter_class": "OktaOpenIDConnectAdapter",
            "provider_id": "okta-oidc",
            "token_auth_method": "client_secret_basic",
        },
    }

    for slug, oidc_cfg in oidc_providers.items():
        settings_key_map = {
            "google-oidc": "google-oidc",
            "jumpcloud-oidc": "jumpcloud-oidc",
            "entra-id-oidc": "microsoft",
            "authentik": "authentik",
            "authelia": "authelia",
            "okta-oidc": "okta-oidc",
        }
        settings_key = settings_key_map.get(slug, slug)
        provider_settings = providers.get(settings_key, {})

        app_cfg = provider_settings.get("APP", {})
        if not app_cfg and "APPS" in provider_settings:
            apps = provider_settings["APPS"]
            app_cfg = apps[0] if apps else {}

        if not app_cfg.get("client_id"):
            continue

        issuer = oidc_cfg["issuer"]
        if not issuer:
            continue

        default_scopes = ["openid", "email", "profile"] + list(
            oidc_cfg.get("extra_scopes", [])
        )
        scopes = " ".join(provider_settings.get("SCOPE", default_scopes))

        SSO_PROVIDER_REGISTRY[slug] = {
            "client_id": app_cfg["client_id"],
            "client_secret": app_cfg.get("secret", ""),
            "issuer": issuer,
            "scopes": scopes,
            "adapter_module": oidc_cfg["adapter_module"],
            "adapter_class": oidc_cfg["adapter_class"],
            "provider_id": oidc_cfg["provider_id"],
            "token_auth_method": oidc_cfg.get(
                "token_auth_method", "client_secret_post"
            ),
            "is_oidc": True,
        }


def _get_adapter_instance(provider_config, request):
    """Dynamically import and instantiate an adapter class."""
    import importlib

    module = importlib.import_module(provider_config["adapter_module"])
    cls = getattr(module, provider_config["adapter_class"])
    return cls(request)


def _get_callback_url(provider_slug):
    """Build the OAuth callback URL for a given provider.

    Always uses the frontend /api/auth/callback/ path, which 302 redirects
    to the backend. This keeps OAuth redirect URIs stable — third-party
    provider configurations never need updating even as the backend URLs
    evolve. The redirect adds negligible latency (~10-50ms).
    """
    return f"{FRONTEND_URL}/api/auth/callback/{provider_slug}"


def _get_or_create_social_app(config, *, org_config_id=None):
    """Get or create a persisted SocialApp so that SocialToken ForeignKeys work.

    Instance-level SSO has exactly one SocialApp per provider_id.

    Org-level SSO requires disambiguation: two orgs configuring the same
    provider type (both Okta) share provider_id="okta-oidc" but each
    registers a distinct client_id with its IdP. Keying solely on
    provider would cause Org B's save to clobber Org A's credentials.
    We key org-level rows on (provider, client_id), which is unique per
    IdP registration.
    """
    provider = config["provider_id"]
    client_id = config["client_id"]
    client_secret = config["client_secret"]

    if org_config_id:
        app = SocialApp.objects.filter(provider=provider, client_id=client_id).first()
        if app is None:
            # Concurrent first-logins on the same org-config could both
            # miss this lookup and race to create() — the duplicate row
            # is harmless, subsequent logins will pick whichever exists.
            #
            # `name` is varchar(40) in allauth's schema. Provider strings
            # like "jumpcloud-oidc" (14) plus a UUID (36) overflow it;
            # truncate to fit. Real disambiguation is (provider,
            # client_id), already enforced by the lookup above.
            app = SocialApp.objects.create(
                provider=provider,
                name=f"{provider}:{org_config_id}"[:40],
                client_id=client_id,
                secret=client_secret,
            )
            return app
        if app.secret != client_secret:
            app.secret = client_secret
            app.save(update_fields=["secret"])
        return app

    # Instance-level: one row per provider_id.
    app, created = SocialApp.objects.get_or_create(
        provider=provider,
        defaults={
            "name": provider,
            "client_id": client_id,
            "secret": client_secret,
        },
    )
    if not created:
        changed = False
        if app.client_id != client_id:
            app.client_id = client_id
            changed = True
        if app.secret != client_secret:
            app.secret = client_secret
            changed = True
        if changed:
            app.save()
    return app


def _complete_login_bypassing_allauth(
    request, social_login, token, *, org_config_id=None
):
    """Handle user creation/linking and login directly, bypassing
    allauth's complete_social_login which has complex redirect-based
    flows (signup forms, account-connect pages) that don't work in
    a backend-driven OAuth callback.

    This replicates the net effect of what dj_rest_auth + allauth do
    together: find/create user by email, link the social account, and
    save the token. Returns the resolved user; the caller performs the
    login (deferred for TOTP-enrolled users).

    Security:
      - Org-level SSO (org_config_id set): the IdP is controlled by
        the org's admin, NOT a universally trusted provider. We pin
        trust to org membership — the claimed email must match an
        existing OrganisationMember of this org, or a pending invite.
        Otherwise a malicious admin could issue tokens claiming any
        email and hijack existing Phase accounts.
      - Instance-level SSO: trust the email_verified claim when the
        IdP exposes it. An explicit False is grounds for rejection.
    """
    from django.utils import timezone
    from api.models import OrganisationMember, OrganisationMemberInvite

    User = get_user_model()

    extra_data = social_login.account.extra_data or {}
    email = (
        extra_data.get("email")
        or extra_data.get("mail")  # Microsoft Graph uses 'mail'
        or (social_login.user.email if social_login.user else None)
    )
    if not email:
        raise ValueError("No email address from SSO provider")

    email = email.lower().strip()

    provider = social_login.account.provider
    uid = social_login.account.uid

    if org_config_id:
        # Anchor trust to org state — the only emails we allow through
        # an org-configured IdP are those the org itself has already
        # authorised (members or pending invites).
        try:
            org_provider = OrganisationSSOProvider.objects.select_related(
                "organisation"
            ).get(id=org_config_id)
        except OrganisationSSOProvider.DoesNotExist:
            raise ValueError("SSO provider no longer exists")

        org = org_provider.organisation

        # A linked identity is stronger proof than the IdP-claimed email:
        # a member who linked this exact (provider, uid) from an
        # authenticated session passes the gate even when their IdP email
        # differs from their Phase email.
        linked_sa = SocialAccount.objects.filter(provider=provider, uid=uid).first()
        linked_member = linked_sa is not None and OrganisationMember.objects.filter(
            user=linked_sa.user,
            organisation=org,
            deleted_at__isnull=True,
        ).exists()

        if not linked_member:
            has_membership = OrganisationMember.objects.filter(
                user__email=email,
                organisation=org,
                deleted_at__isnull=True,
            ).exists()
            has_invite = OrganisationMemberInvite.objects.filter(
                invitee_email__iexact=email,
                organisation=org,
                valid=True,
                expires_at__gt=timezone.now(),
            ).exists()
            if not has_membership and not has_invite:
                logger.warning(
                    f"Blocked org SSO login: {email} not a member of or "
                    f"invited to {org.name}"
                )
                raise ValueError(
                    "This email is not authorised for this organisation."
                )
    else:
        # Instance-level: only reject on explicit False. Providers that
        # don't emit the claim (Microsoft work accounts, older OIDC) are
        # handled by the adapter-level trust of the IdP itself.
        if extra_data.get("email_verified") is False:
            logger.warning(f"Blocked instance SSO login: {email} not verified by IdP")
            raise ValueError("Email not verified by identity provider.")

    # Resolve the Django user. Look up by (provider, uid) FIRST — this IdP
    # identity may already be linked to a user whose email on the IdP side
    # has since changed. If we used the current email to resolve, we would
    # create a fresh CustomUser and orphan the existing one, taking every
    # OrganisationMember with it. Only fall back to email lookup (or user
    # creation) for IdP identities we've never seen before.
    try:
        sa = SocialAccount.objects.get(provider=provider, uid=uid)
        if org_config_id and not linked_member:
            # provider_id is shared across all orgs, so a malicious org IdP
            # could assert a victim's uid with an org-authorised email. Only
            # trust the uid when it's linked to a member of THIS org.
            logger.warning(
                f"Refused org SSO login: identity provider={provider} "
                f"uid={uid} is not linked to a member of {org.name}."
            )
            raise ValueError(
                _maybe_add_admin_contact(
                    "This sign-in identity is not linked to your Phase "
                    "account. Sign in with your existing method, then link "
                    "it from your account settings."
                )
            )
        user = sa.user
        sa.extra_data = extra_data
        # last_login is auto_now — update_fields must name it or the
        # last-used timestamp never advances on this fast path.
        sa.save(update_fields=["extra_data", "last_login"])
    except SocialAccount.DoesNotExist:
        # New (provider, uid). Refuse to silently bind it to an existing
        # email — the membership/invite gate above doesn't prove the IdP
        # speaks for the email (a malicious org admin can invite anyone).
        # Linking must be opt-in from an authenticated session.
        try:
            existing_user = User.objects.get(email=email)
        except User.DoesNotExist:
            existing_user = None

        if existing_user is not None:
            already_linked = SocialAccount.objects.filter(
                user=existing_user, provider=provider
            ).exists()
            if already_linked:
                # Same provider linked under a different uid — refuse
                # the silent re-link so the user can clean up
                # deliberately.
                logger.warning(
                    f"Refused SSO link: provider={provider} email={email} "
                    f"already linked under a different uid."
                )
                raise ValueError(
                    _maybe_add_admin_contact(
                        "This sign-in identity does not match the one "
                        "on file for this account."
                    )
                )

            # SCIM-provisioned members get an auto-link exception ONLY when
            # the existing CustomUser is otherwise blank — no prior
            # SocialAccount, no usable password, no OM in any other org.
            # The SCIM admin only vouches for emails *they own*, not
            # arbitrary global Phase users. Without these guards, an org
            # Owner with SCIM + org-SSO could provision any global email,
            # claim it via their IdP with an attacker-controlled UID, and
            # take over that user's session (auth_bypass).
            from api.models import SCIMUser

            scim_authorised = bool(
                org_config_id
                and SCIMUser.objects.filter(
                    user=existing_user,
                    organisation=org,
                    active=True,
                ).exists()
            )

            has_prior_identity = (
                SocialAccount.objects.filter(user=existing_user).exists()
                or existing_user.has_usable_password()
                or OrganisationMember.objects.filter(
                    user=existing_user, deleted_at__isnull=True
                )
                .exclude(organisation=org)
                .exists()
            )

            if not scim_authorised or has_prior_identity:
                logger.warning(
                    f"Refused silent SSO link: provider={provider} "
                    f"email={email} already has an account "
                    f"(scim_authorised={scim_authorised}, "
                    f"has_prior_identity={has_prior_identity})."
                )
                raise ValueError(
                    _maybe_add_admin_contact(
                        "An account with this email already exists. "
                        "Sign in using your existing authentication method.",
                        suffix=(
                            " Contact your administrator if you need "
                            "access to additional organisations."
                        ),
                    )
                )

            # Belt-and-braces: SCIM trust doesn't override an explicit
            # `email_verified=false` from the IdP this round-trip.
            if extra_data.get("email_verified") is False:
                logger.warning(
                    f"Refused SCIM auto-link: provider={provider} "
                    f"email={email} not verified by IdP."
                )
                raise ValueError(
                    _maybe_add_admin_contact(
                        "Email not verified by identity provider."
                    )
                )

            logger.info(
                f"Auto-linked SSO identity for SCIM-provisioned "
                f"user: provider={provider} email={email} "
                f"org={org.name}"
            )
            user = existing_user
            sa = SocialAccount.objects.create(
                provider=provider,
                uid=uid,
                user=user,
                extra_data=extra_data,
            )
        else:
            from api.views.auth_password import username_for_email

            user = User.objects.create_user(
                username=username_for_email(email),
                email=email,
                password=None,
            )
            sa = SocialAccount.objects.create(
                provider=provider,
                uid=uid,
                user=user,
                extra_data=extra_data,
            )

            # Fire allauth's signup signal so receivers (e.g. Slack
            # notifier) run for org-SSO signups. The instance-level
            # OAuth/OIDC flow goes through allauth and gets this for
            # free; this callback creates users manually and would
            # otherwise skip every receiver.
            try:
                from allauth.account.signals import user_signed_up

                user_signed_up.send(sender=user.__class__, request=request, user=user)
            except Exception:
                logger.exception("Failed to dispatch user_signed_up signal for %s", email)

    # Save the SocialToken if we have one
    if token and token.token:
        SocialToken.objects.update_or_create(
            account=sa,
            defaults={
                "token": token.token,
                "token_secret": getattr(token, "token_secret", "") or "",
                "app": token.app,
            },
        )

    # NOTE: login() is the caller's responsibility — for TOTP-enrolled
    # users the callback defers it until the code verifies.
    return user


def _post_login_redirect_path(user, user_email, org_config_id, org_id, return_to):
    """Destination path after a completed SSO login. Computed BEFORE any
    login()/deferral so the org-invite-wizard handoff survives the TOTP
    challenge round trip."""
    if is_safe_redirect_path(return_to):
        return return_to

    # Org-level SSO with no deep link: route the user to the
    # invite-acceptance wizard if they have a pending invite to this org
    # and aren't yet a member. Invite acceptance must run client-side
    # (mnemonic-derived keyring, deviceKey wrap), so we hand off to
    # /invite/<id> rather than stranding the user at /onboard.
    if org_config_id and org_id:
        from django.utils import timezone as _tz

        from api.models import OrganisationMember, OrganisationMemberInvite
        from api.utils.rest import encode_string_to_base64

        has_membership = OrganisationMember.objects.filter(
            user=user,
            organisation_id=org_id,
            deleted_at__isnull=True,
        ).exists()
        if not has_membership:
            pending_invite = OrganisationMemberInvite.objects.filter(
                invitee_email__iexact=user_email,
                organisation_id=org_id,
                valid=True,
                expires_at__gt=_tz.now(),
            ).first()
            if pending_invite is not None:
                invite_b64 = encode_string_to_base64(str(pending_invite.id))
                return f"/invite/{invite_b64}"

    return "/"


def _complete_link(request, social_login, token, *, org_config_id=None):
    """Bind the IdP identity from a completed OAuth round trip to the
    already-authenticated session user. This is the opt-in flow the login
    path's takeover guards defer to: no email-based trust gate is needed
    because the identity attaches to the session user, never to whichever
    account happens to share the IdP-claimed email.

    Never logs in, never creates users, never touches session auth keys.
    """
    from api.emails import send_identity_linked_email
    from api.models import OrganisationMember
    from api.views.identity import (
        identity_email,
        log_org_identity_events,
        provider_display_name,
    )

    user = request.user
    extra_data = social_login.account.extra_data or {}
    provider = social_login.account.provider
    uid = social_login.account.uid

    if extra_data.get("email_verified") is False:
        logger.warning(
            f"Refused identity link: provider={provider} email not verified by IdP."
        )
        raise ValueError("not_verified")

    if org_config_id:
        # Membership may have been revoked between authorize and callback.
        try:
            org_provider = OrganisationSSOProvider.objects.select_related(
                "organisation"
            ).get(id=org_config_id)
        except OrganisationSSOProvider.DoesNotExist:
            raise ValueError("link_failed")
        if not OrganisationMember.objects.filter(
            user=user,
            organisation=org_provider.organisation,
            deleted_at__isnull=True,
        ).exists():
            raise ValueError("not_a_member")

    sa = SocialAccount.objects.filter(provider=provider, uid=uid).first()
    if sa is not None:
        if sa.user_id != user.pk:
            logger.warning(
                f"Refused identity link: provider={provider} uid is linked to "
                f"another account (requester={user.userId}, owner={sa.user.userId})"
            )
            raise ValueError("identity_in_use")
        # Re-linking your own identity is an idempotent profile refresh.
        sa.extra_data = extra_data
        sa.save(update_fields=["extra_data", "last_login"])
        created = False
    else:
        # Same provider under a different uid is allowed (e.g. two
        # Microsoft tenants).
        sa = SocialAccount.objects.create(
            provider=provider,
            uid=uid,
            user=user,
            extra_data=extra_data,
        )
        created = True

    if token and token.token:
        SocialToken.objects.update_or_create(
            account=sa,
            defaults={
                "token": token.token,
                "token_secret": getattr(token, "token_secret", "") or "",
                "app": token.app,
            },
        )

    logger.info(
        json.dumps(
            {
                "event": "identity_linked",
                "user_id": str(user.userId),
                "provider": provider,
                "uid": uid,
                "created": created,
            }
        )
    )

    if created:
        log_org_identity_events(request, user, provider, "linked")
        try:
            send_identity_linked_email(
                request,
                user,
                provider_display_name(provider),
                identity_email(extra_data),
            )
        except Exception:
            logger.exception(
                "Failed to send identity_linked email to %s", user.email
            )

    return sa


def _exchange_code_for_token(token_url, payload, auth_method, client_id, client_secret):
    """Exchange an authorization code for tokens, supporting both
    client_secret_post and client_secret_basic authentication methods."""

    headers = {"Accept": "application/json"}
    # Work on a copy to avoid mutating the caller's dict
    body = dict(payload)

    if auth_method == "client_secret_basic":
        credentials = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
        headers["Authorization"] = f"Basic {credentials}"
        body.pop("client_id", None)
        body.pop("client_secret", None)

    resp = _safe_oidc_request("POST", token_url, data=body, headers=headers, timeout=15)
    resp.raise_for_status()
    return resp.json()


# --- /auth/me/ ---


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def auth_me(request):
    """Return the currently authenticated user's info."""
    user = request.user
    social_acc = user.socialaccount_set.first()

    avatar_url = None
    full_name = ""

    if social_acc:
        extra = social_acc.extra_data or {}
        avatar_url = (
            extra.get("avatar_url")  # GitHub
            or extra.get("picture")  # Google, standard OIDC
            or extra.get("photo")  # Microsoft Entra ID
            or extra.get("avatar")  # GitLab
        )
        full_name = extra.get("name", "")

    # A user-set display name takes precedence over whatever the first
    # linked provider reports (and survives unlinking that provider).
    if hasattr(user, "full_name") and user.full_name:
        full_name = user.full_name

    # Auth method from session (set at login time)
    auth_method = request.session.get("auth_method", "sso")
    auth_sso_org_id = request.session.get("auth_sso_org_id")

    return JsonResponse(
        {
            "userId": str(user.userId),
            "email": user.email,
            "fullName": full_name or user.email,
            "avatarUrl": avatar_url,
            "authMethod": auth_method,
            "authSsoOrgId": auth_sso_org_id,
            # Capability, not session state — a password account signed in
            # via a linked SSO provider still has (and must prove) it.
            "hasUsablePassword": user.has_usable_password(),
            # Lets the account page warn before a reauth-gated action;
            # advisory only — the freshness gates stay server-side.
            "authFreshUntil": auth_fresh_until(request),
        }
    )


# --- Org-level SSO Authorize ---


def _link_login_redirect(target, reauth):
    """Bounce a link attempt to /login when the session is missing or stale.
    The callbackUrl carries the provider (org config id or instance slug) so
    the account page resumes the link automatically after sign-in."""
    return_to = quote(f"/account?action=link&target={target}", safe="")
    suffix = "&reauth=1" if reauth else ""
    return redirect(f"{FRONTEND_URL}/login?callbackUrl={return_to}{suffix}")


class OrgSSOAuthorizeView(View):
    """
    GET /auth/sso/org/<config_id>/authorize/

    Loads SSO config from DB for the given org provider, builds the
    OIDC authorization URL, and redirects the user to the IdP.
    """

    def get(self, request, config_id):
        from api.utils.sso import get_org_sso_config

        try:
            org_provider, config = get_org_sso_config(config_id)
        except Exception:
            return JsonResponse(
                {"error": "SSO provider not found or not enabled."},
                status=404,
            )

        # Build issuer + callback from provider registry
        from api.utils.sso import get_org_provider_meta, resolve_issuer

        meta = get_org_provider_meta(org_provider.provider_type)
        if not meta:
            return JsonResponse({"error": "Unsupported provider type."}, status=400)

        # ?intent=link: attach this IdP identity to the signed-in account
        # instead of signing in. Members only.
        link_intent = request.GET.get("intent") == "link"
        if link_intent:
            from api.models import OrganisationMember

            if not request.user.is_authenticated:
                return _link_login_redirect(org_provider.id, reauth=False)
            if not session_is_fresh(request):
                return _link_login_redirect(org_provider.id, reauth=True)
            if not OrganisationMember.objects.filter(
                user=request.user,
                organisation=org_provider.organisation,
                deleted_at__isnull=True,
            ).exists():
                return redirect(f"{FRONTEND_URL}/account?error=not_a_member")

        issuer = resolve_issuer(org_provider.provider_type, config)
        if not issuer:
            return JsonResponse(
                {"error": "Could not determine OIDC issuer."}, status=400
            )

        endpoints = _get_oidc_endpoints(issuer)
        if not endpoints:
            return JsonResponse(
                {
                    "error": "Failed to discover OIDC endpoints. Please check OIDC configuration."
                },
                status=502,
            )

        callback_url = _get_callback_url(meta["callback_slug"])

        state = secrets.token_urlsafe(32)
        nonce = secrets.token_urlsafe(32)

        request.session["sso_state"] = state
        request.session["sso_provider"] = meta["callback_slug"]
        request.session["sso_callback_url"] = callback_url
        request.session["sso_token_url"] = endpoints["token_url"]
        request.session["sso_nonce"] = nonce
        # Mark this as org-level SSO so the callback loads config from DB
        request.session["sso_org_config_id"] = str(org_provider.id)

        if link_intent:
            request.session["sso_link_user_id"] = str(request.user.userId)
            # Bind the marker to this round trip's state so only its own
            # callback can claim it.
            request.session["sso_link_state"] = state
            request.session["sso_return_to"] = "/account"
        else:
            # An abandoned link flow must not contaminate a later login —
            # clear both the marker and any /account return destination it
            # left behind.
            request.session.pop("sso_link_user_id", None)
            request.session.pop("sso_link_state", None)
            request.session.pop("sso_return_to", None)

        # djangorestframework_camel_case.CamelCaseMiddleWare rewrites
        # incoming query params from camelCase to snake_case, so the
        # frontend's ?callbackUrl= arrives here as 'callback_url'. Read both
        # for safety.
        callback_url_param = request.GET.get("callback_url") or request.GET.get(
            "callbackUrl"
        )
        if callback_url_param:
            request.session["sso_return_to"] = callback_url_param

        request.session.save()

        params = {
            "client_id": config["client_id"],
            "redirect_uri": callback_url,
            "scope": meta.get("scopes", "openid profile email"),
            "state": state,
            "response_type": "code",
            "nonce": nonce,
        }

        authorize_url = endpoints["authorize_url"]
        parsed = urlparse(authorize_url)
        if not parsed.scheme == "https" or not parsed.netloc:
            return JsonResponse({"error": "Invalid authorize URL"}, status=500)

        full_url = f"{authorize_url}?{urlencode(params)}"
        return redirect(full_url)


# --- SSO Authorize ---


class SSOAuthorizeView(View):
    """
    GET /auth/sso/<provider>/authorize/

    Builds the OAuth authorization URL and redirects the user's browser
    to the identity provider.
    """

    def get(self, request, provider):
        if provider not in SSO_PROVIDER_REGISTRY:
            return JsonResponse(
                {"error": f"SSO provider '{provider}' is not configured."},
                status=404,
            )

        # Clear any stale org-SSO marker from an abandoned org-level flow
        # so the callback dispatches as instance-level.
        request.session.pop("sso_org_config_id", None)

        # ?intent=link: attach this IdP identity to the signed-in account
        # instead of signing in. Members only.
        link_intent = request.GET.get("intent") == "link"
        if link_intent:
            if not request.user.is_authenticated:
                return _link_login_redirect(provider, reauth=False)
            if not session_is_fresh(request):
                return _link_login_redirect(provider, reauth=True)

        config = SSO_PROVIDER_REGISTRY[provider]
        callback_url = _get_callback_url(provider)

        if config.get("is_oidc"):
            endpoints = _get_oidc_endpoints(config["issuer"])
            if not endpoints:
                return JsonResponse(
                    {"error": f"Failed to discover OIDC endpoints for {provider}"},
                    status=502,
                )
            authorize_url = endpoints["authorize_url"]
            request.session["sso_token_url"] = endpoints["token_url"]
        else:
            authorize_url = config["authorize_url"]
            request.session["sso_token_url"] = config["token_url"]

        state = secrets.token_urlsafe(32)
        request.session["sso_state"] = state
        request.session["sso_provider"] = provider
        request.session["sso_callback_url"] = callback_url

        if link_intent:
            request.session["sso_link_user_id"] = str(request.user.userId)
            # Bind the marker to this round trip's state so only its own
            # callback can claim it.
            request.session["sso_link_state"] = state
            request.session["sso_return_to"] = "/account"
        else:
            # An abandoned link flow must not contaminate a later login —
            # clear both the marker and any /account return destination it
            # left behind.
            request.session.pop("sso_link_user_id", None)
            request.session.pop("sso_link_state", None)
            request.session.pop("sso_return_to", None)

        # Preserve the original deep link so the user lands on the page
        # they requested after SSO completes (e.g. /team/settings)
        callback_url_param = request.GET.get("callback_url") or request.GET.get(
            "callbackUrl"
        )
        if callback_url_param:
            request.session["sso_return_to"] = callback_url_param

        request.session.save()

        params = {
            "client_id": config["client_id"],
            "redirect_uri": callback_url,
            "scope": config["scopes"],
            "state": state,
            "response_type": "code",
        }

        extra_params = config.get("extra_auth_params", {})
        params.update(extra_params)

        if config.get("is_oidc"):
            nonce = secrets.token_urlsafe(32)
            request.session["sso_nonce"] = nonce
            params["nonce"] = nonce

        # Validate that the authorize URL is from a trusted origin before redirecting.
        # For non-OIDC providers this comes from the static registry; for OIDC providers
        # it comes from the discovery document fetched from the configured issuer.
        parsed = urlparse(authorize_url)
        if not parsed.scheme == "https" or not parsed.netloc:
            return JsonResponse({"error": "Invalid authorize URL"}, status=500)

        full_url = f"{authorize_url}?{urlencode(params)}"
        return redirect(full_url)


# --- SSO Callback ---


class SSOCallbackView(View):
    """
    GET /auth/sso/<provider>/callback/

    Handles the OAuth callback: validates state, exchanges code for tokens,
    enforces domain whitelist, completes login via allauth adapters.
    """

    def get(self, request, provider):
        # Peek (don't pop) the link marker so a failed/stray callback can't
        # consume it and demote a concurrent link round trip into a login.
        # It's only claimed once its OWN state validates (below).
        pending_link_user_id = request.session.get("sso_link_user_id")

        def _fail(code):
            dest = "/account" if pending_link_user_id else "/login"
            return redirect(f"{FRONTEND_URL}{dest}?error={quote(str(code), safe='')}")

        error = request.GET.get("error")
        if error:
            # Redirect to a fixed URL with a safe error parameter.
            # error_desc is from the IdP — quote it to prevent injection.
            error_desc = request.GET.get("error_description", error)
            return _fail(error_desc)

        code = request.GET.get("code")
        state = request.GET.get("state")

        if not code or not state:
            return _fail("missing_code_or_state")

        expected_state = request.session.get("sso_state")
        if not expected_state or state != expected_state:
            return _fail("invalid_state")
        # State is single-use — drop it before anything else can fail.
        request.session.pop("sso_state", None)

        # Claim link mode only for the round trip that started it: the link
        # marker is bound to its initiating OAuth state. A concurrent login
        # (or a superseded link attempt) carrying a different state leaves
        # the marker untouched for its own matching callback.
        link_state = request.session.get("sso_link_state")
        if pending_link_user_id and link_state == state:
            link_user_id = pending_link_user_id
            request.session.pop("sso_link_user_id", None)
            request.session.pop("sso_link_state", None)
        else:
            link_user_id = None

        # Bind the link to its initiator: the session must still belong to
        # the user who started the link flow.
        if link_user_id and (
            not request.user.is_authenticated
            or str(request.user.userId) != link_user_id
        ):
            return _fail("session_changed")

        # Freshness is gated at authorize, but the OAuth round trip can be
        # parked arbitrarily long (the marker rides the 7-day session).
        # Re-check here so a link can't complete from a session that went
        # stale mid-flow — auth_time isn't refreshed during the round trip.
        if link_user_id and not session_is_fresh(request):
            return _fail("link_session_stale")

        # Check if this is an org-level SSO callback
        org_config_id = request.session.get("sso_org_config_id")
        if org_config_id:
            from api.utils.sso import get_org_sso_config

            try:
                org_provider, org_config = get_org_sso_config(org_config_id)
            except Exception:
                return _fail("sso_config_not_found")

            from api.utils.sso import get_org_provider_meta

            adapter_info = get_org_provider_meta(org_provider.provider_type)
            if not adapter_info:
                return _fail("unsupported_provider")

            config = {**org_config, **adapter_info, "is_oidc": True}

        elif provider not in SSO_PROVIDER_REGISTRY:
            return _fail("unknown_provider")
        else:
            config = SSO_PROVIDER_REGISTRY[provider]

        callback_url = request.session.get(
            "sso_callback_url", _get_callback_url(provider)
        )
        token_url = request.session.get("sso_token_url", config.get("token_url", ""))

        # Exchange code for tokens
        token_payload = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": callback_url,
            "client_id": config["client_id"],
            "client_secret": config["client_secret"],
        }

        try:
            token_data = _exchange_code_for_token(
                token_url,
                token_payload,
                config.get("token_auth_method", "client_secret_post"),
                config["client_id"],
                config["client_secret"],
            )
        except Exception as e:
            logger.error(f"Token exchange failed for {provider}: {e}")
            return _fail("token_exchange_failed")

        access_token = token_data.get("access_token")
        if not access_token:
            return _fail("no_access_token")

        try:
            from api.views.auth_mfa import set_mfa_pending

            if link_user_id:
                # Suppresses the login-alert emails adapters send from
                # complete_login — no login happens in link mode.
                request.sso_link_mode = True

            adapter = _get_adapter_instance(config, request)

            # Use a persisted SocialApp so SocialToken ForeignKeys work.
            # For org-level SSO, scope the SocialApp to the config_id so
            # multiple orgs configuring the same provider_id don't
            # overwrite each other's credentials.
            app = _get_or_create_social_app(config, org_config_id=org_config_id)

            token = SocialToken(token=access_token, app=app)
            if token_data.get("refresh_token"):
                token.token_secret = token_data["refresh_token"]

            social_login = adapter.complete_login(
                request, app, token, response=token_data
            )
            social_login.token = token
            social_login.state = SocialLogin.state_from_request(request)

            # Email domain whitelist enforcement
            user_email = (
                social_login.user.email
                if social_login.user and social_login.user.email
                else social_login.account.extra_data.get("email", "")
            )
            if not _check_email_domain_allowed(user_email):
                logger.warning(
                    f"SSO login blocked: {user_email} not in domain whitelist"
                )
                return _fail("email_domain_not_allowed")

            # Handle user creation/linking and login directly.
            # We bypass allauth's complete_social_login because its
            # redirect-based signup/connect flow doesn't work in a
            # backend-driven OAuth callback (causes assertion errors
            # and 302 redirects to non-existent signup pages).
            try:
                if link_user_id:
                    _complete_link(
                        request, social_login, token, org_config_id=org_config_id
                    )
                else:
                    user = _complete_login_bypassing_allauth(
                        request, social_login, token, org_config_id=org_config_id
                    )
            except ValueError as e:
                mode = "link" if link_user_id else "login"
                logger.warning(f"SSO {mode} rejected: {e}")
                return _fail(str(e))

            if link_user_id:
                for key in [
                    "sso_state",
                    "sso_provider",
                    "sso_callback_url",
                    "sso_token_url",
                    "sso_nonce",
                    "sso_org_config_id",
                    "sso_return_to",
                ]:
                    request.session.pop(key, None)
                linked = quote(social_login.account.provider, safe="")
                return redirect(f"{FRONTEND_URL}/account?linked={linked}")

            if user is None:
                logger.warning(f"SSO login failed to authenticate user for {provider}")
                return _fail("login_failed")

            # Resolve the SSO provider config to its org ID
            sso_org_id = None
            sso_provider_id = None
            if org_config_id:
                try:
                    sso_provider_obj = OrganisationSSOProvider.objects.get(
                        id=org_config_id
                    )
                    sso_org_id = str(sso_provider_obj.organisation_id)
                    sso_provider_id = str(sso_provider_obj.id)
                except OrganisationSSOProvider.DoesNotExist:
                    pass

            # Compute the destination BEFORE any login/deferral so the
            # invite-wizard handoff survives the TOTP challenge.
            return_to = request.session.pop("sso_return_to", None)
            dest = _post_login_redirect_path(
                user, user_email, org_config_id, sso_org_id, return_to
            )

            sso_session_keys = [
                "sso_state",
                "sso_provider",
                "sso_callback_url",
                "sso_token_url",
                "sso_nonce",
                "sso_org_config_id",
            ]

            if user_has_active_totp(user):
                # Defer login: stash the pending context and challenge the
                # user for a TOTP code before any session is issued.
                set_mfa_pending(request.session, user, "sso")
                if sso_org_id:
                    request.session["mfa_pending_sso_org_id"] = sso_org_id
                if sso_provider_id:
                    request.session["mfa_pending_sso_provider_id"] = sso_provider_id
                request.session["mfa_pending_return_to"] = dest
                for key in sso_session_keys:
                    request.session.pop(key, None)
                return redirect(f"{FRONTEND_URL}/login/mfa")

            # Log the user in (sets the Django session)
            login(request, user)

            # Tag session with auth method
            request.session["auth_method"] = "sso"
            stamp_auth_time(request)
            if sso_org_id:
                request.session["auth_sso_org_id"] = sso_org_id
            if sso_provider_id:
                request.session["auth_sso_provider_id"] = sso_provider_id

            for key in sso_session_keys:
                request.session.pop(key, None)

            return redirect(FRONTEND_URL + dest)

        except Exception as e:
            logger.exception(f"SSO callback error for {provider}")
            return _fail("authentication_failed")


# Build the registry on module load
_build_provider_registry()
