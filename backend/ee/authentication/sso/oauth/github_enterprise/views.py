from allauth.socialaccount.providers.github.views import GitHubOAuth2Adapter
from allauth.socialaccount.providers.github.provider import GitHubProvider
from allauth.socialaccount.providers.oauth2.views import OAuth2Error
from allauth.socialaccount import app_settings
import requests
from django.conf import settings
import logging
from django.utils import timezone
from api.emails import send_login_email
from api.models import ActivatedPhaseLicense
import os

logger = logging.getLogger(__name__)

CLOUD_HOSTED = settings.APP_HOST == "cloud"


class GitHubEnterpriseOAuth2Adapter(GitHubOAuth2Adapter):
    provider_id = GitHubProvider.id
    settings = app_settings.PROVIDERS.get(provider_id, {})

    web_url = os.getenv("GITHUB_ENTERPRISE_BASE_URL", "").rstrip("/")
    api_url = f"{os.getenv("GITHUB_ENTERPRISE_API_URL", "").rstrip("/")}/v3"

    access_token_url = f"{web_url}/login/oauth/access_token"
    authorize_url = f"{web_url}/login/oauth/authorize"
    profile_url = f"{api_url}/user"
    emails_url = f"{api_url}/user/emails"

    def complete_login(self, request, app, token, **kwargs):

        if settings.APP_HOST == "cloud":
            error = "GitHub Enterprise is not available in cloud mode"
            logger.error(f"GitHub Enterprise login failed: {str(error)}")
            raise OAuth2Error(str(error))

        # Check for a valid license
        activated_license_exists = ActivatedPhaseLicense.objects.filter(
            expires_at__gte=timezone.now()
        ).exists()

        if not activated_license_exists and not settings.PHASE_LICENSE:
            error = "You need a license to login via GitHub Enterprise."
            logger.error(f"GitHub Enterprise login failed: {str(error)}")
            raise OAuth2Error(str(error))

        headers = {"Authorization": f"token {token.token}"}
        resp = requests.get(self.profile_url, headers=headers)
        resp.raise_for_status()
        extra_data = resp.json()

        if app_settings.QUERY_EMAIL and not extra_data.get("email"):
            emails = self.get_emails(headers)
            for email_obj in emails:
                if email_obj.get("primary"):
                    extra_data["email"] = email_obj["email"]
                    break
            if not extra_data.get("email") and emails:
                extra_data["email"] = emails[0]["email"]

        email = extra_data["email"]

        try:
            full_name = extra_data.get("name", email.split("@")[0])
            send_login_email(request, email, full_name, "GitHub Enterprise")
        except Exception as e:
            print(f"Error sending email: {e}")

        return self.get_provider().sociallogin_from_response(request, extra_data)
