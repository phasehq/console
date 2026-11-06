"""Second-factor login completion (TOTP, passkey or recovery code). These
are the MFA endpoints that stay REST: they run pre-login (anonymous,
mfa_pending_* session state) so they cannot ride the login-required GraphQL
view. Enrollment/management live in backend/graphene/mutations/mfa.py."""

import logging
import time

from django.contrib.auth import get_user_model, login
from django.http import JsonResponse

from rest_framework.authentication import CSRFCheck
from rest_framework.decorators import (
    api_view,
    authentication_classes,
    permission_classes,
    throttle_classes,
)
from rest_framework.permissions import AllowAny
from rest_framework.throttling import AnonRateThrottle

from api.emails import send_login_email
from api.models import UserTOTP
from api.utils.mfa import (
    clear_mfa_failures,
    consume_recovery_code,
    mfa_attempt,
    mfa_locked_out,
    user_has_active_totp,
    user_has_mfa,
    verify_totp_code,
)
from api.utils.passkeys import (
    PURPOSE_LOGIN,
    PasskeyError,
    authentication_options,
    passkey_error_details,
    verify_assertion,
)
from api.utils.reauth import is_safe_redirect_path, stamp_auth_time

logger = logging.getLogger(__name__)

# Primary-auth-succeeded-but-MFA-pending state lives in the signed-cookie
# session; the TTL is enforced server-side against this stamp.
MFA_PENDING_TTL = 600

MFA_PENDING_KEYS = [
    "mfa_pending_user_id",
    "mfa_pending_at",
    "mfa_pending_method",
    "mfa_pending_sso_org_id",
    "mfa_pending_sso_provider_id",
    "mfa_pending_return_to",
]


class MfaVerifyThrottle(AnonRateThrottle):
    # Own scope so unrelated anon traffic can't consume this budget.
    scope = "mfa_verify"
    rate = "10/min"


class MfaOptionsThrottle(AnonRateThrottle):
    scope = "mfa_options"
    rate = "20/min"


def _csrf_reject_reason(request):
    """Explicit CsrfViewMiddleware check — @api_view is middleware-exempt and
    session-auth CSRF enforcement never runs on this anonymous endpoint.
    Returns the rejection reason, or None to accept."""
    check = CSRFCheck(lambda req: None)
    check.process_request(request)
    return check.process_view(request, None, (), {})


def clear_mfa_pending(session):
    for key in MFA_PENDING_KEYS:
        session.pop(key, None)


def set_mfa_pending(session, user, method):
    # Clear first so a new challenge can't inherit a prior flow's org
    # binding (which could forge auth_sso_org_id and bypass require_sso).
    clear_mfa_pending(session)
    session["mfa_pending_user_id"] = str(user.userId)
    session["mfa_pending_at"] = int(time.time())
    session["mfa_pending_method"] = method


def _csrf_failed_response():
    return JsonResponse(
        {"error": "CSRF verification failed.", "code": "csrf_failed"},
        status=403,
    )


def _locked_out_response():
    return JsonResponse(
        {"error": "Too many attempts. Try again later.", "code": "locked_out"},
        status=429,
    )


def _load_pending_user(request):
    """The user whose sign-in awaits a second factor, as (user, None), or
    (None, error response) when there is no live challenge."""
    session = request.session

    pending_user_id = session.get("mfa_pending_user_id")
    if not pending_user_id:
        return None, JsonResponse(
            {"error": "No sign-in awaiting verification.", "code": "no_pending"},
            status=400,
        )

    pending_at = session.get("mfa_pending_at")
    if not isinstance(pending_at, int) or (
        int(time.time()) - pending_at > MFA_PENDING_TTL
    ):
        clear_mfa_pending(session)
        return None, JsonResponse(
            {"error": "Sign-in expired. Please log in again.", "code": "expired"},
            status=410,
        )

    User = get_user_model()
    user = User.objects.filter(userId=pending_user_id).first()
    if user is None or not user_has_mfa(user):
        clear_mfa_pending(session)
        return None, JsonResponse(
            {"error": "Sign-in expired. Please log in again.", "code": "expired"},
            status=410,
        )
    return user, None


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([MfaOptionsThrottle])
def mfa_options(request):
    """The second factors that can finish the pending sign-in, plus a fresh
    passkey challenge when the user has passkeys. POST: it stores state."""
    if _csrf_reject_reason(request):
        return _csrf_failed_response()

    user, error = _load_pending_user(request)
    if error:
        return error

    # Too many wrong codes lock codes (TOTP and recovery) only: passkeys
    # can't be guessed, so a passkey user can still finish signing in.
    codes_locked = mfa_locked_out(str(user.userId))
    passkey_options = authentication_options(user, PURPOSE_LOGIN)
    if codes_locked and not passkey_options:
        return _locked_out_response()
    methods = (["totp"] if user_has_active_totp(user) and not codes_locked else []) + (
        ["passkey"] if passkey_options else []
    )
    return JsonResponse(
        {"methods": methods, "passkeyOptions": passkey_options, "codesLocked": codes_locked}
    )


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([MfaVerifyThrottle])
def mfa_verify(request):
    """Complete a deferred login: primary auth already succeeded and the
    session carries mfa_pending_* state. login() happens only here."""
    if _csrf_reject_reason(request):
        return _csrf_failed_response()

    user, error = _load_pending_user(request)
    if error:
        return error
    pending_user_id = str(user.userId)
    session = request.session

    body = request.data or {}
    code = body.get("code")
    recovery_code = body.get("recoveryCode") or body.get("recovery_code")
    passkey_credential = body.get("passkeyCredential") or body.get(
        "passkey_credential"
    )

    verified = False
    passkey_error = None
    if code or (recovery_code and not passkey_credential):
        # Codes spend an attempt before they're checked, so parallel
        # guesses can't get past the limit.
        if mfa_locked_out(pending_user_id) or not mfa_attempt(pending_user_id):
            return _locked_out_response()
        if code:
            user_totp = UserTOTP.objects.filter(
                user=user, activated_at__isnull=False
            ).first()
            verified = (
                user_totp is not None and verify_totp_code(user_totp, code) is not None
            )
        else:
            verified = consume_recovery_code(user, recovery_code)
    elif passkey_credential:
        # Can't be guessed: not counted, and open while codes are locked.
        try:
            verified = verify_assertion(user, PURPOSE_LOGIN, passkey_credential) is not None
        except PasskeyError as e:
            passkey_error = e

    if not verified:
        if passkey_error:
            code, message = passkey_error_details(passkey_error)
            return JsonResponse(
                {"error": message, "code": f"passkey_{code}"}, status=401
            )
        return JsonResponse(
            {"error": "Invalid code.", "code": "invalid_code"}, status=401
        )

    clear_mfa_failures(pending_user_id)

    # Read pending context before login() cycles the session key.
    method = session.get("mfa_pending_method", "sso")
    sso_org_id = session.get("mfa_pending_sso_org_id")
    sso_provider_id = session.get("mfa_pending_sso_provider_id")
    return_to = session.get("mfa_pending_return_to")

    login(request, user)
    request.session["auth_method"] = method
    # Set-or-clear: a same-user login() preserves session data, so a
    # previous org-SSO login's binding must not survive a non-org one.
    if sso_org_id:
        request.session["auth_sso_org_id"] = sso_org_id
    else:
        request.session.pop("auth_sso_org_id", None)
    if sso_provider_id:
        request.session["auth_sso_provider_id"] = sso_provider_id
    else:
        request.session.pop("auth_sso_provider_id", None)
    # A completed 2FA login is maximally fresh.
    stamp_auth_time(request)
    clear_mfa_pending(request.session)

    social_acc = user.socialaccount_set.first()
    avatar_url = None
    full_name = ""
    if social_acc:
        extra = social_acc.extra_data or {}
        avatar_url = (
            extra.get("avatar_url")
            or extra.get("picture")
            or extra.get("photo")
            or extra.get("avatar")
        )
        full_name = extra.get("name", "")
    if not full_name and getattr(user, "full_name", ""):
        full_name = user.full_name

    # SSO adapters already sent their login alert during complete_login
    # (pre-verify) — only the password flow still owes one.
    if method == "password":
        try:
            send_login_email(request, user.email, full_name or user.email, "Password")
        except Exception:
            logger.exception("Failed to send login email to %s", user.email)

    if not is_safe_redirect_path(return_to):
        return_to = None

    # An /invite/ destination was computed before the challenge; the
    # invite can expire or be revoked during the (≤10 min) window —
    # revalidate rather than landing the user on a dead invite page.
    if return_to and return_to.startswith("/invite/"):
        from base64 import b64decode

        from django.utils import timezone as _tz

        from api.models import OrganisationMemberInvite

        try:
            encoded = return_to.split("/invite/", 1)[1].split("?")[0].strip("/")
            invite_id = b64decode(encoded).decode("utf-8")
            still_valid = OrganisationMemberInvite.objects.filter(
                id=invite_id, valid=True, expires_at__gt=_tz.now()
            ).exists()
        except Exception:
            still_valid = False
        if not still_valid:
            return_to = None

    return JsonResponse(
        {
            "userId": str(user.userId),
            "email": user.email,
            "fullName": full_name or user.email,
            "avatarUrl": avatar_url,
            "authMethod": method,
            "returnTo": return_to,
        }
    )
