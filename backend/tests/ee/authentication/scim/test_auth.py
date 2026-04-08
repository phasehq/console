"""Tests for SCIMTokenAuthentication — fully mocked, no database."""

import hashlib
from datetime import timedelta
from unittest.mock import MagicMock, patch

import pytest
from django.utils import timezone
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.test import APIRequestFactory

from ee.authentication.scim.auth import SCIMServiceUser, SCIMTokenAuthentication

from .conftest import TOKEN_HASH, TOKEN_RAW, make_mock_organisation, make_mock_scim_token

factory = APIRequestFactory()


def _make_request(token=TOKEN_RAW):
    return factory.get(
        "/scim/v2/Users",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )


# ---------------------------------------------------------------------------
# SCIMTokenAuthentication
# ---------------------------------------------------------------------------


class TestSCIMTokenAuthentication:

    def _make_token(self, **overrides):
        org = overrides.pop("organisation", make_mock_organisation())
        return make_mock_scim_token(organisation=org, **overrides)

    # -- valid token --

    @patch("ee.authentication.scim.auth.can_use_scim", return_value=True)
    @patch("ee.authentication.scim.auth.SCIMToken")
    def test_valid_token(self, MockSCIMToken, mock_can_use):
        token = self._make_token()
        MockSCIMToken.objects.select_related.return_value.get.return_value = token
        MockSCIMToken.DoesNotExist = Exception

        auth = SCIMTokenAuthentication()
        user, auth_info = auth.authenticate(_make_request())

        assert isinstance(user, SCIMServiceUser)
        assert user.is_authenticated
        assert auth_info["organisation"] is token.organisation
        assert auth_info["scim_token"] is token

    @patch("ee.authentication.scim.auth.can_use_scim", return_value=True)
    @patch("ee.authentication.scim.auth.SCIMToken")
    def test_updates_last_used_at(self, MockSCIMToken, mock_can_use):
        token = self._make_token()
        assert token.last_used_at is None
        MockSCIMToken.objects.select_related.return_value.get.return_value = token
        MockSCIMToken.DoesNotExist = Exception

        auth = SCIMTokenAuthentication()
        auth.authenticate(_make_request())

        token.save.assert_called_once_with(update_fields=["last_used_at"])
        assert token.last_used_at is not None

    # -- header parsing --

    def test_no_auth_header_returns_none(self):
        auth = SCIMTokenAuthentication()
        request = factory.get("/scim/v2/Users")
        result = auth.authenticate(request)
        assert result is None

    def test_non_bearer_header_returns_none(self):
        auth = SCIMTokenAuthentication()
        request = factory.get(
            "/scim/v2/Users",
            HTTP_AUTHORIZATION="Basic dXNlcjpwYXNz",
        )
        result = auth.authenticate(request)
        assert result is None

    def test_non_scim_bearer_token_returns_none(self):
        """Phase tokens (pss_service:v2:...) should be ignored."""
        auth = SCIMTokenAuthentication()
        request = _make_request(token="pss_service:v2:prefix:body")
        result = auth.authenticate(request)
        assert result is None

    # -- invalid hash --

    @patch("ee.authentication.scim.auth.SCIMToken")
    def test_invalid_token_hash_raises(self, MockSCIMToken):
        MockSCIMToken.DoesNotExist = Exception
        MockSCIMToken.objects.select_related.return_value.get.side_effect = Exception("not found")

        auth = SCIMTokenAuthentication()
        with pytest.raises(AuthenticationFailed, match="Invalid SCIM token"):
            auth.authenticate(_make_request(token="ph_scim:v1:fake:invalid_token_value"))

    # -- expired --

    @patch("ee.authentication.scim.auth.can_use_scim", return_value=True)
    @patch("ee.authentication.scim.auth.SCIMToken")
    def test_expired_token_raises(self, MockSCIMToken, mock_can_use):
        token = self._make_token(expires_at=timezone.now() - timedelta(hours=1))
        MockSCIMToken.objects.select_related.return_value.get.return_value = token
        MockSCIMToken.DoesNotExist = Exception

        auth = SCIMTokenAuthentication()
        with pytest.raises(AuthenticationFailed, match="expired"):
            auth.authenticate(_make_request())

    @patch("ee.authentication.scim.auth.can_use_scim", return_value=True)
    @patch("ee.authentication.scim.auth.SCIMToken")
    def test_non_expired_token_works(self, MockSCIMToken, mock_can_use):
        token = self._make_token(expires_at=timezone.now() + timedelta(days=30))
        MockSCIMToken.objects.select_related.return_value.get.return_value = token
        MockSCIMToken.DoesNotExist = Exception

        auth = SCIMTokenAuthentication()
        user, _ = auth.authenticate(_make_request())
        assert user.is_authenticated

    # -- scim disabled --

    @patch("ee.authentication.scim.auth.can_use_scim", return_value=True)
    @patch("ee.authentication.scim.auth.SCIMToken")
    def test_scim_disabled_on_org_raises(self, MockSCIMToken, mock_can_use):
        org = make_mock_organisation(scim_enabled=False)
        token = self._make_token(organisation=org)
        MockSCIMToken.objects.select_related.return_value.get.return_value = token
        MockSCIMToken.DoesNotExist = Exception

        auth = SCIMTokenAuthentication()
        with pytest.raises(AuthenticationFailed, match="not enabled"):
            auth.authenticate(_make_request())

    # -- token inactive --

    @patch("ee.authentication.scim.auth.can_use_scim", return_value=True)
    @patch("ee.authentication.scim.auth.SCIMToken")
    def test_token_is_inactive_raises(self, MockSCIMToken, mock_can_use):
        token = self._make_token(is_active=False)
        MockSCIMToken.objects.select_related.return_value.get.return_value = token
        MockSCIMToken.DoesNotExist = Exception

        auth = SCIMTokenAuthentication()
        with pytest.raises(AuthenticationFailed, match="disabled"):
            auth.authenticate(_make_request())

    # -- soft-deleted token --

    @patch("ee.authentication.scim.auth.SCIMToken")
    def test_soft_deleted_token_raises(self, MockSCIMToken):
        """Soft-deleted tokens are filtered by the query (deleted_at__isnull=True),
        so they raise DoesNotExist."""
        MockSCIMToken.DoesNotExist = Exception
        MockSCIMToken.objects.select_related.return_value.get.side_effect = Exception("not found")

        auth = SCIMTokenAuthentication()
        with pytest.raises(AuthenticationFailed, match="Invalid SCIM token"):
            auth.authenticate(_make_request())

    # -- plan checks --

    @patch("ee.authentication.scim.auth.can_use_scim", return_value=False)
    @patch("ee.authentication.scim.auth.SCIMToken")
    def test_non_enterprise_plan_without_license_raises(self, MockSCIMToken, mock_can_use):
        org = make_mock_organisation(plan="FR")
        token = self._make_token(organisation=org)
        MockSCIMToken.objects.select_related.return_value.get.return_value = token
        MockSCIMToken.DoesNotExist = Exception

        auth = SCIMTokenAuthentication()
        with pytest.raises(AuthenticationFailed, match="Enterprise plan"):
            auth.authenticate(_make_request())

    @patch("ee.authentication.scim.auth.can_use_scim", return_value=True)
    @patch("ee.authentication.scim.auth.SCIMToken")
    def test_non_enterprise_plan_with_license_works(self, MockSCIMToken, mock_can_use):
        """An activated license should bypass the plan check via can_use_scim."""
        org = make_mock_organisation(plan="FR")
        token = self._make_token(organisation=org)
        MockSCIMToken.objects.select_related.return_value.get.return_value = token
        MockSCIMToken.DoesNotExist = Exception

        auth = SCIMTokenAuthentication()
        user, _ = auth.authenticate(_make_request())
        assert user.is_authenticated


# ---------------------------------------------------------------------------
# SCIMServiceUser
# ---------------------------------------------------------------------------


class TestSCIMServiceUser:

    def test_service_user_properties(self):
        token = make_mock_scim_token()
        user = SCIMServiceUser(token)
        assert user.is_authenticated is True
        assert user.is_active is True
        assert user.id == token.id
        assert user.organisation == token.organisation
        assert user.scim_token == token
