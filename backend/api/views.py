from datetime import datetime
import json
from api.serializers import (
    EnvironmentKeySerializer,
    SecretSerializer,
    ServiceTokenSerializer,
    UserTokenSerializer,
)
from api.emails import send_login_email
from api.utils.permissions import user_can_access_environment
from api.utils.syncing.auth import store_oauth_token
from dj_rest_auth.registration.views import SocialLoginView
from django.contrib.auth.mixins import LoginRequiredMixin
from graphene_django.views import GraphQLView
from django.conf import settings
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from django.http import JsonResponse, HttpResponse
from api.utils.rest import (
    get_client_ip,
    get_env_from_service_token,
    get_org_member_from_user_token,
    get_resolver_request_meta,
    get_token_type,
    token_is_expired_or_deleted,
)
from logs.models import KMSDBLog
from .models import (
    App,
    Environment,
    EnvironmentKey,
    EnvironmentToken,
    Secret,
    SecretEvent,
    SecretTag,
    ServiceToken,
    UserToken,
)
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
from rest_framework.views import APIView
from rest_framework import status
from django.views.decorators.csrf import csrf_exempt
from django.utils import timezone
import base64
from django.shortcuts import redirect
import os

CLOUD_HOSTED = settings.APP_HOST == "cloud"


def github_callback(request):
    code = request.GET.get("code")
    state = request.GET.get("state")

    client_id = os.getenv("GITHUB_INTEGRATION_CLIENT_ID")
    client_secret = os.getenv("GITHUB_INTEGRATION_CLIENT_SECRET")

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
        email = login.email_addresses[0]

        if CLOUD_HOSTED and not CustomUser.objects.filter(email=email).exists():
            try:
                # Notify Slack
                notify_slack(f"New user signup: {email}")
            except Exception as e:
                print(f"Error notifying Slack: {e}")

        try:
            send_login_email(request, email, "Google")
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
            send_login_email(request, email, "GitHub")
        except Exception as e:
            print(f"Error sending email: {e}")

        return self.get_provider().sociallogin_from_response(request, extra_data)


class CustomGitLabOAuth2Adapter(OAuth2Adapter):
    provider_id = GitLabProvider.id
    provider_default_url = "https://gitlab.com"
    provider_api_version = "v4"

    settings = app_settings.PROVIDERS.get(provider_id, {})
    provider_base_url = settings.get("GITLAB_URL", provider_default_url)

    access_token_url = "{0}/oauth/token".format(provider_base_url)
    authorize_url = "{0}/oauth/authorize".format(provider_base_url)
    profile_url = "{0}/api/{1}/user".format(provider_base_url, provider_api_version)

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
            send_login_email(request, email, "GitLab")
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
    return JsonResponse({"status": "alive"})


@api_view(["GET"])
@permission_classes([AllowAny])
def kms(request, app_id):
    auth_token = request.headers["authorization"]
    event_type = request.headers["eventtype"]
    phase_node = request.headers["phasenode"]
    ph_size = request.headers["phsize"]
    ip_address = get_client_ip(request)
    app_token = auth_token.split("Bearer ")[1]

    if not app_token:
        return HttpResponse(status=404)
    try:
        app = App.objects.get(app_token=app_token)
        try:
            timestamp = datetime.now().timestamp() * 1000
            KMSDBLog.objects.create(
                app_id=app_id,
                event_type=event_type,
                phase_node=phase_node,
                ph_size=float(ph_size),
                ip_address=ip_address,
                timestamp=timestamp,
            )
        except:
            pass
        return JsonResponse({"wrappedKeyShare": app.wrapped_key_share})
    except:
        return HttpResponse(status=404)


def user_token_kms(request):
    auth_token = request.headers["authorization"]

    token = auth_token.split(" ")[2]

    user_token = UserToken.objects.get(token=token)

    serializer = UserTokenSerializer(user_token)

    return Response(serializer.data, status=status.HTTP_200_OK)


def service_token_kms(request):
    auth_token = request.headers["authorization"]

    token = auth_token.split(" ")[2]

    service_token = ServiceToken.objects.get(token=token)

    serializer = ServiceTokenSerializer(service_token)

    return Response(serializer.data, status=status.HTTP_200_OK)


@api_view(["GET"])
@permission_classes([AllowAny])
def secrets_tokens(request):
    auth_token = request.headers["authorization"]

    if token_is_expired_or_deleted(auth_token):
        return HttpResponse(status=403)

    token_type = get_token_type(auth_token)

    if token_type == "Service":
        return service_token_kms(request)
    elif token_type == "User":
        return user_token_kms(request)
    else:
        return HttpResponse(status=403)


class PrivateGraphQLView(LoginRequiredMixin, GraphQLView):
    raise_exception = True
    pass


class SecretsView(APIView):
    permission_classes = [
        AllowAny,
    ]

    @csrf_exempt
    def dispatch(self, request, *args):
        return super(SecretsView, self).dispatch(request, *args)

    def get(self, request):
        auth_token = request.headers["authorization"]

        if token_is_expired_or_deleted(auth_token):
            return HttpResponse(status=403)

        token_type = get_token_type(auth_token)

        env_id = request.headers["environment"]
        env = Environment.objects.get(id=env_id)

        ip_address, user_agent = get_resolver_request_meta(request)

        if token_type == "User":
            try:
                org_member = get_org_member_from_user_token(auth_token)

                if not user_can_access_environment(org_member.user.userId, env_id):
                    return HttpResponse(status=403)
            except Exception as ex:
                print("EX:", ex)
                return HttpResponse(status=404)

        else:
            org_member = None

        if not env.id:
            return HttpResponse(status=404)

        secrets_filter = {"environment": env, "deleted_at": None}

        try:
            key_digest = request.headers["keydigest"]
            if key_digest:
                secrets_filter["key_digest"] = key_digest
        except:
            pass

        secrets = Secret.objects.filter(**secrets_filter)

        for secret in secrets:
            read_event = SecretEvent.objects.create(
                secret=secret,
                environment=secret.environment,
                user=org_member,
                key=secret.key,
                key_digest=secret.key_digest,
                value=secret.value,
                comment=secret.comment,
                event_type=SecretEvent.READ,
                ip_address=ip_address,
                user_agent=user_agent,
            )
            read_event.tags.set(secret.tags.all())

        serializer = SecretSerializer(
            secrets, many=True, context={"org_member": org_member}
        )

        return Response(serializer.data, status=status.HTTP_200_OK)

    def post(self, request):
        auth_token = request.headers["authorization"]

        if token_is_expired_or_deleted(auth_token):
            return HttpResponse(status=403)

        token_type = get_token_type(auth_token)

        env_id = request.headers["environment"]
        env = Environment.objects.get(id=env_id)

        if token_type == "User":
            try:
                user = get_org_member_from_user_token(auth_token)

                if not user_can_access_environment(user.user.userId, env_id):
                    return HttpResponse(status=403)
            except:
                return HttpResponse(status=404)
        else:
            user = None

        if not env:
            return HttpResponse(status=404)

        request_body = json.loads(request.body)

        ip_address, user_agent = get_resolver_request_meta(request)

        for secret in request_body["secrets"]:
            tags = SecretTag.objects.filter(id__in=secret["tags"])

            secret_data = {
                "environment": env,
                "key": secret["key"],
                "key_digest": secret["keyDigest"],
                "value": secret["value"],
                "folder_id": secret["folderId"],
                "version": 1,
                "comment": secret["comment"],
            }

            secret_obj = Secret.objects.create(**secret_data)
            secret_obj.tags.set(tags)

            event = SecretEvent.objects.create(
                **{
                    **secret_data,
                    **{
                        "user": user,
                        "secret": secret_obj,
                        "event_type": SecretEvent.CREATE,
                        "ip_address": ip_address,
                        "user_agent": user_agent,
                    },
                }
            )
            event.tags.set(tags)

        return Response(status=status.HTTP_200_OK)

    def put(self, request):
        auth_token = request.headers["authorization"]

        if token_is_expired_or_deleted(auth_token):
            return HttpResponse(status=403)

        token_type = get_token_type(auth_token)

        env_id = request.headers["environment"]
        env = Environment.objects.get(id=env_id)

        if token_type == "User":
            try:
                user = get_org_member_from_user_token(auth_token)

                if not user_can_access_environment(user.user.userId, env_id):
                    return HttpResponse(status=403)
            except:
                return HttpResponse(status=404)

        else:
            user = None

        request_body = json.loads(request.body)

        ip_address, user_agent = get_resolver_request_meta(request)

        for secret in request_body["secrets"]:
            secret_obj = Secret.objects.get(id=secret["id"])

            tags = SecretTag.objects.filter(id__in=secret["tags"])

            secret_data = {
                "environment": env,
                "key": secret["key"],
                "key_digest": secret["keyDigest"],
                "value": secret["value"],
                "folder_id": secret["folderId"],
                "version": secret_obj.version + 1,
                "comment": secret["comment"],
            }

            for key, value in secret_data.items():
                setattr(secret_obj, key, value)

            secret_obj.updated_at = timezone.now()
            secret_obj.tags.set(tags)
            secret_obj.save()

            event = SecretEvent.objects.create(
                **{
                    **secret_data,
                    **{
                        "user": user,
                        "secret": secret_obj,
                        "event_type": SecretEvent.UPDATE,
                        "ip_address": ip_address,
                        "user_agent": user_agent,
                    },
                }
            )
            event.tags.set(tags)

        return Response(status=status.HTTP_200_OK)

    def delete(self, request):
        auth_token = request.headers["authorization"]

        if token_is_expired_or_deleted(auth_token):
            return HttpResponse(status=403)

        token_type = get_token_type(auth_token)

        env_id = request.headers["environment"]

        if token_type == "User":
            try:
                user = get_org_member_from_user_token(auth_token)

                if not user_can_access_environment(user.user.userId, env_id):
                    return HttpResponse(status=403)
            except:
                return HttpResponse(status=404)

        else:
            user = None

        request_body = json.loads(request.body)

        ip_address, user_agent = get_resolver_request_meta(request)

        secrets_to_delete = Secret.objects.filter(id__in=request_body["secrets"])

        for secret in secrets_to_delete:
            if not Secret.objects.filter(id=secret.id).exists():
                return HttpResponse(status=404)

            if user is not None and not user_can_access_environment(
                user.user.userId, secret.environment.id
            ):
                return HttpResponse(status=403)

        for secret in secrets_to_delete:
            secret.updated_at = timezone.now()
            secret.deleted_at = timezone.now()
            secret.save()

            most_recent_event_copy = (
                SecretEvent.objects.filter(secret=secret).order_by("version").last()
            )

            # setting the pk to None and then saving it creates a copy of the instance with updated fields
            most_recent_event_copy.id = None
            most_recent_event_copy.event_type = SecretEvent.DELETE
            most_recent_event_copy.ip_address = ip_address
            most_recent_event_copy.user_agent = user_agent
            most_recent_event_copy.save()

        return Response(status=status.HTTP_200_OK)
