import logging
import requests
from api.emails import send_login_email
from allauth.socialaccount import app_settings
from allauth.socialaccount.providers.github.provider import GitHubProvider
from allauth.socialaccount.providers.github.views import GitHubOAuth2Adapter
from django.conf import settings

logger = logging.getLogger(__name__)


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
        emails = None
        if app_settings.QUERY_EMAIL and not extra_data.get("email"):
            emails = self.get_emails(headers) or []
            # Only accept verified emails — GitHub allows unverified primary
            # emails, which would otherwise let an attacker set a victim's
            # email as primary on their own GitHub account and sign in as
            # that victim.
            verified_emails = [e for e in emails if e.get("verified")]
            if verified_emails:
                for email_obj in verified_emails:
                    if email_obj.get("primary"):
                        extra_data["email"] = email_obj["email"]
                        break
                if not extra_data.get("email"):
                    extra_data["email"] = verified_emails[0]["email"]

        email = extra_data.get("email")
        if not email:
            # GitHub's API-level invariant is that a primary email MUST be
            # verified before it can be set primary, so in practice this
            # branch should be near-unreachable. If we ever observe this
            # log in production, investigate whether the invariant has
            # changed, whether API stale data is involved, or whether a
            # real user needs support. github_login is safe to log (it's
            # the public GitHub handle, not the private email).
            logger.warning(
                "github_sso_rejected_no_verified_email "
                "github_login=%s total_emails=%s had_primary_email_in_profile=%s",
                extra_data.get("login"),
                len(emails) if emails is not None else "not_queried",
                bool(extra_data.get("email")),
            )
            from allauth.socialaccount.providers.oauth2.client import OAuth2Error
            raise OAuth2Error(
                "GitHub returned no verified email address. Please verify "
                "an email on your GitHub account and retry."
            )

        try:
            full_name = extra_data.get("name", email.split("@")[0])
            send_login_email(request, email, full_name, "GitHub")
        except Exception as e:
            print(f"Error sending email: {e}")

        return self.get_provider().sociallogin_from_response(request, extra_data)
