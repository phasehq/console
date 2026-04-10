import os
import time
import base64
import secrets
import logging
import threading
import requests as http_requests
from urllib.parse import urlencode, quote

from django.conf import settings
from django.contrib.auth import login, get_user_model
from django.http import JsonResponse
from django.shortcuts import redirect
from django.views import View

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.throttling import AnonRateThrottle

from allauth.socialaccount.models import SocialApp, SocialAccount, SocialToken, SocialLogin

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


# --- OIDC Discovery Cache ---

_oidc_cache = {}
_oidc_cache_lock = threading.Lock()
_OIDC_CACHE_TTL = 3600  # 1 hour


def _get_oidc_endpoints(issuer):
    """Fetch OIDC discovery document with a TTL cache."""
    now = time.time()

    with _oidc_cache_lock:
        cached = _oidc_cache.get(issuer)
        if cached and (now - cached["fetched_at"]) < _OIDC_CACHE_TTL:
            return cached["endpoints"]

    discovery_url = f"{issuer.rstrip('/')}/.well-known/openid-configuration"
    try:
        resp = http_requests.get(discovery_url, timeout=10)
        resp.raise_for_status()
        config = resp.json()
        endpoints = {
            "authorize_url": config["authorization_endpoint"],
            "token_url": config["token_endpoint"],
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

        scopes = " ".join(provider_settings.get("SCOPE", ["openid", "email", "profile"]))

        SSO_PROVIDER_REGISTRY[slug] = {
            "client_id": app_cfg["client_id"],
            "client_secret": app_cfg.get("secret", ""),
            "issuer": issuer,
            "scopes": scopes,
            "adapter_module": oidc_cfg["adapter_module"],
            "adapter_class": oidc_cfg["adapter_class"],
            "provider_id": oidc_cfg["provider_id"],
            "token_auth_method": oidc_cfg.get("token_auth_method", "client_secret_post"),
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


def _get_or_create_social_app(config):
    """Get or create a persisted SocialApp so that SocialToken ForeignKeys work."""
    app, created = SocialApp.objects.get_or_create(
        provider=config["provider_id"],
        defaults={
            "name": config["provider_id"],
            "client_id": config["client_id"],
            "secret": config["client_secret"],
        },
    )
    if not created:
        # Update credentials if they changed in settings
        changed = False
        if app.client_id != config["client_id"]:
            app.client_id = config["client_id"]
            changed = True
        if app.secret != config["client_secret"]:
            app.secret = config["client_secret"]
            changed = True
        if changed:
            app.save()
    return app


def _complete_login_bypassing_allauth(request, social_login, token):
    """Handle user creation/linking and login directly, bypassing
    allauth's complete_social_login which has complex redirect-based
    flows (signup forms, account-connect pages) that don't work in
    a backend-driven OAuth callback.

    This replicates the net effect of what dj_rest_auth + allauth do
    together: find/create user by email, link the social account,
    save the token, and log in.
    """
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

    # Find or create the Django user
    try:
        user = User.objects.get(email=email)
    except User.DoesNotExist:
        user = User.objects.create_user(
            username=email,
            email=email,
            password=None,
        )

    # Find or create the SocialAccount linking this provider to the user
    sa, created = SocialAccount.objects.update_or_create(
        provider=social_login.account.provider,
        uid=social_login.account.uid,
        defaults={
            "user": user,
            "extra_data": extra_data,
        },
    )

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

    # Log the user in (sets the Django session)
    login(request, user)

    return user


def _exchange_code_for_token(token_url, payload, auth_method, client_id, client_secret):
    """Exchange an authorization code for tokens, supporting both
    client_secret_post and client_secret_basic authentication methods."""

    headers = {"Accept": "application/json"}
    # Work on a copy to avoid mutating the caller's dict
    body = dict(payload)

    if auth_method == "client_secret_basic":
        credentials = base64.b64encode(
            f"{client_id}:{client_secret}".encode()
        ).decode()
        headers["Authorization"] = f"Basic {credentials}"
        body.pop("client_id", None)
        body.pop("client_secret", None)

    resp = http_requests.post(token_url, data=body, headers=headers, timeout=15)
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

    # full_name field on the user model (available after migration is applied)
    if not full_name and hasattr(user, "full_name") and user.full_name:
        full_name = user.full_name

    return JsonResponse(
        {
            "userId": str(user.userId),
            "email": user.email,
            "fullName": full_name or user.email,
            "avatarUrl": avatar_url,
            "authMethod": getattr(user, "auth_method", "sso"),
        }
    )


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

        # Preserve the original deep link so the user lands on the page
        # they requested after SSO completes (e.g. /team/settings)
        callback_url_param = request.GET.get("callbackUrl")
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
        error = request.GET.get("error")
        if error:
            error_desc = request.GET.get("error_description", error)
            return redirect(f"{FRONTEND_URL}/login?error={quote(error_desc)}")

        code = request.GET.get("code")
        state = request.GET.get("state")

        if not code or not state:
            return redirect(f"{FRONTEND_URL}/login?error=missing_code_or_state")

        expected_state = request.session.get("sso_state")
        if not expected_state or state != expected_state:
            return redirect(f"{FRONTEND_URL}/login?error=invalid_state")

        if provider not in SSO_PROVIDER_REGISTRY:
            return redirect(f"{FRONTEND_URL}/login?error=unknown_provider")

        config = SSO_PROVIDER_REGISTRY[provider]
        callback_url = request.session.get("sso_callback_url", _get_callback_url(provider))
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
            return redirect(f"{FRONTEND_URL}/login?error=token_exchange_failed")

        access_token = token_data.get("access_token")
        if not access_token:
            return redirect(f"{FRONTEND_URL}/login?error=no_access_token")

        try:
            adapter = _get_adapter_instance(config, request)

            # Use a persisted SocialApp so SocialToken ForeignKeys work
            app = _get_or_create_social_app(config)

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
                return redirect(
                    f"{FRONTEND_URL}/login?error=email_domain_not_allowed"
                )

            # Handle user creation/linking and login directly.
            # We bypass allauth's complete_social_login because its
            # redirect-based signup/connect flow doesn't work in a
            # backend-driven OAuth callback (causes assertion errors
            # and 302 redirects to non-existent signup pages).
            _complete_login_bypassing_allauth(request, social_login, token)

            if not request.user.is_authenticated:
                logger.warning(f"SSO login failed to authenticate user for {provider}")
                return redirect(f"{FRONTEND_URL}/login?error=login_failed")

            # Restore the original deep link, then clean up SSO session data
            return_to = request.session.pop("sso_return_to", None)
            for key in ["sso_state", "sso_provider", "sso_callback_url", "sso_token_url", "sso_nonce"]:
                request.session.pop(key, None)

            if return_to and return_to.startswith("/"):
                return redirect(FRONTEND_URL + return_to)
            return redirect(FRONTEND_URL + "/")

        except Exception as e:
            logger.exception(f"SSO callback error for {provider}")
            return redirect(f"{FRONTEND_URL}/login?error=authentication_failed")


# Build the registry on module load
_build_provider_registry()
