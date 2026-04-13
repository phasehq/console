"""Password-based authentication endpoints.

Implements the client-side double-derivation protocol:
  password + email → Argon2id → masterKey (stays on client, encrypts keyring)
                                    ↓
                              BLAKE2b-256 → authHash (sent to server)
                                    ↓
                              Django set_password(authHash) → Argon2id stored

The server never sees the plaintext password or the masterKey.
"""

import json
import logging
import os
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
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.throttling import AnonRateThrottle

from api.views.sso import _check_email_domain_allowed


class CsrfExemptSessionAuthentication(SessionAuthentication):
    """SessionAuthentication that skips DRF's CSRF enforcement.

    Used on endpoints already decorated with @csrf_exempt that still
    need session-based authentication (e.g. password change).
    """

    def enforce_csrf(self, request):
        return  # Skip CSRF check

from api.models import (
    EmailVerification,
    Organisation,
    OrganisationMember,
)

logger = logging.getLogger(__name__)

FRONTEND_URL = os.getenv("ALLOWED_ORIGINS", "").split(",")[0].strip()


# --- Rate Limiting ---

class PasswordRegisterThrottle(AnonRateThrottle):
    rate = "5/hour"


class PasswordChangeThrottle(AnonRateThrottle):
    rate = "5/hour"


class AuthLoginThrottle(AnonRateThrottle):
    rate = "10/min"


class EmailCheckThrottle(AnonRateThrottle):
    rate = "20/min"


class ResendVerificationThrottle(AnonRateThrottle):
    rate = "3/hour"


# --- Helpers ---

def _skip_email_verification():
    """Check if email verification is disabled (for quick self-hosted setup)."""
    return os.getenv("SKIP_EMAIL_VERIFICATION", "").lower() in ("true", "1", "yes")


def _smtp_configured():
    """Check if SMTP email sending is configured."""
    return bool(getattr(settings, "EMAIL_HOST", ""))


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
        return JsonResponse({"error": "Registration is not available for this email domain."}, status=403)

    if User.objects.filter(email=email).exists():
        return JsonResponse({"error": "An account with this email already exists."}, status=409)

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
        user.save()

        if not skip_verification:
            token = secrets.token_urlsafe(32)
            EmailVerification.objects.create(
                user=user,
                token=token,
                expires_at=timezone.now() + timedelta(hours=24),
            )

    if skip_verification:
        return JsonResponse({"message": "Account created.", "verificationSkipped": True}, status=201)

    # Send verification email (outside transaction so the user is persisted).
    # If the send fails, the user can still use the resend endpoint.
    backend_url = os.getenv("NEXT_PUBLIC_BACKEND_API_BASE", "").rstrip("/")
    verify_url = f"{backend_url}/auth/verify-email/{token}/"
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
    try:
        ev = EmailVerification.objects.select_related("user").get(token=token)
    except EmailVerification.DoesNotExist:
        return redirect(f"{FRONTEND_URL}/login?error=invalid_verification_token")

    if ev.verified:
        return redirect(f"{FRONTEND_URL}/login?verified=true")

    if ev.expires_at < timezone.now():
        return redirect(f"{FRONTEND_URL}/login?error=verification_expired")

    ev.verified = True
    ev.save()

    user = ev.user
    user.active = True
    user.save()

    return redirect(f"{FRONTEND_URL}/login?verified=true")


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
        return JsonResponse({"message": "If that email is registered, a new verification link has been sent."})

    if user.active:
        return JsonResponse({"message": "If that email is registered, a new verification link has been sent."})

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

    return JsonResponse({"message": "If that email is registered, a new verification link has been sent."})


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

    if not user.active:
        return JsonResponse({"error": "Please verify your email address first."}, status=403)

    if not user.check_password(auth_hash):
        return JsonResponse({"error": "Invalid email or password."}, status=401)

    login(request, user)

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
@api_view(["POST"])
@authentication_classes([CsrfExemptSessionAuthentication])
@permission_classes([IsAuthenticated])
@throttle_classes([PasswordChangeThrottle])
def password_change(request):
    """Change password: verify old, set new, re-encrypt all org keyrings.

    Accepts per-organisation wrapped keys because each org has a
    different keyring that must be re-encrypted with the new masterKey.

    Input: {
        currentAuthHash, newAuthHash,
        orgKeys: [{ orgId, wrappedKeyring, wrappedRecovery }, ...]
    }
    """
    user = request.user

    if not user.has_usable_password():
        return JsonResponse(
            {"error": "SSO users cannot change their password here."},
            status=400,
        )

    data = request.data
    current_auth_hash = data.get("currentAuthHash", "")
    new_auth_hash = data.get("newAuthHash", "")
    org_keys = data.get("orgKeys", [])

    if not current_auth_hash or not new_auth_hash or not org_keys:
        return JsonResponse({"error": "All fields are required."}, status=400)

    if not user.check_password(current_auth_hash):
        return JsonResponse({"error": "Current password is incorrect."}, status=401)

    with transaction.atomic():
        user.set_password(new_auth_hash)
        user.save()

        # Update wrapped keys per organisation
        for entry in org_keys:
            org_id = entry.get("orgId")
            wrapped_keyring = entry.get("wrappedKeyring")
            wrapped_recovery = entry.get("wrappedRecovery")
            if org_id and wrapped_keyring:
                OrganisationMember.objects.filter(
                    user=user, organisation_id=org_id, deleted_at=None
                ).update(
                    wrapped_keyring=wrapped_keyring,
                    wrapped_recovery=wrapped_recovery or "",
                )

    # Re-login so the session hash stays valid after password change
    login(request, user)

    return JsonResponse({"message": "Password changed successfully."})


@csrf_exempt
@api_view(["POST"])
@authentication_classes([CsrfExemptSessionAuthentication])
@permission_classes([IsAuthenticated])
@throttle_classes([PasswordChangeThrottle])
def password_reset_via_recovery(request):
    """Reset password after verifying identity via recovery kit.

    Requires server-side proof: the caller must supply the identityKey
    (public key derived from the mnemonic + orgId) and the orgId.
    The server verifies it matches the organisation's stored identity_key,
    proving the caller actually possesses the recovery mnemonic.
    """
    user = request.user

    if not user.has_usable_password():
        return JsonResponse({"message": "No password to reset for SSO users."})

    data = request.data
    new_auth_hash = data.get("newAuthHash", "")
    identity_key = data.get("identityKey", "")
    org_id = data.get("orgId", "")
    wrapped_keyring = data.get("wrappedKeyring", "")
    wrapped_recovery = data.get("wrappedRecovery", "")

    if not new_auth_hash or not identity_key or not org_id:
        return JsonResponse({"error": "newAuthHash, identityKey, and orgId are required."}, status=400)

    # Verify the identity key matches the org — proves mnemonic possession
    try:
        org = Organisation.objects.get(id=org_id)
    except Organisation.DoesNotExist:
        return JsonResponse({"error": "Organisation not found."}, status=404)

    if org.identity_key != identity_key:
        return JsonResponse({"error": "Invalid recovery proof."}, status=403)

    # Verify the user is actually a member of this org
    if not OrganisationMember.objects.filter(
        user=user, organisation=org, deleted_at=None
    ).exists():
        return JsonResponse({"error": "Not a member of this organisation."}, status=403)

    # Update auth hash + wrapped keys atomically to prevent inconsistent state
    with transaction.atomic():
        user.set_password(new_auth_hash)
        user.save()

        if wrapped_keyring:
            OrganisationMember.objects.filter(
                user=user, organisation=org, deleted_at=None
            ).update(
                wrapped_keyring=wrapped_keyring,
                wrapped_recovery=wrapped_recovery or "",
            )

    # Re-login so the session hash stays valid
    login(request, user)

    return JsonResponse({"message": "Password reset successfully."})


@csrf_exempt
@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([EmailCheckThrottle])
def email_check(request):
    """Resolve the auth method for a given email.

    Returns which authentication flow the frontend should present:
      - "credentials": show password field (user exists with password, OR unknown email)
      - "sso": redirect to their SSO provider

    Deliberately does NOT distinguish "unknown email" from "password user"
    to prevent email enumeration.
    """
    User = get_user_model()

    email = (request.data.get("email") or "").lower().strip()
    if not email:
        return JsonResponse({"error": "Email is required."}, status=400)

    try:
        user = User.objects.get(email=email)
    except User.DoesNotExist:
        return JsonResponse({"authMethod": "credentials"})

    # SSO user — find which provider they used
    if not user.has_usable_password():
        social_acc = user.socialaccount_set.first()
        if social_acc:
            return JsonResponse({"authMethod": "sso", "ssoProvider": social_acc.provider})

    # Password user or edge case (no password, no social account) — show password field
    return JsonResponse({"authMethod": "credentials"})
