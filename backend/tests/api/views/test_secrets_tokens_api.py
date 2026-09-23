"""Shared-auth and compatibility tests for the token bootstrap endpoint."""

from types import SimpleNamespace
from unittest.mock import Mock, patch

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.renderers import JSONRenderer
from rest_framework.test import APIRequestFactory

from api.auth import PhaseTokenAuthentication
from api.throttling import PlanBasedRateThrottle
from api.utils.access.middleware import IsIPAllowed
from api.views.auth import SecretsTokensView


def _user():
    return SimpleNamespace(
        id="user-1",
        userId="user-1",
        username="user",
        is_authenticated=True,
        is_active=True,
    )


def _request(token_type, **headers):
    extras = {
        "HTTP_AUTHORIZATION": f"Bearer {token_type} token-value",
        **{f"HTTP_{key.upper().replace('-', '_')}": value for key, value in headers.items()},
    }
    return APIRequestFactory().get(
        "/secrets/tokens/?app_id=foreign&env=Production&secret_id=foreign",
        **extras,
    )


def _policy_patches():
    return (
        patch("api.views.auth.IsIPAllowed.has_permission", return_value=True),
        patch(
            "api.views.auth.PlanBasedRateThrottle.allow_request", return_value=True
        ),
    )


class TestSecretsTokensViewCompatibility:
    def setup_method(self):
        self.view = SecretsTokensView.as_view()

    def test_uses_shared_security_policies_and_json_renderer(self):
        assert SecretsTokensView.authentication_classes == [PhaseTokenAuthentication]
        assert SecretsTokensView.permission_classes == [IsAuthenticated, IsIPAllowed]
        assert SecretsTokensView.throttle_classes == [PlanBasedRateThrottle]
        assert SecretsTokensView.renderer_classes == [JSONRenderer]
        assert SecretsTokensView.allow_contextless_token_bootstrap is True

    def test_contextless_user_token_preserves_snake_case_response(self):
        user = _user()
        org = SimpleNamespace(id="org-1", plan="PR")
        member = SimpleNamespace(
            id="member-1",
            user=user,
            organisation=org,
            deleted_at=None,
        )
        user_token = Mock(id="user-token-1")
        payload = {
            "wrapped_key_share": "wrapped",
            "user_id": "member-1",
            "offline_enabled": False,
            "apps": [],
            "organisation": {"id": "org-1", "name": "Org"},
        }
        ip_patch, throttle_patch = _policy_patches()

        with patch("api.auth.get_token_type", return_value="User"), patch(
            "api.auth.token_is_expired_or_deleted", return_value=False
        ), patch("api.auth._resolve_caller_org", return_value=org), patch(
            "api.auth.get_org_member_from_user_token", return_value=member
        ), patch(
            "api.models.UserToken.objects.get", return_value=user_token
        ), patch(
            "api.views.auth.UserTokenSerializer"
        ) as serializer, ip_patch, throttle_patch:
            serializer.return_value.data = payload
            response = self.view(_request("User", Environment="foreign-env"))

        assert response.status_code == status.HTTP_200_OK
        assert response.data == payload
        serializer.assert_called_once_with(user_token)

    def test_contextless_service_account_token_preserves_response(self):
        user = _user()
        org = SimpleNamespace(id="org-1", plan="PR")
        service_account = SimpleNamespace(
            id="sa-1",
            name="automation",
            organisation=org,
            deleted_at=None,
        )
        token = SimpleNamespace(
            id="sa-token-1",
            service_account=service_account,
            created_by=SimpleNamespace(user=user),
        )
        payload = {
            "wrapped_key_share": "wrapped",
            "account_id": "sa-1",
            "offline_enabled": False,
            "apps": [],
            "organisation": {"id": "org-1", "name": "Org"},
        }
        ip_patch, throttle_patch = _policy_patches()

        with patch("api.auth.get_token_type", return_value="ServiceAccount"), patch(
            "api.auth.token_is_expired_or_deleted", return_value=False
        ), patch("api.auth._resolve_caller_org", return_value=org), patch(
            "api.auth.get_service_account_token", return_value=token
        ), patch(
            "api.auth.get_service_account_from_token", return_value=service_account
        ), patch(
            "api.auth.ServiceAccountToken.objects.filter"
        ), patch(
            "api.views.auth.ServiceAccountTokenSerializer"
        ) as serializer, ip_patch, throttle_patch:
            serializer.return_value.data = payload
            response = self.view(
                _request("ServiceAccount", Environment="foreign-env")
            )

        assert response.status_code == status.HTTP_200_OK
        assert response.data == payload
        serializer.assert_called_once_with(token)


class TestSecretsTokensViewEnforcement:
    def setup_method(self):
        self.view = SecretsTokensView.as_view()

    def test_missing_credentials_returns_shared_auth_401(self):
        request = APIRequestFactory().get("/secrets/tokens/")

        response = self.view(request)

        assert response.status_code == status.HTTP_401_UNAUTHORIZED
        assert response["WWW-Authenticate"] == "Bearer"
        assert "Authentication credentials" in str(response.data["error"])

    def test_expired_token_returns_shared_auth_401(self):
        with patch("api.auth.get_token_type", return_value="User"), patch(
            "api.auth.token_is_expired_or_deleted", return_value=True
        ):
            response = self.view(_request("User"))

        assert response.status_code == status.HTTP_401_UNAUTHORIZED
        assert response["WWW-Authenticate"] == "Bearer"
        assert str(response.data["error"]) == "Token expired or deleted"

    def test_ip_policy_denial_happens_before_serialization_and_throttle(self):
        user = _user()
        token = Mock(id="sa-token-1")
        auth = {
            "auth_type": "ServiceAccount",
            "environment": None,
            "app": Mock(),
            "organisation": Mock(),
            "org_member": None,
            "service_account": None,
            "service_account_token": token,
        }

        with patch(
            "api.auth.PhaseTokenAuthentication.authenticate",
            return_value=(user, auth),
        ), patch(
            "api.views.auth.IsIPAllowed.has_permission", return_value=False
        ), patch(
            "api.views.auth.PlanBasedRateThrottle.allow_request"
        ) as throttle, patch(
            "api.views.auth.ServiceAccountTokenSerializer"
        ) as serializer:
            response = self.view(_request("ServiceAccount"))

        assert response.status_code == status.HTTP_403_FORBIDDEN
        throttle.assert_not_called()
        serializer.assert_not_called()

    def test_authenticated_request_is_throttled_before_serialization(self):
        user = _user()
        token = Mock(id="sa-token-1")
        auth = {
            "auth_type": "ServiceAccount",
            "environment": None,
            "app": Mock(),
            "organisation": Mock(),
            "org_member": None,
            "service_account": None,
            "service_account_token": token,
        }

        with patch(
            "api.auth.PhaseTokenAuthentication.authenticate",
            return_value=(user, auth),
        ), patch(
            "api.views.auth.IsIPAllowed.has_permission", return_value=True
        ), patch(
            "api.views.auth.PlanBasedRateThrottle.allow_request", return_value=False
        ), patch(
            "api.views.auth.PlanBasedRateThrottle.wait", return_value=1
        ), patch(
            "api.views.auth.ServiceAccountTokenSerializer"
        ) as serializer:
            response = self.view(_request("ServiceAccount"))

        assert response.status_code == status.HTTP_429_TOO_MANY_REQUESTS
        serializer.assert_not_called()
