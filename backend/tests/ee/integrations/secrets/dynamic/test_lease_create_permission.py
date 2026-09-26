"""Minting a dynamic secret lease requires DynamicSecretLeases:create for the
principal that will hold it, on every path that can create one."""

from types import SimpleNamespace
from unittest.mock import MagicMock, call

import pytest
from graphql import GraphQLError

from api.models import OrganisationMember
from api.views import secrets as secrets_views
from ee.integrations.secrets.dynamic import utils as dynamic_utils
from ee.integrations.secrets.dynamic.graphene import mutations
from ee.integrations.secrets.dynamic.rest import views as dynamic_views

ORG = SimpleNamespace(id="org-1")
APP = SimpleNamespace(id="app-1", organisation=ORG, sse_enabled=True)
ENV = SimpleNamespace(id="env-1", app=APP)


# --- helper -------------------------------------------------------------------


def test_member_principal_is_checked_in_app_context(monkeypatch):
    permission = MagicMock(return_value=True)
    monkeypatch.setattr(dynamic_utils, "user_has_permission", permission)
    member = SimpleNamespace(user=SimpleNamespace(userId="user-1"))

    assert dynamic_utils.can_create_dynamic_secret_lease(
        ENV, organisation_member=member
    )

    permission.assert_called_once_with(
        member.user, "create", "DynamicSecretLeases", ORG, True, False, app=APP
    )


def test_service_account_principal_is_checked_as_service_account(monkeypatch):
    permission = MagicMock(return_value=False)
    monkeypatch.setattr(dynamic_utils, "user_has_permission", permission)
    service_account = SimpleNamespace(id="sa-1")

    assert not dynamic_utils.can_create_dynamic_secret_lease(
        ENV, service_account=service_account
    )

    permission.assert_called_once_with(
        service_account, "create", "DynamicSecretLeases", ORG, True, True, app=APP
    )


def test_principal_less_token_cannot_create_leases(monkeypatch):
    permission = MagicMock(return_value=True)
    monkeypatch.setattr(dynamic_utils, "user_has_permission", permission)

    assert not dynamic_utils.can_create_dynamic_secret_lease(ENV)
    permission.assert_not_called()


# --- REST: /v1/secrets/dynamic/ ----------------------------------------------------


@pytest.fixture
def dynamic_view(monkeypatch):
    can_create = MagicMock(return_value=False)
    monkeypatch.setattr(dynamic_views, "can_create_dynamic_secret_lease", can_create)
    create_lease = MagicMock(return_value=(SimpleNamespace(id="lease-1"), {}))
    monkeypatch.setattr(dynamic_views, "create_dynamic_secret_lease", create_lease)

    secret_qs = MagicMock()
    secret_qs.exists.return_value = True
    secret_qs.__iter__.return_value = iter([SimpleNamespace(id="ds-1")])
    secret_model = MagicMock()
    secret_model.objects.filter.return_value = secret_qs
    monkeypatch.setattr(dynamic_views, "DynamicSecret", secret_model)
    monkeypatch.setattr(
        dynamic_views,
        "DynamicSecretSerializer",
        MagicMock(return_value=SimpleNamespace(data={})),
    )
    return SimpleNamespace(can_create=can_create, create_lease=create_lease)


def _dynamic_request(auth_type="User", lease=True):
    member = SimpleNamespace(id="member-1") if auth_type == "User" else None
    service_account = SimpleNamespace(id="sa-1") if auth_type != "User" else None
    params = {"lease": "true"} if lease else {}
    return SimpleNamespace(
        GET=params,
        auth={
            "auth_type": auth_type,
            "org_member": member,
            "service_account": service_account,
            "environment": ENV,
        },
    )


def test_dynamic_view_refuses_lease_without_permission(dynamic_view):
    response = dynamic_views.DynamicSecretsView().get(_dynamic_request())

    assert response.status_code == 403
    assert response.data == {"error": dynamic_utils.LEASE_CREATE_PERMISSION_ERROR}
    dynamic_view.create_lease.assert_not_called()


def test_dynamic_view_mints_lease_with_permission(dynamic_view):
    dynamic_view.can_create.return_value = True

    response = dynamic_views.DynamicSecretsView().get(_dynamic_request())

    assert response.status_code == 200
    dynamic_view.create_lease.assert_called_once()


def test_dynamic_view_without_lease_skips_the_check(dynamic_view):
    response = dynamic_views.DynamicSecretsView().get(_dynamic_request(lease=False))

    assert response.status_code == 200
    dynamic_view.can_create.assert_not_called()


def test_dynamic_view_checks_the_member_principal(dynamic_view):
    request = _dynamic_request()

    dynamic_views.DynamicSecretsView().get(request)

    dynamic_view.can_create.assert_called_once_with(
        ENV, organisation_member=request.auth["org_member"], service_account=None
    )


def test_dynamic_view_checks_the_service_account_principal(dynamic_view):
    request = _dynamic_request(auth_type="ServiceAccount")

    dynamic_views.DynamicSecretsView().get(request)

    dynamic_view.can_create.assert_called_once_with(
        ENV, organisation_member=None, service_account=request.auth["service_account"]
    )


# --- REST: /secrets/ and /v1/secrets/ --------------------------------------------


@pytest.fixture
def secrets_view(monkeypatch):
    monkeypatch.setattr(
        secrets_views, "get_resolver_request_meta", MagicMock(return_value=(None, None))
    )
    secret_model = MagicMock()
    secret_model.objects.filter.return_value.prefetch_related.return_value = []
    monkeypatch.setattr(secrets_views, "Secret", secret_model)
    monkeypatch.setattr(secrets_views, "log_secret_events_bulk", MagicMock())
    monkeypatch.setattr(secrets_views, "get_environment_crypto_context", MagicMock())
    monkeypatch.setattr(
        secrets_views,
        "SecretSerializer",
        MagicMock(return_value=SimpleNamespace(data=[])),
    )
    monkeypatch.setattr(
        secrets_views,
        "DynamicSecretSerializer",
        MagicMock(return_value=SimpleNamespace(data={})),
    )

    dynamic_qs = MagicMock()
    dynamic_qs.__iter__.side_effect = lambda: iter([SimpleNamespace(id="ds-1")])
    dynamic_model = MagicMock()
    dynamic_model.objects.filter.return_value = dynamic_qs
    monkeypatch.setattr(secrets_views, "DynamicSecret", dynamic_model)

    can_create = MagicMock(return_value=False)
    monkeypatch.setattr(secrets_views, "can_create_dynamic_secret_lease", can_create)
    create_lease = MagicMock(return_value=(SimpleNamespace(id="lease-1"), {}))
    monkeypatch.setattr(secrets_views, "create_dynamic_secret_lease", create_lease)

    return SimpleNamespace(
        dynamic_qs=dynamic_qs, can_create=can_create, create_lease=create_lease
    )


def _secrets_request(view_cls, flags, service_account=None):
    member = (
        None
        if service_account
        else SimpleNamespace(id="member-1", user=SimpleNamespace(userId="u1"))
    )
    token = (
        SimpleNamespace(service_account=service_account) if service_account else None
    )
    auth = {
        "auth_type": "ServiceAccount" if service_account else "User",
        "org_member": member,
        "service_account": service_account,
        "service_token": None,
        "service_account_token": token,
        "environment": ENV,
    }
    if view_cls is secrets_views.E2EESecretsView:
        return SimpleNamespace(headers=dict(flags), GET={}, auth=auth)
    return SimpleNamespace(headers={}, GET=dict(flags), auth=auth)


SECRETS_VIEWS = [secrets_views.E2EESecretsView, secrets_views.PublicSecretsView]
VIEW_IDS = ["e2ee", "public"]
WITH_LEASE = {"dynamic": "true", "lease": "true"}


@pytest.mark.parametrize("view_cls", SECRETS_VIEWS, ids=VIEW_IDS)
def test_secrets_view_refuses_lease_without_permission(secrets_view, view_cls):
    response = view_cls().get(_secrets_request(view_cls, WITH_LEASE))

    assert response.status_code == 403
    assert response.data == {"error": dynamic_utils.LEASE_CREATE_PERMISSION_ERROR}
    secrets_view.create_lease.assert_not_called()


@pytest.mark.parametrize("view_cls", SECRETS_VIEWS, ids=VIEW_IDS)
def test_secrets_view_mints_lease_with_permission(secrets_view, view_cls):
    secrets_view.can_create.return_value = True

    response = view_cls().get(_secrets_request(view_cls, WITH_LEASE))

    assert response.status_code == 200
    secrets_view.create_lease.assert_called_once()


@pytest.mark.parametrize("view_cls", SECRETS_VIEWS, ids=VIEW_IDS)
def test_secrets_view_without_dynamic_secrets_ignores_lease_flag(
    secrets_view, view_cls
):
    secrets_view.dynamic_qs.__iter__.side_effect = lambda: iter([])

    response = view_cls().get(_secrets_request(view_cls, WITH_LEASE))

    assert response.status_code == 200
    secrets_view.can_create.assert_not_called()


@pytest.mark.parametrize("view_cls", SECRETS_VIEWS, ids=VIEW_IDS)
def test_secrets_view_without_lease_flag_skips_the_check(secrets_view, view_cls):
    response = view_cls().get(_secrets_request(view_cls, {"dynamic": "true"}))

    assert response.status_code == 200
    secrets_view.can_create.assert_not_called()


@pytest.mark.parametrize("view_cls", SECRETS_VIEWS, ids=VIEW_IDS)
def test_secrets_view_checks_the_member_principal(secrets_view, view_cls):
    request = _secrets_request(view_cls, WITH_LEASE)

    view_cls().get(request)

    secrets_view.can_create.assert_called_once_with(
        ENV, organisation_member=request.auth["org_member"], service_account=None
    )


@pytest.mark.parametrize("view_cls", SECRETS_VIEWS, ids=VIEW_IDS)
def test_secrets_view_checks_the_service_account_principal(secrets_view, view_cls):
    service_account = SimpleNamespace(id="sa-1")

    view_cls().get(_secrets_request(view_cls, WITH_LEASE, service_account))

    secrets_view.can_create.assert_called_once_with(
        ENV, organisation_member=None, service_account=service_account
    )


# --- GraphQL: LeaseDynamicSecret ----------------------------------------------


@pytest.fixture
def lease_mutation(monkeypatch):
    secret = SimpleNamespace(id="ds-1", name="AWS", environment=ENV)
    secret_model = MagicMock()
    secret_model.objects.get.return_value = secret
    monkeypatch.setattr(mutations, "DynamicSecret", secret_model)

    active_member = SimpleNamespace(id="member-active")

    def member_get(**kwargs):
        # Re-invited users keep their soft-deleted membership rows.
        if "deleted_at" not in kwargs:
            raise OrganisationMember.MultipleObjectsReturned
        return active_member

    member_model = MagicMock()
    member_model.objects.get.side_effect = member_get
    monkeypatch.setattr(mutations, "OrganisationMember", member_model)
    monkeypatch.setattr(mutations, "user_is_org_member", MagicMock(return_value=True))
    monkeypatch.setattr(
        mutations, "user_can_access_environment", MagicMock(return_value=True)
    )

    granted = {("read", "Secrets"), ("create", "DynamicSecretLeases")}
    permission = MagicMock(
        side_effect=lambda user, action, resource, *args, **kwargs: (
            (action, resource) in granted
        )
    )
    monkeypatch.setattr(mutations, "user_has_permission", permission)

    create_lease = MagicMock(
        return_value=(
            SimpleNamespace(id="lease-1"),
            {"access_key_id": "a", "secret_access_key": "b", "username": "c"},
        )
    )
    monkeypatch.setattr(mutations, "create_dynamic_secret_lease", create_lease)

    return SimpleNamespace(
        granted=granted,
        permission=permission,
        create_lease=create_lease,
        active_member=active_member,
    )


USER = SimpleNamespace(userId="u1")


def _lease_mutation():
    info = SimpleNamespace(context=SimpleNamespace(user=USER))
    return mutations.LeaseDynamicSecret.mutate(None, info, secret_id="ds-1")


def test_lease_mutation_requires_lease_create_permission(lease_mutation):
    lease_mutation.granted.discard(("create", "DynamicSecretLeases"))

    with pytest.raises(GraphQLError, match="create dynamic secret leases"):
        _lease_mutation()

    lease_mutation.create_lease.assert_not_called()


def test_lease_mutation_requires_secrets_read(lease_mutation):
    lease_mutation.granted.discard(("read", "Secrets"))

    with pytest.raises(GraphQLError, match="read secrets"):
        _lease_mutation()

    lease_mutation.create_lease.assert_not_called()


def test_lease_mutation_succeeds_with_read_and_lease_create(lease_mutation):
    _lease_mutation()

    lease_mutation.create_lease.assert_called_once()
    assert lease_mutation.create_lease.call_args.args[3] is lease_mutation.active_member
    assert lease_mutation.permission.call_args_list == [
        call(USER, "read", "Secrets", ORG, True, app=APP),
        call(USER, "create", "DynamicSecretLeases", ORG, True, app=APP),
    ]
