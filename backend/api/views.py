
from datetime import datetime
from dj_rest_auth.registration.views import SocialLoginView
from django.contrib.auth.mixins import LoginRequiredMixin
from graphene_django.views import GraphQLView
from django.conf import settings
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from django.http import JsonResponse, HttpResponse
from api.utils import get_client_ip
from logs.models import KMSDBLog
from .models import App
import jwt
import requests
from django.contrib.auth import logout
from api.models import CustomUser
from allauth.socialaccount import app_settings
from backend.api.notifier import notify_slack
from allauth.socialaccount.providers.oauth2.client import OAuth2Client, OAuth2Error
from allauth.socialaccount.providers.github.provider import GitHubProvider
from allauth.socialaccount.providers.gitlab.provider import GitLabProvider
from allauth.socialaccount.providers.google.views import GoogleOAuth2Adapter
from allauth.socialaccount.providers.github.views import GitHubOAuth2Adapter
from allauth.socialaccount.providers.oauth2.views import OAuth2Adapter

CLOUD_HOSTED = settings.APP_HOST == 'cloud'

# for custom gitlab adapter class
def _check_errors(response):
    #  403 error's are presented as user-facing errors
    if response.status_code == 403:
        msg = response.content
        raise OAuth2Error("Invalid data from GitLab API: %r" % (msg))

    try:
        data = response.json()
    except ValueError:  # JSONDecodeError on py3
        raise OAuth2Error(
            "Invalid JSON from GitLab API: %r" % (response.text))

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
        email = login.email_addresses[0]
        if CLOUD_HOSTED and not CustomUser.objects.filter(email=email).exists():
            # new user
            notify_slack(f"New user signup: {email}")

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
            # new user
            notify_slack(f"New user signup: {email}")
        return self.get_provider().sociallogin_from_response(request, extra_data)


class CustomGitLabOAuth2Adapter(OAuth2Adapter):
    provider_id = GitLabProvider.id
    provider_default_url = "https://gitlab.com"
    provider_api_version = "v4"

    settings = app_settings.PROVIDERS.get(provider_id, {})
    provider_base_url = settings.get("GITLAB_URL", provider_default_url)

    access_token_url = "{0}/oauth/token".format(provider_base_url)
    authorize_url = "{0}/oauth/authorize".format(provider_base_url)
    profile_url = "{0}/api/{1}/user".format(
        provider_base_url, provider_api_version)

    def complete_login(self, request, app, token, response):
        print('logging in')
        response = requests.get(self.profile_url, params={
                                "access_token": token.token})
        data = _check_errors(response)
        login = self.get_provider().sociallogin_from_response(request, data)

        email = login.email_addresses[0]

        if CLOUD_HOSTED and not CustomUser.objects.filter(email=email).exists():
            # new user
            notify_slack(f"New user signup: {email}")
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
    return JsonResponse({
        'message': 'Logged out'
    })


@api_view(['GET'])
@permission_classes([AllowAny])
def health_check(request):  
     return JsonResponse({
        'status': 'alive'
    })


@api_view(['GET'])
@permission_classes([AllowAny])
def kms(request, app_id):
    auth_token = request.headers['authorization']
    event_type = request.headers['eventtype']
    phase_node = request.headers['phasenode']
    ph_size = request.headers['phsize']
    ip_address = get_client_ip(request)
    app_token = auth_token.split("Bearer ")[1]

    if not app_token:
        return HttpResponse(status=404)
    try:
        app = App.objects.get(app_token=app_token)
        try:
            timestamp = datetime.now().timestamp() * 1000
            KMSDBLog.objects.create(app_id=app_id, event_type=event_type, phase_node=phase_node, ph_size=float(ph_size), ip_address=ip_address, timestamp=timestamp)
        except:
            pass
        return JsonResponse({
            'wrappedKeyShare': app.wrapped_key_share
        })
    except:
        return HttpResponse(status=404)


class PrivateGraphQLView(LoginRequiredMixin, GraphQLView):
    raise_exception = True
    pass
