"""PhaseTokenAuthentication reads the token row once per request, and writes
a service account token's last_used_at only once the stored value is stale.

The token rows here are real, unsaved model instances with their related
rows attached in memory. A lazy foreign-key load anywhere in the auth path
would hit pytest-django's database blocker and fail the test, so the mocked
token managers are the only way the code can reach a row, and every call on
them is asserted.
"""
from datetime import datetime, timedelta, timezone as dt_timezone
from types import SimpleNamespace
from unittest.mock import call, patch

import pytest
from django.db.models import Q
from freezegun import freeze_time
from rest_framework import exceptions
from rest_framework.test import APIRequestFactory

from api.auth import LAST_USED_AT_WRITE_INTERVAL, PhaseTokenAuthentication
from api.models import (
    App,
    CustomUser,
    Environment,
    Organisation,
    OrganisationMember,
    ServiceAccount,
    ServiceAccountToken,
    UserToken,
)

NOW = datetime(2026, 10, 31, 12, 0, tzinfo=dt_timezone.utc)
SECRETS = {"ServiceAccount": "sa-secret", "User": "user-secret"}

TOKEN_LOOKUP = {
    "ServiceAccount": [
        call.select_related("service_account__organisation", "created_by__user"),
        call.select_related().get(token="sa-secret"),
    ],
    "User": [
        call.select_related("user__user", "user__organisation"),
        call.select_related().get(token="user-secret"),
    ],
}
LAST_USED_AT_WRITE = [
    call.filter(
        Q(last_used_at__isnull=True)
        | Q(last_used_at__lt=NOW - LAST_USED_AT_WRITE_INTERVAL),
        id="sa-token-1",
    ),
    call.filter().update(last_used_at=NOW),
]


def _org(**fields):
    return Organisation(id="org-1", name="Org", **fields)


def _member(org, **fields):
    user = CustomUser(userId="user-1", username="user", email="user@example.com")
    return OrganisationMember(id="member-1", user=user, organisation=org, **fields)


def _user_token(member, **fields):
    return UserToken(id="user-token-1", user=member, token=SECRETS["User"], **fields)


def _token(token_type, org=None, **fields):
    org = org or _org()
    if token_type == "User":
        return _user_token(_member(org), **fields)
    account = ServiceAccount(id="sa-1", name="automation", organisation=org)
    return ServiceAccountToken(
        id="sa-token-1",
        service_account=account,
        token=SECRETS["ServiceAccount"],
        **fields,
    )


@pytest.fixture
def managers():
    """Mock every manager authenticate() reads through on the Environment
    header path, the shape the CLI uses for GET /secrets/."""
    with patch.object(ServiceAccountToken, "objects") as sa_tokens, patch.object(
        UserToken, "objects"
    ) as user_tokens, patch.object(
        Environment.objects, "select_related"
    ) as environments, patch(
        "api.auth.service_account_can_access_environment", return_value=True
    ), patch(
        "api.auth.user_can_access_environment", return_value=True
    ):
        yield SimpleNamespace(
            sa_tokens=sa_tokens, user_tokens=user_tokens, environments=environments
        )


def _authenticate(managers, token_type, token, org=None):
    """Serve `token` from its manager (None: no row has the token's value)
    and authenticate a GET /secrets/ that presents it."""
    if token_type == "ServiceAccount":
        manager, model = managers.sa_tokens, ServiceAccountToken
    else:
        manager, model = managers.user_tokens, UserToken
    if token is None:
        manager.select_related.return_value.get.side_effect = model.DoesNotExist
    else:
        manager.select_related.return_value.get.return_value = token

    env = Environment(
        id="env-1", name="Development", app=App(id="app-1", organisation=org or _org())
    )
    managers.environments.return_value.get.return_value = env
    managers.environments.return_value.filter.return_value.get.return_value = env

    request = APIRequestFactory().get(
        "/secrets/",
        HTTP_AUTHORIZATION=f"Bearer {token_type} {SECRETS[token_type]}",
        HTTP_ENVIRONMENT="env-1",
    )
    with freeze_time(NOW):
        return PhaseTokenAuthentication().authenticate(request)


def _assert_token_calls(managers, token_type, last_used_at_written=False):
    """The presented token's manager saw exactly one lookup, plus the
    last_used_at write when expected; the other token manager saw nothing."""
    sa_calls, user_calls = [], []
    if token_type == "ServiceAccount":
        sa_calls = TOKEN_LOOKUP["ServiceAccount"] + (
            LAST_USED_AT_WRITE if last_used_at_written else []
        )
    else:
        user_calls = TOKEN_LOOKUP["User"]
    assert managers.sa_tokens.mock_calls == sa_calls
    assert managers.user_tokens.mock_calls == user_calls


class TestSingleTokenLookup:
    def test_service_account_token_row_is_read_once(self, managers):
        org = _org()
        creator = _member(org)
        token = _token("ServiceAccount", org, created_by=creator, last_used_at=NOW)

        user, auth = _authenticate(managers, "ServiceAccount", token, org)

        _assert_token_calls(managers, "ServiceAccount")
        assert auth["service_account_token"] is token
        assert auth["service_account"] is token.service_account
        assert user is creator.user
        # Cross-tenant scoping uses the organisation joined onto the token.
        managers.environments.return_value.filter.assert_called_once_with(
            app__organisation=org
        )

    def test_user_token_row_is_read_once(self, managers):
        org = _org()
        token = _token("User", org)

        user, auth = _authenticate(managers, "User", token, org)

        # Also shows user tokens never write to ServiceAccountToken rows.
        _assert_token_calls(managers, "User")
        assert auth["user_token"] is token
        assert auth["org_member"] is token.user
        assert user is token.user.user
        managers.environments.return_value.filter.assert_called_once_with(
            app__organisation=org
        )


class TestLastUsedAtThrottle:
    @pytest.mark.parametrize(
        "age, written",
        [
            (None, True),
            (timedelta(minutes=5), True),
            (LAST_USED_AT_WRITE_INTERVAL + timedelta(seconds=1), True),
            (LAST_USED_AT_WRITE_INTERVAL - timedelta(seconds=1), False),
            (timedelta(0), False),
        ],
        ids=["never-used", "5m-ago", "just-stale", "just-fresh", "just-now"],
    )
    def test_last_used_at_is_written_only_when_stale(self, managers, age, written):
        last_used_at = None if age is None else NOW - age
        token = _token("ServiceAccount", last_used_at=last_used_at)

        _authenticate(managers, "ServiceAccount", token)

        # A stale value costs one UPDATE that re-checks staleness in SQL, so
        # concurrent requests that loaded the same stale row write it once.
        _assert_token_calls(managers, "ServiceAccount", last_used_at_written=written)


class TestChecksReadTheLoadedRow:
    @pytest.mark.parametrize("token_type", ["User", "ServiceAccount"])
    @pytest.mark.parametrize(
        "fields",
        [None, {"deleted_at": NOW}, {"expires_at": NOW - timedelta(seconds=1)}],
        ids=["unknown", "deleted", "expired"],
    )
    def test_unusable_token_is_rejected_before_other_lookups(
        self, managers, token_type, fields
    ):
        token = None if fields is None else _token(token_type, **fields)

        with pytest.raises(
            exceptions.AuthenticationFailed, match=r"^Token expired or deleted$"
        ):
            _authenticate(managers, token_type, token)

        _assert_token_calls(managers, token_type)
        managers.environments.assert_not_called()

    def test_token_with_future_expiry_authenticates(self, managers):
        token = _token(
            "ServiceAccount", expires_at=NOW + timedelta(days=1), last_used_at=NOW
        )

        _user, auth = _authenticate(managers, "ServiceAccount", token)

        assert auth["service_account_token"] is token

    @pytest.mark.parametrize("token_type", ["User", "ServiceAccount"])
    def test_token_of_org_scheduled_for_deletion_is_refused(self, managers, token_type):
        locked_org = _org(deleted_at=NOW)
        token = _token(token_type, locked_org)

        with pytest.raises(
            exceptions.PermissionDenied,
            match=r"^This organisation is scheduled for deletion\.$",
        ):
            _authenticate(managers, token_type, token, locked_org)

        _assert_token_calls(managers, token_type)
        managers.environments.assert_not_called()

    @pytest.mark.parametrize(
        "member",
        [None, _member(_org(), deleted_at=NOW)],
        ids=["no-member", "deleted-member"],
    )
    def test_user_token_without_live_member_is_not_found(self, managers, member):
        with pytest.raises(exceptions.NotFound, match=r"^User not found$"):
            _authenticate(managers, "User", _user_token(member))

        _assert_token_calls(managers, "User")
