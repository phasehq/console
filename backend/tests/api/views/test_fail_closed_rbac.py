"""Management views must fail closed: a principal that is not a User or a
ServiceAccount gets 403 before any permission helper or handler runs."""

import importlib
import uuid
from unittest.mock import Mock, patch

import pytest
from django.urls import URLPattern, URLResolver, get_resolver
from rest_framework import status
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.test import APIRequestFactory, force_authenticate

from api.auth import PhaseTokenAuthentication
from api.utils.rest import get_request_principal

_API = "api.views"
_DYNAMIC = "ee.integrations.secrets.dynamic.rest.views"

# (module, view class, url kwargs, HTTP methods)
_VIEWS = [
    (f"{_API}.apps", "PublicAppsView", {}, ["get", "post"]),
    (f"{_API}.apps", "PublicAppDetailView", {"app_id": "a"}, ["get", "put", "delete"]),
    (f"{_API}.environments", "PublicEnvironmentsView", {}, ["get", "post"]),
    (
        f"{_API}.environments",
        "PublicEnvironmentDetailView",
        {"env_id": "e"},
        ["get", "put", "delete"],
    ),
    (f"{_API}.members", "PublicMembersView", {}, ["get"]),
    (
        f"{_API}.members",
        "PublicMemberDetailView",
        {"member_id": "m"},
        ["get", "put", "delete"],
    ),
    (f"{_API}.members", "PublicMemberAccessView", {"member_id": "m"}, ["get", "put"]),
    (f"{_API}.members", "PublicInvitesView", {}, ["get", "post"]),
    (f"{_API}.members", "PublicInviteDetailView", {"invite_id": "i"}, ["delete"]),
    (f"{_API}.roles", "PublicRolesView", {}, ["get", "post"]),
    (f"{_API}.roles", "PublicRoleDetailView", {"role_id": "r"}, ["get", "put", "delete"]),
    (f"{_API}.secrets", "E2EESecretsView", {}, ["get", "post", "put", "delete"]),
    (f"{_API}.secrets", "PublicSecretsView", {}, ["get", "post", "put", "delete"]),
    (f"{_API}.service_accounts", "PublicServiceAccountsView", {}, ["get", "post"]),
    (
        f"{_API}.service_accounts",
        "PublicServiceAccountDetailView",
        {"sa_id": "s"},
        ["get", "put", "delete"],
    ),
    (f"{_API}.service_accounts", "PublicServiceAccountAccessView", {"sa_id": "s"}, ["put"]),
    (f"{_API}.service_accounts", "PublicServiceAccountTokensView", {"sa_id": "s"}, ["post"]),
    (
        f"{_API}.service_accounts",
        "PublicServiceAccountTokenDetailView",
        {"sa_id": "s", "token_id": "t"},
        ["delete"],
    ),
    (f"{_API}.teams", "PublicTeamsView", {}, ["get", "post"]),
    (f"{_API}.teams", "PublicTeamDetailView", {"team_id": "t"}, ["get", "put", "delete"]),
    (f"{_API}.teams", "PublicTeamMembersView", {"team_id": "t"}, ["post"]),
    (
        f"{_API}.teams",
        "PublicTeamMemberDetailView",
        {"team_id": "t", "member_id": "m"},
        ["delete"],
    ),
    (f"{_API}.teams", "PublicTeamAccessView", {"team_id": "t"}, ["put"]),
    (f"{_DYNAMIC}", "DynamicSecretsView", {}, ["get"]),
    (f"{_DYNAMIC}", "DynamicSecretLeaseView", {}, ["get", "put", "delete"]),
]

_CASES = [
    pytest.param(module, view, kwargs, method, id=f"{view}-{method.upper()}")
    for module, view, kwargs, methods in _VIEWS
    for method in methods
]

# Views with their own principal handling, asserted elsewhere.
_EXEMPT = {
    ("api.views.auth", "SecretsTokensView"),
    ("api.views.audit", "PublicAuditLogsView"),
}

_PERMISSION_HELPERS = [
    "user_has_permission",
    "user_is_org_member",
    "user_can_access_app",
    "user_can_access_environment",
    "service_account_can_access_app",
    "service_account_can_access_environment",
    "role_has_permission",
    "role_has_global_access",
]


def _org_member():
    member = Mock()
    member.id = uuid.uuid4()
    member.user.userId = uuid.uuid4()
    member.user.is_authenticated = True
    return member


def _service_account():
    sa = Mock()
    sa.id = uuid.uuid4()
    return sa


# auth_type, org_member, service_account
_UNSUPPORTED_PRINCIPALS = [
    pytest.param("Service", None, None, id="legacy-service"),
    pytest.param("FutureToken", None, None, id="future-token"),
    pytest.param("FutureToken", _org_member(), _service_account(), id="future-token-with-principals"),
    pytest.param("User", None, _service_account(), id="user-without-org-member"),
    pytest.param("ServiceAccount", _org_member(), None, id="sa-without-service-account"),
]


def _auth(auth_type, org_member, service_account):
    org = Mock()
    org.id = uuid.uuid4()
    app = Mock()
    app.id = uuid.uuid4()
    app.sse_enabled = True
    app.organisation = org
    env = Mock()
    env.id = uuid.uuid4()
    env.app = app
    return {
        "token": f"Bearer {auth_type} test_token",
        "auth_type": auth_type,
        "app": app,
        "environment": env,
        "organisation": org,
        "org_member": org_member,
        "service_account": service_account,
        "service_account_token": None,
    }


def _call(module, view_name, url_kwargs, method, auth, has_permission=True):
    """Dispatch a request through the real view with the handler and every
    permission helper replaced by mocks. Returns (response, handler, helpers)."""
    mod = importlib.import_module(module)
    view_cls = getattr(mod, view_name)

    request = getattr(APIRequestFactory(), method)("/", data={}, format="json")
    user = Mock(is_authenticated=True, is_active=True)
    force_authenticate(request, user=user, token=auth)

    handler = Mock(return_value=Response({}))
    helpers = {
        name: Mock(return_value=True)
        for name in _PERMISSION_HELPERS
        if hasattr(mod, name)
    }
    helpers["user_has_permission"].return_value = has_permission
    patches = [patch.object(view_cls, method, handler)] + [
        patch.object(mod, name, mock) for name, mock in helpers.items()
    ]
    for p in patches:
        p.start()
    try:
        response = view_cls.as_view()(request, **url_kwargs)
    finally:
        for p in patches:
            p.stop()
    return response, handler, helpers


@pytest.fixture(autouse=True)
def _bypass_ip_and_throttle():
    with patch(
        "api.utils.access.middleware.IsIPAllowed.has_permission", return_value=True
    ), patch("api.throttling.PlanBasedRateThrottle.allow_request", return_value=True):
        yield


@pytest.mark.parametrize("auth_type,org_member,service_account", _UNSUPPORTED_PRINCIPALS)
@pytest.mark.parametrize("module,view_name,url_kwargs,method", _CASES)
def test_unsupported_principal_is_denied_before_rbac(
    module, view_name, url_kwargs, method, auth_type, org_member, service_account
):
    auth = _auth(auth_type, org_member, service_account)

    response, handler, helpers = _call(module, view_name, url_kwargs, method, auth)

    assert response.status_code == status.HTTP_403_FORBIDDEN
    handler.assert_not_called()
    for name, mock in helpers.items():
        assert not mock.called, f"{name} ran for an unsupported principal"


# The lease view authorises inside its handlers, which are mocked out here.
_INITIAL_RBAC_CASES = [c for c in _CASES if c.values[1] != "DynamicSecretLeaseView"]

_SUPPORTED_PRINCIPALS = [
    pytest.param("User", id="user"),
    pytest.param("ServiceAccount", id="service-account"),
]


def _supported_auth(auth_type):
    if auth_type == "User":
        member = _org_member()
        return _auth(auth_type, member, None), member.user
    sa = _service_account()
    return _auth(auth_type, None, sa), sa


@pytest.mark.parametrize("auth_type", _SUPPORTED_PRINCIPALS)
@pytest.mark.parametrize("module,view_name,url_kwargs,method", _CASES)
def test_supported_principal_reaches_handler(
    module, view_name, url_kwargs, method, auth_type
):
    auth, _ = _supported_auth(auth_type)

    response, handler, _ = _call(module, view_name, url_kwargs, method, auth)

    assert response.status_code == status.HTTP_200_OK
    handler.assert_called_once()


@pytest.mark.parametrize("auth_type", _SUPPORTED_PRINCIPALS)
@pytest.mark.parametrize("module,view_name,url_kwargs,method", _INITIAL_RBAC_CASES)
def test_supported_principal_without_permission_is_denied(
    module, view_name, url_kwargs, method, auth_type
):
    auth, account = _supported_auth(auth_type)

    response, handler, helpers = _call(
        module, view_name, url_kwargs, method, auth, has_permission=False
    )

    assert response.status_code == status.HTTP_403_FORBIDDEN
    handler.assert_not_called()
    assert helpers["user_has_permission"].call_args.args[0] is account


def _token_authenticated_views():
    found = set()

    def walk(patterns):
        for entry in patterns:
            if isinstance(entry, URLResolver):
                walk(entry.url_patterns)
            elif isinstance(entry, URLPattern):
                view_cls = getattr(entry.callback, "view_class", None)
                if view_cls is not None and PhaseTokenAuthentication in getattr(
                    view_cls, "authentication_classes", []
                ):
                    found.add((view_cls.__module__, view_cls.__name__))

    walk(get_resolver().url_patterns)
    return found


def test_every_token_authenticated_route_is_covered():
    covered = {(module, view) for module, view, _, _ in _VIEWS}
    assert _token_authenticated_views() - covered - _EXEMPT == set()


class TestGetRequestPrincipal:
    def _request(self, auth):
        request = Mock()
        request.auth = auth
        return request

    def test_user(self):
        member = _org_member()
        request = self._request({"auth_type": "User", "org_member": member})
        assert get_request_principal(request) == (member.user, False)

    def test_service_account(self):
        sa = _service_account()
        request = self._request(
            {"auth_type": "ServiceAccount", "service_account": sa}
        )
        assert get_request_principal(request) == (sa, True)

    @pytest.mark.parametrize(
        "auth",
        [
            None,
            {},
            {"auth_type": "Service"},
            {"auth_type": "FutureToken", "org_member": Mock(), "service_account": Mock()},
            {"auth_type": "User", "org_member": None, "service_account": Mock()},
            {"auth_type": "ServiceAccount", "org_member": Mock(), "service_account": None},
        ],
    )
    def test_anything_else_is_denied(self, auth):
        with pytest.raises(PermissionDenied):
            get_request_principal(self._request(auth))
