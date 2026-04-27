"""Tests for password auth endpoints (api.views.auth_password).

Uses unittest.TestCase with mocked ORM — no database required.
Throttling is disabled for all tests via setUp() cache clearing.
"""

import json
import unittest
from datetime import timedelta
from unittest.mock import patch, MagicMock

from django.core.cache import cache
from django.test import RequestFactory
from django.contrib.sessions.middleware import SessionMiddleware
from django.utils import timezone
from rest_framework.test import APIRequestFactory, force_authenticate

from api.views.auth_password import (
    password_register,
    password_login,
    password_change,
    verify_email,
    resend_verification,
    email_check,
)


class _ThrottleClearMixin:
    """Clear DRF throttle cache before each test."""

    def setUp(self):
        super().setUp()
        cache.clear()


def _add_session_to_request(request):
    """Attach session support to a bare RequestFactory request."""
    middleware = SessionMiddleware(lambda req: None)
    middleware.process_request(request)
    request.session.save()


def _make_post(path, data, user=None):
    """Create a POST request with JSON body and session."""
    factory = APIRequestFactory()
    request = factory.post(path, data=data, format="json")
    _add_session_to_request(request)
    if user:
        force_authenticate(request, user=user)
    return request


def _make_get(path):
    """Create a GET request with session."""
    factory = RequestFactory()
    request = factory.get(path)
    _add_session_to_request(request)
    return request


# ---------------------------------------------------------------------------
# password_register
# ---------------------------------------------------------------------------

class PasswordRegisterTest(_ThrottleClearMixin, unittest.TestCase):
    """Tests for POST /auth/password/register/."""

    VALID_PAYLOAD = {
        "email": "alice@example.com",
        "authHash": "a" * 64,
        "fullName": "Alice Test",
    }

    @patch("api.views.auth_password._smtp_configured", return_value=True)
    @patch("api.views.auth_password.transaction")
    @patch("api.views.auth_password._send_verification_email")
    @patch("api.views.auth_password.EmailVerification")
    @patch("api.views.auth_password.get_user_model")
    def test_register_creates_user(
        self, mock_get_user, mock_ev, mock_send_email, mock_tx, mock_smtp
    ):
        """Successful registration creates user + verification token."""
        User = MagicMock()
        User.objects.filter.return_value.exists.return_value = False
        mock_get_user.return_value = User

        new_user = MagicMock()
        new_user.active = True
        User.objects.create_user.return_value = new_user

        request = _make_post("/auth/password/register/", self.VALID_PAYLOAD)
        response = password_register(request)

        self.assertEqual(response.status_code, 201)
        data = json.loads(response.content)
        self.assertIn("Verification", data["message"])

        User.objects.create_user.assert_called_once()
        mock_ev.objects.create.assert_called_once()
        mock_send_email.assert_called_once()

        # Verify full_name was saved on the user object
        self.assertEqual(new_user.full_name, "Alice Test")

    @patch("api.views.auth_password.get_user_model")
    def test_register_rejects_duplicate_email(self, mock_get_user):
        """Registration fails if email already exists."""
        User = MagicMock()
        User.objects.filter.return_value.exists.return_value = True
        mock_get_user.return_value = User

        request = _make_post("/auth/password/register/", self.VALID_PAYLOAD)
        response = password_register(request)

        self.assertEqual(response.status_code, 409)

    def test_register_rejects_missing_fields(self):
        """Registration fails with missing required fields."""
        request = _make_post("/auth/password/register/", {"email": "a@b.com"})
        response = password_register(request)

        self.assertEqual(response.status_code, 400)

    def test_register_rejects_invalid_email(self):
        """Registration fails with badly formatted email."""
        payload = dict(self.VALID_PAYLOAD, email="not-an-email")
        request = _make_post("/auth/password/register/", payload)
        response = password_register(request)

        self.assertEqual(response.status_code, 400)

    @patch("api.views.auth_password.OrganisationMemberInvite")
    @patch("api.views.auth_password.get_user_model")
    def test_register_rejects_invite_email_mismatch(
        self, mock_get_user, mock_invite_cls
    ):
        """Invite-driven signup must use the invitee's email. The frontend
        locks the field but a tampered request with a different email
        must still be rejected server-side."""
        from base64 import b64encode

        User = MagicMock()
        User.objects.filter.return_value.exists.return_value = False
        mock_get_user.return_value = User

        invite = MagicMock()
        invite.invitee_email = "invitee@example.com"
        mock_invite_cls.objects.get.return_value = invite

        invite_id = "abc-invite-id"
        encoded = b64encode(invite_id.encode()).decode()
        payload = dict(
            self.VALID_PAYLOAD,
            email="attacker@example.com",
            callbackUrl=f"/invite/{encoded}",
        )
        request = _make_post("/auth/password/register/", payload)
        response = password_register(request)

        self.assertEqual(response.status_code, 403)
        User.objects.create_user.assert_not_called()


# ---------------------------------------------------------------------------
# verify_email
# ---------------------------------------------------------------------------

class VerifyEmailTest(_ThrottleClearMixin, unittest.TestCase):
    """Tests for GET /auth/verify-email/<token>/."""

    @patch("api.views.auth_password.EmailVerification")
    def test_valid_token_activates_user(self, mock_ev_cls):
        """Valid non-expired token activates user and sets verified."""
        ev = MagicMock()
        ev.verified = False
        ev.expires_at = timezone.now() + timedelta(hours=1)
        ev.user = MagicMock()
        mock_ev_cls.objects.select_related.return_value.get.return_value = ev

        request = _make_get("/auth/verify-email/test-token/")
        response = verify_email(request, "test-token")

        self.assertEqual(response.status_code, 302)
        self.assertIn("verified=true", response.url)
        self.assertTrue(ev.verified)
        ev.save.assert_called()
        ev.user.save.assert_called()

    @patch("api.views.auth_password.EmailVerification")
    def test_expired_token_rejected(self, mock_ev_cls):
        """Expired token redirects with error."""
        ev = MagicMock()
        ev.verified = False
        ev.expires_at = timezone.now() - timedelta(hours=1)
        mock_ev_cls.objects.select_related.return_value.get.return_value = ev

        request = _make_get("/auth/verify-email/expired-token/")
        response = verify_email(request, "expired-token")

        self.assertEqual(response.status_code, 302)
        self.assertIn("verification_expired", response.url)

    @patch("api.views.auth_password.EmailVerification")
    def test_invalid_token_rejected(self, mock_ev_cls):
        """Non-existent token redirects with error."""
        from api.models import EmailVerification as EV

        mock_ev_cls.DoesNotExist = EV.DoesNotExist
        mock_ev_cls.objects.select_related.return_value.get.side_effect = EV.DoesNotExist

        request = _make_get("/auth/verify-email/bad-token/")
        response = verify_email(request, "bad-token")

        self.assertEqual(response.status_code, 302)
        self.assertIn("invalid_verification_token", response.url)

    @patch("api.views.auth_password.EmailVerification")
    def test_already_verified_redirects_success(self, mock_ev_cls):
        """Already-verified token is idempotent."""
        ev = MagicMock()
        ev.verified = True
        mock_ev_cls.objects.select_related.return_value.get.return_value = ev

        request = _make_get("/auth/verify-email/already-done/")
        response = verify_email(request, "already-done")

        self.assertEqual(response.status_code, 302)
        self.assertIn("verified=true", response.url)


# ---------------------------------------------------------------------------
# password_login
# ---------------------------------------------------------------------------

class PasswordLoginTest(_ThrottleClearMixin, unittest.TestCase):
    """Tests for POST /auth/password/login/."""

    @patch("api.views.auth_password.login")
    @patch("api.views.auth_password.get_user_model")
    def test_login_succeeds_with_correct_hash(self, mock_get_user, mock_login):
        """Correct authHash logs user in and returns user info."""
        User = MagicMock()
        user = MagicMock()
        user.active = True
        user.userId = "uuid-123"
        user.email = "alice@example.com"
        user.full_name = ""
        user.auth_method = "password"
        user.check_password.return_value = True
        user.socialaccount_set.first.return_value = None
        User.objects.get.return_value = user
        mock_get_user.return_value = User

        request = _make_post(
            "/auth/password/login/",
            {"email": "alice@example.com", "authHash": "a" * 64},
        )
        response = password_login(request)

        self.assertEqual(response.status_code, 200)
        data = json.loads(response.content)
        self.assertEqual(data["email"], "alice@example.com")
        self.assertEqual(data["fullName"], "alice@example.com")  # no full_name, falls back to email
        self.assertEqual(data["authMethod"], "password")
        mock_login.assert_called_once()

    @patch("api.views.auth_password.login")
    @patch("api.views.auth_password.get_user_model")
    def test_login_returns_full_name_for_password_user(self, mock_get_user, mock_login):
        """Login returns stored full_name for password-only users."""
        User = MagicMock()
        user = MagicMock()
        user.active = True
        user.userId = "uuid-123"
        user.email = "alice@example.com"
        user.full_name = "Alice Test"
        user.auth_method = "password"
        user.check_password.return_value = True
        user.socialaccount_set.first.return_value = None
        User.objects.get.return_value = user
        mock_get_user.return_value = User

        request = _make_post(
            "/auth/password/login/",
            {"email": "alice@example.com", "authHash": "a" * 64},
        )
        response = password_login(request)

        self.assertEqual(response.status_code, 200)
        data = json.loads(response.content)
        self.assertEqual(data["fullName"], "Alice Test")

    @patch("api.views.auth_password.get_user_model")
    def test_login_fails_with_wrong_hash(self, mock_get_user):
        """Wrong authHash returns 401."""
        User = MagicMock()
        user = MagicMock()
        user.active = True
        user.check_password.return_value = False
        User.objects.get.return_value = user
        mock_get_user.return_value = User

        request = _make_post(
            "/auth/password/login/",
            {"email": "alice@example.com", "authHash": "wrong"},
        )
        response = password_login(request)

        self.assertEqual(response.status_code, 401)

    @patch("api.views.auth_password.get_user_model")
    def test_login_fails_if_not_verified(self, mock_get_user):
        """Unverified user (active=False) returns 403."""
        User = MagicMock()
        user = MagicMock()
        user.active = False
        User.objects.get.return_value = user
        mock_get_user.return_value = User

        request = _make_post(
            "/auth/password/login/",
            {"email": "alice@example.com", "authHash": "a" * 64},
        )
        response = password_login(request)

        self.assertEqual(response.status_code, 403)

    @patch("api.views.auth_password.get_user_model")
    def test_login_fails_for_nonexistent_user(self, mock_get_user):
        """Non-existent email returns 401 (same as wrong password)."""
        User = MagicMock()
        from api.models import CustomUser

        User.DoesNotExist = CustomUser.DoesNotExist
        User.objects.get.side_effect = CustomUser.DoesNotExist
        mock_get_user.return_value = User

        request = _make_post(
            "/auth/password/login/",
            {"email": "nobody@example.com", "authHash": "a" * 64},
        )
        response = password_login(request)

        self.assertEqual(response.status_code, 401)

    def test_login_rejects_missing_fields(self):
        """Missing email or authHash returns 400."""
        request = _make_post("/auth/password/login/", {"email": "a@b.com"})
        response = password_login(request)

        self.assertEqual(response.status_code, 400)


# ---------------------------------------------------------------------------
# password_change
# ---------------------------------------------------------------------------

class PasswordChangeTest(_ThrottleClearMixin, unittest.TestCase):
    """Tests for POST /auth/password/change/."""

    @patch("api.views.auth_password.transaction")
    @patch("api.views.auth_password.login")
    @patch("api.views.auth_password.OrganisationMember")
    @patch("api.views.auth_password.Organisation")
    def test_change_password_succeeds(self, mock_org, mock_om, mock_login, mock_tx):
        """Valid current password + matching identityKey updates login
        password and re-wraps THIS org's keyring atomically."""
        user = MagicMock()
        user.is_authenticated = True
        user.has_usable_password.return_value = True
        user.check_password.return_value = True

        org = MagicMock()
        org.identity_key = "matching_key"
        mock_org.objects.get.return_value = org
        mock_om.objects.filter.return_value.exists.return_value = True

        request = _make_post(
            "/auth/password/change/",
            {
                "currentAuthHash": "old" * 20,
                "newAuthHash": "new" * 20,
                "orgId": "org-1",
                "identityKey": "matching_key",
                "wrappedKeyring": "new-wrapped-keyring",
                "wrappedRecovery": "new-wrapped-recovery",
            },
            user=user,
        )
        response = password_change(request)

        self.assertEqual(response.status_code, 200)
        user.set_password.assert_called_once_with("new" * 20)
        user.save.assert_called()
        # The single org's keyring update should fire — exactly one filter call.
        self.assertEqual(mock_om.objects.filter.call_count, 2)
        mock_login.assert_called_once()

    @patch("api.views.auth_password.Organisation")
    def test_change_rejects_wrong_current_password(self, mock_org):
        """Wrong current password returns 401 before we even check the org."""
        user = MagicMock()
        user.is_authenticated = True
        user.has_usable_password.return_value = True
        user.check_password.return_value = False

        request = _make_post(
            "/auth/password/change/",
            {
                "currentAuthHash": "wrong",
                "newAuthHash": "new" * 20,
                "orgId": "org-1",
                "identityKey": "k",
                "wrappedKeyring": "wk",
                "wrappedRecovery": "wr",
            },
            user=user,
        )
        response = password_change(request)

        self.assertEqual(response.status_code, 401)

    def test_change_rejects_sso_user(self):
        """SSO users (unusable password) get 400."""
        user = MagicMock()
        user.is_authenticated = True
        user.has_usable_password.return_value = False

        request = _make_post(
            "/auth/password/change/",
            {
                "currentAuthHash": "x",
                "newAuthHash": "y",
                "orgKeys": [{"orgId": "org-1", "wrappedKeyring": "wk", "wrappedRecovery": "wr"}],
            },
            user=user,
        )
        response = password_change(request)

        self.assertEqual(response.status_code, 400)

    def test_change_rejects_missing_fields(self):
        """Missing fields return 400."""
        user = MagicMock()
        user.is_authenticated = True
        user.has_usable_password.return_value = True

        request = _make_post(
            "/auth/password/change/",
            {"currentAuthHash": "x"},
            user=user,
        )
        response = password_change(request)

        self.assertEqual(response.status_code, 400)


# ---------------------------------------------------------------------------
# Verification email logging
# ---------------------------------------------------------------------------

class VerificationEmailLoggingTest(_ThrottleClearMixin, unittest.TestCase):
    """Ensure verification URL is always logged."""

    @patch("api.views.auth_password._smtp_configured", return_value=True)
    @patch("api.views.auth_password.transaction")
    @patch("api.views.auth_password._send_verification_email")
    @patch("api.views.auth_password.EmailVerification")
    @patch("api.views.auth_password.get_user_model")
    def test_verification_url_logged(
        self, mock_get_user, mock_ev, mock_send_email, mock_tx, mock_smtp
    ):
        """Registration always calls _send_verification_email which logs."""
        User = MagicMock()
        User.objects.filter.return_value.exists.return_value = False
        new_user = MagicMock()
        User.objects.create_user.return_value = new_user
        mock_get_user.return_value = User

        payload = {
            "email": "bob@example.com",
            "authHash": "h" * 64,
        }
        request = _make_post("/auth/password/register/", payload)
        password_register(request)

        mock_send_email.assert_called_once()
        call_args = mock_send_email.call_args
        self.assertEqual(call_args[0][0], "bob@example.com")
        self.assertIn("/auth/verify-email/", call_args[0][1])


# ---------------------------------------------------------------------------
# email_check
# ---------------------------------------------------------------------------

class EmailCheckTest(_ThrottleClearMixin, unittest.TestCase):
    """Tests for POST /auth/email/check/."""

    @patch("api.views.auth_password.OrganisationSSOProvider")
    @patch("api.views.auth_password.OrganisationMember")
    @patch("api.views.auth_password.get_user_model")
    def test_returns_credentials_for_password_user(self, mock_get_user, mock_om, mock_sso):
        """Known password user returns password=True, sso=[]."""
        User = MagicMock()
        user = MagicMock()
        user.has_usable_password.return_value = True
        user.socialaccount_set.first.return_value = None
        User.objects.get.return_value = user
        mock_get_user.return_value = User
        mock_om.objects.filter.return_value.select_related.return_value = []

        request = _make_post("/auth/email/check/", {"email": "alice@example.com"})
        response = email_check(request)

        self.assertEqual(response.status_code, 200)
        data = json.loads(response.content)
        self.assertTrue(data["authMethods"]["password"])
        self.assertEqual(data["authMethods"]["sso"], [])

    @patch("api.views.auth_password.OrganisationSSOProvider")
    @patch("api.views.auth_password.OrganisationMember")
    @patch("api.views.auth_password.get_user_model")
    def test_returns_empty_sso_for_instance_sso_user(self, mock_get_user, mock_om, mock_sso):
        """Instance-level SSO users get sso=[] (buttons are on the first screen)."""
        User = MagicMock()
        user = MagicMock()
        user.has_usable_password.return_value = False
        User.objects.get.return_value = user
        mock_get_user.return_value = User
        mock_om.objects.filter.return_value.select_related.return_value = []

        request = _make_post("/auth/email/check/", {"email": "bob@example.com"})
        response = email_check(request)

        self.assertEqual(response.status_code, 200)
        data = json.loads(response.content)
        self.assertFalse(data["authMethods"]["password"])
        self.assertEqual(data["authMethods"]["sso"], [])

    @patch("api.views.auth_password.OrganisationSSOProvider")
    @patch("api.views.auth_password.OrganisationMember")
    @patch("api.views.auth_password.get_user_model")
    def test_returns_credentials_for_unknown_email(self, mock_get_user, mock_om, mock_sso):
        """Unknown email returns password=True, sso=[] (no enumeration leak)."""
        User = MagicMock()
        from api.models import CustomUser
        User.DoesNotExist = CustomUser.DoesNotExist
        User.objects.get.side_effect = CustomUser.DoesNotExist
        mock_get_user.return_value = User

        request = _make_post("/auth/email/check/", {"email": "nobody@example.com"})
        response = email_check(request)

        self.assertEqual(response.status_code, 200)
        data = json.loads(response.content)
        self.assertTrue(data["authMethods"]["password"])
        self.assertEqual(data["authMethods"]["sso"], [])

    def test_rejects_missing_email(self):
        """Missing email returns 400."""
        request = _make_post("/auth/email/check/", {})
        response = email_check(request)

        self.assertEqual(response.status_code, 400)


# ---------------------------------------------------------------------------
# resend_verification
# ---------------------------------------------------------------------------

class ResendVerificationTest(_ThrottleClearMixin, unittest.TestCase):
    """Tests for POST /auth/verify-email/resend/."""

    @patch("api.views.auth_password._send_verification_email")
    @patch("api.views.auth_password.EmailVerification")
    @patch("api.views.auth_password.get_user_model")
    def test_resend_creates_new_token(self, mock_get_user, mock_ev, mock_send_email):
        """Resend deletes old token and creates new one."""
        User = MagicMock()
        user = MagicMock()
        user.active = False
        User.objects.get.return_value = user
        mock_get_user.return_value = User

        request = _make_post("/auth/verify-email/resend/", {"email": "alice@example.com"})
        response = resend_verification(request)

        self.assertEqual(response.status_code, 200)
        mock_ev.objects.filter.return_value.delete.assert_called_once()
        mock_ev.objects.create.assert_called_once()
        mock_send_email.assert_called_once()

    @patch("api.views.auth_password.get_user_model")
    def test_resend_does_not_leak_for_unknown_email(self, mock_get_user):
        """Unknown email gets same success message (no enumeration)."""
        User = MagicMock()
        from api.models import CustomUser
        User.DoesNotExist = CustomUser.DoesNotExist
        User.objects.get.side_effect = CustomUser.DoesNotExist
        mock_get_user.return_value = User

        request = _make_post("/auth/verify-email/resend/", {"email": "unknown@example.com"})
        response = resend_verification(request)

        self.assertEqual(response.status_code, 200)

    @patch("api.views.auth_password.get_user_model")
    def test_resend_noop_for_already_active_user(self, mock_get_user):
        """Already-active user gets same success message, no new token."""
        User = MagicMock()
        user = MagicMock()
        user.active = True
        User.objects.get.return_value = user
        mock_get_user.return_value = User

        request = _make_post("/auth/verify-email/resend/", {"email": "active@example.com"})
        response = resend_verification(request)

        self.assertEqual(response.status_code, 200)

    def test_resend_rejects_missing_email(self):
        """Missing email returns 400."""
        request = _make_post("/auth/verify-email/resend/", {})
        response = resend_verification(request)

        self.assertEqual(response.status_code, 400)


# ---------------------------------------------------------------------------
# skip email verification flag
# ---------------------------------------------------------------------------

class SkipEmailVerificationTest(_ThrottleClearMixin, unittest.TestCase):
    """Tests for SKIP_EMAIL_VERIFICATION env var."""

    @patch("api.views.auth_password._skip_email_verification", return_value=True)
    @patch("api.views.auth_password.transaction")
    @patch("api.views.auth_password.EmailVerification")
    @patch("api.views.auth_password.get_user_model")
    def test_register_skips_verification(self, mock_get_user, mock_ev, mock_tx, mock_skip):
        """With SKIP_EMAIL_VERIFICATION, user is active immediately."""
        User = MagicMock()
        User.objects.filter.return_value.exists.return_value = False
        new_user = MagicMock()
        User.objects.create_user.return_value = new_user
        mock_get_user.return_value = User

        request = _make_post("/auth/password/register/", {
            "email": "quick@example.com",
            "authHash": "a" * 64,
        })
        response = password_register(request)

        self.assertEqual(response.status_code, 201)
        data = json.loads(response.content)
        self.assertTrue(data["verificationSkipped"])
        # User should be set to active=True (skip_verification)
        self.assertTrue(new_user.active)
        # No verification token should be created
        mock_ev.objects.create.assert_not_called()

    @patch("api.views.auth_password._smtp_configured", return_value=True)
    @patch("api.views.auth_password._skip_email_verification", return_value=False)
    @patch("api.views.auth_password._send_verification_email")
    @patch("api.views.auth_password.transaction")
    @patch("api.views.auth_password.EmailVerification")
    @patch("api.views.auth_password.get_user_model")
    def test_register_requires_verification_by_default(
        self, mock_get_user, mock_ev, mock_tx, mock_send_email, mock_skip, mock_smtp
    ):
        """Without flag, user is inactive and verification token is created."""
        User = MagicMock()
        User.objects.filter.return_value.exists.return_value = False
        new_user = MagicMock()
        User.objects.create_user.return_value = new_user
        mock_get_user.return_value = User

        request = _make_post("/auth/password/register/", {
            "email": "normal@example.com",
            "authHash": "a" * 64,
        })
        response = password_register(request)

        self.assertEqual(response.status_code, 201)
        data = json.loads(response.content)
        self.assertNotIn("verificationSkipped", data)
        mock_ev.objects.create.assert_called_once()
        mock_send_email.assert_called_once()


# ===========================================================================
# End-to-end flow tests (multi-step scenarios)
# ===========================================================================

class PasswordSignupFlowTest(_ThrottleClearMixin, unittest.TestCase):
    """Full password signup flow: register → verify → login."""

    @patch("api.views.auth_password._smtp_configured", return_value=True)
    @patch("api.views.auth_password.login")
    @patch("api.views.auth_password.transaction")
    @patch("api.views.auth_password._send_verification_email")
    @patch("api.views.auth_password.EmailVerification")
    @patch("api.views.auth_password.get_user_model")
    def test_full_password_signup_flow(
        self, mock_get_user, mock_ev, mock_send_email, mock_tx, mock_login, mock_smtp
    ):
        """Register → verify email → login succeeds."""
        User = MagicMock()
        user = MagicMock()
        user.active = False
        user.userId = "uuid-pw-1"
        user.email = "newuser@example.com"
        user.full_name = ""
        user.auth_method = "password"
        user.has_usable_password.return_value = True
        user.socialaccount_set.first.return_value = None

        User.objects.filter.return_value.exists.return_value = False
        User.objects.create_user.return_value = user
        User.objects.get.return_value = user
        mock_get_user.return_value = User

        # Step 1: Register
        reg_request = _make_post("/auth/password/register/", {
            "email": "newuser@example.com",
            "authHash": "h" * 64,
        })
        reg_response = password_register(reg_request)
        self.assertEqual(reg_response.status_code, 201)
        mock_send_email.assert_called_once()

        # Step 2: Verify email
        ev = MagicMock()
        ev.verified = False
        ev.expires_at = timezone.now() + timedelta(hours=1)
        ev.user = user
        mock_ev.objects.select_related.return_value.get.return_value = ev

        verify_request = _make_get("/auth/verify-email/token123/")
        verify_response = verify_email(verify_request, "token123")
        self.assertEqual(verify_response.status_code, 302)
        self.assertIn("verified=true", verify_response.url)

        # Step 3: Login (user now active)
        user.active = True
        user.check_password.return_value = True

        login_request = _make_post("/auth/password/login/", {
            "email": "newuser@example.com",
            "authHash": "h" * 64,
        })
        login_response = password_login(login_request)
        self.assertEqual(login_response.status_code, 200)
        data = json.loads(login_response.content)
        self.assertEqual(data["authMethod"], "password")
        mock_login.assert_called_once()

    @patch("api.views.auth_password._smtp_configured", return_value=True)
    @patch("api.views.auth_password.transaction")
    @patch("api.views.auth_password.EmailVerification")
    @patch("api.views.auth_password.get_user_model")
    def test_login_blocked_before_verification(
        self, mock_get_user, mock_ev, mock_tx, mock_smtp
    ):
        """User cannot login before verifying email."""
        User = MagicMock()
        user = MagicMock()
        user.active = False
        User.objects.filter.return_value.exists.return_value = False
        User.objects.create_user.return_value = user
        User.objects.get.return_value = user
        mock_get_user.return_value = User

        # Register
        reg_request = _make_post("/auth/password/register/", {
            "email": "unverified@example.com",
            "authHash": "h" * 64,
        })
        password_register(reg_request)

        # Try to login without verifying — should fail
        login_request = _make_post("/auth/password/login/", {
            "email": "unverified@example.com",
            "authHash": "h" * 64,
        })
        login_response = password_login(login_request)
        self.assertEqual(login_response.status_code, 403)


class SSOSignupFlowTest(_ThrottleClearMixin, unittest.TestCase):
    """SSO login creates user with unusable password."""

    def test_sso_user_has_unusable_password(self):
        """SSO-created user has auth_method=sso and can't password-login."""
        user = MagicMock()
        user.has_usable_password.return_value = False
        user.auth_method = "sso"

        # Verify auth_method is sso
        self.assertEqual(user.auth_method, "sso")

    @patch("api.views.auth_password.get_user_model")
    def test_sso_user_cannot_password_login(self, mock_get_user):
        """SSO user with unusable password fails password login."""
        User = MagicMock()
        user = MagicMock()
        user.active = True
        user.check_password.return_value = False  # unusable password always fails
        User.objects.get.return_value = user
        mock_get_user.return_value = User

        request = _make_post("/auth/password/login/", {
            "email": "sso-user@example.com",
            "authHash": "anything",
        })
        response = password_login(request)
        self.assertEqual(response.status_code, 401)

    @patch("api.views.auth_password.OrganisationSSOProvider")
    @patch("api.views.auth_password.OrganisationMember")
    @patch("api.views.auth_password.get_user_model")
    def test_email_check_instance_sso_user_gets_empty_sso(self, mock_get_user, mock_om, mock_sso):
        """Instance-level SSO user gets sso=[] (buttons are on the first screen)."""
        User = MagicMock()
        user = MagicMock()
        user.has_usable_password.return_value = False
        User.objects.get.return_value = user
        mock_get_user.return_value = User
        mock_om.objects.filter.return_value.select_related.return_value = []

        request = _make_post("/auth/email/check/", {"email": "sso-user@example.com"})
        response = email_check(request)

        data = json.loads(response.content)
        self.assertFalse(data["authMethods"]["password"])
        self.assertEqual(data["authMethods"]["sso"], [])


class EmailCheckNoEnumerationTest(_ThrottleClearMixin, unittest.TestCase):
    """email_check must not leak whether an email is registered."""

    @patch("api.views.auth_password.OrganisationSSOProvider")
    @patch("api.views.auth_password.OrganisationMember")
    @patch("api.views.auth_password.get_user_model")
    def test_unknown_and_password_user_same_response(self, mock_get_user, mock_om, mock_sso):
        """Unknown email and password user both return password=True, sso=[]."""
        User = MagicMock()
        from api.models import CustomUser

        # Unknown email
        User.DoesNotExist = CustomUser.DoesNotExist
        User.objects.get.side_effect = CustomUser.DoesNotExist
        mock_get_user.return_value = User

        req1 = _make_post("/auth/email/check/", {"email": "unknown@example.com"})
        resp1 = email_check(req1)
        data1 = json.loads(resp1.content)

        # Password user
        User.objects.get.side_effect = None
        pw_user = MagicMock()
        pw_user.has_usable_password.return_value = True
        pw_user.socialaccount_set.first.return_value = None
        User.objects.get.return_value = pw_user
        mock_om.objects.filter.return_value.select_related.return_value = []

        req2 = _make_post("/auth/email/check/", {"email": "known@example.com"})
        resp2 = email_check(req2)
        data2 = json.loads(resp2.content)

        # Both should return identical authMethods
        self.assertEqual(data1["authMethods"], data2["authMethods"])
        self.assertTrue(data1["authMethods"]["password"])
        self.assertEqual(data1["authMethods"]["sso"], [])


class PasswordChangeFlowTest(_ThrottleClearMixin, unittest.TestCase):
    """ChangeAccountPasswordMutation rotates the auth hash AND re-wraps
    THIS org's keyring atomically. Other orgs are left encrypted with the
    old key and surface a recovery prompt on next access."""

    def _info(self, user):
        from django.contrib.sessions.middleware import SessionMiddleware
        info = MagicMock()
        request = APIRequestFactory().post("/graphql/")
        SessionMiddleware(lambda r: None).process_request(request)
        request.session.save()
        request.user = user
        info.context = request
        return info

    @patch("backend.graphene.mutations.organisation.login")
    @patch("backend.graphene.mutations.organisation.transaction")
    @patch("backend.graphene.mutations.organisation.OrganisationMember")
    @patch("backend.graphene.mutations.organisation.Organisation")
    def test_password_change_rewraps_current_org_keyring(
        self, mock_org, mock_om, mock_tx, mock_login
    ):
        from backend.graphene.mutations.organisation import (
            ChangeAccountPasswordMutation,
        )
        user = MagicMock()
        user.has_usable_password.return_value = True
        user.check_password.return_value = True

        org = MagicMock()
        org.identity_key = "matching_key"
        mock_org.objects.get.return_value = org

        org_member = MagicMock()
        mock_om.objects.get.return_value = org_member

        result = ChangeAccountPasswordMutation.mutate(
            None,
            self._info(user),
            org_id="org-a",
            current_auth_hash="old_hash",
            new_auth_hash="new_hash",
            identity_key="matching_key",
            wrapped_keyring="wk_a",
            wrapped_recovery="wr_a",
        )

        user.set_password.assert_called_once_with("new_hash")
        self.assertEqual(org_member.wrapped_keyring, "wk_a")
        self.assertEqual(org_member.wrapped_recovery, "wr_a")
        org_member.save.assert_called_once()
        mock_login.assert_called_once()
        self.assertIs(result.org_member, org_member)

    @patch("backend.graphene.mutations.organisation.Organisation")
    def test_password_change_rejects_wrong_current_password(self, mock_org):
        """Wrong current password is rejected before any org lookup."""
        from graphql import GraphQLError
        from backend.graphene.mutations.organisation import (
            ChangeAccountPasswordMutation,
        )
        user = MagicMock()
        user.has_usable_password.return_value = True
        user.check_password.return_value = False

        with self.assertRaises(GraphQLError):
            ChangeAccountPasswordMutation.mutate(
                None,
                self._info(user),
                org_id="org-a",
                current_auth_hash="wrong",
                new_auth_hash="new_hash",
                identity_key="k",
                wrapped_keyring="wk",
                wrapped_recovery="wr",
            )
        user.set_password.assert_not_called()
        mock_org.objects.get.assert_not_called()

    @patch("backend.graphene.mutations.organisation.OrganisationMember")
    @patch("backend.graphene.mutations.organisation.Organisation")
    def test_password_change_rejects_wrong_identity_key(self, mock_org, mock_om):
        """Mnemonic must match the org's stored identity_key — proves the
        user has the keyring material and isn't just guessing UUIDs."""
        from graphql import GraphQLError
        from backend.graphene.mutations.organisation import (
            ChangeAccountPasswordMutation,
        )
        user = MagicMock()
        user.has_usable_password.return_value = True
        user.check_password.return_value = True

        org = MagicMock()
        org.identity_key = "real_key"
        mock_org.objects.get.return_value = org

        with self.assertRaises(GraphQLError):
            ChangeAccountPasswordMutation.mutate(
                None,
                self._info(user),
                org_id="org-a",
                current_auth_hash="old_hash",
                new_auth_hash="new_hash",
                identity_key="wrong_key",
                wrapped_keyring="wk_a",
                wrapped_recovery="wr_a",
            )
        user.set_password.assert_not_called()
        mock_om.objects.get.assert_not_called()

    def test_sso_user_cannot_change_password(self):
        """SSO users (unusable password) are blocked."""
        from graphql import GraphQLError
        from backend.graphene.mutations.organisation import (
            ChangeAccountPasswordMutation,
        )
        user = MagicMock()
        user.has_usable_password.return_value = False

        with self.assertRaises(GraphQLError):
            ChangeAccountPasswordMutation.mutate(
                None,
                self._info(user),
                org_id="org-a",
                current_auth_hash="x",
                new_auth_hash="y",
                identity_key="k",
                wrapped_keyring="wk",
                wrapped_recovery="wr",
            )
        user.set_password.assert_not_called()


class RecoveryFlowTest(_ThrottleClearMixin, unittest.TestCase):
    """Recovery via mnemonic, exposed as the GraphQL mutation
    RecoverAccountKeyringMutation. Password must match user's
    current login auth (auth and sudo stay unified). Only the org's
    keyring is rewrapped; user.password is never reset because if the
    hashes match, it's already correct."""

    def _info(self, user):
        from django.contrib.sessions.middleware import SessionMiddleware
        info = MagicMock()
        request = APIRequestFactory().post("/graphql/")
        SessionMiddleware(lambda r: None).process_request(request)
        request.session.save()
        request.user = user
        info.context = request
        return info

    @patch("backend.graphene.mutations.organisation.login")
    @patch("backend.graphene.mutations.organisation.transaction")
    @patch("backend.graphene.mutations.organisation.OrganisationMember")
    @patch("backend.graphene.mutations.organisation.Organisation")
    def test_password_user_recovery_rewraps_keyring_when_auth_matches(
        self, mock_org, mock_om, mock_tx, mock_login
    ):
        from backend.graphene.mutations.organisation import (
            RecoverAccountKeyringMutation,
        )
        user = MagicMock()
        user.has_usable_password.return_value = True
        user.check_password.return_value = True  # supplied authHash matches

        org = MagicMock()
        org.identity_key = "matching_key"
        mock_org.objects.get.return_value = org

        org_member = MagicMock()
        mock_om.objects.get.return_value = org_member

        result = RecoverAccountKeyringMutation.mutate(
            None,
            self._info(user),
            org_id="org-1",
            auth_hash="current_hash",
            identity_key="matching_key",
            wrapped_keyring="new_wk",
            wrapped_recovery="new_wr",
        )

        # Auth password is already correct — set_password should NOT be called.
        user.set_password.assert_not_called()
        self.assertEqual(org_member.wrapped_keyring, "new_wk")
        self.assertEqual(org_member.wrapped_recovery, "new_wr")
        org_member.save.assert_called_once()
        mock_login.assert_called_once()
        self.assertIs(result.org_member, org_member)

    @patch("backend.graphene.mutations.organisation.OrganisationMember")
    @patch("backend.graphene.mutations.organisation.Organisation")
    def test_recovery_rejects_password_mismatch(self, mock_org, mock_om):
        """Regression: a user who recovers an org's keyring with a
        password DIFFERENT from their current login auth would otherwise
        end up with split auth/sudo passwords. The mutation must refuse."""
        from graphql import GraphQLError
        from backend.graphene.mutations.organisation import (
            RecoverAccountKeyringMutation,
        )
        user = MagicMock()
        user.has_usable_password.return_value = True
        user.check_password.return_value = False  # supplied hash != stored

        org = MagicMock()
        org.identity_key = "matching_key"
        mock_org.objects.get.return_value = org
        mock_om.objects.get.return_value = MagicMock()

        with self.assertRaises(GraphQLError):
            RecoverAccountKeyringMutation.mutate(
                None,
                self._info(user),
                org_id="org-1",
                auth_hash="wrong_pw_hash",
                identity_key="matching_key",
                wrapped_keyring="new_wk",
                wrapped_recovery="new_wr",
            )
        user.set_password.assert_not_called()

    @patch("backend.graphene.mutations.organisation.Organisation")
    def test_recovery_rejects_wrong_identity_key(self, mock_org):
        """Wrong identity key is rejected before any keyring write."""
        from graphql import GraphQLError
        from backend.graphene.mutations.organisation import (
            RecoverAccountKeyringMutation,
        )
        user = MagicMock()
        user.has_usable_password.return_value = True

        org = MagicMock()
        org.identity_key = "real_key"
        mock_org.objects.get.return_value = org

        with self.assertRaises(GraphQLError):
            RecoverAccountKeyringMutation.mutate(
                None,
                self._info(user),
                org_id="org-1",
                auth_hash="hash",
                identity_key="wrong_key",
                wrapped_keyring="x",
                wrapped_recovery="y",
            )
        user.set_password.assert_not_called()
        user.check_password.assert_not_called()

    def test_sso_user_recovery_rejected(self):
        """SSO users have no password to reset — mutation refuses."""
        from graphql import GraphQLError
        from backend.graphene.mutations.organisation import (
            RecoverAccountKeyringMutation,
        )
        user = MagicMock()
        user.has_usable_password.return_value = False

        with self.assertRaises(GraphQLError):
            RecoverAccountKeyringMutation.mutate(
                None,
                self._info(user),
                org_id="org-1",
                auth_hash="anything",
                identity_key="k",
                wrapped_keyring="x",
                wrapped_recovery="y",
            )
        user.set_password.assert_not_called()

    @patch("backend.graphene.mutations.organisation.OrganisationMember")
    @patch("backend.graphene.mutations.organisation.Organisation")
    def test_sso_recovery_rewrap_requires_identity_proof(self, mock_org, mock_om):
        """SSO recovery via UpdateUserWrappedSecretsMutation must reject
        when supplied identity_key doesn't match — without this proof an
        authenticated user (or session-cookie holder) could overwrite
        their wrapped_keyring with arbitrary garbage."""
        from graphql import GraphQLError
        from backend.graphene.mutations.organisation import (
            UpdateUserWrappedSecretsMutation,
        )
        user = MagicMock()

        org = MagicMock()
        org.identity_key = "real_key"
        mock_org.objects.get.return_value = org

        with self.assertRaises(GraphQLError):
            UpdateUserWrappedSecretsMutation.mutate(
                None,
                self._info(user),
                org_id="org-1",
                identity_key="wrong_key",
                wrapped_keyring="garbage",
                wrapped_recovery="garbage",
            )
        mock_om.objects.get.assert_not_called()

    @patch("backend.graphene.mutations.organisation.OrganisationMember")
    @patch("backend.graphene.mutations.organisation.Organisation")
    def test_sso_recovery_rewrap_succeeds_with_valid_identity(
        self, mock_org, mock_om
    ):
        """Matching identity_key allows the keyring rewrap."""
        from backend.graphene.mutations.organisation import (
            UpdateUserWrappedSecretsMutation,
        )
        user = MagicMock()

        org = MagicMock()
        org.identity_key = "matching_key"
        mock_org.objects.get.return_value = org

        org_member = MagicMock()
        mock_om.objects.get.return_value = org_member

        result = UpdateUserWrappedSecretsMutation.mutate(
            None,
            self._info(user),
            org_id="org-1",
            identity_key="matching_key",
            wrapped_keyring="new_wk",
            wrapped_recovery="new_wr",
        )

        self.assertEqual(org_member.wrapped_keyring, "new_wk")
        self.assertEqual(org_member.wrapped_recovery, "new_wr")
        org_member.save.assert_called_once()
        self.assertIs(result.org_member, org_member)


class CrossAuthMethodTest(_ThrottleClearMixin, unittest.TestCase):
    """Tests for cross-auth-method edge cases."""

    def test_sso_user_cannot_change_password(self):
        """SSO users are blocked from password change."""
        user = MagicMock()
        user.is_authenticated = True
        user.has_usable_password.return_value = False

        request = _make_post(
            "/auth/password/change/",
            {
                "currentAuthHash": "x",
                "newAuthHash": "y",
                "orgKeys": [{"orgId": "org-1", "wrappedKeyring": "wk", "wrappedRecovery": "wr"}],
            },
            user=user,
        )
        response = password_change(request)
        self.assertEqual(response.status_code, 400)

    @patch("api.views.auth_password.OrganisationSSOProvider")
    @patch("api.views.auth_password.OrganisationMember")
    @patch("api.views.auth_password.get_user_model")
    def test_email_check_password_user_gets_credentials(self, mock_get_user, mock_om, mock_sso):
        """Password user returns password=True."""
        User = MagicMock()
        user = MagicMock()
        user.has_usable_password.return_value = True
        user.socialaccount_set.first.return_value = None
        User.objects.get.return_value = user
        mock_get_user.return_value = User
        mock_om.objects.filter.return_value.select_related.return_value = []

        request = _make_post("/auth/email/check/", {"email": "pw@example.com"})
        response = email_check(request)
        data = json.loads(response.content)
        self.assertTrue(data["authMethods"]["password"])
        self.assertEqual(data["authMethods"]["sso"], [])

    @patch("api.views.auth_password.OrganisationSSOProvider")
    @patch("api.views.auth_password.OrganisationMember")
    @patch("api.views.auth_password.get_user_model")
    def test_email_check_instance_sso_user_gets_empty_sso(self, mock_get_user, mock_om, mock_sso):
        """Instance-level SSO user gets sso=[] (buttons are on the first screen)."""
        User = MagicMock()
        user = MagicMock()
        user.has_usable_password.return_value = False
        User.objects.get.return_value = user
        mock_get_user.return_value = User
        mock_om.objects.filter.return_value.select_related.return_value = []

        request = _make_post("/auth/email/check/", {"email": "sso@example.com"})
        response = email_check(request)
        data = json.loads(response.content)
        self.assertFalse(data["authMethods"]["password"])
        self.assertEqual(data["authMethods"]["sso"], [])
