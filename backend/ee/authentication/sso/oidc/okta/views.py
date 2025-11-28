from allauth.socialaccount.providers.oauth2.views import (
    OAuth2LoginView,
    OAuth2CallbackView,
)
from allauth.socialaccount.providers.oauth2.views import OAuth2Error
from allauth.socialaccount import providers

from django.conf import settings
from django.utils import timezone

import logging
from api.authentication.adapters.generic.provider import GenericOpenIDConnectProvider
from api.authentication.adapters.generic.views import GenericOpenIDConnectAdapter
from api.models import ActivatedPhaseLicense
import os

logger = logging.getLogger(__name__)


class OktaOpenIDConnectProvider(GenericOpenIDConnectProvider):
    id = "okta-oidc"
    name = "Okta OIDC"


class OktaOpenIDConnectAdapter(GenericOpenIDConnectAdapter):
    provider_id = OktaOpenIDConnectProvider.id

    @property
    def oidc_config_url(self):
        issuer = os.getenv("OKTA_OIDC_ISSUER")
        if not issuer:
            raise ValueError("OKTA_OIDC_ISSUER must be set")
        return f"{issuer}/.well-known/openid-configuration"

    @property
    def default_config(self):
        issuer = os.getenv("OKTA_OIDC_ISSUER")
        if not issuer:
            raise ValueError("OKTA_OIDC_ISSUER must be set")
        return {
            "access_token_url": f"{issuer}/v1/token",
            "authorize_url": f"{issuer}/v1/authorize",
            "profile_url": f"{issuer}/v1/userinfo",
            "jwks_url": f"{issuer}/v1/keys",
            "issuer": issuer,
        }

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

        try:
            id_token = getattr(token, "id_token", None)
            if not id_token and isinstance(kwargs.get("response"), dict):
                id_token = kwargs["response"].get("id_token")

            extra_data = self._get_user_data(token, id_token, app)
            logger.debug(
                f"User authentication data received for email: {extra_data.get('email')}"
            )

            # Create social login object without creating user
            login = self.get_provider().sociallogin_from_response(request, extra_data)

            return login

        except Exception as e:
            logger.error(f"OIDC login failed: {str(e)}")
            raise OAuth2Error(str(e))


oauth2_login = OAuth2LoginView.adapter_view(OktaOpenIDConnectAdapter)
oauth2_callback = OAuth2CallbackView.adapter_view(OktaOpenIDConnectAdapter)

# Register the provider
providers.registry.register(OktaOpenIDConnectProvider)

provider_classes = [OktaOpenIDConnectProvider]
