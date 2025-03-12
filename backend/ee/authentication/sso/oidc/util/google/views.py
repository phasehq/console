from allauth.socialaccount.providers.oauth2.views import (
    OAuth2LoginView,
    OAuth2CallbackView,
)
from allauth.socialaccount import providers
from ..generic.views import GenericOpenIDConnectAdapter
from ..generic.provider import GenericOpenIDConnectProvider


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


oauth2_login = OAuth2LoginView.adapter_view(GoogleOpenIDConnectAdapter)
oauth2_callback = OAuth2CallbackView.adapter_view(GoogleOpenIDConnectAdapter)

# Register the provider
providers.registry.register(GoogleOpenIDConnectProvider)

provider_classes = [GoogleOpenIDConnectProvider]
