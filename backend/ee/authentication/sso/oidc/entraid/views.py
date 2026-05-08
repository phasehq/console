import jwt
import json
import os
from api.models import ActivatedPhaseLicense
from django.conf import settings
from django.utils import timezone
from api.emails import send_login_email
from allauth.socialaccount.providers.microsoft.views import MicrosoftGraphOAuth2Adapter
from allauth.socialaccount.providers.oauth2.client import OAuth2Error
from allauth.socialaccount.adapter import get_adapter
import logging

logger = logging.getLogger(__name__)

# Multi-tenant JWKS — PyJWKClient picks the right key by `kid`.
_MS_JWKS_URL = "https://login.microsoftonline.com/common/discovery/v2.0/keys"

# Issuer is built from the configured tenant_id; both `iss` and `tid`
# get pinned to it during validation.
_MS_ISSUER_PREFIX = "https://login.microsoftonline.com/"
_MS_ISSUER_SUFFIX = "/v2.0"


def _validate_ms_id_token(
    id_token,
    audience,
    expected_tenant_id,
    expected_nonce=None,
):
    """Verify signature (via /common JWKS), audience, expiry, issuer,
    tenant, and nonce. `expected_tenant_id` is required — without it,
    any Microsoft tenant's token would validate."""
    if not expected_tenant_id:
        logger.error("Entra ID validation: no expected tenant_id configured")
        raise OAuth2Error("Tenant configuration missing — cannot verify token.")

    try:
        jwk_client = jwt.PyJWKClient(_MS_JWKS_URL)
        signing_key = jwk_client.get_signing_key_from_jwt(id_token)
    except Exception as e:
        logger.error(f"Microsoft JWKS fetch failed: {e}")
        raise OAuth2Error("Unable to verify ID token (JWKS fetch failed).")

    expected_issuer = (
        f"{_MS_ISSUER_PREFIX}{expected_tenant_id}{_MS_ISSUER_SUFFIX}"
    )
    try:
        claims = jwt.decode(
            id_token,
            key=signing_key.key,
            algorithms=["RS256"],
            audience=audience,
            issuer=expected_issuer,
        )
    except jwt.InvalidTokenError as e:
        logger.error(f"Microsoft ID token validation failed: {e}")
        raise OAuth2Error(f"Invalid ID token: {e}")

    # Defense-in-depth: assert `tid` matches the configured tenant even
    # after PyJWT's issuer check.
    tid = claims.get("tid", "")
    if tid.lower() != expected_tenant_id.lower():
        logger.error(
            f"Microsoft ID token tenant mismatch: tid={tid!r} != "
            f"expected={expected_tenant_id!r}"
        )
        raise OAuth2Error("Invalid ID token: tenant mismatch")

    if expected_nonce is not None:
        if claims.get("nonce") != expected_nonce:
            logger.error("Microsoft ID token nonce mismatch — possible replay")
            raise OAuth2Error("Invalid ID token: nonce mismatch")

    return claims


def _resolve_expected_tenant_id(request):
    """Org-level: tenant from `OrganisationSSOProvider.config`.
    Instance-level: tenant from `ENTRA_ID_OIDC_TENANT_ID` env."""
    session = getattr(request, "session", None)
    org_config_id = session.get("sso_org_config_id") if session else None
    if org_config_id:
        try:
            from api.utils.sso import get_org_sso_config

            _provider, org_config = get_org_sso_config(org_config_id)
            tenant = org_config.get("tenant_id") if org_config else None
            if tenant:
                return tenant
        except Exception as e:
            logger.error(
                f"Failed to load org SSO config {org_config_id}: {e}"
            )
            return None

    return os.getenv("ENTRA_ID_OIDC_TENANT_ID")


class CustomMicrosoftGraphOAuth2Adapter(MicrosoftGraphOAuth2Adapter):
    def _check_microsoft_errors(self, response):
        try:
            data = response.json()
        except json.decoder.JSONDecodeError:
            raise OAuth2Error(
                "Invalid JSON from Microsoft Graph API: {}".format(response.text)
            )

        if "id" not in data:
            error_message = "Error retrieving Microsoft profile"
            microsoft_error_message = data.get("error", {}).get("message")
            if microsoft_error_message:
                error_message = ": ".join((error_message, microsoft_error_message))
            raise OAuth2Error(error_message)

        data["name"] = data.get("displayName")
        if data["name"] is None:
            data["name"] = "{} {}".format(data.get("givenName"), data.get("surName"))
        return data

    def complete_login(self, request, app, token, **kwargs):

        if settings.APP_HOST != "cloud":
            activated_license_exists = ActivatedPhaseLicense.objects.filter(
                expires_at__gte=timezone.now()
            ).exists()

            if not activated_license_exists and not settings.PHASE_LICENSE:
                error = "You need a license to login via OIDC."
                logger.error(f"OIDC login failed: {str(error)}")
                raise OAuth2Error(str(error))

        # Microsoft returns the ID token in the token exchange response
        # alongside the access token. Validate it properly — signature,
        # audience, issuer, expiry, and nonce — BEFORE trusting any of
        # its claims.
        response_payload = kwargs.get("response") or {}
        id_token = getattr(token, "id_token", None) or response_payload.get(
            "id_token"
        )
        if not id_token:
            raise OAuth2Error(
                "Microsoft Entra ID did not return an id_token; refusing to "
                "accept access-token claims unverified."
            )

        expected_nonce = (
            request.session.get("sso_nonce")
            if hasattr(request, "session")
            else None
        )
        expected_tenant_id = _resolve_expected_tenant_id(request)
        validated_claims = _validate_ms_id_token(
            id_token,
            audience=app.client_id,
            expected_tenant_id=expected_tenant_id,
            expected_nonce=expected_nonce,
        )

        headers = {"Authorization": "Bearer {0}".format(token.token)}
        response = (
            get_adapter()
            .get_requests_session()
            .get(
                self.profile_url,
                params=self.profile_url_params,
                headers=headers,
            )
        )

        extra_data = self._check_microsoft_errors(response)

        login = self.get_provider().sociallogin_from_response(request, extra_data)

        # Email now comes from the validated ID token (or the Graph
        # response as a fallback). Either way the IdP has been
        # cryptographically verified.
        email = (
            validated_claims.get("email")
            or validated_claims.get("preferred_username")
            or extra_data.get("mail")
            or extra_data.get("userPrincipalName")
        )
        if email:
            login.user.email = email

        try:
            full_name = extra_data.get("name", "")
            send_login_email(request, login.user.email, full_name, "Microsoft Entra ID")
        except Exception as e:
            logger.error(f"Error sending login email: {e}")

        return login
