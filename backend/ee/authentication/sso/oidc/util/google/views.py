from allauth.socialaccount.providers.oauth2.views import (
    OAuth2LoginView,
    OAuth2CallbackView,
)
from allauth.socialaccount import providers
from allauth.socialaccount.providers.oauth2.views import OAuth2Error
from api.authentication.adapters.generic.provider import GenericOpenIDConnectProvider
from api.authentication.adapters.generic.views import GenericOpenIDConnectAdapter
from api.emails import send_login_email
from django.conf import settings
from django.utils import timezone
import logging
from api.models import ActivatedPhaseLicense

logger = logging.getLogger(__name__)


class GoogleOpenIDConnectProvider(GenericOpenIDConnectProvider):
    id = "google-oidc"
    name = "Google OIDC"


class GoogleOpenIDConnectAdapter(GenericOpenIDConnectAdapter):
    provider_id = GoogleOpenIDConnectProvider.id
    oidc_config_url = "https://accounts.google.com/.well-known/openid-configuration"
    default_config = {
        "access_token_url": "https://oauth2.googleapis.com/token",
        "authorize_url": "https://accounts.google.com/o/oauth2/v2/auth",
        "profile_url": "https://openidconnect.googleapis.com/v1/userinfo",
        "jwks_url": "https://www.googleapis.com/oauth2/v3/certs",
        "issuer": "https://accounts.google.com",
    }

    def complete_login(self, request, app, token, **kwargs):
        if settings.APP_HOST != "cloud":
            activated_license_exists = ActivatedPhaseLicense.objects.filter(
                expires_at__gte=timezone.now()
            ).exists()

            if not activated_license_exists and not settings.PHASE_LICENSE:
                error = "You need a license to login via OIDC."
                logger.error(f"OIDC login failed: {str(error)}")
                raise OAuth2Error(str(error))

        try:
            id_token = getattr(token, "id_token", None)
            if not id_token and isinstance(kwargs.get("response"), dict):
                id_token = kwargs["response"].get("id_token")

            # Forward the OIDC nonce so the parent's _process_id_token
            # actually validates it.
            expected_nonce = (
                request.session.get("sso_nonce")
                if hasattr(request, "session")
                else None
            )
            extra_data = self._get_user_data(
                token, id_token, app, expected_nonce=expected_nonce
            )
            logger.debug(
                f"User authentication data received for email: {extra_data.get('email')}"
            )

            # Create social login object without creating user
            login = self.get_provider().sociallogin_from_response(request, extra_data)

            try:
                email = login.user.email if login.user else extra_data.get("email", "")
                full_name = extra_data.get("name", "")
                if email:
                    send_login_email(request, email, full_name, "Google OIDC")
            except Exception as email_err:
                logger.error(f"Failed to send Google OIDC login email: {email_err}")

            return login

        except Exception as e:
            logger.error(f"OIDC login failed: {str(e)}")
            raise OAuth2Error(str(e))


oauth2_login = OAuth2LoginView.adapter_view(GoogleOpenIDConnectAdapter)
oauth2_callback = OAuth2CallbackView.adapter_view(GoogleOpenIDConnectAdapter)

# Register the provider
providers.registry.register(GoogleOpenIDConnectProvider)

provider_classes = [GoogleOpenIDConnectProvider]
