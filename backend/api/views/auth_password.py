import json
import logging
import os
import re
import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import login, get_user_model
from django.db import transaction
from django.http import JsonResponse
from django.shortcuts import redirect
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from rest_framework.decorators import (
    api_view,
    authentication_classes,
    permission_classes,
    throttle_classes,
)
from rest_framework.permissions import AllowAny
from rest_framework.throttling import AnonRateThrottle

from api.views.sso import _check_email_domain_allowed


from django.db.models import Q

from api.models import (
    EmailVerification,
    OrganisationMember,  # noqa: F401 — kept for backward compat with test patches
    OrganisationMemberInvite,
    OrganisationSSOProvider,
)

logger = logging.getLogger(__name__)

FRONTEND_URL = os.getenv("ALLOWED_ORIGINS", "").split(",")[0].strip()


# --- Rate Limiting ---


class PasswordRegisterThrottle(AnonRateThrottle):
    rate = "5/min"


class AuthLoginThrottle(AnonRateThrottle):
    rate = "10/min"


class EmailCheckThrottle(AnonRateThrottle):
    rate = "20/min"


class ResendVerificationThrottle(AnonRateThrottle):
    rate = "3/min"


# --- Helpers ---


def _skip_email_verification():
    """Check if email verification is disabled (for quick self-hosted setup)."""
    return os.getenv("SKIP_EMAIL_VERIFICATION", "").lower() in ("true", "1", "yes")


def _smtp_configured():
    """Check if SMTP email sending is configured."""
    return bool(getattr(settings, "EMAIL_HOST", ""))


_INVITE_PATH_RE = re.compile(r"^/invite/[A-Za-z0-9+/=_-]+/?$")


def _safe_internal_path(value):
    """Return value if it's a safe same-origin invite path (e.g.
    '/invite/<base64-token>'), else None.

    Strictly allowlisted to the invite acceptance flow — that's the only
    legitimate destination we forward through email verification today.
    Allowing arbitrary internal paths would let a crafted verification
    URL redirect through any internal route (e.g. '/login?error=...'
    with injected query params)."""
    if not isinstance(value, str) or not value:
        return None
    if not _INVITE_PATH_RE.match(value):
        return None
    return value


def _send_verification_email(email, verify_url):
    """Send verification email if SMTP is configured. Always log."""
    logger.info(
        json.dumps(
            {
                "event": "email_verification",
                "email": email,
                "url": verify_url,
            }
        )
    )

    if _smtp_configured():
        from api.emails import send_email

        send_email(
            subject="Verify your Phase account",
            recipient_list=[email],
            template_name="api/email_verification.html",
            context={"verify_url": verify_url},
        )


# --- Endpoints ---


@csrf_exempt
@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([PasswordRegisterThrottle])
def password_register(request):
    """Register a new user with email/password.

    Creates the user account and sends a verification email.
    Organisation creation happens separately after email verification
    via the onboarding flow (CreateOrganisationMutation).
    """
    User = get_user_model()

    data = request.data
    email = (data.get("email") or "").lower().strip()
    auth_hash = data.get("authHash", "")
    full_name = (data.get("fullName") or "").strip()

    if not email or not auth_hash:
        return JsonResponse({"error": "Email and password are required."}, status=400)

    # Basic email format check
    if "@" not in email or "." not in email.split("@")[-1]:
        return JsonResponse({"error": "Invalid email address."}, status=400)

    if not _check_email_domain_allowed(email):
        return JsonResponse(
            {"error": "Registration is not available for this email domain."},
            status=403,
        )

    if User.objects.filter(email=email).exists():
        return JsonResponse(
            {"error": "An account with this email already exists."}, status=409
        )

    # If signup was triggered from an invite link, the registered email must
    # match the invitee email. The frontend forwards callbackUrl=/invite/<id>
    # for invite-driven signups and locks the email field; this enforces the
    # same constraint server-side so a tampered request can't register an
    # arbitrary email and then fail downstream at invite acceptance.
    callback_url = data.get("callbackUrl") or ""
    if callback_url.startswith("/invite/"):
        from base64 import b64decode

        try:
            encoded_invite = callback_url[len("/invite/") :].split("/")[0].split("?")[0]
            invite_id = b64decode(encoded_invite).decode("utf-8")
            invite = OrganisationMemberInvite.objects.get(
                id=invite_id,
                valid=True,
                expires_at__gt=timezone.now(),
            )
            if invite.invitee_email.lower().strip() != email:
                return JsonResponse(
                    {"error": "This invite is for a different email address."},
                    status=403,
                )
        except (OrganisationMemberInvite.DoesNotExist, ValueError, Exception):
            # Invalid invite reference — ignore and let registration proceed
            # under the user's submitted email. Acceptance will fail later
            # with a clearer error if the invite truly is bad.
            pass

    # Skip verification if explicitly configured OR if SMTP isn't set up
    # (no point creating inactive accounts when emails can't be delivered)
    skip_verification = _skip_email_verification() or not _smtp_configured()

    with transaction.atomic():
        user = User.objects.create_user(
            username=email,
            email=email,
            password=auth_hash,
        )
        user.active = skip_verification
        if full_name:
            user.full_name = full_name
        user.save()

        if not skip_verification:
            token = secrets.token_urlsafe(32)
            EmailVerification.objects.create(
                user=user,
                token=token,
                expires_at=timezone.now() + timedelta(hours=24),
            )

    if skip_verification:
        return JsonResponse(
            {"message": "Account created.", "verificationSkipped": True}, status=201
        )

    # Send verification email (outside transaction so the user is persisted).
    # If the send fails, the user can still use the resend endpoint.
    backend_url = os.getenv("NEXT_PUBLIC_BACKEND_API_BASE", "").rstrip("/")
    verify_url = f"{backend_url}/auth/verify-email/{token}/"
    # Forward the post-login destination (e.g. /invite/<id>) through the
    # verification link so invite-flow signups land back at acceptance after
    # verifying their email.
    next_url = _safe_internal_path(data.get("callbackUrl"))
    if next_url:
        from urllib.parse import urlencode

        verify_url = f"{verify_url}?{urlencode({'next': next_url})}"
    try:
        _send_verification_email(email, verify_url)
    except Exception:
        logger.exception("Failed to send verification email to %s", email)

    return JsonResponse({"message": "Verification required."}, status=201)


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def verify_email(request, token):
    """Verify email address and activate user account."""
    from urllib.parse import urlencode

    next_url = _safe_internal_path(request.GET.get("next"))

    def _login_redirect(**params):
        if next_url:
            params["callbackUrl"] = next_url
        qs = urlencode(params)
        return redirect(f"{FRONTEND_URL}/login?{qs}")

    try:
        ev = EmailVerification.objects.select_related("user").get(token=token)
    except EmailVerification.DoesNotExist:
        return _login_redirect(error="invalid_verification_token")

    if ev.verified:
        return _login_redirect(verified="true")

    if ev.expires_at < timezone.now():
        return _login_redirect(error="verification_expired")

    ev.verified = True
    ev.save()

    user = ev.user
    user.active = True
    user.save()

    return _login_redirect(verified="true")


@csrf_exempt
@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([ResendVerificationThrottle])
def resend_verification(request):
    """Resend verification email with a fresh token."""
    User = get_user_model()

    email = (request.data.get("email") or "").lower().strip()
    if not email:
        return JsonResponse({"error": "Email is required."}, status=400)

    try:
        user = User.objects.get(email=email)
    except User.DoesNotExist:
        # Don't reveal whether email exists
        return JsonResponse(
            {
                "message": "If that email is registered, a new verification link has been sent."
            }
        )

    if user.active:
        return JsonResponse(
            {
                "message": "If that email is registered, a new verification link has been sent."
            }
        )

    # Delete old token, create new one
    EmailVerification.objects.filter(user=user).delete()
    token = secrets.token_urlsafe(32)
    EmailVerification.objects.create(
        user=user,
        token=token,
        expires_at=timezone.now() + timedelta(hours=24),
    )

    backend_url = os.getenv("NEXT_PUBLIC_BACKEND_API_BASE", "").rstrip("/")
    verify_url = f"{backend_url}/auth/verify-email/{token}/"
    _send_verification_email(email, verify_url)

    return JsonResponse(
        {
            "message": "If that email is registered, a new verification link has been sent."
        }
    )


@csrf_exempt
@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([AuthLoginThrottle])
def password_login(request):
    """Authenticate with email + authHash, create a Django session."""
    User = get_user_model()

    data = request.data
    email = (data.get("email") or "").lower().strip()
    auth_hash = data.get("authHash", "")

    if not email or not auth_hash:
        return JsonResponse({"error": "Email and password are required."}, status=400)

    if not _check_email_domain_allowed(email):
        return JsonResponse({"error": "Invalid email or password."}, status=401)

    try:
        user = User.objects.get(email=email)
    except User.DoesNotExist:
        return JsonResponse({"error": "Invalid email or password."}, status=401)

    # Verify password BEFORE leaking the active/inactive distinction.
    # Returning a different status for unverified-but-existing accounts
    # would let unauthenticated callers enumerate registered emails in
    # the verification window.
    if not user.check_password(auth_hash):
        return JsonResponse({"error": "Invalid email or password."}, status=401)

    if not user.active:
        return JsonResponse(
            {"error": "Please verify your email address first."}, status=403
        )

    login(request, user)
    request.session["auth_method"] = "password"
    request.session.pop("auth_sso_org_id", None)
    request.session.pop("auth_sso_provider_id", None)

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
    if not full_name and hasattr(user, "full_name") and user.full_name:
        full_name = user.full_name

    try:
        from api.emails import send_login_email

        send_login_email(request, user.email, full_name or user.email, "Password")
    except Exception as email_err:
        logger.error(f"Failed to send password login email: {email_err}")

    return JsonResponse(
        {
            "userId": str(user.userId),
            "email": user.email,
            "fullName": full_name or user.email,
            "avatarUrl": avatar_url,
            "authMethod": user.auth_method,
        }
    )


@csrf_exempt
@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([EmailCheckThrottle])
def invite_lookup(request, invite_id):
    """Return the invitee email + org name for a valid pending invite.

    Used by the login page to prefill the email field when a user is
    redirected there from an invite link. Invite IDs are UUID4 (122 bits
    of entropy) so enumeration is infeasible; the EmailCheck throttle
    adds an extra layer.
    """
    try:
        invite = OrganisationMemberInvite.objects.select_related("organisation").get(
            id=invite_id,
            valid=True,
            expires_at__gt=timezone.now(),
        )
    except OrganisationMemberInvite.DoesNotExist:
        return JsonResponse({"error": "Invite not found or expired."}, status=404)

    return JsonResponse(
        {
            "inviteeEmail": invite.invitee_email,
            "organisationName": invite.organisation.name,
        }
    )


@csrf_exempt
@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([EmailCheckThrottle])
def email_check(request):
    """Return all available auth methods for a given email.

    Response shape:
      {
        "authMethods": {
          "password": true/false,
          "sso": [
            {"id": "config-uuid", "providerType": "oidc", "enforced": false},
            ...
          ]
        }
      }
    """
    User = get_user_model()

    email = (request.data.get("email") or "").lower().strip()
    invite_id = request.data.get("inviteId") or request.data.get("invite_id")
    if not email:
        return JsonResponse({"error": "Email is required."}, status=400)

    # Unknown users default to password=True to minimise enumeration.
    try:
        user = User.objects.get(email=email)
        has_password = user.has_usable_password()
    except User.DoesNotExist:
        user = None
        has_password = True

    # In the invite-acceptance flow the only useful SSO is the invite's
    # org's SSO — authenticating via another org's provider would land
    # the user with an SSO session bound to the wrong org, locking them
    # out of the org they're actually trying to join. Membership-derived
    # SSO is only useful as a FALLBACK when the invite's org has no SSO
    # configured (so existing users without a password can still sign in).
    #
    # Outside the invite flow we always offer membership-derived SSO so
    # returning users can pick whichever org they want to land in.
    invite_org_filter = None
    if invite_id:
        try:
            invite = OrganisationMemberInvite.objects.get(
                id=invite_id,
                valid=True,
                expires_at__gt=timezone.now(),
                invitee_email__iexact=email,
            )
            invite_org_filter = Q(organisation=invite.organisation)
        except OrganisationMemberInvite.DoesNotExist:
            pass

    membership_filter = None
    if user is not None:
        membership_filter = Q(
            organisation__users__user=user,
            organisation__users__deleted_at=None,
        )

    def _query(filter_q):
        return list(
            OrganisationSSOProvider.objects.filter(filter_q, enabled=True)
            .select_related("organisation")
            .distinct()
        )

    org_providers = []
    if invite_org_filter is not None:
        org_providers = _query(invite_org_filter)
        # Fallback: if the invite's org has no SSO, fall back to the user's
        # account-level auth methods so an existing-user invitee with no
        # password set isn't stranded.
        if not org_providers and membership_filter is not None:
            org_providers = _query(membership_filter)
    elif membership_filter is not None:
        org_providers = _query(membership_filter)

    sso_methods = [
        {
            "id": str(provider.id),
            "providerType": "oidc",
            "provider": provider.provider_type,
            "providerName": provider.name,
            "organisationName": provider.organisation.name,
            "enforced": provider.organisation.require_sso,
        }
        for provider in org_providers
    ]

    return JsonResponse(
        {
            "authMethods": {
                "password": has_password,
                "sso": sso_methods,
            }
        }
    )
