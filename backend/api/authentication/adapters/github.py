import requests
from api.models import CustomUser
from api.emails import send_login_email
from backend.api.notifier import notify_slack
from django.conf import settings
from allauth.socialaccount import app_settings
from allauth.socialaccount.providers.github.provider import GitHubProvider
from allauth.socialaccount.providers.github.views import GitHubOAuth2Adapter
from django.conf import settings


CLOUD_HOSTED = settings.APP_HOST == "cloud"


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
            emails = self.get_emails(headers)
            if emails:
                # First try to get primary email
                for email_obj in emails:
                    if email_obj.get("primary"):
                        extra_data["email"] = email_obj["email"]
                        break
                # If no primary email found, use the first one
                if not extra_data.get("email") and len(emails) > 0:
                    extra_data["email"] = emails[0]["email"]

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
