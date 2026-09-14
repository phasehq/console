"""Redirect-path safety and TOTP-aware freshness stamping."""

import time
from unittest.mock import MagicMock, patch

from api.utils.reauth import (
    AUTH_FRESHNESS_MAX_AGE,
    auth_fresh_until,
    is_safe_redirect_path,
    session_is_fresh,
    stamp_auth_time_after_relogin,
)


class TestIsSafeRedirectPath:
    def test_accepts_plain_relative_path(self):
        assert is_safe_redirect_path("/team/apps")
        assert is_safe_redirect_path("/invite/abc?x=1")

    def test_rejects_protocol_relative(self):
        assert not is_safe_redirect_path("//evil.com")

    def test_rejects_backslash_authority_bypass(self):
        # Browsers resolve '\' as '/', so these reach an external origin.
        assert not is_safe_redirect_path("/\\evil.com")
        assert not is_safe_redirect_path("/\\/evil.com")
        assert not is_safe_redirect_path("\\/evil.com")

    def test_rejects_absolute_url(self):
        assert not is_safe_redirect_path("https://evil.com")
        assert not is_safe_redirect_path("http:/evil.com")

    def test_rejects_control_chars(self):
        assert not is_safe_redirect_path("/a\tb")
        assert not is_safe_redirect_path("/a\nb")

    def test_rejects_empty_and_non_string(self):
        assert not is_safe_redirect_path("")
        assert not is_safe_redirect_path(None)
        assert not is_safe_redirect_path("relative")
        assert not is_safe_redirect_path(123)


class TestAuthFreshUntil:
    def _request(self, session):
        request = MagicMock()
        request.session = session
        return request

    def test_returns_deadline_for_stamped_session(self):
        now = int(time.time())
        request = self._request({"auth_time": now})
        assert auth_fresh_until(request) == now + AUTH_FRESHNESS_MAX_AGE
        assert session_is_fresh(request)

    def test_expired_stamp_yields_past_deadline_and_stale_session(self):
        request = self._request({"auth_time": int(time.time()) - AUTH_FRESHNESS_MAX_AGE - 10})
        assert auth_fresh_until(request) < int(time.time())
        assert not session_is_fresh(request)

    def test_returns_none_without_stamp(self):
        # Pre-feature sessions have no stamp — stale, the fail-safe direction.
        assert auth_fresh_until(self._request({})) is None
        assert auth_fresh_until(self._request({"auth_time": "bogus"})) is None
        assert not session_is_fresh(self._request({}))


class TestStampAuthTimeAfterRelogin:
    def _request(self):
        request = MagicMock()
        request.session = {}
        return request

    @patch("api.utils.mfa.user_has_active_totp", return_value=False)
    def test_password_only_user_is_stamped(self, _totp):
        request = self._request()
        stamp_auth_time_after_relogin(request, MagicMock())
        assert isinstance(request.session.get("auth_time"), int)
        assert abs(request.session["auth_time"] - int(time.time())) < 5

    @patch("api.utils.mfa.user_has_active_totp", return_value=True)
    def test_totp_user_is_not_stamped(self, _totp):
        request = self._request()
        stamp_auth_time_after_relogin(request, MagicMock())
        # Password proof alone must not mint freshness for a 2FA user.
        assert "auth_time" not in request.session

    @patch("api.utils.mfa.user_has_active_totp", return_value=True)
    def test_totp_user_keeps_prior_stale_stamp(self, _totp):
        request = self._request()
        stale = int(time.time()) - 100000
        request.session["auth_time"] = stale
        stamp_auth_time_after_relogin(request, MagicMock())
        # Existing (stale) stamp is left untouched — not refreshed.
        assert request.session["auth_time"] == stale
