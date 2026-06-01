from allauth.socialaccount.providers.oauth2.views import (
    OAuth2LoginView,
    OAuth2CallbackView,
)
from allauth.socialaccount.providers.oauth2.views import OAuth2Error
from allauth.socialaccount import providers

from django.conf import settings
from django.utils import timezone

import logging
from api.authentication.adapters.generic.provider import GenericOpenIDConnectProvider
from api.authentication.adapters.generic.views import GenericOpenIDConnectAdapter
from api.emails import send_login_email
from api.models import ActivatedPhaseLicense
import os

logger = logging.getLogger(__name__)


class OktaOpenIDConnectProvider(GenericOpenIDConnectProvider):
    id = "okta-oidc"
    name = "Okta OIDC"


class OktaOpenIDConnectAdapter(GenericOpenIDConnectAdapter):
    provider_id = OktaOpenIDConnectProvider.id

    def _resolve_issuer(self):
        """Resolve the Okta issuer URL.

        The session key `sso_org_config_id` is the intent signal:

        - When present, the user entered the org-level SSO flow → use that
          org's stored config. If the config can't be loaded or is missing
          an `issuer`, FAIL CLOSED — don't silently fall back to the
          instance-level env, which could route the user to a different IdP
          than the operator intended.
        - When absent, the user entered the instance-level flow → use
          `OKTA_OIDC_ISSUER` from env.
        """
        session = getattr(self.request, "session", None) if self.request else None
        org_config_id = session.get("sso_org_config_id") if session else None

        if org_config_id:
            try:
                from api.utils.sso import get_org_sso_config

                _provider, org_config = get_org_sso_config(org_config_id)
            except Exception as e:
                logger.error(
                    f"Failed to load org SSO config {org_config_id}: {e}"
                )
                raise ValueError(
                    f"Org-level Okta SSO config {org_config_id} could not be loaded"
                )

            issuer = org_config.get("issuer") if org_config else None
            if not issuer:
                raise ValueError(
                    f"Org-level Okta SSO config {org_config_id} is missing 'issuer'"
                )
            return issuer.rstrip("/")

        issuer = os.getenv("OKTA_OIDC_ISSUER")
        if not issuer:
            raise ValueError(
                "OKTA_OIDC_ISSUER must be set, or configure org-level Okta SSO"
            )
        return issuer.rstrip("/")

    @property
    def oidc_config_url(self):
        return f"{self._resolve_issuer()}/.well-known/openid-configuration"

    @property
    def default_config(self):
        issuer = self._resolve_issuer()
        return {
            "access_token_url": f"{issuer}/v1/token",
            "authorize_url": f"{issuer}/v1/authorize",
            "profile_url": f"{issuer}/v1/userinfo",
            "jwks_url": f"{issuer}/v1/keys",
            "issuer": issuer,
        }

    def complete_login(self, request, app, token, **kwargs):
        if settings.APP_HOST != "cloud":
            activated_license_exists = ActivatedPhaseLicense.objects.filter(
                expires_at__gte=timezone.now()
            ).exists()

            if not activated_license_exists and not settings.PHASE_LICENSE:
                error = "You need a license to login via OIDC."
                logger.error(f"OIDC login failed: {str(error)}")
                raise OAuth2Error(str(error))

        try:
            id_token = getattr(token, "id_token", None)
            if not id_token and isinstance(kwargs.get("response"), dict):
                id_token = kwargs["response"].get("id_token")

            # Forward the OIDC nonce so the parent's _process_id_token
            # actually validates it. Without this kwarg the check is
            # silently skipped (defaults to None → guard short-circuits).
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

            try:
                email = login.user.email if login.user else extra_data.get("email", "")
                full_name = extra_data.get("name", "")
                if email:
                    send_login_email(request, email, full_name, "Okta")
            except Exception as email_err:
                logger.error(f"Failed to send Okta login email: {email_err}")

            return login

        except Exception as e:
            logger.error(f"OIDC login failed: {str(e)}")
            raise OAuth2Error(str(e))


oauth2_login = OAuth2LoginView.adapter_view(OktaOpenIDConnectAdapter)
oauth2_callback = OAuth2CallbackView.adapter_view(OktaOpenIDConnectAdapter)

# Register the provider
providers.registry.register(OktaOpenIDConnectProvider)

provider_classes = [OktaOpenIDConnectProvider]
