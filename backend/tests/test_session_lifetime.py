"""A session lasts 24 hours after sign-in. SESSION_LIFETIME_HOURS can change
that; a value that isn't a whole number of hours stops the application from
starting instead of being ignored."""

import os

import pytest
from django.core.exceptions import ImproperlyConfigured

import backend.settings as project_settings
from backend.settings import session_lifetime_seconds

HOUR = 60 * 60


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
