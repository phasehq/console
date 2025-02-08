import requests
from api.models import ActivatedPhaseLicense
from ee.licensing.verifier import check_license
import jwt
import logging
from allauth.socialaccount.providers.oauth2.views import OAuth2Adapter, OAuth2Error
from allauth.socialaccount.models import SocialAccount
from django.contrib.auth import get_user_model
from api.emails import send_login_email
from django.conf import settings
from django.utils import timezone

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

    def complete_login(self, request, app, token, **kwargs):

        if settings.APP_HOST == "cloud":
            error = "OIDC is not available in cloud mode"
            logger.error(f"OIDC login failed: {str(error)}")
            raise OAuth2Error(str(error))

        # Check if a valid license env var or pre-activated valid license already exists for this instance
        activated_license_exists = ActivatedPhaseLicense.objects.filter(
            expires_at__gte=timezone.now()
        ).exists()

        if not activated_license_exists and not settings.PHASE_LICENSE:
            error = f"You need a license to login via OIDC."
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

            # Get or create user
            User = get_user_model()
            try:
                user = User.objects.get(email=extra_data["email"])
            except User.DoesNotExist:
                user = User.objects.create_user(
                    email=extra_data["email"],
                    username=extra_data["email"],
                    password=None,
                )

            extra_data["display_name"] = extra_data.get("name", "")

            # Create or update social account
            social_account, created = SocialAccount.objects.get_or_create(
                provider=self.provider_id,
                uid=extra_data["sub"],
                defaults={"user": user, "extra_data": extra_data},
            )

            if not created:
                social_account.extra_data = extra_data
                social_account.save()

            try:
                send_login_email(
                    request,
                    extra_data["email"],
                    extra_data.get("name", ""),
                    self.get_provider().name,
                )
            except Exception as e:
                logger.warning(
                    f"Failed to send login email to {extra_data['email']}: {str(e)}"
                )

            login = self.get_provider().sociallogin_from_response(request, extra_data)
            login.user = user
            return login

        except Exception as e:
            logger.error(f"OIDC login failed: {str(e)}")
            raise OAuth2Error(str(e))
