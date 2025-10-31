from allauth.socialaccount.providers.base import ProviderAccount
from allauth.socialaccount.providers.oauth2.provider import OAuth2Provider

class OpenIDConnectAccount(ProviderAccount):
    def get_avatar_url(self):
        return self.account.extra_data.get('picture')

    def to_str(self):
        return self.account.extra_data.get('name', 
            super(OpenIDConnectAccount, self).to_str())

class GenericOpenIDConnectProvider(OAuth2Provider):
    account_class = OpenIDConnectAccount

    def extract_uid(self, data):
        return str(data['sub'])

    def extract_common_fields(self, data):
        return {
            'email': data.get('email'),
            'username': data.get('email'),
            'display_name': data.get('name'),
        }
