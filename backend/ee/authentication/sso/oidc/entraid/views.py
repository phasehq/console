import jwt
import json
from api.models import ActivatedPhaseLicense
from django.conf import settings
from django.utils import timezone
from api.emails import send_login_email
from allauth.socialaccount.providers.microsoft.views import MicrosoftGraphOAuth2Adapter
from allauth.socialaccount.providers.oauth2.client import OAuth2Error
from allauth.socialaccount.adapter import get_adapter
import logging

logger = logging.getLogger(__name__)

# Microsoft's JWKS endpoint for v2 tokens. Keys are shared across
# tenants (different `kid` per key); PyJWKClient picks the right one
# based on the token's `kid` header.
_MS_JWKS_URL = "https://login.microsoftonline.com/common/discovery/v2.0/keys"

# Issuer URL prefix/suffix for v2 tokens. The tenant id in the middle
# is dynamic, so we can't pin a single issuer; instead we assert the
# claim matches the expected shape, with the tid taken from the token
# itself.
_MS_ISSUER_PREFIX = "https://login.microsoftonline.com/"
_MS_ISSUER_SUFFIX = "/v2.0"


def _validate_ms_id_token(id_token, audience, expected_nonce=None):
    """Verify a Microsoft Entra ID token end-to-end: signature via
    JWKS, audience, expiry, issuer shape, and nonce.

    Returns the validated claims dict. Raises OAuth2Error on failure.
    """
    try:
        jwk_client = jwt.PyJWKClient(_MS_JWKS_URL)
        signing_key = jwk_client.get_signing_key_from_jwt(id_token)
    except Exception as e:
        logger.error(f"Microsoft JWKS fetch failed: {e}")
        raise OAuth2Error("Unable to verify ID token (JWKS fetch failed).")

    try:
        # Don't use PyJWT's built-in issuer check — Entra's issuer
        # embeds the tenant id which is dynamic. Verify the rest here
        # and validate the shape of `iss` manually below.
        claims = jwt.decode(
            id_token,
            key=signing_key.key,
            algorithms=["RS256"],
            audience=audience,
            options={"verify_iss": False},
        )
    except jwt.InvalidTokenError as e:
        logger.error(f"Microsoft ID token validation failed: {e}")
        raise OAuth2Error(f"Invalid ID token: {e}")

    issuer = claims.get("iss", "")
    tid = claims.get("tid", "")
    expected_issuer = f"{_MS_ISSUER_PREFIX}{tid}{_MS_ISSUER_SUFFIX}"
    if not tid or issuer != expected_issuer:
        logger.error(
            f"Microsoft ID token issuer mismatch: {issuer!r} != {expected_issuer!r}"
        )
        raise OAuth2Error("Invalid ID token: issuer mismatch")

    if expected_nonce is not None:
        if claims.get("nonce") != expected_nonce:
            logger.error(
                "Microsoft ID token nonce mismatch — possible replay"
            )
            raise OAuth2Error("Invalid ID token: nonce mismatch")

    return claims


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
        validated_claims = _validate_ms_id_token(
            id_token, audience=app.client_id, expected_nonce=expected_nonce
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
