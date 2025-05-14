import requests
import json
import base64
import os
from django.shortcuts import redirect
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
from django.http import JsonResponse
from api.authentication.adapters.gitlab import CustomGitLabOAuth2Adapter
from api.authentication.adapters.google import CustomGoogleOAuth2Adapter
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework import status

from dj_rest_auth.registration.views import SocialLoginView
from allauth.socialaccount.providers.oauth2.client import OAuth2Client
from django.conf import settings
from ee.authentication.sso.oidc.util.google.views import (
    GoogleOpenIDConnectAdapter,
)
from ee.authentication.sso.oidc.util.jumpcloud.views import (
    JumpCloudOpenIDConnectAdapter,
)
from ee.authentication.sso.oidc.entraid.views import CustomMicrosoftGraphOAuth2Adapter


CLOUD_HOSTED = settings.APP_HOST == "cloud"


if getattr(settings, "GITHUB_ENTERPRISE_ENABLED", False):
    from ee.authentication.adapters.github_enterprise import (
        GitHubEnterpriseOAuth2Adapter as GitHubAdapter,
    )
else:
    from backend.api.authentication.adapters.github import (
        CustomGitHubOAuth2Adapter as GitHubAdapter,
    )


class GoogleLoginView(SocialLoginView):
    authentication_classes = []
    adapter_class = CustomGoogleOAuth2Adapter
    callback_url = settings.OAUTH_REDIRECT_URI
    client_class = OAuth2Client


class GitHubLoginView(SocialLoginView):
    authentication_classes = []
    adapter_class = GitHubAdapter
    callback_url = settings.OAUTH_REDIRECT_URI
    client_class = OAuth2Client


class GitLabLoginView(SocialLoginView):
    authentication_classes = []
    adapter_class = CustomGitLabOAuth2Adapter
    callback_url = settings.OAUTH_REDIRECT_URI
    client_class = OAuth2Client


class OIDCLoginView(SocialLoginView):
    authentication_classes = []
    adapter_class = GoogleOpenIDConnectAdapter
    callback_url = settings.OAUTH_REDIRECT_URI
    client_class = OAuth2Client


class JumpCloudLoginView(SocialLoginView):
    authentication_classes = []
    adapter_class = JumpCloudOpenIDConnectAdapter
    callback_url = settings.OAUTH_REDIRECT_URI
    client_class = OAuth2Client


class EntraIDLoginView(SocialLoginView):
    authentication_classes = []
    adapter_class = CustomMicrosoftGraphOAuth2Adapter
    callback_url = settings.OAUTH_REDIRECT_URI
    client_class = OAuth2Client

    def get_adapter(self, request):
        """
        Initialize the adapter with the request
        """
        adapter = self.adapter_class(request=request)
        return adapter

    def post(self, request, *args, **kwargs):
        """Override to ensure adapter initialization is correct"""
        self.request = request
        return super().post(request, *args, **kwargs)


def logout_view(request):
    logout(request)
    return JsonResponse({"message": "Logged out"})


@api_view(["GET"])
@permission_classes([AllowAny])
def health_check(request):
    return JsonResponse({"status": "alive", "version": settings.VERSION})


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


def github_callback(request):
    code = request.GET.get("code")
    state = request.GET.get("state")

    client_id = os.getenv("GITHUB_INTEGRATION_CLIENT_ID")
    client_secret = get_secret("GITHUB_INTEGRATION_CLIENT_SECRET")

    state_decoded = base64.b64decode(state).decode("utf-8")
    state = json.loads(state_decoded)

    original_url = state.get("returnUrl", "/")
    org_id = state.get("orgId")

    # Exchange code for token
    response = requests.post(
        "https://github.com/login/oauth/access_token",
        headers={"Accept": "application/json"},
        data={
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
            "redirect_uri": f"{os.getenv('ALLOWED_ORIGINS')}/service/oauth/github/callback",
        },
    )

    access_token = response.json().get("access_token")

    store_oauth_token("github", access_token, org_id)

    # Redirect back to Next.js app with token and original URL
    return redirect(f"{os.getenv('ALLOWED_ORIGINS')}{original_url}")
