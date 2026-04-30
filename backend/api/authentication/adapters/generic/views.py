import requests
import jwt
import logging
from allauth.socialaccount.providers.oauth2.views import OAuth2Adapter, OAuth2Error
from allauth.socialaccount.models import SocialAccount
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError

from api.utils.network import validate_url_is_safe


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

            self._assert_url_safe(self.oidc_config_url)
            oidc_config_response = requests.get(
                self.oidc_config_url, allow_redirects=False
            )
            oidc_config = oidc_config_response.json()

            token_endpoint = oidc_config["token_endpoint"]
            jwks_uri = oidc_config["jwks_uri"]
            userinfo_endpoint = oidc_config["userinfo_endpoint"]
            # Endpoints returned by discovery flow back out to server-side
            # fetches (token exchange, userinfo, JWKS). Validate before
            # trusting any of them.
            self._assert_url_safe(token_endpoint)
            self._assert_url_safe(jwks_uri)
            self._assert_url_safe(userinfo_endpoint)

            self.access_token_url = token_endpoint
            self.authorize_url = oidc_config["authorization_endpoint"]
            self.profile_url = userinfo_endpoint
            self.jwks_url = jwks_uri
            self.issuer = oidc_config["issuer"]
        except Exception as e:
            logger.error(f"Failed to fetch OIDC configuration: {e}")
            if not self.default_config:
                raise
            self._set_default_config()

    @staticmethod
    def _assert_url_safe(url):
        """Reject URLs that resolve to private networks on cloud.
        Self-hosted deployments may legitimately use internal OIDC."""
        if settings.APP_HOST != "cloud":
            return
        try:
            validate_url_is_safe(url)
        except ValidationError:
            raise OAuth2Error(f"URL rejected by safety check: {url}")

    def _set_default_config(self):
        for key, value in self.default_config.items():
            setattr(self, key, value)

    def _get_user_data(self, token, id_token, app, expected_nonce=None):
        if id_token:
            return self._process_id_token(id_token, app, expected_nonce=expected_nonce)
        # Userinfo fallback can't bind to the auth request — refuse if
        # a nonce was issued (replay would be undetectable).
        if expected_nonce is not None:
            raise OAuth2Error(
                "id_token required for nonce verification; refusing to "
                "accept userinfo claims without it."
            )
        return self._fetch_user_info(token)

    def _fetch_user_info(self, token):
        headers = {"Authorization": f"Bearer {token.token}"}
        resp = requests.get(self.profile_url, headers=headers)
        resp.raise_for_status()
        return resp.json()

    def _process_id_token(self, id_token, app, expected_nonce=None):
        try:
            jwk_client = jwt.PyJWKClient(self.jwks_url)
            signing_key = jwk_client.get_signing_key_from_jwt(id_token)
            claims = jwt.decode(
                id_token,
                key=signing_key.key,
                algorithms=["RS256"],
                audience=app.client_id,
                issuer=self.issuer,
            )
        except jwt.InvalidTokenError as e:
            logger.error(f"ID token validation failed: {e}")
            raise OAuth2Error(f"Invalid ID token: {e}")

        # OIDC nonce: anchors the ID token to the specific authorize
        # request initiated by this session. Without it, a stolen token
        # could be replayed. When a nonce was sent, it MUST match.
        if expected_nonce is not None:
            if claims.get("nonce") != expected_nonce:
                logger.error(
                    "ID token nonce mismatch — possible replay or "
                    "cross-session attack"
                )
                raise OAuth2Error("Invalid ID token: nonce mismatch")

        return claims

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

            expected_nonce = (
                request.session.get("sso_nonce")
                if hasattr(request, "session")
                else None
            )
            extra_data = self._get_user_data(
                token, id_token, app, expected_nonce=expected_nonce
            )
            logger.debug(
                f"User authentication data received for email: {extra_data.get('email')}"
            )

            # Create social login object without creating user
            login = self.get_provider().sociallogin_from_response(request, extra_data)

            return login

        except OAuth2Error:
            raise
        except Exception as e:
            logger.error(f"OIDC login failed: {str(e)}")
            raise OAuth2Error(str(e))
