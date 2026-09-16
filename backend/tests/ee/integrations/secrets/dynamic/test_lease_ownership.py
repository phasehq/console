"""Lease holders can renew and revoke their own leases without the
DynamicSecretLeases permission; holder matching never crosses principal types."""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from graphql import GraphQLError
from rest_framework.exceptions import PermissionDenied

from api.models import (
    CustomUser,
    DynamicSecretLease,
    OrganisationMember,
    ServiceAccount,
)
from ee.integrations.secrets.dynamic.graphene import mutations
from ee.integrations.secrets.dynamic.rest import views

ORG = SimpleNamespace(id="org-1")
APP = SimpleNamespace(id="app-1", organisation=ORG)
ENV = SimpleNamespace(id="env-1", app=APP)

MEMBER = OrganisationMember(id="member-1", user=CustomUser(userId="user-1"))
OTHER_MEMBER = OrganisationMember(id="member-2", user=CustomUser(userId="user-2"))
SERVICE_ACCOUNT = ServiceAccount(id="sa-1")


def _lease(member=None, service_account=None):
    return SimpleNamespace(
        id="lease-1",
        secret=SimpleNamespace(environment=ENV, provider="aws"),
        organisation_member=member,
        organisation_member_id=getattr(member, "id", None),
        service_account=service_account,
        service_account_id=getattr(service_account, "id", None),
    )


def _request(auth_type, member=None, service_account=None):
    return SimpleNamespace(
        data={"lease_id": "lease-1"},
        query_params={},
        auth={
            "auth_type": auth_type,
            "org_member": member,
            "service_account": service_account,
            "environment": ENV,
        },
    )


@pytest.fixture
def rest(monkeypatch):
    lease_model = MagicMock()
    monkeypatch.setattr(views, "DynamicSecretLease", lease_model)
    permission = MagicMock(return_value=False)
    monkeypatch.setattr(views, "user_has_permission", permission)
    renew = MagicMock()
    monkeypatch.setattr(views, "renew_dynamic_secret_lease", renew)
    revoke = MagicMock()
    monkeypatch.setattr(views, "revoke_aws_dynamic_secret_lease", revoke)

    def call(method, request, lease):
        lease_model.objects.get.return_value = lease
        view = views.DynamicSecretLeaseView()
        view.request = request
        return getattr(view, method)(request)

    return SimpleNamespace(call=call, permission=permission, renew=renew, revoke=revoke)


@pytest.mark.parametrize("method", ["put", "delete"])
def test_user_token_acts_on_own_lease_without_lease_permission(rest, method):
    response = rest.call(method, _request("User", MEMBER), _lease(MEMBER))

    assert response.status_code == 200
    rest.permission.assert_not_called()


def test_user_token_renew_is_attributed_to_the_member(rest):
    rest.call("put", _request("User", MEMBER), _lease(MEMBER))

    assert rest.renew.call_args.kwargs["organisation_member"] is MEMBER
    assert rest.renew.call_args.kwargs["service_account"] is None


@pytest.mark.parametrize("method", ["put", "delete"])
def test_user_token_needs_permission_for_other_member_lease(rest, method):
    with pytest.raises(PermissionDenied):
        rest.call(method, _request("User", MEMBER), _lease(OTHER_MEMBER))

    rest.renew.assert_not_called()
    rest.revoke.assert_not_called()


def test_user_token_does_not_hold_service_account_lease(rest):
    with pytest.raises(PermissionDenied):
        rest.call(
            "delete", _request("User", MEMBER), _lease(service_account=SERVICE_ACCOUNT)
        )

    rest.revoke.assert_not_called()


def test_user_token_does_not_hold_service_account_lease_with_same_id(rest):
    same_id_account = ServiceAccount(id=MEMBER.id)

    with pytest.raises(PermissionDenied):
        rest.call(
            "delete", _request("User", MEMBER), _lease(service_account=same_id_account)
        )

    rest.revoke.assert_not_called()


@pytest.mark.parametrize("method", ["put", "delete"])
def test_service_account_acts_on_own_lease(rest, method):
    request = _request("ServiceAccount", service_account=SERVICE_ACCOUNT)

    response = rest.call(method, request, _lease(service_account=SERVICE_ACCOUNT))

    assert response.status_code == 200
    rest.permission.assert_not_called()


def test_service_account_does_not_hold_member_lease_with_same_id(rest):
    same_id_member = OrganisationMember(
        id=SERVICE_ACCOUNT.id, user=CustomUser(userId="user-3")
    )
    request = _request("ServiceAccount", service_account=SERVICE_ACCOUNT)

    with pytest.raises(PermissionDenied):
        rest.call("delete", request, _lease(same_id_member))

    rest.revoke.assert_not_called()


def test_service_token_never_matches_a_holder(rest):
    with pytest.raises(PermissionDenied):
        rest.call("put", _request("Service"), _lease(service_account=SERVICE_ACCOUNT))

    rest.renew.assert_not_called()


def test_non_holder_permission_is_checked_in_app_context(rest):
    rest.permission.return_value = True

    rest.call("put", _request("User", MEMBER), _lease(OTHER_MEMBER))

    rest.permission.assert_called_once_with(
        MEMBER.user, "update", "DynamicSecretLeases", ORG, True, False, app=APP
    )


def _info(user_id="user-1"):
    return SimpleNamespace(context=SimpleNamespace(user=CustomUser(userId=user_id)))


@pytest.fixture
def gql(monkeypatch):
    active_member = SimpleNamespace(id="member-1")
    removed_member = SimpleNamespace(id="member-removed")
    state = SimpleNamespace(active_member=active_member, lease=_lease(active_member))

    lease_model = MagicMock()
    lease_model.objects.get.side_effect = lambda **kw: state.lease
    lease_model.objects.filter.side_effect = lambda **kw: SimpleNamespace(
        first=lambda: state.lease
    )
    monkeypatch.setattr(mutations, "DynamicSecretLease", lease_model)

    # Re-invited users keep their soft-deleted membership rows.
    def member_get(**kw):
        if "deleted_at" not in kw:
            raise OrganisationMember.MultipleObjectsReturned
        if state.active_member is None:
            raise OrganisationMember.DoesNotExist
        return state.active_member

    def member_filter(**kw):
        found = state.active_member if "deleted_at" in kw else removed_member
        return SimpleNamespace(first=lambda: found)

    member_model = MagicMock()
    member_model.DoesNotExist = OrganisationMember.DoesNotExist
    member_model.objects.get.side_effect = member_get
    member_model.objects.filter.side_effect = member_filter
    monkeypatch.setattr(mutations, "OrganisationMember", member_model)

    permission = MagicMock(return_value=False)
    monkeypatch.setattr(mutations, "user_has_permission", permission)
    monkeypatch.setattr(mutations, "user_is_org_member", MagicMock(return_value=True))
    monkeypatch.setattr(
        mutations, "user_can_access_environment", MagicMock(return_value=True)
    )
    renew = MagicMock(return_value=state.lease)
    monkeypatch.setattr(mutations, "renew_dynamic_secret_lease", renew)
    revoke = MagicMock()
    monkeypatch.setattr(mutations, "revoke_aws_dynamic_secret_lease", revoke)

    state.permission, state.renew, state.revoke = permission, renew, revoke
    return state


def test_renew_mutation_holder_uses_active_membership(gql):
    mutations.RenewLeaseMutation.mutate(None, _info(), lease_id="lease-1")

    assert gql.renew.call_args.kwargs["organisation_member"] is gql.active_member
    gql.permission.assert_not_called()


def test_revoke_mutation_holder_uses_active_membership(gql):
    mutations.RevokeLeaseMutation.mutate(None, _info(), lease_id="lease-1")

    assert gql.revoke.call_args.kwargs["organisation_member"] is gql.active_member
    gql.permission.assert_not_called()


def test_renew_mutation_rejects_caller_outside_lease_org(gql):
    gql.active_member = None

    with pytest.raises(GraphQLError, match="^Lease not found$"):
        mutations.RenewLeaseMutation.mutate(None, _info(), lease_id="lease-1")

    gql.renew.assert_not_called()


def test_revoke_mutation_non_holder_needs_permission(gql):
    gql.lease = _lease(SimpleNamespace(id="member-2"))

    with pytest.raises(GraphQLError, match="wasn't created by you"):
        mutations.RevokeLeaseMutation.mutate(None, _info(), lease_id="lease-1")

    gql.revoke.assert_not_called()


@pytest.mark.parametrize(
    ("mutation", "action"),
    [
        (mutations.RenewLeaseMutation, "renew"),
        (mutations.RevokeLeaseMutation, "revoke"),
    ],
)
def test_unknown_lease_gets_the_same_error_as_a_foreign_one(gql, mutation, action):
    gql.lease = None
    mutations.DynamicSecretLease.objects.get.side_effect = (
        DynamicSecretLease.DoesNotExist
    )

    with pytest.raises(GraphQLError, match="^Lease not found$"):
        mutation.mutate(None, _info(), lease_id="missing")

    getattr(gql, action).assert_not_called()


def test_renew_mutation_non_holder_needs_update_permission(gql):
    gql.lease = _lease(SimpleNamespace(id="member-2"))
    info = _info()

    with pytest.raises(GraphQLError, match="wasn't created by you"):
        mutations.RenewLeaseMutation.mutate(None, info, lease_id="lease-1")

    gql.renew.assert_not_called()
    gql.permission.assert_called_once_with(
        info.context.user, "update", "DynamicSecretLeases", ORG, True, app=APP
    )


def test_revoke_mutation_non_holder_checks_delete_permission(gql):
    gql.lease = _lease(SimpleNamespace(id="member-2"))
    gql.permission.return_value = True
    info = _info()

    mutations.RevokeLeaseMutation.mutate(None, info, lease_id="lease-1")

    gql.permission.assert_called_once_with(
        info.context.user, "delete", "DynamicSecretLeases", ORG, True, app=APP
    )


@pytest.mark.parametrize(
    ("mutation", "action"),
    [
        (mutations.RenewLeaseMutation, "renew"),
        (mutations.RevokeLeaseMutation, "revoke"),
    ],
)
def test_holder_without_environment_access_is_rejected(
    gql, monkeypatch, mutation, action
):
    monkeypatch.setattr(
        mutations, "user_can_access_environment", MagicMock(return_value=False)
    )

    with pytest.raises(GraphQLError, match="access to this environment"):
        mutation.mutate(None, _info(), lease_id="lease-1")

    getattr(gql, action).assert_not_called()
