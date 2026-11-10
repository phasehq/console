"""Logging out ends the session on the server: the session record is deleted,
so a copy of the cookie made before logout stops working."""

from importlib import import_module

from django.conf import settings
from django.contrib.auth import (
    BACKEND_SESSION_KEY,
    HASH_SESSION_KEY,
    SESSION_KEY,
    get_user,
)
from django.contrib.auth.models import AnonymousUser
from django.contrib.sessions.middleware import SessionMiddleware
from django.test import RequestFactory

import backend.settings as project_settings
from api.views.auth import logout_view

SessionStore = import_module(settings.SESSION_ENGINE).SessionStore


def _logged_in_session(user_id="user-1"):
    """Store a session as login leaves it and return its key (the cookie value)."""
    store = SessionStore()
    store[SESSION_KEY] = user_id
    store[BACKEND_SESSION_KEY] = "django.contrib.auth.backends.ModelBackend"
    store[HASH_SESSION_KEY] = "session-auth-hash"
    store["auth_method"] = "password"
    store.save()
    return store.session_key


def _request(session_key, method="post"):
    request = getattr(RequestFactory(), method)("/logout/")
    request.COOKIES[settings.SESSION_COOKIE_NAME] = session_key
    request.user = AnonymousUser()
    return request


def _with_session(request):
    SessionMiddleware(lambda r: None).process_request(request)
    return request


def test_sessions_are_stored_server_side():
    """A cookie-only session can't be revoked: logout would only clear the
    browser's copy. Tests run on the cache engine (see conftest); this checks
    the engine the application ships with."""
    engine = project_settings.SESSION_ENGINE.rsplit(".", 1)[-1]

    assert engine in {"db", "cached_db", "cache"}


def test_sessions_last_at_most_a_day():
    """Signing out ends a session early; the lifetime bounds every session
    that is never signed out."""
    assert project_settings.SESSION_COOKIE_AGE <= 24 * 60 * 60


def test_session_cookie_holds_a_key_not_the_session_data():
    key = _logged_in_session()

    assert len(key) == 32
    assert key.isalnum()


def test_logout_deletes_the_session_record():
    key = _logged_in_session()
    assert SessionStore().exists(key)

    response = logout_view(_with_session(_request(key)))

    assert response.status_code == 200
    assert not SessionStore().exists(key)
    assert SessionStore(session_key=key).load() == {}


def test_cookie_copied_before_logout_is_anonymous_afterwards():
    key = _logged_in_session()
    logout_view(_with_session(_request(key)))

    replayed = _with_session(_request(key, method="get"))

    assert SESSION_KEY not in replayed.session
    assert get_user(replayed).is_anonymous


def test_logout_response_clears_the_cookie():
    key = _logged_in_session()

    response = SessionMiddleware(logout_view)(_request(key))

    cookie = response.cookies[settings.SESSION_COOKIE_NAME]
    assert cookie.value == ""
    assert cookie["max-age"] == 0


def test_logout_ends_only_the_session_it_was_called_with():
    """Another device's session for the same user stays signed in."""
    here = _logged_in_session()
    elsewhere = _logged_in_session()

    logout_view(_with_session(_request(here)))

    assert not SessionStore().exists(here)
    assert SessionStore().exists(elsewhere)
    assert SessionStore(session_key=elsewhere).load()[SESSION_KEY] == "user-1"
