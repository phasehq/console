import logging
import os
from urllib.parse import urljoin
from allauth.socialaccount.providers.oauth2.views import (
    OAuth2LoginView,
    OAuth2CallbackView,
    OAuth2Error,
)
from allauth.socialaccount import providers
from api.authentication.adapters.generic.provider import GenericOpenIDConnectProvider
from api.authentication.adapters.generic.views import GenericOpenIDConnectAdapter

logger = logging.getLogger(__name__)

AUTHELIA_URL = os.getenv("AUTHELIA_URL", "")

OIDC_DISCOVERY_URL = urljoin(
    AUTHELIA_URL + "/",
    ".well-known/openid-configuration",
)


def _build_url(path):
    return urljoin(AUTHELIA_URL + "/", path)


class AutheliaOpenIDConnectProvider(GenericOpenIDConnectProvider):
    id = "authelia"
    name = "Authelia OIDC"


class AutheliaOpenIDConnectAdapter(GenericOpenIDConnectAdapter):
    provider_id = AutheliaOpenIDConnectProvider.id
    oidc_config_url = OIDC_DISCOVERY_URL
    default_config = {
        "access_token_url": _build_url("api/oidc/token"),
        "authorize_url": _build_url("api/oidc/authorization"),
        "profile_url": _build_url("api/oidc/userinfo"),
        "jwks_url": _build_url("jwks.json"),
        "issuer": AUTHELIA_URL,
    }

    def complete_login(self, request, app, token, **kwargs):
        try:
            id_token = getattr(token, "id_token", None)
            if not id_token and isinstance(kwargs.get("response"), dict):
                id_token = kwargs["response"].get("id_token")
            if not id_token and hasattr(request, "data"):
                id_token = request.data.get("id_token")

            extra_data = self._get_user_data(token, id_token, app)
            logger.debug(
                f"Authelia user authentication data received for email: {extra_data.get('email')}"
            )

            login = self.get_provider().sociallogin_from_response(request, extra_data)

            return login

        except Exception as e:
            logger.error(f"Authelia OIDC login failed: {str(e)}")
            raise OAuth2Error(str(e))


oauth2_login = OAuth2LoginView.adapter_view(AutheliaOpenIDConnectAdapter)
oauth2_callback = OAuth2CallbackView.adapter_view(AutheliaOpenIDConnectAdapter)

# Register the provider
providers.registry.register(AutheliaOpenIDConnectProvider)

provider_classes = [AutheliaOpenIDConnectProvider]
