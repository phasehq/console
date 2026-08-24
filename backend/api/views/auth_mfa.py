"""TOTP login completion. This is the one MFA endpoint that stays REST:
it runs pre-login (anonymous, mfa_pending_* session state) so it cannot
ride the login-required GraphQL view. Enrollment/management live in
backend/graphene/mutations/mfa.py."""

import logging
import time

from django.contrib.auth import get_user_model, login
from django.http import JsonResponse

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
    mfa_locked_out,
    record_mfa_failure,
    verify_totp_code,
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
