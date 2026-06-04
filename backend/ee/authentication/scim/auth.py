import hashlib
import logging

from django.utils import timezone
from rest_framework import authentication, exceptions

from api.models import SCIMToken
from backend.quotas import can_use_scim

logger = logging.getLogger(__name__)


class SCIMServiceUser:
    """Minimal user object satisfying DRF's request.user contract."""

    def __init__(self, scim_token):
        self.id = scim_token.id
        self.is_authenticated = True
        self.is_active = True
        self.scim_token = scim_token
        self.organisation = scim_token.organisation


class SCIMTokenAuthentication(authentication.BaseAuthentication):
    """
    Authenticates SCIM v2 requests via Bearer token.
    Header format: Authorization: Bearer <token>
    """

    def authenticate(self, request):
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return None

        raw_token = auth_header[7:]

        # Only match SCIM tokens (ph_scim: prefix)
        if not raw_token.startswith("ph_scim:"):
            return None

        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()

        try:
            scim_token = SCIMToken.objects.select_related("organisation").get(
                token_hash=token_hash,
                deleted_at__isnull=True,
            )
        except SCIMToken.DoesNotExist:
            raise exceptions.AuthenticationFailed("Invalid SCIM token")

        if scim_token.expires_at and scim_token.expires_at < timezone.now():
            raise exceptions.AuthenticationFailed("SCIM token has expired")

        if not scim_token.organisation.scim_enabled:
            raise exceptions.AuthenticationFailed(
                "SCIM is not enabled for this organisation"
            )

        if not scim_token.is_active:
            raise exceptions.AuthenticationFailed(
                "This SCIM token is disabled"
            )

        if not can_use_scim(scim_token.organisation):
            raise exceptions.AuthenticationFailed(
                "SCIM provisioning requires an Enterprise plan"
            )

        # Track usage
        scim_token.last_used_at = timezone.now()
        scim_token.save(update_fields=["last_used_at"])

        user = SCIMServiceUser(scim_token)
        auth_info = {
            "scim_token": scim_token,
            "organisation": scim_token.organisation,
        }
        return (user, auth_info)
