"""Tests for TOTP 2FA: crypto helpers, replay guard, recovery codes, the
management/verify endpoints, and the login-flow deferral.

Uses unittest.TestCase with mocked ORM — no database required.
"""

import json
import time
import unittest
from unittest.mock import patch, MagicMock

import pyotp
from django.contrib.auth.models import AnonymousUser
from django.core.cache import cache
from django.test import RequestFactory
from django.contrib.sessions.middleware import SessionMiddleware
from rest_framework.test import APIRequestFactory, force_authenticate

from api.utils.mfa import TOTP_DIGITS, TOTP_STEP


def _add_session_to_request(request):
    middleware = SessionMiddleware(lambda req: None)
    middleware.process_request(request)
    request.session.save()


def _fresh_session(request):
    request.session["auth_time"] = int(time.time())


def _make_user(user_id="uuid-user-1", email="alice@example.com"):
    user = MagicMock()
    user.userId = user_id
    user.pk = user_id
    user.email = email
    user.full_name = "Alice Test"
    user.is_authenticated = True
    return user


# ---------------------------------------------------------------------------
# Crypto helpers
# ---------------------------------------------------------------------------


class SeedEncryptionTest(unittest.TestCase):
    def test_seed_encrypt_decrypt_round_trip(self):
        from api.utils.crypto import random_key_pair
        import api.utils.mfa as mfa

        pk, sk = random_key_pair()
        with patch.object(mfa, "get_server_keypair", return_value=(pk, sk)):
            seed = mfa.generate_totp_secret()
            ciphertext = mfa.encrypt_seed(seed)
            self.assertTrue(ciphertext.startswith("ph:v1:"))
            self.assertNotIn(seed, ciphertext)
            self.assertEqual(mfa.decrypt_seed(ciphertext), seed)

    def test_secret_is_160_bits_base32(self):
        from api.utils.mfa import generate_totp_secret

        secret = generate_totp_secret()
        self.assertEqual(len(secret), 32)  # 32 base32 chars = 160 bits

    def test_otpauth_uri_contains_issuer_and_email(self):
        from api.utils.mfa import build_otpauth_uri, generate_totp_secret

        uri = build_otpauth_uri(generate_totp_secret(), "alice@example.com")
        self.assertTrue(uri.startswith("otpauth://totp/"))
        self.assertIn("Phase%20Console", uri)
        self.assertIn("alice%40example.com", uri)
        # Non-standard `image` param for apps that render issuer logos
        self.assertIn("image=", uri)
        self.assertIn("phase-avatar", uri)


# ---------------------------------------------------------------------------
# Verify + replay guard
# ---------------------------------------------------------------------------


class VerifyTotpCodeTest(unittest.TestCase):
    SEED = pyotp.random_base32(length=32)

    def _totp_row(self, floor=0):
        row = MagicMock()
        row.pk = "totp-1"
        row.encrypted_seed = "ph:v1:..."
        row.last_verified_timestep = floor
        return row

    def _code_at(self, offset_steps=0):
        totp = pyotp.TOTP(self.SEED, digits=TOTP_DIGITS, interval=TOTP_STEP)
        return totp.at((int(time.time()) // TOTP_STEP + offset_steps) * TOTP_STEP)

    def _verify(self, code, update_result=1, floor=0):
        import api.utils.mfa as mfa

        with patch.object(mfa, "decrypt_seed", return_value=self.SEED), patch.object(
            mfa, "UserTOTP"
        ) as mock_model:
            mock_model.objects.filter.return_value.update.return_value = update_result
            return mfa.verify_totp_code(self._totp_row(floor=floor), code)

    def test_current_code_accepted(self):
        self.assertIsNotNone(self._verify(self._code_at(0)))

    def test_previous_and_next_step_accepted(self):
        self.assertIsNotNone(self._verify(self._code_at(-1)))
        self.assertIsNotNone(self._verify(self._code_at(1)))

    def test_two_steps_out_rejected(self):
        self.assertIsNone(self._verify(self._code_at(-2)))
        self.assertIsNone(self._verify(self._code_at(2)))

    def test_replay_rejected(self):
        # Conditional update matched 0 rows → the step was already used
        self.assertIsNone(self._verify(self._code_at(0), update_result=0))

    def test_skewed_device_next_code_accepted(self):
        # A fast device verified at +1 (floor = current+1); its next code
        # (current+2) must verify without waiting for the server clock.
        step = int(time.time()) // TOTP_STEP
        self.assertIsNotNone(self._verify(self._code_at(2), floor=step + 1))
        # The chase extends the window by exactly one step, no further
        self.assertIsNone(self._verify(self._code_at(3), floor=step + 1))

    def test_floor_chase_requires_advanced_floor(self):
        # Without a floor past the window, +2 codes stay rejected
        self.assertIsNone(self._verify(self._code_at(2), floor=0))

    def test_malformed_codes_rejected(self):
        self.assertIsNone(self._verify("12345"))
        self.assertIsNone(self._verify("abcdef"))
        self.assertIsNone(self._verify(""))
        self.assertIsNone(self._verify(None))

    def test_whitespace_normalised(self):
        code = self._code_at(0)
        spaced = f" {code[:3]} {code[3:]} "
        self.assertIsNotNone(self._verify(spaced))


class RecoveryCodeTest(unittest.TestCase):
    def test_generate_creates_ten_hashed_codes(self):
        import api.utils.mfa as mfa

        user = _make_user()
        with patch.object(mfa, "UserRecoveryCode") as mock_model, patch.object(
            mfa, "make_password", side_effect=lambda c: f"hash({c})"
        ):
            codes = mfa.generate_recovery_codes(user)

        self.assertEqual(len(codes), 10)
        for code in codes:
            self.assertRegex(code, r"^[a-z2-7]{5}-[a-z2-7]{5}$")
        self.assertEqual(len(set(codes)), 10)
        # Old codes are invalidated first
        mock_model.objects.filter.return_value.delete.assert_called_once()
        self.assertEqual(mock_model.objects.create.call_count, 10)

    def test_consume_matches_and_marks_used(self):
        import api.utils.mfa as mfa
        from django.contrib.auth.hashers import make_password

        user = _make_user()
        row = MagicMock()
        row.pk = "rc-1"
        row.code_hash = make_password("abcde-fghij")

        with patch.object(mfa, "UserRecoveryCode") as mock_model:
            mock_model.objects.filter.return_value = [row]
            # Second filter call (conditional update) needs the chained mock
            update_chain = MagicMock()
            update_chain.update.return_value = 1
            mock_model.objects.filter.side_effect = [[row], update_chain]
            self.assertTrue(mfa.consume_recovery_code(user, "ABCDE-FGHIJ"))
            update_chain.update.assert_called_once()

    def test_consume_rejects_wrong_code(self):
        import api.utils.mfa as mfa
        from django.contrib.auth.hashers import make_password

        user = _make_user()
        row = MagicMock()
        row.code_hash = make_password("abcde-fghij")
        with patch.object(mfa, "UserRecoveryCode") as mock_model:
            mock_model.objects.filter.return_value = [row]
            self.assertFalse(mfa.consume_recovery_code(user, "wrong-wrong"))


# ---------------------------------------------------------------------------
# Management endpoints
# ---------------------------------------------------------------------------


class MfaManagementViewTest(unittest.TestCase):
    def setUp(self):
        cache.clear()

    def _post(self, path, body, user=None, fresh=True):
        request = RequestFactory().post(
            path, data=json.dumps(body), content_type="application/json"
        )
        _add_session_to_request(request)
        if fresh:
            _fresh_session(request)
        request.user = user if user is not None else AnonymousUser()
        return request

    def test_enroll_requires_authentication(self):
        from api.views.auth_mfa import mfa_enroll

        response = mfa_enroll(self._post("/auth/mfa/enroll/", {}))
        self.assertEqual(response.status_code, 401)
        self.assertEqual(json.loads(response.content)["code"], "unauthenticated")

    def test_enroll_requires_fresh_session(self):
        from api.views.auth_mfa import mfa_enroll

        response = mfa_enroll(
            self._post("/auth/mfa/enroll/", {}, user=_make_user(), fresh=False)
        )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(json.loads(response.content)["code"], "reauth_required")

    @patch("api.views.auth_mfa.user_has_active_totp", return_value=True)
    def test_enroll_refuses_when_already_enabled(self, mock_active):
        from api.views.auth_mfa import mfa_enroll

        response = mfa_enroll(self._post("/auth/mfa/enroll/", {}, user=_make_user()))
        self.assertEqual(response.status_code, 409)

    @patch("api.views.auth_mfa.build_otpauth_uri", return_value="otpauth://totp/x")
    @patch("api.views.auth_mfa.encrypt_seed", return_value="ph:v1:ct")
    @patch("api.views.auth_mfa.generate_totp_secret", return_value="S" * 32)
    @patch("api.views.auth_mfa.UserTOTP")
    @patch("api.views.auth_mfa.user_has_active_totp", return_value=False)
    def test_enroll_creates_pending_row(
        self, mock_active, mock_model, mock_secret, mock_encrypt, mock_uri
    ):
        from api.views.auth_mfa import mfa_enroll

        response = mfa_enroll(self._post("/auth/mfa/enroll/", {}, user=_make_user()))
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.content)
        self.assertEqual(data["secret"], "S" * 32)
        self.assertEqual(data["otpauthUri"], "otpauth://totp/x")
        _, kwargs = mock_model.objects.update_or_create.call_args
        self.assertIsNone(kwargs["defaults"]["activated_at"])
        self.assertEqual(kwargs["defaults"]["encrypted_seed"], "ph:v1:ct")

    @patch("api.views.auth_mfa.send_totp_status_email")
    @patch("api.views.auth_mfa.generate_recovery_codes", return_value=["a-b"] * 10)
    @patch("api.views.auth_mfa.verify_totp_code", return_value=12345)
    @patch("api.views.auth_mfa.UserTOTP")
    def test_activate_with_valid_code(
        self, mock_model, mock_verify, mock_codes, mock_email
    ):
        from api.views.auth_mfa import mfa_enroll_activate

        pending = MagicMock()
        mock_model.objects.filter.return_value.first.return_value = pending

        response = mfa_enroll_activate(
            self._post("/auth/mfa/enroll/activate/", {"code": "123456"}, user=_make_user())
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(json.loads(response.content)["recoveryCodes"]), 10)
        pending.save.assert_called_once_with(update_fields=["activated_at"])
        mock_email.assert_called_once()

    @patch("api.views.auth_mfa.verify_totp_code", return_value=None)
    @patch("api.views.auth_mfa.UserTOTP")
    def test_activate_with_invalid_code(self, mock_model, mock_verify):
        from api.views.auth_mfa import mfa_enroll_activate

        pending = MagicMock()
        mock_model.objects.filter.return_value.first.return_value = pending

        response = mfa_enroll_activate(
            self._post("/auth/mfa/enroll/activate/", {"code": "000000"}, user=_make_user())
        )
        self.assertEqual(response.status_code, 401)
        pending.save.assert_not_called()

    @patch("api.views.auth_mfa.send_totp_status_email")
    @patch("api.views.auth_mfa.verify_totp_code", return_value=12345)
    @patch("api.views.auth_mfa.UserRecoveryCode")
    @patch("api.views.auth_mfa.UserTOTP")
    def test_disable_with_valid_code_deletes_rows(
        self, mock_model, mock_recovery, mock_verify, mock_email
    ):
        from api.views.auth_mfa import mfa_disable

        active = MagicMock()
        mock_model.objects.filter.return_value.first.return_value = active

        response = mfa_disable(
            self._post("/auth/mfa/disable/", {"code": "123456"}, user=_make_user())
        )
        self.assertEqual(response.status_code, 200)
        mock_model.objects.filter.return_value.delete.assert_called_once()
        mock_recovery.objects.filter.return_value.delete.assert_called_once()
        mock_email.assert_called_once()

    @patch("api.views.auth_mfa.consume_recovery_code", return_value=False)
    @patch("api.views.auth_mfa.verify_totp_code", return_value=None)
    @patch("api.views.auth_mfa.UserRecoveryCode")
    @patch("api.views.auth_mfa.UserTOTP")
    def test_disable_without_valid_code_refused(
        self, mock_model, mock_recovery, mock_verify, mock_consume
    ):
        from api.views.auth_mfa import mfa_disable

        active = MagicMock()
        mock_model.objects.filter.return_value.first.return_value = active

        response = mfa_disable(
            self._post("/auth/mfa/disable/", {"code": "000000"}, user=_make_user())
        )
        self.assertEqual(response.status_code, 401)
        mock_model.objects.filter.return_value.delete.assert_not_called()

    @patch("api.views.auth_mfa.generate_recovery_codes", return_value=["x-y"] * 10)
    @patch("api.views.auth_mfa.verify_totp_code", return_value=12345)
    @patch("api.views.auth_mfa.UserTOTP")
    def test_regenerate_returns_new_codes(self, mock_model, mock_verify, mock_codes):
        from api.views.auth_mfa import mfa_recovery_codes

        active = MagicMock()
        mock_model.objects.filter.return_value.first.return_value = active

        response = mfa_recovery_codes(
            self._post("/auth/mfa/recovery-codes/", {"code": "123456"}, user=_make_user())
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(json.loads(response.content)["recoveryCodes"]), 10)


# ---------------------------------------------------------------------------
# Verify endpoint (partial-auth completion)
# ---------------------------------------------------------------------------


class SetMfaPendingTest(unittest.TestCase):
    def test_clears_stale_org_binding_from_prior_flow(self):
        """A new pending challenge must not inherit an abandoned org-SSO
        attempt's org binding (which would forge auth_sso_org_id at verify
        and bypass require_sso)."""
        from api.views.auth_mfa import set_mfa_pending

        request = RequestFactory().get("/")
        _add_session_to_request(request)
        # Leftover from an abandoned org-SSO challenge
        request.session["mfa_pending_sso_org_id"] = "org-A"
        request.session["mfa_pending_sso_provider_id"] = "cfg-A"
        request.session["mfa_pending_return_to"] = "/acme"

        # A later instance-level (no org) challenge
        set_mfa_pending(request.session, _make_user(), "sso")

        self.assertNotIn("mfa_pending_sso_org_id", request.session)
        self.assertNotIn("mfa_pending_sso_provider_id", request.session)
        self.assertNotIn("mfa_pending_return_to", request.session)
        self.assertEqual(request.session["mfa_pending_method"], "sso")


class MfaVerifyViewTest(unittest.TestCase):
    def setUp(self):
        cache.clear()

    def _post(self, body, pending_user_id="uuid-user-1", pending_age=0, method="password"):
        factory = APIRequestFactory()
        request = factory.post("/auth/mfa/verify/", data=body, format="json")
        _add_session_to_request(request)
        if pending_user_id is not None:
            request.session["mfa_pending_user_id"] = pending_user_id
            request.session["mfa_pending_at"] = int(time.time()) - pending_age
            request.session["mfa_pending_method"] = method
        return request

    def _call(self, request):
        from api.views.auth_mfa import mfa_verify

        return mfa_verify(request)

    def test_no_pending_state(self):
        response = self._call(self._post({"code": "123456"}, pending_user_id=None))
        self.assertEqual(response.status_code, 400)

    def test_expired_pending_state_is_cleared(self):
        request = self._post({"code": "123456"}, pending_age=700)
        response = self._call(request)
        self.assertEqual(response.status_code, 410)
        self.assertNotIn("mfa_pending_user_id", request.session)

    @patch("api.views.auth_mfa.mfa_locked_out", return_value=True)
    def test_locked_out(self, mock_locked):
        response = self._call(self._post({"code": "123456"}))
        self.assertEqual(response.status_code, 429)

    @patch("api.views.auth_mfa.record_mfa_failure")
    @patch("api.views.auth_mfa.verify_totp_code", return_value=None)
    @patch("api.views.auth_mfa.UserTOTP")
    @patch("api.views.auth_mfa.get_user_model")
    def test_invalid_code_records_failure(
        self, mock_get_user, mock_model, mock_verify, mock_record
    ):
        user = _make_user()
        mock_get_user.return_value.objects.filter.return_value.first.return_value = user
        mock_model.objects.filter.return_value.first.return_value = MagicMock()

        response = self._call(self._post({"code": "000000"}))
        self.assertEqual(response.status_code, 401)
        mock_record.assert_called_once_with("uuid-user-1")

    @patch("api.views.auth_mfa.send_login_email")
    @patch("api.views.auth_mfa.login")
    @patch("api.views.auth_mfa.verify_totp_code", return_value=12345)
    @patch("api.views.auth_mfa.UserTOTP")
    @patch("api.views.auth_mfa.get_user_model")
    def test_password_flow_success(
        self, mock_get_user, mock_model, mock_verify, mock_login, mock_email
    ):
        user = _make_user()
        user.socialaccount_set.first.return_value = None
        mock_get_user.return_value.objects.filter.return_value.first.return_value = user
        mock_model.objects.filter.return_value.first.return_value = MagicMock()

        request = self._post({"code": "123456"}, method="password")
        response = self._call(request)

        self.assertEqual(response.status_code, 200)
        data = json.loads(response.content)
        self.assertEqual(data["authMethod"], "password")
        # DRF wraps the WSGIRequest — assert on the user arg only
        mock_login.assert_called_once()
        self.assertIs(mock_login.call_args.args[1], user)
        self.assertEqual(request.session["auth_method"], "password")
        self.assertIn("auth_time", request.session)
        self.assertNotIn("mfa_pending_user_id", request.session)
        mock_email.assert_called_once()

    @patch("api.views.auth_mfa.send_login_email")
    @patch("api.views.auth_mfa.login")
    @patch("api.views.auth_mfa.consume_recovery_code", return_value=True)
    @patch("api.views.auth_mfa.UserTOTP")
    @patch("api.views.auth_mfa.get_user_model")
    def test_sso_flow_restores_org_context_without_login_email(
        self, mock_get_user, mock_model, mock_consume, mock_login, mock_email
    ):
        user = _make_user()
        user.socialaccount_set.first.return_value = None
        mock_get_user.return_value.objects.filter.return_value.first.return_value = user
        mock_model.objects.filter.return_value.first.return_value = MagicMock()

        request = self._post({"recoveryCode": "abcde-fghij"}, method="sso")
        request.session["mfa_pending_sso_org_id"] = "org-1"
        request.session["mfa_pending_sso_provider_id"] = "cfg-1"
        request.session["mfa_pending_return_to"] = "/acme/apps"
        response = self._call(request)

        self.assertEqual(response.status_code, 200)
        data = json.loads(response.content)
        self.assertEqual(data["authMethod"], "sso")
        self.assertEqual(data["returnTo"], "/acme/apps")
        self.assertEqual(request.session["auth_sso_org_id"], "org-1")
        self.assertEqual(request.session["auth_sso_provider_id"], "cfg-1")
        # SSO adapters already sent the login alert during complete_login
        mock_email.assert_not_called()

    @patch("api.views.auth_mfa.send_login_email")
    @patch("api.views.auth_mfa.login")
    @patch("api.views.auth_mfa.verify_totp_code", return_value=12345)
    @patch("api.views.auth_mfa.UserTOTP")
    @patch("api.views.auth_mfa.get_user_model")
    def test_unsafe_return_to_is_dropped(
        self, mock_get_user, mock_model, mock_verify, mock_login, mock_email
    ):
        user = _make_user()
        user.socialaccount_set.first.return_value = None
        mock_get_user.return_value.objects.filter.return_value.first.return_value = user
        mock_model.objects.filter.return_value.first.return_value = MagicMock()

        request = self._post({"code": "123456"})
        request.session["mfa_pending_return_to"] = "//evil.example/phish"
        response = self._call(request)
        self.assertIsNone(json.loads(response.content)["returnTo"])


# ---------------------------------------------------------------------------
# Login-flow deferral
# ---------------------------------------------------------------------------


class PasswordLoginDeferralTest(unittest.TestCase):
    def setUp(self):
        cache.clear()

    @patch("api.views.auth_password.user_has_active_totp", return_value=True)
    @patch("api.views.auth_password.login")
    @patch("api.views.auth_password.get_user_model")
    @patch("api.views.auth_password._password_auth_enabled", return_value=True)
    def test_enrolled_user_gets_mfa_required_without_session(
        self, mock_enabled, mock_get_user, mock_login, mock_totp
    ):
        from api.views.auth_password import password_login

        User = MagicMock()
        user = MagicMock()
        user.active = True
        user.userId = "uuid-123"
        user.check_password.return_value = True
        User.objects.get.return_value = user
        mock_get_user.return_value = User

        factory = APIRequestFactory()
        request = factory.post(
            "/auth/password/login/",
            data={"email": "alice@example.com", "authHash": "a" * 64},
            format="json",
        )
        _add_session_to_request(request)
        response = password_login(request)

        self.assertEqual(response.status_code, 200)
        data = json.loads(response.content)
        self.assertTrue(data["mfaRequired"])
        # No PII in the deferred response
        self.assertNotIn("email", data)
        self.assertNotIn("userId", data)
        # No session was issued
        mock_login.assert_not_called()
        self.assertEqual(request.session["mfa_pending_user_id"], "uuid-123")
        self.assertEqual(request.session["mfa_pending_method"], "password")

    @patch("api.views.auth_password.user_has_active_totp", return_value=True)
    @patch("api.views.auth_password.login")
    @patch("api.views.auth_password.get_user_model")
    @patch("api.views.auth_password._password_auth_enabled", return_value=True)
    def test_deferred_password_login_clears_stale_sso_binding(
        self, mock_enabled, mock_get_user, mock_login, mock_totp
    ):
        """A previous org-SSO login's org binding must not survive through
        the MFA deferral into the post-verify password session."""
        from api.views.auth_password import password_login

        User = MagicMock()
        user = MagicMock()
        user.active = True
        user.userId = "uuid-123"
        user.check_password.return_value = True
        User.objects.get.return_value = user
        mock_get_user.return_value = User

        factory = APIRequestFactory()
        request = factory.post(
            "/auth/password/login/",
            data={"email": "alice@example.com", "authHash": "a" * 64},
            format="json",
        )
        _add_session_to_request(request)
        # Stale binding from an earlier org-SSO login in this browser
        request.session["auth_sso_org_id"] = "org-stale"
        request.session["auth_sso_provider_id"] = "cfg-stale"

        response = password_login(request)

        self.assertEqual(response.status_code, 200)
        self.assertNotIn("auth_sso_org_id", request.session)
        self.assertNotIn("auth_sso_provider_id", request.session)


_FAKE_GOOGLE_CONFIG = {
    "client_id": "test-client",
    "client_secret": "test-secret",
    "authorize_url": "https://accounts.google.com/o/oauth2/v2/auth",
    "token_url": "https://oauth2.googleapis.com/token",
    "scopes": "openid profile email",
    "provider_id": "google",
    "token_auth_method": "client_secret_post",
}


class SsoCallbackDeferralTest(unittest.TestCase):
    def setUp(self):
        cache.clear()
        patcher = patch.dict(
            "api.views.sso.SSO_PROVIDER_REGISTRY",
            {"google": dict(_FAKE_GOOGLE_CONFIG)},
            clear=True,
        )
        patcher.start()
        self.addCleanup(patcher.stop)

    @patch("api.views.sso.login")
    @patch("api.views.sso.user_has_active_totp", return_value=True)
    @patch("api.views.sso._complete_login_bypassing_allauth")
    @patch("api.views.sso._get_or_create_social_app")
    @patch("api.views.sso._get_adapter_instance")
    @patch("api.views.sso._exchange_code_for_token")
    def test_enrolled_user_deferred_to_mfa_page(
        self,
        mock_exchange,
        mock_get_adapter,
        mock_get_app,
        mock_complete_login,
        mock_totp,
        mock_login,
    ):
        from api.views.sso import SSOCallbackView

        mock_exchange.return_value = {"access_token": "at"}
        adapter = MagicMock()
        social_login = MagicMock()
        social_login.user.email = "alice@example.com"
        social_login.account.extra_data = {"email": "alice@example.com"}
        adapter.complete_login.return_value = social_login
        mock_get_adapter.return_value = adapter
        mock_get_app.return_value = MagicMock()

        user = _make_user()
        mock_complete_login.return_value = user

        request = RequestFactory().get(
            "/auth/sso/google/callback/?code=abc&state=st-1"
        )
        _add_session_to_request(request)
        request.session["sso_state"] = "st-1"
        request.session["sso_token_url"] = _FAKE_GOOGLE_CONFIG["token_url"]
        request.user = AnonymousUser()

        with patch("api.views.sso.SocialToken"):
            response = SSOCallbackView.as_view()(request, provider="google")

        self.assertEqual(response.status_code, 302)
        self.assertIn("/login/mfa", response.url)
        # Login deferred; pending state carries the SSO context
        mock_login.assert_not_called()
        self.assertEqual(
            request.session["mfa_pending_user_id"], str(user.userId)
        )
        self.assertEqual(request.session["mfa_pending_method"], "sso")
        self.assertEqual(request.session["mfa_pending_return_to"], "/")
        # SSO scratch keys are cleaned up
        self.assertNotIn("sso_token_url", request.session)

    @patch("api.views.sso.stamp_auth_time")
    @patch("api.views.sso.login")
    @patch("api.views.sso.user_has_active_totp", return_value=False)
    @patch("api.views.sso._complete_login_bypassing_allauth")
    @patch("api.views.sso._get_or_create_social_app")
    @patch("api.views.sso._get_adapter_instance")
    @patch("api.views.sso._exchange_code_for_token")
    def test_non_enrolled_user_logs_in_directly(
        self,
        mock_exchange,
        mock_get_adapter,
        mock_get_app,
        mock_complete_login,
        mock_totp,
        mock_login,
        mock_stamp,
    ):
        from api.views.sso import SSOCallbackView

        mock_exchange.return_value = {"access_token": "at"}
        adapter = MagicMock()
        social_login = MagicMock()
        social_login.user.email = "alice@example.com"
        social_login.account.extra_data = {"email": "alice@example.com"}
        adapter.complete_login.return_value = social_login
        mock_get_adapter.return_value = adapter
        mock_get_app.return_value = MagicMock()

        user = _make_user()
        mock_complete_login.return_value = user

        request = RequestFactory().get(
            "/auth/sso/google/callback/?code=abc&state=st-1"
        )
        _add_session_to_request(request)
        request.session["sso_state"] = "st-1"
        request.session["sso_token_url"] = _FAKE_GOOGLE_CONFIG["token_url"]
        request.user = AnonymousUser()

        with patch("api.views.sso.SocialToken"):
            response = SSOCallbackView.as_view()(request, provider="google")

        self.assertEqual(response.status_code, 302)
        self.assertNotIn("/login/mfa", response.url)
        mock_login.assert_called_once_with(request, user)
        self.assertEqual(request.session["auth_method"], "sso")
        self.assertNotIn("mfa_pending_user_id", request.session)


if __name__ == "__main__":
    unittest.main()
