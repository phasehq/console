"""A session lasts 24 hours after sign-in. SESSION_LIFETIME_HOURS can change
that; a value that isn't a whole number of hours stops the application from
starting instead of being ignored.

The end is fixed at sign-in. Requests that write to the session later, and a
re-login after a credential change, do not move it."""

import os
from datetime import datetime, timedelta, timezone as dt_timezone
from unittest.mock import patch

import pytest
from django.conf import settings
from django.contrib.auth.signals import user_logged_in
from django.contrib.sessions.middleware import SessionMiddleware
from django.core.exceptions import ImproperlyConfigured
from django.test import RequestFactory

import backend.settings as project_settings
from api.models import CustomUser
from api.signals import start_session_lifetime
from api.utils.reauth import relogin_preserving_session
from backend.settings import session_lifetime_seconds

HOUR = 60 * 60
SIGN_IN = datetime(2026, 1, 5, 9, 0, tzinfo=dt_timezone.utc)
LIFETIME = timedelta(seconds=settings.SESSION_COOKIE_AGE)


def _at(hours):
    """Run the block as if it were `hours` after sign-in."""
    return patch(
        "django.utils.timezone.now", return_value=SIGN_IN + timedelta(hours=hours)
    )


def _signed_in_request():
    request = RequestFactory().post("/auth/password/login/")
    SessionMiddleware(lambda r: None).process_request(request)
    with _at(0):
        start_session_lifetime(sender=CustomUser, request=request, user=None)
        request.session.save()
    return request


@pytest.mark.parametrize("unset", [None, "", "   "])
def test_default_is_24_hours(unset):
    assert session_lifetime_seconds(unset) == 24 * HOUR


@pytest.mark.parametrize(
    "value, seconds",
    [
        ("1", HOUR),
        ("12", 12 * HOUR),
        ("24", 24 * HOUR),
        (" 8 ", 8 * HOUR),
        ("168", 168 * HOUR),
    ],
)
def test_reads_a_whole_number_of_hours(value, seconds):
    assert session_lifetime_seconds(value) == seconds


@pytest.mark.parametrize(
    "value",
    [
        "0",
        "-12",
        "+12",
        "1.5",
        "12h",
        "12 hours",
        "1d",
        "PT12H",
        "twelve",
        "1e2",
        "1_0",
        "12,5",
    ],
)
def test_refuses_anything_else(value):
    with pytest.raises(ImproperlyConfigured) as error:
        session_lifetime_seconds(value)

    assert "SESSION_LIFETIME_HOURS" in str(error.value)
    assert repr(value) in str(error.value)


def test_session_cookie_age_comes_from_the_environment():
    expected = session_lifetime_seconds(os.getenv("SESSION_LIFETIME_HOURS"))

    assert project_settings.SESSION_COOKIE_AGE == expected


def test_sign_in_fixes_when_the_session_ends():
    request = _signed_in_request()

    assert request.session.get_expiry_date() == SIGN_IN + LIFETIME


def test_sign_in_signal_sets_the_end():
    """login() sends user_logged_in, so every sign-in path is covered."""
    request = RequestFactory().post("/auth/password/login/")
    SessionMiddleware(lambda r: None).process_request(request)

    with _at(0):
        # send_robust: the receiver that records last_login needs a database
        responses = dict(
            user_logged_in.send_robust(
                sender=CustomUser, request=request, user=CustomUser(userId="u")
            )
        )

    assert responses[start_session_lifetime] is None
    assert request.session.get_expiry_date() == SIGN_IN + LIFETIME


def test_a_later_session_write_does_not_move_the_end():
    request = _signed_in_request()

    with _at(20):
        request.session["gh_int_state"] = "written by an unrelated request"
        request.session.save()

        assert request.session.get_expiry_date() == SIGN_IN + LIFETIME
        assert request.session.get_expiry_age() == LIFETIME.total_seconds() - 20 * HOUR


def test_re_login_after_a_credential_change_keeps_the_end():
    request = _signed_in_request()

    def sign_in_again(request, user):
        start_session_lifetime(sender=CustomUser, request=request, user=user)

    with _at(23), patch("django.contrib.auth.login", side_effect=sign_in_again), patch(
        "api.utils.reauth.stamp_auth_time_after_relogin"
    ):
        relogin_preserving_session(request, CustomUser(userId="u"))

    assert request.session.get_expiry_date() == SIGN_IN + LIFETIME


def test_a_new_sign_in_starts_a_new_lifetime():
    request = _signed_in_request()

    with _at(26):
        start_session_lifetime(sender=CustomUser, request=request, user=None)

    assert request.session.get_expiry_date() == SIGN_IN + timedelta(hours=26) + LIFETIME


def test_sign_in_without_a_session_is_ignored():
    """Not every caller of login() has a session, e.g. token-based requests."""
    start_session_lifetime(sender=CustomUser, request=None, user=None)
    start_session_lifetime(
        sender=CustomUser, request=RequestFactory().get("/"), user=None
    )
