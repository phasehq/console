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

logger = logging.getLogger(__name__)


class JumpCloudOpenIDConnectProvider(GenericOpenIDConnectProvider):
    id = "jumpcloud-oidc"
    name = "JumpCloud OIDC"


class JumpCloudOpenIDConnectAdapter(GenericOpenIDConnectAdapter):
    provider_id = JumpCloudOpenIDConnectProvider.id
    oidc_config_url = "https://oauth.id.jumpcloud.com/.well-known/openid-configuration"
    default_config = {
        "access_token_url": "https://oauth.id.jumpcloud.com/oauth2/token",
        "authorize_url": "https://oauth.id.jumpcloud.com/oauth2/auth",
        "profile_url": "https://oauth.id.jumpcloud.com/userinfo",
        "jwks_url": "https://oauth.id.jumpcloud.com/.well-known/jwks.json",
        "issuer": "https://oauth.id.jumpcloud.com",
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


oauth2_login = OAuth2LoginView.adapter_view(JumpCloudOpenIDConnectAdapter)
oauth2_callback = OAuth2CallbackView.adapter_view(JumpCloudOpenIDConnectAdapter)

# Register the provider
providers.registry.register(JumpCloudOpenIDConnectProvider)

provider_classes = [JumpCloudOpenIDConnectProvider]
