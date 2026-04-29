import requests
import json
import base64
import os
from django.shortcuts import redirect
from django.views.decorators.http import require_POST
from api.utils.syncing.auth import store_oauth_token

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


def github_integration_callback(request):
    error = request.GET.get("error")
    state = request.GET.get("state")

    # Safely decode the state so we always have the original returnUrl
    state_decoded = base64.b64decode(state).decode("utf-8")
    state = json.loads(state_decoded)
    original_url = state.get("returnUrl", "/")

    if error:
        # User denied the OAuth consent
        return redirect(
            f"{os.getenv('ALLOWED_ORIGINS')}{original_url}?error=access_denied"
        )

    code = request.GET.get("code")
    if not code:
        # Something went wrong (missing code)
        return redirect(
            f"{os.getenv('ALLOWED_ORIGINS')}{original_url}?error=missing_code"
        )

    is_enterprise = bool(state.get("isEnterprise", False))
    host_url = state.get("hostUrl", "https://github.com")
    api_url = state.get("apiUrl", "https://github.com")
    org_id = state.get("orgId")
    name = state.get("name")

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

    # Exchange code for token
    response = requests.post(
        f"{host_url}/login/oauth/access_token",
        headers={"Accept": "application/json"},
        data={
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
            "redirect_uri": f"{os.getenv('ALLOWED_ORIGINS')}/service/oauth/github/callback",
        },
    )

    access_token = response.json().get("access_token")
    if not access_token:
        return redirect(
            f"{os.getenv('ALLOWED_ORIGINS')}{original_url}?error=token_exchange_failed"
        )

    store_oauth_token("github", name, access_token, host_url, api_url, org_id)

    # Redirect back to Next.js app
    return redirect(f"{os.getenv('ALLOWED_ORIGINS')}{original_url}")
