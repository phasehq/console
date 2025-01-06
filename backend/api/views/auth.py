import requests
import json
import base64
import jwt
import os
from api.serializers import (
    ServiceAccountTokenSerializer,
    ServiceTokenSerializer,
    UserTokenSerializer,
)
from api.models import ServiceAccountToken, ServiceToken, UserToken, CustomUser
from api.emails import send_login_email
from api.utils.syncing.auth import store_oauth_token
from backend.utils.secrets import get_secret
from backend.api.notifier import notify_slack
from api.utils.rest import (
    get_token_type,
    token_is_expired_or_deleted,
)

from django.conf import settings
from django.contrib.auth import logout
from django.views.decorators.csrf import csrf_exempt
from django.shortcuts import redirect
from django.http import JsonResponse
from django.http import JsonResponse, HttpResponse
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework import status

from dj_rest_auth.registration.views import SocialLoginView
from allauth.socialaccount import app_settings
from allauth.socialaccount.providers.oauth2.client import OAuth2Client, OAuth2Error
from allauth.socialaccount.providers.github.provider import GitHubProvider
from allauth.socialaccount.providers.gitlab.provider import GitLabProvider
from allauth.socialaccount.providers.google.views import GoogleOAuth2Adapter
from allauth.socialaccount.providers.github.views import GitHubOAuth2Adapter
from allauth.socialaccount.providers.oauth2.views import OAuth2Adapter


CLOUD_HOSTED = settings.APP_HOST == "cloud"


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


# for custom gitlab adapter class
def _check_errors(response):
    #  403 error's are presented as user-facing errors
    if response.status_code == 403:
        msg = response.content
        raise OAuth2Error("Invalid data from GitLab API: %r" % (msg))

    try:
        data = response.json()
    except ValueError:  # JSONDecodeError on py3
        raise OAuth2Error("Invalid JSON from GitLab API: %r" % (response.text))

    if response.status_code >= 400 or "error" in data:
        # For errors, we expect the following format:
        # {"error": "error_name", "error_description": "Oops!"}
        # For example, if the token is not valid, we will get:
        # {"message": "status_code - message"}
        error = data.get("error", "") or response.status_code
        desc = data.get("error_description", "") or data.get("message", "")

        raise OAuth2Error("GitLab error: %s (%s)" % (error, desc))

    # The expected output from the API follows this format:
    # {"id": 12345, ...}
    if "id" not in data:
        # If the id is not present, the output is not usable (no UID)
        raise OAuth2Error("Invalid data from GitLab API: %r" % (data))

    return data


class CustomGoogleOAuth2Adapter(GoogleOAuth2Adapter):
    def complete_login(self, request, app, token, response, **kwargs):
        try:
            identity_data = jwt.decode(
                response["id_token"],  # another nested id_token was returned
                options={
                    "verify_signature": False,
                    "verify_iss": True,
                    "verify_aud": True,
                    "verify_exp": True,
                },
                issuer=self.id_token_issuer,
                audience=app.client_id,
            )
        except jwt.PyJWTError as e:
            raise OAuth2Error("Invalid id_token") from e
        login = self.get_provider().sociallogin_from_response(request, identity_data)
        email = identity_data.get("email")
        full_name = identity_data.get("name")  # Get the full name from the id_token

        if CLOUD_HOSTED and not CustomUser.objects.filter(email=email).exists():
            try:
                # Notify Slack
                notify_slack(f"New user signup: {full_name} - {email}")
            except Exception as e:
                print(f"Error notifying Slack: {e}")

        try:
            send_login_email(request, email, full_name, "Google")
        except Exception as e:
            print(f"Error sending email: {e}")

        return login


class CustomGitHubOAuth2Adapter(GitHubOAuth2Adapter):
    provider_id = GitHubProvider.id
    settings = app_settings.PROVIDERS.get(provider_id, {})

    if "GITHUB_URL" in settings:
        web_url = settings.get("GITHUB_URL").rstrip("/")
        api_url = "{0}/api/v3".format(web_url)
    else:
        web_url = "https://github.com"
        api_url = "https://api.github.com"

    access_token_url = "{0}/login/oauth/access_token".format(web_url)
    authorize_url = "{0}/login/oauth/authorize".format(web_url)
    profile_url = "{0}/user".format(api_url)
    emails_url = "{0}/user/emails".format(api_url)

    def complete_login(self, request, app, token, **kwargs):
        headers = {"Authorization": "token {}".format(token.token)}
        resp = requests.get(self.profile_url, headers=headers)
        resp.raise_for_status()
        extra_data = resp.json()
        if app_settings.QUERY_EMAIL and not extra_data.get("email"):
            extra_data["email"] = self.get_email(headers)

        email = extra_data["email"]

        if CLOUD_HOSTED and not CustomUser.objects.filter(email=email).exists():

            try:
                # Notify Slack
                notify_slack(f"New user signup: {email}")
            except Exception as e:
                print(f"Error notifying Slack: {e}")

        try:
            full_name = extra_data.get("name", email.split("@")[0])
            send_login_email(request, email, full_name, "GitHub")
        except Exception as e:
            print(f"Error sending email: {e}")

        return self.get_provider().sociallogin_from_response(request, extra_data)


class CustomGitLabOAuth2Adapter(OAuth2Adapter):
    provider_id = GitLabProvider.id
    provider_api_version = "v4"

    settings = app_settings.PROVIDERS.get(provider_id, {})

    provider_url = settings.get("APP", {}).get("settings", {}).get("gitlab_url")

    access_token_url = "{0}/oauth/token".format(provider_url)
    authorize_url = "{0}/oauth/authorize".format(provider_url)
    profile_url = "{0}/api/{1}/user".format(provider_url, provider_api_version)

    def complete_login(self, request, app, token, response):
        response = requests.get(self.profile_url, params={"access_token": token.token})
        data = _check_errors(response)
        login = self.get_provider().sociallogin_from_response(request, data)

        email = login.email_addresses[0]

        if CLOUD_HOSTED:
            # Check if user exists and notify Slack for new user signup
            if not CustomUser.objects.filter(email=email).exists():
                try:
                    notify_slack(f"New user signup: {email}")
                except Exception as e:
                    print(f"Error notifying Slack: {e}")

        try:
            full_name = data.get("name", "")
            send_login_email(request, email, full_name, "GitLab")
        except Exception as e:
            print(f"Error sending email: {e}")

        return login


class GoogleLoginView(SocialLoginView):
    authentication_classes = []
    adapter_class = CustomGoogleOAuth2Adapter
    callback_url = settings.OAUTH_REDIRECT_URI
    client_class = OAuth2Client


class GitHubLoginView(SocialLoginView):
    authentication_classes = []
    adapter_class = CustomGitHubOAuth2Adapter
    callback_url = settings.OAUTH_REDIRECT_URI
    client_class = OAuth2Client


class GitLabLoginView(SocialLoginView):
    authentication_classes = []
    adapter_class = CustomGitLabOAuth2Adapter
    callback_url = settings.OAUTH_REDIRECT_URI
    client_class = OAuth2Client


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
@permission_classes([AllowAny])
def secrets_tokens(request):
    auth_token = request.headers["authorization"]

    if token_is_expired_or_deleted(auth_token):
        return HttpResponse(status=403)

    token_type = get_token_type(auth_token)

    if token_type == "Service" or token_type == "ServiceAccount":
        return service_token_kms(request)
    elif token_type == "User":
        return user_token_kms(request)
    else:
        return HttpResponse(status=403)
