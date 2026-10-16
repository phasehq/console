"""An organisation pending deletion is locked: GraphQL, REST token auth, SCIM
and external identity auth all refuse it, except the owner's restore."""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from django.utils import timezone
from rest_framework import exceptions
from rest_framework.test import APIRequestFactory

from backend.graphene.middleware import (
    OrgDeletionLockMiddleware,
    OrgPendingDeletionError,
)

MIDDLEWARE = "backend.graphene.middleware"


def _info(authenticated=True):
    info = MagicMock()
    info.context = SimpleNamespace(
        user=MagicMock(is_authenticated=authenticated), session={}
    )
    return info


def _next(root, info, **kwargs):
    return "resolved"


@pytest.fixture
def resolve_org():
    with patch(
        f"{MIDDLEWARE}.OrgSSOEnforcementMiddleware._resolve_org_id",
        return_value="org-1",
    ) as resolver:
        yield resolver


class TestOrgDeletionLockMiddleware:
    def test_locked_org_is_refused(self, resolve_org):
        with patch(f"{MIDDLEWARE}.organisation_is_locked", return_value=True):
            with pytest.raises(OrgPendingDeletionError) as error:
                OrgDeletionLockMiddleware().resolve(
                    _next, None, _info(), organisation_id="org-1"
                )

        assert error.value.extensions["code"] == "ORG_PENDING_DELETION"
        assert error.value.extensions["organisation_id"] == "org-1"

    def test_unlocked_org_resolves(self, resolve_org):
        with patch(f"{MIDDLEWARE}.organisation_is_locked", return_value=False):
            result = OrgDeletionLockMiddleware().resolve(
                _next, None, _info(), organisation_id="org-1"
            )

        assert result == "resolved"

    def test_restore_bypasses_the_lock(self, resolve_org):
        restore_type = type("Restore", (), {"bypass_org_deletion_lock": True})
        with patch(f"{MIDDLEWARE}.organisation_is_locked", return_value=True), patch(
            f"{MIDDLEWARE}._output_graphene_type", return_value=restore_type
        ):
            result = OrgDeletionLockMiddleware().resolve(
                _next, None, _info(), organisation_id="org-1"
            )

        assert result == "resolved"

    def test_resolvers_without_an_org_are_untouched(self, resolve_org):
        resolve_org.return_value = None
        with patch(f"{MIDDLEWARE}.organisation_is_locked") as is_locked:
            result = OrgDeletionLockMiddleware().resolve(_next, None, _info())

        assert result == "resolved"
        is_locked.assert_not_called()

    def test_anonymous_requests_are_untouched(self, resolve_org):
        with patch(f"{MIDDLEWARE}.organisation_is_locked") as is_locked:
            result = OrgDeletionLockMiddleware().resolve(
                _next, None, _info(authenticated=False), organisation_id="org-1"
            )

        assert result == "resolved"
        is_locked.assert_not_called()

    def test_lock_state_is_looked_up_once_per_request(self, resolve_org):
        info = _info()
        with patch(
            f"{MIDDLEWARE}.organisation_is_locked", return_value=False
        ) as is_locked:
            for _ in range(3):
                OrgDeletionLockMiddleware().resolve(
                    _next, None, info, organisation_id="org-1"
                )

        is_locked.assert_called_once_with("org-1")


class TestTokenAuthentication:
    def test_tokens_of_a_locked_org_are_refused(self):
        from api.auth import PhaseTokenAuthentication

        request = APIRequestFactory().get(
            "/v1/secrets/", HTTP_AUTHORIZATION="Bearer User test-token"
        )
        locked_org = MagicMock(deleted_at=timezone.now())

        with patch("api.auth.get_token_type", return_value="User"), patch(
            "api.auth.token_is_expired_or_deleted", return_value=False
        ), patch("api.auth._resolve_caller_org", return_value=locked_org):
            with pytest.raises(
                exceptions.PermissionDenied, match="scheduled for deletion"
            ):
                PhaseTokenAuthentication().authenticate(request)


class TestLookupsSkipLockedOrgs:
    def test_external_identity_lookup_excludes_locked_orgs(self):
        from api.utils.identity.common import resolve_service_account

        with patch("api.models.ServiceAccount.objects") as objects:
            resolve_service_account("sa-1")

        objects.get.assert_called_once_with(
            id="sa-1", deleted_at=None, organisation__deleted_at__isnull=True
        )

    def test_scim_token_lookup_excludes_locked_orgs(self):
        from ee.authentication.scim.auth import SCIMTokenAuthentication

        request = MagicMock()
        request.headers = {"Authorization": "Bearer ph_scim:v1:abcd:token"}

        with patch("ee.authentication.scim.auth.SCIMToken") as token_model:
            token_model.DoesNotExist = type("DoesNotExist", (Exception,), {})
            token_model.objects.select_related.return_value.get.side_effect = (
                token_model.DoesNotExist
            )
            with pytest.raises(exceptions.AuthenticationFailed):
                SCIMTokenAuthentication().authenticate(request)

        lookup = token_model.objects.select_related.return_value.get.call_args.kwargs
        assert lookup["organisation__deleted_at__isnull"] is True
