import os
from urllib.parse import urljoin
from allauth.socialaccount.providers.oauth2.views import (
    OAuth2LoginView,
    OAuth2CallbackView,
)
from allauth.socialaccount import providers
from api.authentication.adapters.generic.provider import GenericOpenIDConnectProvider
from api.authentication.adapters.generic.views import GenericOpenIDConnectAdapter

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


oauth2_login = OAuth2LoginView.adapter_view(AutheliaOpenIDConnectAdapter)
oauth2_callback = OAuth2CallbackView.adapter_view(AutheliaOpenIDConnectAdapter)

# Register the provider
providers.registry.register(AutheliaOpenIDConnectProvider)

provider_classes = [AutheliaOpenIDConnectProvider]
