"""Tests for SCIMTokenAuthentication."""

import hashlib
from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.test import APIRequestFactory

from api.models import ActivatedPhaseLicense, Organisation, SCIMToken
from ee.authentication.scim.auth import SCIMServiceUser, SCIMTokenAuthentication

from .conftest import TOKEN_HASH, TOKEN_RAW

factory = APIRequestFactory()


def _make_request(token=TOKEN_RAW):
    """Create a DRF request with the given Bearer token."""
    request = factory.get(
        "/scim/v2/Users",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    return request


@pytest.mark.django_db
class TestSCIMTokenAuthentication:

    def test_valid_token(self, scim_token, organisation):
        auth = SCIMTokenAuthentication()
        request = _make_request()
        user, auth_info = auth.authenticate(request)

        assert isinstance(user, SCIMServiceUser)
        assert user.is_authenticated
        assert str(auth_info["organisation"].id) == str(organisation.id)
        assert str(auth_info["scim_token"].id) == str(scim_token.id)

    def test_updates_last_used_at(self, scim_token):
        assert scim_token.last_used_at is None

        auth = SCIMTokenAuthentication()
        auth.authenticate(_make_request())

        scim_token.refresh_from_db()
        assert scim_token.last_used_at is not None

    def test_no_auth_header_returns_none(self, scim_token):
        """Missing Authorization header should return None (not raise), allowing other authenticators to try."""
        auth = SCIMTokenAuthentication()
        request = factory.get("/scim/v2/Users")
        result = auth.authenticate(request)
        assert result is None

    def test_non_bearer_header_returns_none(self, scim_token):
        auth = SCIMTokenAuthentication()
        request = factory.get(
            "/scim/v2/Users",
            HTTP_AUTHORIZATION="Basic dXNlcjpwYXNz",
        )
        result = auth.authenticate(request)
        assert result is None

    def test_non_scim_bearer_token_returns_none(self, scim_token):
        """Phase tokens (pss_service:v2:...) should be ignored."""
        auth = SCIMTokenAuthentication()
        request = _make_request(token="pss_service:v2:prefix:body")
        result = auth.authenticate(request)
        assert result is None

    def test_invalid_token_hash_raises(self, scim_token):
        auth = SCIMTokenAuthentication()
        request = _make_request(token="ph_scim:v1:fake:invalid_token_value")
        with pytest.raises(AuthenticationFailed, match="Invalid SCIM token"):
            auth.authenticate(request)

    def test_expired_token_raises(self, scim_token):
        scim_token.expires_at = timezone.now() - timedelta(hours=1)
        scim_token.save(update_fields=["expires_at"])

        auth = SCIMTokenAuthentication()
        with pytest.raises(AuthenticationFailed, match="expired"):
            auth.authenticate(_make_request())

    def test_non_expired_token_works(self, scim_token):
        scim_token.expires_at = timezone.now() + timedelta(days=30)
        scim_token.save(update_fields=["expires_at"])

        auth = SCIMTokenAuthentication()
        user, _ = auth.authenticate(_make_request())
        assert user.is_authenticated

    def test_scim_disabled_on_org_raises(self, scim_token, organisation):
        organisation.scim_enabled = False
        organisation.save(update_fields=["scim_enabled"])

        auth = SCIMTokenAuthentication()
        with pytest.raises(AuthenticationFailed, match="not enabled"):
            auth.authenticate(_make_request())

    def test_token_is_inactive_raises(self, scim_token):
        scim_token.is_active = False
        scim_token.save(update_fields=["is_active"])

        auth = SCIMTokenAuthentication()
        with pytest.raises(AuthenticationFailed, match="disabled"):
            auth.authenticate(_make_request())

    def test_soft_deleted_token_raises(self, scim_token):
        scim_token.deleted_at = timezone.now()
        scim_token.save(update_fields=["deleted_at"])

        auth = SCIMTokenAuthentication()
        with pytest.raises(AuthenticationFailed, match="Invalid SCIM token"):
            auth.authenticate(_make_request())

    def test_non_enterprise_plan_without_license_raises(self, scim_token, organisation):
        organisation.plan = "FR"
        organisation.save(update_fields=["plan"])

        auth = SCIMTokenAuthentication()
        with pytest.raises(AuthenticationFailed, match="Enterprise plan"):
            auth.authenticate(_make_request())

    def test_non_enterprise_plan_with_license_works(self, scim_token, organisation):
        """An activated license should bypass the plan check."""
        organisation.plan = "FR"
        organisation.save(update_fields=["plan"])

        ActivatedPhaseLicense.objects.create(
            id="test-license-id",
            customer_name="TestCorp",
            organisation=organisation,
            plan="EN",
            metadata={},
            environment="production",
            license_type="enterprise",
            signature_date=timezone.now().date(),
            issuing_authority="Phase",
            issued_at=timezone.now(),
            expires_at=timezone.now() + timedelta(days=365),
        )

        auth = SCIMTokenAuthentication()
        user, _ = auth.authenticate(_make_request())
        assert user.is_authenticated


@pytest.mark.django_db
class TestSCIMServiceUser:

    def test_service_user_properties(self, scim_token):
        user = SCIMServiceUser(scim_token)
        assert user.is_authenticated is True
        assert user.is_active is True
        assert user.id == scim_token.id
        assert user.organisation == scim_token.organisation
        assert user.scim_token == scim_token
