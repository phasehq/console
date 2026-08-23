import json
import logging

import graphene
from django.utils import timezone
from graphql import GraphQLError

from api.models import UserRecoveryCode, UserTOTP
from api.utils.mfa import (
    build_otpauth_uri,
    clear_mfa_failures,
    consume_recovery_code,
    encrypt_seed,
    generate_recovery_codes,
    generate_totp_secret,
    mfa_locked_out,
    record_mfa_failure,
    user_has_active_totp,
    verify_totp_code,
)
from api.utils.reauth import require_fresh_session_graphql

logger = logging.getLogger(__name__)

# TOTP management for the authenticated session. The login-completion
# endpoint (/auth/mfa/verify/) stays REST — it runs pre-login with no
# authenticated session, which the private GraphQL view cannot serve.


def _verify_management_code(user, code, recovery_code):
    """Disable/regenerate require a current TOTP code or an unused recovery
    code IN ADDITION to the fresh session (session-theft hardening)."""
    if mfa_locked_out(str(user.userId)):
        raise GraphQLError("Too many attempts. Try again later.")

    user_totp = UserTOTP.objects.filter(user=user, activated_at__isnull=False).first()
    if user_totp is None:
        raise GraphQLError("Two-factor authentication is not enabled.")

    if code and verify_totp_code(user_totp, code) is not None:
        clear_mfa_failures(str(user.userId))
        return
    if recovery_code and consume_recovery_code(user, recovery_code):
        clear_mfa_failures(str(user.userId))
        return

    record_mfa_failure(str(user.userId))
    raise GraphQLError("Invalid code.")


def _send_status_email(request, user, enabled):
    from api.emails import send_totp_status_email

    try:
        send_totp_status_email(request, user, enabled=enabled)
    except Exception:
        logger.exception(
            "Failed to send totp_%s email to %s",
            "enabled" if enabled else "disabled",
            user.email,
        )


class EnrollMfaMutation(graphene.Mutation):
    """Create (or overwrite) a pending enrollment and return the secret.
    Nothing is enabled until a code verifies via activateMfa."""

    secret = graphene.String()
    otpauth_uri = graphene.String()

    @classmethod
    def mutate(cls, root, info):
        request = info.context
        user = request.user

        require_fresh_session_graphql(request)

        if user_has_active_totp(user):
            raise GraphQLError("Two-factor authentication is already enabled.")

        secret = generate_totp_secret()
        UserTOTP.objects.update_or_create(
            user=user,
            defaults={
                "encrypted_seed": encrypt_seed(secret),
                "activated_at": None,
                "last_verified_timestep": 0,
            },
        )

        return EnrollMfaMutation(
            secret=secret, otpauth_uri=build_otpauth_uri(secret, user.email)
        )


class ActivateMfaMutation(graphene.Mutation):
    class Arguments:
        code = graphene.String(required=True)

    recovery_codes = graphene.List(graphene.String)

    @classmethod
    def mutate(cls, root, info, code):
        request = info.context
        user = request.user

        require_fresh_session_graphql(request)

        if mfa_locked_out(str(user.userId)):
            raise GraphQLError("Too many attempts. Try again later.")

        user_totp = UserTOTP.objects.filter(
            user=user, activated_at__isnull=True
        ).first()
        if user_totp is None:
            raise GraphQLError("No pending enrollment.")

        if verify_totp_code(user_totp, code) is None:
            record_mfa_failure(str(user.userId))
            raise GraphQLError("Invalid code.")

        clear_mfa_failures(str(user.userId))
        user_totp.activated_at = timezone.now()
        user_totp.save(update_fields=["activated_at"])
        recovery_codes = generate_recovery_codes(user)

        _send_status_email(request, user, enabled=True)
        logger.info(
            json.dumps({"event": "totp_enabled", "user_id": str(user.userId)})
        )
        return ActivateMfaMutation(recovery_codes=recovery_codes)


class DisableMfaMutation(graphene.Mutation):
    class Arguments:
        code = graphene.String(required=False)
        recovery_code = graphene.String(required=False)

    ok = graphene.Boolean()

    @classmethod
    def mutate(cls, root, info, code=None, recovery_code=None):
        request = info.context
        user = request.user

        require_fresh_session_graphql(request)
        _verify_management_code(user, code, recovery_code)

        # Hard delete: a disabled 2FA must not leave a resurrectable seed.
        UserTOTP.objects.filter(user=user).delete()
        UserRecoveryCode.objects.filter(user=user).delete()

        _send_status_email(request, user, enabled=False)
        logger.info(
            json.dumps({"event": "totp_disabled", "user_id": str(user.userId)})
        )
        return DisableMfaMutation(ok=True)


class RegenerateRecoveryCodesMutation(graphene.Mutation):
    class Arguments:
        code = graphene.String(required=False)
        recovery_code = graphene.String(required=False)

    recovery_codes = graphene.List(graphene.String)

    @classmethod
    def mutate(cls, root, info, code=None, recovery_code=None):
        request = info.context
        user = request.user

        require_fresh_session_graphql(request)
        _verify_management_code(user, code, recovery_code)

        return RegenerateRecoveryCodesMutation(
            recovery_codes=generate_recovery_codes(user)
        )
