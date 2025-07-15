import jwt, os
from allauth.socialaccount.providers.oauth2.views import (
    OAuth2Adapter,
)
from allauth.socialaccount.providers.oauth2.client import OAuth2Error
from allauth.socialaccount.providers.base import Provider
from allauth.socialaccount.models import SocialLogin
from django.conf import settings


CLOUD_HOSTED = settings.APP_HOST == "cloud"

AUTHENTIK_URL = os.getenv("AUTHENTIK_URL")


class AuthentikOAuth2Adapter(OAuth2Adapter):
    provider_id = "authentik"

    access_token_url = f"{AUTHENTIK_URL}/application/o/token/"
    authorize_url = f"{AUTHENTIK_URL}/application/o/authorize/"
    profile_url = f"{AUTHENTIK_URL}/application/o/userinfo/"

    def complete_login(self, request, app, token, response, **kwargs):
        from api.models import CustomUser
        from api.emails import send_login_email
        from backend.api.notifier import notify_slack

        # Authentik returns an id_token in the token response
        id_token = response.get("id_token")
        if not id_token:
            raise OAuth2Error("No id_token in Authentik response")

        try:
            identity_data = jwt.decode(
                id_token,
                options={
                    "verify_signature": False,
                    "verify_iss": True,
                    "verify_aud": True,
                    "verify_exp": True,
                },
                issuer=AUTHENTIK_URL,
                audience=app.client_id,
            )
        except jwt.PyJWTError as e:
            raise OAuth2Error("Invalid id_token") from e

        login = self.get_provider().sociallogin_from_response(request, identity_data)
        email = identity_data.get("email")
        full_name = identity_data.get("name")

        if (
            CLOUD_HOSTED
            and email
            and not CustomUser.objects.filter(email=email).exists()
        ):
            try:
                notify_slack(f"New user signup: {full_name} - {email}")
            except Exception as e:
                print(f"Error notifying Slack: {e}")

        try:
            send_login_email(request, email, full_name, "Authentik")
        except Exception as e:
            print(f"Error sending email: {e}")

        return login
