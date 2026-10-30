import json
import unicodedata
import logging

import graphene
from django.db import IntegrityError, transaction
from django.utils import timezone
from graphql import GraphQLError

from api.models import UserPasskey, UserRecoveryCode, UserTOTP
from api.utils.mfa import (
    build_otpauth_uri,
    clear_mfa_failures,
    consume_recovery_code,
    encrypt_seed,
    generate_recovery_codes,
    generate_totp_secret,
    lock_mfa_factors,
    mfa_attempt,
    mfa_locked_out,
    record_mfa_failure,
    user_has_active_totp,
    user_has_mfa,
    user_has_passkeys,
    verify_totp_code,
)
from api.utils.passkeys import (
    MAX_PASSKEYS_PER_USER,
    PASSKEY_NAME_MAX_LENGTH,
    PURPOSE_MANAGE,
    PasskeyError,
    authentication_options,
    authenticator_name,
    claim_registration_challenge,
    passkey_kind,
    public_key_jwk,
    registration_options,
    suggested_name,
    verify_assertion,
    verify_registration,
)
from api.utils.reauth import require_fresh_session_graphql
from backend.graphene.types import PasskeyCandidateType, PasskeyType

logger = logging.getLogger(__name__)

# 2FA management for the authenticated session. Login completion
# (/auth/mfa/options/ and /auth/mfa/verify/) stays REST — it runs pre-login
# with no authenticated session, which the private GraphQL view cannot serve.

# The new credential itself was rejected, so the client must start the
# ceremony over (a rejected proof can be retried with the same credential).
PASSKEY_REGISTRATION_FAILED = "PASSKEY_REGISTRATION_FAILED"
# The credential is already a registered passkey: the client must not ask
# the password manager to forget it.
PASSKEY_ALREADY_REGISTERED = "PASSKEY_ALREADY_REGISTERED"

# Control, format (bidi overrides, zero-width) and surrogate characters.
_HIDDEN_CATEGORIES = {"Cc", "Cf", "Cs"}


def _already_registered_error():
    return GraphQLError(
        "This passkey is already registered.",
        extensions={"code": PASSKEY_ALREADY_REGISTERED},
    )


def _already_registered(user, credential_json):
    """Whether the response's credential is already one of the user's
    passkeys, checked under the factor lock so a twin request that is
    storing it has committed first."""
    try:
        credential_id = json.loads(credential_json).get("id")
    except (TypeError, ValueError, AttributeError):
        return False
    if not isinstance(credential_id, str):
        return False
    with transaction.atomic():
        lock_mfa_factors(user)
        return UserPasskey.objects.filter(
            user=user, credential_id=credential_id
        ).exists()


def _verify_second_factor(user, code=None, recovery_code=None, passkey_credential=None):
    """Changing 2FA requires proof of a CURRENT factor IN ADDITION to the
    fresh session (session-theft hardening). One proof per request: a
    passkey, else a TOTP code, else a recovery code (so a passkey or a code
    never burns a recovery code). Codes spend an attempt before they're
    checked, so parallel guesses can't get past the limit; passkeys can't be
    guessed, so they spend none and work while codes are locked."""
    user_id = str(user.userId)
    if not user_has_mfa(user):
        raise GraphQLError("Two-factor authentication is not enabled.")
    if passkey_credential:
        try:
            verify_assertion(user, PURPOSE_MANAGE, passkey_credential)
        except PasskeyError as e:
            raise GraphQLError(str(e))
        return
    if not (code or recovery_code):
        raise GraphQLError("Confirm it's you with one of your two-factor methods.")
    if mfa_locked_out(user_id) or not mfa_attempt(user_id):
        raise GraphQLError("Too many attempts. Try again later.")
    if code:
        user_totp = UserTOTP.objects.filter(
            user=user, activated_at__isnull=False
        ).first()
        verified = user_totp is not None and verify_totp_code(user_totp, code) is not None
    else:
        verified = consume_recovery_code(user, recovery_code)
    if not verified:
        raise GraphQLError("Invalid code.")
    clear_mfa_failures(user_id)


def _send_status_email(request, user, enabled, other_factors):
    from api.emails import send_totp_status_email

    try:
        send_totp_status_email(
            request, user, enabled=enabled, other_factors=other_factors
        )
    except Exception:
        logger.exception(
            "Failed to send totp_%s email to %s",
            "enabled" if enabled else "disabled",
            user.email,
        )


def _send_passkey_email(request, user, passkey_name, added, other_factors):
    from api.emails import send_passkey_status_email

    try:
        send_passkey_status_email(
            request, user, passkey_name, added=added, other_factors=other_factors
        )
    except Exception:
        logger.exception(
            "Failed to send passkey_%s email to %s",
            "added" if added else "removed",
            user.email,
        )


def _send_recovery_regenerated_email(request, user):
    from api.emails import send_recovery_codes_regenerated_email

    try:
        send_recovery_codes_regenerated_email(request, user)
    except Exception:
        logger.exception(
            "Failed to send recovery-codes-regenerated email to %s", user.email
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

        secret = generate_totp_secret()
        # Under the factor lock, so it can't reset an activation in flight.
        with transaction.atomic():
            lock_mfa_factors(user)
            if user_has_active_totp(user):
                raise GraphQLError("Two-factor authentication is already enabled.")
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
        # Proof of an existing factor, required when passkeys are registered.
        recovery_code = graphene.String(required=False)
        passkey_credential = graphene.String(required=False)

    # Only when TOTP is the first factor; otherwise the existing codes stay.
    recovery_codes = graphene.List(graphene.String)

    @classmethod
    def mutate(cls, root, info, code, recovery_code=None, passkey_credential=None):
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
        # The seed the code is checked against: activation applies to it only.
        enrolled_seed = user_totp.encrypted_seed

        # The new code first: a typo must not cost the proof (which may be a
        # single-use recovery code).
        if verify_totp_code(user_totp, code) is None:
            record_mfa_failure(str(user.userId))
            # Coded apart from a rejected proof: the client sends the user
            # back to the code step.
            raise GraphQLError("Invalid code.", extensions={"code": "TOTP_CODE_INVALID"})

        if user_has_passkeys(user):
            _verify_second_factor(
                user, recovery_code=recovery_code, passkey_credential=passkey_credential
            )

        clear_mfa_failures(str(user.userId))
        with transaction.atomic():
            lock_mfa_factors(user)
            is_first_factor = not user_has_mfa(user)
            # A setup restarted meanwhile (another tab) has a new seed: don't
            # turn on one this code was never checked against.
            activated = UserTOTP.objects.filter(
                pk=user_totp.pk, activated_at__isnull=True, encrypted_seed=enrolled_seed
            ).update(activated_at=timezone.now())
            if not activated:
                raise GraphQLError(
                    "Authenticator app setup was restarted. Please start again."
                )
            recovery_codes = generate_recovery_codes(user) if is_first_factor else None

        _send_status_email(
            request, user, enabled=True, other_factors=not is_first_factor
        )
        logger.info(
            json.dumps({"event": "totp_enabled", "user_id": str(user.userId)})
        )
        return ActivateMfaMutation(recovery_codes=recovery_codes)


class DisableMfaMutation(graphene.Mutation):
    """Remove TOTP. Recovery codes go too only if no passkey remains."""

    class Arguments:
        code = graphene.String(required=False)
        recovery_code = graphene.String(required=False)
        passkey_credential = graphene.String(required=False)

    ok = graphene.Boolean()

    @classmethod
    def mutate(cls, root, info, code=None, recovery_code=None, passkey_credential=None):
        request = info.context
        user = request.user

        require_fresh_session_graphql(request)

        if not user_has_active_totp(user):
            raise GraphQLError("Authenticator app sign-in is not enabled.")
        _verify_second_factor(user, code, recovery_code, passkey_credential)

        with transaction.atomic():
            lock_mfa_factors(user)
            # Hard delete: a disabled 2FA must not leave a resurrectable seed.
            UserTOTP.objects.filter(user=user).delete()
            passkeys_remain = user_has_passkeys(user)
            if not passkeys_remain:
                UserRecoveryCode.objects.filter(user=user).delete()

        _send_status_email(request, user, enabled=False, other_factors=passkeys_remain)
        logger.info(
            json.dumps({"event": "totp_disabled", "user_id": str(user.userId)})
        )
        return DisableMfaMutation(ok=True)


class RegenerateRecoveryCodesMutation(graphene.Mutation):
    class Arguments:
        code = graphene.String(required=False)
        recovery_code = graphene.String(required=False)
        passkey_credential = graphene.String(required=False)

    recovery_codes = graphene.List(graphene.String)

    @classmethod
    def mutate(cls, root, info, code=None, recovery_code=None, passkey_credential=None):
        request = info.context
        user = request.user

        require_fresh_session_graphql(request)
        _verify_second_factor(user, code, recovery_code, passkey_credential)

        with transaction.atomic():
            lock_mfa_factors(user)
            # The last factor may have gone meanwhile: no codes without 2FA.
            if not user_has_mfa(user):
                raise GraphQLError("Two-factor authentication is not enabled.")
            recovery_codes = generate_recovery_codes(user)
        _send_recovery_regenerated_email(request, user)
        return RegenerateRecoveryCodesMutation(recovery_codes=recovery_codes)


class BeginPasskeyRegistrationMutation(graphene.Mutation):
    """Creation options for navigator.credentials.create(). Nothing is stored
    until finishPasskeyRegistration verifies the browser's response."""

    options = graphene.JSONString()

    @classmethod
    def mutate(cls, root, info):
        request = info.context
        user = request.user

        require_fresh_session_graphql(request)

        if UserPasskey.objects.filter(user=user).count() >= MAX_PASSKEYS_PER_USER:
            raise GraphQLError(
                f"You can register up to {MAX_PASSKEYS_PER_USER} passkeys."
            )
        return BeginPasskeyRegistrationMutation(options=registration_options(user))


class InspectPasskeyRegistrationMutation(graphene.Mutation):
    """Verify a new passkey and describe it, without storing it or using its
    challenge up, so the user can review it (and name it) before adding."""

    class Arguments:
        credential = graphene.String(required=True)

    passkey = graphene.Field(PasskeyCandidateType)

    @classmethod
    def mutate(cls, root, info, credential):
        request = info.context
        user = request.user

        require_fresh_session_graphql(request)

        try:
            fields, _ = verify_registration(user, credential)
        except PasskeyError as e:
            raise GraphQLError(
                str(e), extensions={"code": PASSKEY_REGISTRATION_FAILED}
            )
        # Refused at finish anyway: say so before the user names and proves it.
        if UserPasskey.objects.filter(credential_id=fields["credential_id"]).exists():
            raise _already_registered_error()
        kind = passkey_kind(fields["backup_eligible"], fields["transports"])
        return InspectPasskeyRegistrationMutation(
            passkey=PasskeyCandidateType(
                credential_id=fields["credential_id"],
                suggested_name=suggested_name(user, fields["aaguid"], kind),
                kind=kind,
                aaguid=fields["aaguid"],
                authenticator_name=authenticator_name(fields["aaguid"]),
                transports=fields["transports"],
                synced=fields["backup_eligible"],
                prf_enabled=fields["prf_enabled"],
                public_key=public_key_jwk(fields["public_key"]),
            )
        )


class FinishPasskeyRegistrationMutation(graphene.Mutation):
    class Arguments:
        name = graphene.String(required=True)
        credential = graphene.String(required=True)
        # Proof of an existing factor, required once any factor is active.
        code = graphene.String(required=False)
        recovery_code = graphene.String(required=False)
        passkey_credential = graphene.String(required=False)

    passkey = graphene.Field(PasskeyType)
    # Only when the passkey is the first factor; otherwise the existing
    # codes stay.
    recovery_codes = graphene.List(graphene.String)

    @classmethod
    def mutate(
        cls,
        root,
        info,
        name,
        credential,
        code=None,
        recovery_code=None,
        passkey_credential=None,
    ):
        request = info.context
        user = request.user

        require_fresh_session_graphql(request)

        name = (name or "").strip()
        if not name:
            raise GraphQLError("Give your passkey a name.")
        if len(name) > PASSKEY_NAME_MAX_LENGTH:
            raise GraphQLError(
                f"Passkey names can be at most {PASSKEY_NAME_MAX_LENGTH} characters."
            )
        # Shown in the account page and security emails: no control or
        # invisible formatting characters (a NUL would also fail the insert
        # after the proof was spent), and no copy of another passkey's name.
        if any(unicodedata.category(c) in _HIDDEN_CATEGORIES for c in name):
            raise GraphQLError("Passkey names can't contain control characters.")
        taken = UserPasskey.objects.filter(user=user).values_list("name", flat=True)
        if name.casefold() in {n.casefold() for n in taken}:
            raise GraphQLError("You already have a passkey with this name.")

        # The new credential first, without using its challenge up: a bad
        # credential must not cost the proof (a recovery code is single-use),
        # and a rejected proof leaves the credential good for a retry.
        try:
            fields, challenge = verify_registration(user, credential)
        except PasskeyError as e:
            # Its challenge is gone when a twin request (a double submit)
            # stored it: report that, so the client never tells the password
            # manager to forget a live passkey.
            if e.code == "registration_expired" and _already_registered(
                user, credential
            ):
                raise _already_registered_error()
            raise GraphQLError(
                str(e), extensions={"code": PASSKEY_REGISTRATION_FAILED}
            )

        if user_has_mfa(user):
            _verify_second_factor(user, code, recovery_code, passkey_credential)

        try:
            with transaction.atomic():
                lock_mfa_factors(user)
                # Claimed under the lock: a twin request waits here, then
                # sees the passkey this one stored.
                if not claim_registration_challenge(user, challenge):
                    if UserPasskey.objects.filter(
                        user=user, credential_id=fields["credential_id"]
                    ).exists():
                        raise _already_registered_error()
                    raise GraphQLError(
                        "Passkey setup expired. Please try again.",
                        extensions={"code": PASSKEY_REGISTRATION_FAILED},
                    )
                if (
                    UserPasskey.objects.filter(user=user).count()
                    >= MAX_PASSKEYS_PER_USER
                ):
                    raise GraphQLError(
                        f"You can register up to {MAX_PASSKEYS_PER_USER} passkeys."
                    )
                is_first_factor = not user_has_mfa(user)
                passkey = UserPasskey.objects.create(user=user, name=name, **fields)
                recovery_codes = (
                    generate_recovery_codes(user) if is_first_factor else None
                )
        except IntegrityError:
            raise _already_registered_error()

        _send_passkey_email(
            request, user, name, added=True, other_factors=not is_first_factor
        )
        logger.info(
            json.dumps(
                {
                    "event": "passkey_added",
                    "user_id": str(user.userId),
                    "passkey_id": str(passkey.id),
                }
            )
        )
        return FinishPasskeyRegistrationMutation(
            passkey=passkey, recovery_codes=recovery_codes
        )


class BeginPasskeyVerificationMutation(graphene.Mutation):
    """Request options for proving an existing passkey ahead of a 2FA change
    (passed back as `passkeyCredential`)."""

    options = graphene.JSONString()

    @classmethod
    def mutate(cls, root, info):
        request = info.context
        user = request.user

        require_fresh_session_graphql(request)

        options = authentication_options(user, PURPOSE_MANAGE)
        if options is None:
            raise GraphQLError("No passkeys are registered.")
        return BeginPasskeyVerificationMutation(options=options)


class DeletePasskeyMutation(graphene.Mutation):
    """Remove a passkey. Removing the last factor turns 2FA off and deletes
    the recovery codes."""

    class Arguments:
        passkey_id = graphene.ID(required=True)
        code = graphene.String(required=False)
        recovery_code = graphene.String(required=False)
        passkey_credential = graphene.String(required=False)

    ok = graphene.Boolean()

    @classmethod
    def mutate(
        cls,
        root,
        info,
        passkey_id,
        code=None,
        recovery_code=None,
        passkey_credential=None,
    ):
        request = info.context
        user = request.user

        require_fresh_session_graphql(request)

        passkey = UserPasskey.objects.filter(user=user, id=passkey_id).first()
        if passkey is None:
            raise GraphQLError("Passkey not found.")
        _verify_second_factor(user, code, recovery_code, passkey_credential)

        with transaction.atomic():
            lock_mfa_factors(user)
            UserPasskey.objects.filter(user=user, id=passkey.id).delete()
            mfa_on = user_has_mfa(user)
            if not mfa_on:
                UserRecoveryCode.objects.filter(user=user).delete()

        _send_passkey_email(
            request, user, passkey.name, added=False, other_factors=mfa_on
        )
        logger.info(
            json.dumps(
                {
                    "event": "passkey_removed",
                    "user_id": str(user.userId),
                    "passkey_id": str(passkey.id),
                }
            )
        )
        return DeletePasskeyMutation(ok=True)
