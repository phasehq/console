import json
import logging
import time

from django.contrib.auth import get_user_model, login
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_POST

from rest_framework.decorators import (
    api_view,
    authentication_classes,
    permission_classes,
    throttle_classes,
)
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.throttling import AnonRateThrottle

from api.emails import send_login_email, send_totp_status_email
from api.models import UserRecoveryCode, UserTOTP
from api.utils.mfa import (
    build_otpauth_uri,
    clear_mfa_failures,
    consume_recovery_code,
    decrypt_seed,
    encrypt_seed,
    generate_recovery_codes,
    generate_totp_secret,
    mfa_locked_out,
    record_mfa_failure,
    user_has_active_totp,
    verify_totp_code,
)
from api.utils.reauth import (
    REAUTH_ERROR,
    is_safe_redirect_path,
    session_is_fresh,
    stamp_auth_time,
)

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
    rate = "10/min"


def clear_mfa_pending(session):
    for key in MFA_PENDING_KEYS:
        session.pop(key, None)


def set_mfa_pending(session, user, method):
    # Start from a clean slate so a new challenge can never inherit a prior
    # flow's org binding (e.g. an abandoned org-SSO attempt leaving
    # mfa_pending_sso_org_id behind for a later instance-level login to
    # claim, which would forge auth_sso_org_id and bypass require_sso).
    clear_mfa_pending(session)
    session["mfa_pending_user_id"] = str(user.userId)
    session["mfa_pending_at"] = int(time.time())
    session["mfa_pending_method"] = method


def _json_body(request):
    try:
        return json.loads(request.body or b"{}")
    except json.JSONDecodeError:
        return None


def _session_guard(request):
    """Shared guards for the management endpoints (plain Django views —
    DRF SessionAuthentication would demand CSRF tokens the frontend
    doesn't have; these are mounted csrf_exempt with a JSON-body
    requirement, same posture as identity unlink)."""
    if not request.user.is_authenticated:
        return JsonResponse(
            {"error": "Authentication required.", "code": "unauthenticated"},
            status=401,
        )
    if not session_is_fresh(request):
        return JsonResponse(REAUTH_ERROR, status=401)
    if not (request.content_type or "").startswith("application/json"):
        return JsonResponse({"error": "JSON body required."}, status=400)
    return None


def _verify_management_code(request, user, body):
    """Disable/regenerate require a current TOTP code or an unused recovery
    code IN ADDITION to the fresh session (session-theft hardening).
    Returns an error response or None."""
    if mfa_locked_out(str(user.userId)):
        return JsonResponse(
            {"error": "Too many attempts. Try again later.", "code": "locked_out"},
            status=429,
        )

    user_totp = UserTOTP.objects.filter(user=user, activated_at__isnull=False).first()
    if user_totp is None:
        return JsonResponse(
            {"error": "Two-factor authentication is not enabled.", "code": "not_enabled"},
            status=400,
        )

    code = body.get("code")
    recovery_code = body.get("recoveryCode") or body.get("recovery_code")
    if code and verify_totp_code(user_totp, code) is not None:
        clear_mfa_failures(str(user.userId))
        return None
    if recovery_code and consume_recovery_code(user, recovery_code):
        clear_mfa_failures(str(user.userId))
        return None

    record_mfa_failure(str(user.userId))
    return JsonResponse(
        {"error": "Invalid code.", "code": "invalid_code"}, status=401
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def mfa_status(request):
    user = request.user
    user_totp = UserTOTP.objects.filter(user=user, activated_at__isnull=False).first()
    return JsonResponse(
        {
            "enabled": user_totp is not None,
            "activatedAt": (
                user_totp.activated_at.isoformat() if user_totp else None
            ),
            "recoveryCodesRemaining": UserRecoveryCode.objects.filter(
                user=user, used_at__isnull=True
            ).count(),
        }
    )


@require_POST
def mfa_enroll(request):
    """Create (or overwrite) a pending enrollment and return the secret.
    Nothing is enabled until a code verifies via mfa_enroll_activate."""
    guard = _session_guard(request)
    if guard is not None:
        return guard

    user = request.user
    if user_has_active_totp(user):
        return JsonResponse(
            {
                "error": "Two-factor authentication is already enabled.",
                "code": "already_enabled",
            },
            status=409,
        )

    secret = generate_totp_secret()
    UserTOTP.objects.update_or_create(
        user=user,
        defaults={
            "encrypted_seed": encrypt_seed(secret),
            "activated_at": None,
            "last_verified_timestep": 0,
        },
    )

    return JsonResponse(
        {
            "secret": secret,
            "otpauthUri": build_otpauth_uri(secret, user.email),
        }
    )


@require_POST
def mfa_enroll_activate(request):
    guard = _session_guard(request)
    if guard is not None:
        return guard

    body = _json_body(request)
    if body is None:
        return JsonResponse({"error": "Invalid JSON body."}, status=400)

    user = request.user
    if mfa_locked_out(str(user.userId)):
        return JsonResponse(
            {"error": "Too many attempts. Try again later.", "code": "locked_out"},
            status=429,
        )

    user_totp = UserTOTP.objects.filter(user=user, activated_at__isnull=True).first()
    if user_totp is None:
        return JsonResponse(
            {"error": "No pending enrollment.", "code": "no_pending"}, status=400
        )

    if verify_totp_code(user_totp, body.get("code")) is None:
        record_mfa_failure(str(user.userId))
        return JsonResponse(
            {"error": "Invalid code.", "code": "invalid_code"}, status=401
        )

    clear_mfa_failures(str(user.userId))
    user_totp.activated_at = timezone.now()
    user_totp.save(update_fields=["activated_at"])
    recovery_codes = generate_recovery_codes(user)

    try:
        send_totp_status_email(request, user, enabled=True)
    except Exception:
        logger.exception("Failed to send totp_enabled email to %s", user.email)

    logger.info(
        json.dumps({"event": "totp_enabled", "user_id": str(user.userId)})
    )
    return JsonResponse({"recoveryCodes": recovery_codes})


@require_POST
def mfa_disable(request):
    guard = _session_guard(request)
    if guard is not None:
        return guard

    body = _json_body(request)
    if body is None:
        return JsonResponse({"error": "Invalid JSON body."}, status=400)

    user = request.user
    error = _verify_management_code(request, user, body)
    if error is not None:
        return error

    # Hard delete: a disabled 2FA must not leave a resurrectable seed.
    UserTOTP.objects.filter(user=user).delete()
    UserRecoveryCode.objects.filter(user=user).delete()

    try:
        send_totp_status_email(request, user, enabled=False)
    except Exception:
        logger.exception("Failed to send totp_disabled email to %s", user.email)

    logger.info(
        json.dumps({"event": "totp_disabled", "user_id": str(user.userId)})
    )
    return JsonResponse({"ok": True})


@require_POST
def mfa_recovery_codes(request):
    guard = _session_guard(request)
    if guard is not None:
        return guard

    body = _json_body(request)
    if body is None:
        return JsonResponse({"error": "Invalid JSON body."}, status=400)

    user = request.user
    error = _verify_management_code(request, user, body)
    if error is not None:
        return error

    return JsonResponse({"recoveryCodes": generate_recovery_codes(user)})


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([MfaVerifyThrottle])
def mfa_verify(request):
    """Complete a deferred login: primary auth already succeeded and the
    session carries mfa_pending_* state. login() happens only here."""
    session = request.session

    pending_user_id = session.get("mfa_pending_user_id")
    if not pending_user_id:
        return JsonResponse(
            {"error": "No sign-in awaiting verification.", "code": "no_pending"},
            status=400,
        )

    pending_at = session.get("mfa_pending_at")
    if not isinstance(pending_at, int) or (
        int(time.time()) - pending_at > MFA_PENDING_TTL
    ):
        clear_mfa_pending(session)
        return JsonResponse(
            {"error": "Sign-in expired. Please log in again.", "code": "expired"},
            status=410,
        )

    if mfa_locked_out(pending_user_id):
        return JsonResponse(
            {"error": "Too many attempts. Try again later.", "code": "locked_out"},
            status=429,
        )

    User = get_user_model()
    user = User.objects.filter(userId=pending_user_id).first()
    user_totp = (
        UserTOTP.objects.filter(user=user, activated_at__isnull=False).first()
        if user
        else None
    )
    if user is None or user_totp is None:
        clear_mfa_pending(session)
        return JsonResponse(
            {"error": "Sign-in expired. Please log in again.", "code": "expired"},
            status=410,
        )

    body = request.data or {}
    code = body.get("code")
    recovery_code = body.get("recoveryCode") or body.get("recovery_code")

    verified = False
    if code:
        verified = verify_totp_code(user_totp, code) is not None
    elif recovery_code:
        verified = consume_recovery_code(user, recovery_code)

    if not verified:
        record_mfa_failure(pending_user_id)
        return JsonResponse(
            {"error": "Invalid code.", "code": "invalid_code"}, status=401
        )

    clear_mfa_failures(pending_user_id)

    # Read pending context before login() cycles the session key (data
    # survives the cycle, but be explicit).
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
