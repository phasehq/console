import os
from urllib.parse import urljoin
from allauth.socialaccount.providers.oauth2.views import (
    OAuth2LoginView,
    OAuth2CallbackView,
)
from allauth.socialaccount import providers
from api.authentication.adapters.generic.provider import GenericOpenIDConnectProvider
from api.authentication.adapters.generic.views import GenericOpenIDConnectAdapter

AUTHENTIK_URL = os.getenv("AUTHENTIK_URL")

# Optional: Your Authentik slug if you have one
AUTHENTIK_APP_SLUG = os.getenv("AUTHENTIK_APP_SLUG", "default")

# Build the discovery URL
OIDC_DISCOVERY_URL = urljoin(
    AUTHENTIK_URL + "/",
    f"application/o/{AUTHENTIK_APP_SLUG}/.well-known/openid-configuration",
)


def _build_url(path):
    return urljoin(AUTHENTIK_URL + "/", path)


class AuthentikOpenIDConnectProvider(GenericOpenIDConnectProvider):
    id = "authentik"
    name = "Authentik OIDC"


class AuthentikOpenIDConnectAdapter(GenericOpenIDConnectAdapter):
    provider_id = AuthentikOpenIDConnectProvider.id
    oidc_config_url = OIDC_DISCOVERY_URL
    default_config = {
        "access_token_url": _build_url("application/o/token/"),
        "authorize_url": _build_url("application/o/authorize/"),
        "profile_url": _build_url("application/o/userinfo/"),
        "jwks_url": _build_url("application/o/jwks/"),
        "issuer": AUTHENTIK_URL,
    }


oauth2_login = OAuth2LoginView.adapter_view(AuthentikOpenIDConnectAdapter)
oauth2_callback = OAuth2CallbackView.adapter_view(AuthentikOpenIDConnectAdapter)

# Register the provider
providers.registry.register(AuthentikOpenIDConnectProvider)

provider_classes = [AuthentikOpenIDConnectProvider]
