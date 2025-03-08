from allauth.socialaccount.providers.oauth2.views import (
    OAuth2LoginView,
    OAuth2CallbackView,
)
from allauth.socialaccount import providers
from allauth.socialaccount.providers.oauth2.client import OAuth2Error
from ..generic.views import GenericOpenIDConnectAdapter
from ..generic.provider import GenericOpenIDConnectProvider
from django.conf import settings
import os
import logging
import jwt
from django.contrib.auth import get_user_model
from allauth.socialaccount.models import SocialAccount

logger = logging.getLogger(__name__)

class EntraIDOpenIDConnectProvider(GenericOpenIDConnectProvider):
    id = 'entra-id-oidc'
    name = 'Entra ID'
    
    def extract_common_fields(self, data):
        """Extract fields from Entra ID profile"""
        return {
            'email': data.get('email'),
            'username': data.get('preferred_username', data.get('email')),
            'name': data.get('name'),
            'given_name': data.get('given_name'),
            'family_name': data.get('family_name'),
        }

class EntraIDOpenIDConnectAdapter(GenericOpenIDConnectAdapter):
    provider_id = EntraIDOpenIDConnectProvider.id
    
    def __init__(self, *args, **kwargs):
        tenant_id = os.getenv('ENTRA_ID_OIDC_TENANT_ID', 'common')
        client_id = os.getenv('ENTRA_ID_OIDC_CLIENT_ID', '')
        
        self.oidc_config_url = f'https://login.microsoftonline.com/{tenant_id}/v2.0/.well-known/openid-configuration?appid={client_id}'
        self.default_config = {
            'access_token_url': f'https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token',
            'authorize_url': f'https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/authorize',
            'profile_url': 'https://graph.microsoft.com/oidc/userinfo',
            'jwks_url': f'https://login.microsoftonline.com/{tenant_id}/discovery/v2.0/keys',
            'issuer': f'https://login.microsoftonline.com/{tenant_id}/v2.0'
        }
        # Now call super().__init__ after setting the needed properties
        super().__init__(*args, **kwargs)
    
    def _process_id_token(self, id_token, app):
        """
        Process the ID token to extract user profile data
        """
        try:
            decoded_data = jwt.decode(
                id_token, 
                options={"verify_signature": False},  # We're just extracting data, not verifying here
                audience=app.client_id
            )
            
            # Ensure email is present
            if 'email' not in decoded_data and 'preferred_username' in decoded_data:
                decoded_data['email'] = decoded_data['preferred_username']
                
            return decoded_data
        except Exception as e:
            logger.error(f"Error decoding ID token: {str(e)}")
            raise e

    def complete_login(self, request, app, token, **kwargs):
        """
        Complete the login process by extracting user data from token 
        and creating a social login instance.
        """
        response = kwargs.get('response', None)
        id_token = None
        
        # Handle different response types
        if isinstance(response, dict):
            id_token = response.get('id_token')
        elif isinstance(response, str):
            # The response itself might be the ID token
            id_token = response
        
        if not id_token:
            logger.error("No ID token found in response")
            raise OAuth2Error("No ID token found")
        
        # Process the token to extract profile data
        try:
            decoded_data = self._process_id_token(id_token, app)
            
            # Create the extra_data dictionary with all profile information
            extra_data = {
                'sub': decoded_data.get('sub'),
                'email': decoded_data.get('email', decoded_data.get('preferred_username')),
                'name': decoded_data.get('name'),
                'given_name': decoded_data.get('given_name'),
                'family_name': decoded_data.get('family_name'),
                'picture': decoded_data.get('picture', 'https://graph.microsoft.com/v1.0/me/photo/$value')
            }
            
            # Get Django user model
            User = get_user_model()
            
            # Check if user exists
            try:
                if not extra_data.get('email'):
                    raise OAuth2Error("No email found in token data")
                    
                user = User.objects.get(email=extra_data['email'])
            except User.DoesNotExist:
                # Create a new user
                user = User.objects.create_user(
                    email=extra_data['email'],
                    username=extra_data['email'],
                    password=None,
                )
            
            # Create a social login object
            social_account, created = SocialAccount.objects.get_or_create(
                provider=self.provider_id,
                uid=extra_data['sub'],
                defaults={'user': user, 'extra_data': extra_data},
            )
            
            if not created:
                social_account.extra_data = extra_data
                social_account.save()
                
            # Create and return the login object
            login = self.get_provider().sociallogin_from_response(request, extra_data)
            login.user = user
            return login
            
        except Exception as e:
            logger.error(f"Error in complete_login: {str(e)}")
            raise OAuth2Error(str(e))

oauth2_login = OAuth2LoginView.adapter_view(EntraIDOpenIDConnectAdapter)
oauth2_callback = OAuth2CallbackView.adapter_view(EntraIDOpenIDConnectAdapter)

# Register the provider
providers.registry.register(EntraIDOpenIDConnectProvider)

provider_classes = [EntraIDOpenIDConnectProvider] 