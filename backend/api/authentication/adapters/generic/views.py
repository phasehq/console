import requests
import jwt
import logging
from allauth.socialaccount.providers.oauth2.views import OAuth2Adapter, OAuth2Error
from allauth.socialaccount.models import SocialAccount
from django.contrib.auth import get_user_model


logger = logging.getLogger(__name__)


class GenericOpenIDConnectAdapter(OAuth2Adapter):
    """
    Generic adapter for OpenID Connect providers implementing OAuth2 + OIDC specification.
    Handles the OpenID Connect authentication flow and token verification.
    """

    provider_id = None
    oidc_config_url = None
    default_config = None

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._fetch_oidc_config()

    def _fetch_oidc_config(self):
        try:
            if not self.oidc_config_url:
                raise ValueError("OIDC configuration URL not set")

            oidc_config_response = requests.get(self.oidc_config_url)
            oidc_config = oidc_config_response.json()

            self.access_token_url = oidc_config["token_endpoint"]
            self.authorize_url = oidc_config["authorization_endpoint"]
            self.profile_url = oidc_config["userinfo_endpoint"]
            self.jwks_url = oidc_config["jwks_uri"]
            self.issuer = oidc_config["issuer"]
        except Exception as e:
            logger.error(f"Failed to fetch OIDC configuration: {e}")
            if not self.default_config:
                raise
            self._set_default_config()

    def _set_default_config(self):
        for key, value in self.default_config.items():
            setattr(self, key, value)

    def _get_user_data(self, token, id_token, app):
        if id_token:
            return self._process_id_token(id_token, app)
        return self._fetch_user_info(token)

    def _fetch_user_info(self, token):
        headers = {"Authorization": f"Bearer {token.token}"}
        resp = requests.get(self.profile_url, headers=headers)
        resp.raise_for_status()
        return resp.json()

    def _process_id_token(self, id_token, app):
        jwks_response = requests.get(self.jwks_url)
        jwks = jwks_response.json()
        try:
            return jwt.decode(
                id_token,
                key=jwks,
                algorithms=["RS256"],
                audience=app.client_id,
                issuer=self.issuer,
            )
        except jwt.InvalidTokenError as e:
            logger.error(f"ID token validation failed: {e}")
            raise OAuth2Error(f"Invalid ID token: {e}")

    def pre_social_login(self, request, sociallogin):
        User = get_user_model()

        # Extract email from social login
        email = sociallogin.account.extra_data.get("email")
        if not email:
            logger.error("OIDC login failed: No email provided.")
            return

        try:
            user = User.objects.get(email=email)
            sociallogin.user = user  # Attach the existing user
        except User.DoesNotExist:
            # Create new user
            user = User.objects.create_user(
                email=email,
                username=email,
                password=None,
            )
            sociallogin.user = user  # Attach the new user

        # Ensure social account is linked correctly
        social_account, created = SocialAccount.objects.get_or_create(
            provider=sociallogin.account.provider,
            uid=sociallogin.account.uid,
            defaults={"user": user, "extra_data": sociallogin.account.extra_data},
        )

        if not created:
            social_account.extra_data = sociallogin.account.extra_data
            social_account.save()

    def complete_login(self, request, app, token, **kwargs):

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
