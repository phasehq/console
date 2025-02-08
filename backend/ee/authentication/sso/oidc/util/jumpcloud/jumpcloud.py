from allauth.socialaccount.providers.oauth2.views import (
    OAuth2LoginView,
    OAuth2CallbackView,
)
from allauth.socialaccount import providers
from ..generic.views import GenericOpenIDConnectAdapter
from ..generic.provider import GenericOpenIDConnectProvider

class JumpCloudOpenIDConnectProvider(GenericOpenIDConnectProvider):
    id = 'jumpcloud-oidc'
    name = 'JumpCloud OIDC'

class JumpCloudOpenIDConnectAdapter(GenericOpenIDConnectAdapter):
    provider_id = JumpCloudOpenIDConnectProvider.id
    oidc_config_url = 'https://oauth.id.jumpcloud.com/.well-known/openid-configuration'
    default_config = {
        'access_token_url': 'https://oauth.id.jumpcloud.com/oauth2/token',
        'authorize_url': 'https://oauth.id.jumpcloud.com/oauth2/auth',
        'profile_url': 'https://oauth.id.jumpcloud.com/userinfo',
        'jwks_url': 'https://oauth.id.jumpcloud.com/.well-known/jwks.json',
        'issuer': 'https://oauth.id.jumpcloud.com'
    }

oauth2_login = OAuth2LoginView.adapter_view(JumpCloudOpenIDConnectAdapter)
oauth2_callback = OAuth2CallbackView.adapter_view(JumpCloudOpenIDConnectAdapter)

# Register the provider
providers.registry.register(JumpCloudOpenIDConnectProvider)

provider_classes = [JumpCloudOpenIDConnectProvider]
