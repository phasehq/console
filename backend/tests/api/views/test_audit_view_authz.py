"""PublicAuditLogsView authorization: only principals with a permission
model (Users, Service Accounts) may read organisation-wide audit logs.

Legacy service tokens authenticate through the same PhaseTokenAuthentication
class but are environment-scoped and have no role — the view must fail
closed for them instead of silently skipping the Logs:read check.
"""

from unittest.mock import MagicMock, patch

import pytest
from rest_framework.exceptions import PermissionDenied
from rest_framework.views import APIView

from api.views.audit import PublicAuditLogsView

_V = "api.views.audit"


def _request(auth):
    request = MagicMock()
    request.auth = auth
    return request


def _view():
    return PublicAuditLogsView()


def _initial(view, request):
    # Bypass DRF's own initial() machinery (authentication/throttling) —
    # under test is only this view's authorization logic.
    with patch.object(APIView, "initial"):
        view.initial(request)


def test_service_tokens_are_rejected():
    org = MagicMock()
    request = _request({"auth_type": "Service", "app": MagicMock(organisation=org)})

    with patch(f"{_V}.user_has_permission") as mock_perm:
        with pytest.raises(PermissionDenied, match="service token"):
            _initial(_view(), request)

    mock_perm.assert_not_called()


def test_user_without_logs_permission_is_rejected():
    org = MagicMock()
    org_member = MagicMock()
    request = _request(
        {"auth_type": "User", "org_member": org_member, "organisation": org}
    )

    with patch(f"{_V}.user_has_permission", return_value=False) as mock_perm, patch(
        f"{_V}.role_has_global_access", return_value=True
    ):
        with pytest.raises(PermissionDenied, match="permission"):
            _initial(_view(), request)

    mock_perm.assert_called_once_with(
        org_member.user, "read", "Logs", org, False, False
    )


def test_service_account_tokens_are_rejected():
    """Service accounts cannot hold global-access roles (enforced at SA
    create/update), so they can never satisfy the org-wide guard — reject
    with an actionable message instead of an unsatisfiable one."""
    org = MagicMock()
    service_account = MagicMock()
    request = _request(
        {
            "auth_type": "ServiceAccount",
            "service_account": service_account,
            "organisation": org,
        }
    )

    with patch(f"{_V}.user_has_permission") as mock_perm:
        with pytest.raises(PermissionDenied, match="service account"):
            _initial(_view(), request)

    mock_perm.assert_not_called()


def test_user_with_global_access_role_is_allowed():
    org = MagicMock()
    org_member = MagicMock()
    request = _request(
        {"auth_type": "User", "org_member": org_member, "organisation": org}
    )

    with patch(f"{_V}.user_has_permission", return_value=True), patch(
        f"{_V}.role_has_global_access", return_value=True
    ):
        _initial(_view(), request)


def test_scoped_roles_are_rejected():
    """This endpoint returns the unscoped org-wide stream. The Console's
    GraphQL resolver filters events for roles without global access — the
    REST view doesn't replicate that scoping, so it must fail closed for
    scoped roles (e.g. default Developer/Manager) instead of over-exposing."""
    org = MagicMock()
    org_member = MagicMock()
    request = _request(
        {"auth_type": "User", "org_member": org_member, "organisation": org}
    )

    with patch(f"{_V}.user_has_permission", return_value=True), patch(
        f"{_V}.role_has_global_access", return_value=False
    ) as mock_global:
        with pytest.raises(PermissionDenied, match="global access"):
            _initial(_view(), request)

    mock_global.assert_called_once_with(org_member.role)
