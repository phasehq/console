"""resolve_service_account_handlers role eligibility.

Default roles store an empty permissions JSON in the DB; their permissions
live in the default_roles template. The old JSON-query filter silently
excluded every default role except Owner/Admin, so default-role Managers
were never provisioned as SA handlers. Eligibility must be resolved from
the template for default roles and from the stored JSON for custom roles.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest


_M = "backend.graphene.queries.service_accounts"


def _info(user=None):
    info = MagicMock()
    user = user or MagicMock()
    user.userId = "u1"
    info.context.user = user
    return info


def _default_role(name):
    return SimpleNamespace(id=f"role-{name.lower()}", name=name, is_default=True, permissions={})


def _custom_role(role_id, permissions):
    return SimpleNamespace(id=role_id, name=role_id, is_default=False, permissions=permissions)


def _resolve_with_roles(roles):
    """Run the resolver with mocked ORM; return the eligible role ids."""
    from backend.graphene.queries.service_accounts import (
        resolve_service_account_handlers,
    )

    with patch(f"{_M}.user_is_org_member", return_value=True), patch(
        f"{_M}.Role"
    ) as mock_role_cls, patch(f"{_M}.OrganisationMember") as mock_member_cls:
        mock_role_cls.objects.filter.return_value = roles
        resolve_service_account_handlers(None, _info(), org_id="org1")
        _args, kwargs = mock_member_cls.objects.filter.call_args
        return set(kwargs["role_id__in"])


def test_default_manager_role_is_handler_eligible():
    """The regression: Manager's permissions only exist in the template."""
    eligible = _resolve_with_roles([_default_role("Manager")])
    assert eligible == {"role-manager"}


def test_default_owner_and_admin_roles_are_handler_eligible():
    eligible = _resolve_with_roles([_default_role("Owner"), _default_role("Admin")])
    assert eligible == {"role-owner", "role-admin"}


def test_default_developer_role_is_not_handler_eligible():
    eligible = _resolve_with_roles([_default_role("Developer")])
    assert eligible == set()


def test_default_service_role_is_not_handler_eligible():
    """Machine-account role — excluded despite ServiceAccounts:["read"]."""
    eligible = _resolve_with_roles([_default_role("Service")])
    assert eligible == set()


def test_custom_role_with_service_account_permissions_is_eligible():
    role = _custom_role(
        "custom-sa",
        {"permissions": {"ServiceAccounts": ["read"]}, "global_access": False},
    )
    assert _resolve_with_roles([role]) == {"custom-sa"}


def test_custom_role_named_service_is_still_eligible():
    """Only the default Service role is excluded, not custom roles by name."""
    role = SimpleNamespace(
        id="custom-service",
        name="service",
        is_default=False,
        permissions={"permissions": {"ServiceAccounts": ["update"]}, "global_access": False},
    )
    assert _resolve_with_roles([role]) == {"custom-service"}


def test_custom_role_with_global_access_is_eligible():
    role = _custom_role(
        "custom-global",
        {"permissions": {"ServiceAccounts": []}, "global_access": True},
    )
    assert _resolve_with_roles([role]) == {"custom-global"}


def test_custom_role_with_empty_service_account_permissions_is_not_eligible():
    role = _custom_role(
        "custom-empty",
        {"permissions": {"ServiceAccounts": []}, "global_access": False},
    )
    assert _resolve_with_roles([role]) == set()


def test_members_without_identity_keys_are_excluded():
    """No public key to wrap SA keys to — must not be returned as handlers."""
    from django.db.models import Q
    from backend.graphene.queries.service_accounts import (
        resolve_service_account_handlers,
    )

    with patch(f"{_M}.user_is_org_member", return_value=True), patch(
        f"{_M}.Role"
    ) as mock_role_cls, patch(f"{_M}.OrganisationMember") as mock_member_cls:
        mock_role_cls.objects.filter.return_value = [_default_role("Owner")]
        resolve_service_account_handlers(None, _info(), org_id="org1")

        exclude_mock = mock_member_cls.objects.filter.return_value.exclude
        exclude_mock.assert_called_once()
        (exclude_arg,), _kwargs = exclude_mock.call_args
        assert str(exclude_arg) == str(Q(identity_key__isnull=True) | Q(identity_key=""))


def test_non_org_members_are_rejected():
    from graphql import GraphQLError
    from backend.graphene.queries.service_accounts import (
        resolve_service_account_handlers,
    )

    with patch(f"{_M}.user_is_org_member", return_value=False):
        with pytest.raises(GraphQLError):
            resolve_service_account_handlers(None, _info(), org_id="org1")
