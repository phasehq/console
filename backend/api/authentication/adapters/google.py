import jwt
from api.models import CustomUser
from api.emails import send_login_email
from backend.api.notifier import notify_slack
from allauth.socialaccount.providers.oauth2.client import OAuth2Error
from allauth.socialaccount.providers.google.views import GoogleOAuth2Adapter
from django.conf import settings

CLOUD_HOSTED = settings.APP_HOST == "cloud"


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
