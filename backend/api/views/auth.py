import requests
import os
import secrets as pysecrets
from urllib.parse import urlparse, urlencode
from django.apps import apps
from django.core.exceptions import ValidationError
from django.shortcuts import redirect
from django.utils.http import url_has_allowed_host_and_scheme
from django.views.decorators.http import require_POST
from django.views.decorators.csrf import csrf_exempt
from api.utils.syncing.auth import store_oauth_token
from api.utils.access.permissions import user_has_permission

from backend.utils.secrets import get_secret
from api.serializers import (
    ServiceAccountTokenSerializer,
    ServiceTokenSerializer,
    UserTokenSerializer,
)
from api.models import ServiceAccountToken, ServiceToken, UserToken
from api.utils.rest import (
    get_token_type,
    token_is_expired_or_deleted,
)
from django.conf import settings
from django.contrib.auth import logout
from django.http import JsonResponse
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from api.throttling import PlanBasedRateThrottle
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework import status

# First configured origin — ALLOWED_ORIGINS may hold a comma-separated list.
FRONTEND_URL = os.getenv("ALLOWED_ORIGINS", "").split(",")[0].strip()

GITHUB_INTEGRATION_SCOPE = "user,repo,admin:repo_hook,admin:org"


@require_POST
def logout_view(request):
    logout(request)
    return JsonResponse({"message": "Logged out"})


@api_view(["GET"])
@permission_classes([AllowAny])
def health_check(request):
    return JsonResponse({"status": "alive", "version": settings.VERSION})


@permission_classes([AllowAny])
def root_endpoint(request):
    return JsonResponse(
        {
            "message": "API is alive. Please see https://docs.phase.dev/public-api for documentation on available endpoints.",
            "status": "ok",
        },
    )


def user_token_kms(request):
    auth_token = request.headers["authorization"]

    token = auth_token.split(" ")[2]

    user_token = UserToken.objects.get(token=token)

    serializer = UserTokenSerializer(user_token)

    return Response(serializer.data, status=status.HTTP_200_OK)


def service_token_kms(request):
    auth_token = request.headers["authorization"]

    token = auth_token.split(" ")[2]

    token_type = get_token_type(auth_token)

    if token_type == "Service":
        service_token = ServiceToken.objects.get(token=token)
        serializer = ServiceTokenSerializer(service_token)

    elif token_type == "ServiceAccount":
        service_token = ServiceAccountToken.objects.get(token=token)
        serializer = ServiceAccountTokenSerializer(service_token)

    return Response(serializer.data, status=status.HTTP_200_OK)


@api_view(["GET"])
@permission_classes(
    [
        AllowAny,
    ]
)
@throttle_classes([PlanBasedRateThrottle])
def secrets_tokens(request):
    auth_token = request.headers["authorization"]

    if token_is_expired_or_deleted(auth_token):
        return JsonResponse({"error": "Token expired or deleted"}, status=403)

    token_type = get_token_type(auth_token)

    if token_type == "Service" or token_type == "ServiceAccount":
        return service_token_kms(request)
    elif token_type == "User":
        return user_token_kms(request)
    else:
        return JsonResponse({"error": "Invalid token type"}, status=403)


def _github_callback_redirect_uri():
    """redirect_uri registered with the GitHub app — must match at authorize and token exchange."""
    return f"{FRONTEND_URL}/service/oauth/github/callback"


def _safe_return_url(candidate):
    """Only allow same-origin root-relative redirect targets (open-redirect guard)."""
    if (
        isinstance(candidate, str)
        and candidate.startswith("/")
        and url_has_allowed_host_and_scheme(candidate, allowed_hosts=None)
    ):
        return candidate
    return "/"


def _github_param(request, *names):
    """Read a POST param under any spelling — CamelCaseMiddleWare may snake_case it."""
    for name in names:
        value = request.POST.get(name)
        if value is not None:
            return value
    return None


@csrf_exempt
@require_POST
def github_integration_authorize(request):
    """Begin the GitHub secret-sync OAuth flow (POST-only, session-bound).

    csrf_exempt matches the app's SameSite-based CSRF posture (graphql/logout);
    POST-only + SameSite already blocks cross-site initiation. App-wide CSRF
    tokens are a separate change."""
    if not request.user.is_authenticated:
        return redirect(f"{FRONTEND_URL}/login?error=login_required")

    org_id = _github_param(request, "org_id", "orgId")
    name = _github_param(request, "name") or "GitHub OAuth credentials"
    return_url = _safe_return_url(_github_param(request, "return_url", "returnUrl"))

    if not org_id:
        return redirect(f"{FRONTEND_URL}{return_url}?error=missing_org")

    Organisation = apps.get_model("api", "Organisation")
    try:
        org = Organisation.objects.get(id=org_id)
    except (Organisation.DoesNotExist, ValidationError, ValueError):
        return redirect(f"{FRONTEND_URL}{return_url}?error=org_not_found")

    if not user_has_permission(
        request.user, "create", "IntegrationCredentials", org
    ):
        return redirect(f"{FRONTEND_URL}{return_url}?error=permission_denied")

    # Cloud pins github.com (never send the shared secret to a caller's host).
    # Self-hosted's GHE host is browser-supplied but session-bound, so not forgeable.
    is_cloud = settings.APP_HOST == "cloud"
    is_enterprise = (
        False
        if is_cloud
        else str(_github_param(request, "is_enterprise", "isEnterprise") or "").lower()
        in ("true", "1")
    )

    if is_enterprise:
        host_url = (_github_param(request, "host_url", "hostUrl") or "").strip()
        api_url = (_github_param(request, "api_url", "apiUrl") or "").strip()
        parsed_host = urlparse(host_url)
        if parsed_host.scheme not in ("https", "http") or not parsed_host.netloc:
            return redirect(f"{FRONTEND_URL}{return_url}?error=invalid_host_url")
        if not api_url:
            api_url = f"{host_url.rstrip('/')}/api/v3"
    else:
        host_url = "https://github.com"
        api_url = "https://api.github.com"

    client_id = (
        os.getenv("GITHUB_ENTERPRISE_INTEGRATION_CLIENT_ID")
        if is_enterprise
        else os.getenv("GITHUB_INTEGRATION_CLIENT_ID")
    )
    if not client_id:
        return redirect(
            f"{FRONTEND_URL}{return_url}?error=integration_not_configured"
        )

    state = pysecrets.token_urlsafe(32)
    request.session["gh_int_state"] = state
    request.session["gh_int_org_id"] = str(org.id)
    request.session["gh_int_host_url"] = host_url
    request.session["gh_int_api_url"] = api_url
    request.session["gh_int_is_enterprise"] = is_enterprise
    request.session["gh_int_name"] = name
    request.session["gh_int_return_url"] = return_url
    request.session.save()

    params = {
        "client_id": client_id,
        "redirect_uri": _github_callback_redirect_uri(),
        "scope": GITHUB_INTEGRATION_SCOPE,
        "state": state,
        "prompt": "consent",
    }
    authorize_url = f"{host_url}/login/oauth/authorize"
    return redirect(f"{authorize_url}?{urlencode(params)}")


def github_integration_callback(request):
    """Complete the OAuth flow — trusted params come from the session set in
    authorize (gated by the state nonce), never from the request."""
    state = request.GET.get("state")
    expected_state = request.session.get("gh_int_state")

    # Reject anything not tied to a session we started (blocks unauth callers).
    if not state or not expected_state or state != expected_state:
        return redirect(f"{FRONTEND_URL}/?error=invalid_state")

    # One-time use: consume the flow state regardless of outcome.
    org_id = request.session.get("gh_int_org_id")
    host_url = request.session.get("gh_int_host_url", "https://github.com")
    api_url = request.session.get("gh_int_api_url", "https://api.github.com")
    is_enterprise = request.session.get("gh_int_is_enterprise", False)
    name = request.session.get("gh_int_name")
    return_url = _safe_return_url(request.session.get("gh_int_return_url", "/"))
    for key in (
        "gh_int_state",
        "gh_int_org_id",
        "gh_int_host_url",
        "gh_int_api_url",
        "gh_int_is_enterprise",
        "gh_int_name",
        "gh_int_return_url",
    ):
        request.session.pop(key, None)

    # Re-verify the caller still holds the permission the flow was started with.
    if not request.user.is_authenticated:
        return redirect(f"{FRONTEND_URL}/login?error=login_required")

    Organisation = apps.get_model("api", "Organisation")
    try:
        org = Organisation.objects.get(id=org_id)
    except (Organisation.DoesNotExist, ValidationError, ValueError):
        return redirect(f"{FRONTEND_URL}{return_url}?error=org_not_found")

    if not user_has_permission(
        request.user, "create", "IntegrationCredentials", org
    ):
        return redirect(f"{FRONTEND_URL}{return_url}?error=permission_denied")

    if request.GET.get("error"):
        # User denied the OAuth consent
        return redirect(f"{FRONTEND_URL}{return_url}?error=access_denied")

    code = request.GET.get("code")
    if not code:
        return redirect(f"{FRONTEND_URL}{return_url}?error=missing_code")

    # Defense in depth: scheme sanity check on the session-provided host.
    parsed_host = urlparse(host_url)
    if parsed_host.scheme not in ("https", "http") or not parsed_host.netloc:
        return redirect(f"{FRONTEND_URL}{return_url}?error=invalid_host_url")

    client_id = (
        os.getenv("GITHUB_ENTERPRISE_INTEGRATION_CLIENT_ID")
        if is_enterprise
        else os.getenv("GITHUB_INTEGRATION_CLIENT_ID")
    )
    client_secret = (
        get_secret("GITHUB_ENTERPRISE_INTEGRATION_CLIENT_SECRET")
        if is_enterprise
        else get_secret("GITHUB_INTEGRATION_CLIENT_SECRET")
    )

    # Exchange code for token; allow_redirects=False stops the host bouncing the secret onward.
    response = requests.post(
        f"{host_url}/login/oauth/access_token",
        headers={"Accept": "application/json"},
        data={
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
            "redirect_uri": _github_callback_redirect_uri(),
        },
        allow_redirects=False,
    )

    access_token = response.json().get("access_token")
    if not access_token:
        return redirect(f"{FRONTEND_URL}{return_url}?error=token_exchange_failed")

    store_oauth_token("github", name, access_token, host_url, api_url, str(org.id))

    # Redirect back to Next.js app
    return redirect(f"{FRONTEND_URL}{return_url}")
