import jwt
import json
from api.models import ActivatedPhaseLicense
from django.conf import settings
from django.utils import timezone
from api.emails import send_login_email
from allauth.socialaccount.providers.microsoft.views import MicrosoftGraphOAuth2Adapter
from allauth.socialaccount.providers.oauth2.client import OAuth2Error
from allauth.socialaccount.adapter import get_adapter
import logging

logger = logging.getLogger(__name__)


class CustomMicrosoftGraphOAuth2Adapter(MicrosoftGraphOAuth2Adapter):
    def _check_microsoft_errors(self, response):
        try:
            data = response.json()
        except json.decoder.JSONDecodeError:
            raise OAuth2Error(
                "Invalid JSON from Microsoft Graph API: {}".format(response.text)
            )

        if "id" not in data:
            error_message = "Error retrieving Microsoft profile"
            microsoft_error_message = data.get("error", {}).get("message")
            if microsoft_error_message:
                error_message = ": ".join((error_message, microsoft_error_message))
            raise OAuth2Error(error_message)

        data["name"] = data.get("displayName")
        if data["name"] is None:
            data["name"] = f"{data.get("givenName")} {data.get("surName")}"
        return data

    def complete_login(self, request, app, token, **kwargs):

        if settings.APP_HOST == "cloud":
            error = "OIDC is not available in cloud mode"
            logger.error(f"OIDC login failed: {str(error)}")
            raise OAuth2Error(str(error))

        # Check for a valid license
        activated_license_exists = ActivatedPhaseLicense.objects.filter(
            expires_at__gte=timezone.now()
        ).exists()

        if not activated_license_exists and not settings.PHASE_LICENSE:
            error = "You need a license to login via OIDC."
            logger.error(f"OIDC login failed: {str(error)}")
            raise OAuth2Error(str(error))

        headers = {"Authorization": "Bearer {0}".format(token.token)}
        response = (
            get_adapter()
            .get_requests_session()
            .get(
                self.profile_url,
                params=self.profile_url_params,
                headers=headers,
            )
        )

        extra_data = self._check_microsoft_errors(response)

        login = self.get_provider().sociallogin_from_response(request, extra_data)

        try:
            claims = jwt.decode(token.token, options={"verify_signature": False})

            email = claims.get("email") or claims.get(
                "preferred_username"
            )  # Microsoft may use "preferred_username"
            if email:
                login.user.email = email
        except jwt.DecodeError as ex:
            print(ex)
            pass  # Handle decoding errors if necessary

        try:
            email = login.user.email
            full_name = extra_data.get("name", "")
            send_login_email(request, email, full_name, "Microsoft Entra ID")
        except Exception as e:
            print(f"Error sending email: {e}")

        return login
