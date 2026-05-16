"""Pending-member role-change guard for UpdateOrganisationMemberRole.

A SCIM-provisioned user before first login has no identity_key. If
they're given a role that enrols them as a service account handler
(global-access or ServiceAccountTokens.create), the next SA creation
tries to wrap a keyring for that empty identity_key and breaks. The
mutation must reject those role changes until the user completes their
key ceremony.
"""

from unittest.mock import MagicMock, patch

import pytest


def _info(user):
    info = MagicMock()
    info.context.user = user
    return info


def _role(name, permissions=None, *, is_default=True, global_access=False):
    role = MagicMock()
    role.name = name
    role.is_default = is_default
    role.permissions = permissions or {"global_access": global_access}
    return role


@patch("backend.graphene.mutations.organisation.Role")
@patch("backend.graphene.mutations.organisation.OrganisationMember")
@patch("backend.graphene.mutations.organisation.user_has_permission", return_value=True)
def test_pending_member_blocked_from_global_access_role(
    _mock_perm, MockOM, MockRole
):
    from backend.graphene.mutations.organisation import UpdateOrganisationMemberRole
    from graphql import GraphQLError

    pending = MagicMock(identity_key="", role=_role("Developer"))
    pending.user = MagicMock()
    caller_membership = MagicMock(role=_role("Owner"))
    MockOM.objects.get.side_effect = [pending, caller_membership]

    admin_role = _role("Admin")
    MockRole.objects.get.return_value = admin_role

    with patch(
        "backend.graphene.mutations.organisation.role_has_global_access",
        side_effect=lambda r: r is admin_role,
    ), patch(
        "backend.graphene.mutations.organisation.role_has_permission",
        return_value=False,
    ):
        with pytest.raises(GraphQLError, match="hasn't completed account setup"):
            UpdateOrganisationMemberRole.mutate(
                None, _info(MagicMock()), member_id="m1", role_id="r1"
            )

    pending.save.assert_not_called()


@patch("backend.graphene.mutations.organisation.Role")
@patch("backend.graphene.mutations.organisation.OrganisationMember")
@patch("backend.graphene.mutations.organisation.user_has_permission", return_value=True)
def test_pending_member_blocked_from_sa_token_create_role(
    _mock_perm, MockOM, MockRole
):
    from backend.graphene.mutations.organisation import UpdateOrganisationMemberRole
    from graphql import GraphQLError

    pending = MagicMock(identity_key="", role=_role("Developer"))
    pending.user = MagicMock()
    caller_membership = MagicMock(role=_role("Owner"))
    MockOM.objects.get.side_effect = [pending, caller_membership]

    manager_role = _role("Manager")
    MockRole.objects.get.return_value = manager_role

    with patch(
        "backend.graphene.mutations.organisation.role_has_global_access",
        return_value=False,
    ), patch(
        "backend.graphene.mutations.organisation.role_has_permission",
        side_effect=lambda r, action, resource: (
            r is manager_role
            and action == "create"
            and resource == "ServiceAccountTokens"
        ),
    ):
        with pytest.raises(GraphQLError, match="hasn't completed account setup"):
            UpdateOrganisationMemberRole.mutate(
                None, _info(MagicMock()), member_id="m1", role_id="r1"
            )

    pending.save.assert_not_called()


@patch("backend.graphene.mutations.organisation.Role")
@patch("backend.graphene.mutations.organisation.OrganisationMember")
@patch("backend.graphene.mutations.organisation.user_has_permission", return_value=True)
def test_pending_member_can_take_safe_role(_mock_perm, MockOM, MockRole):
    """Regression: pending members can still be assigned a safe role
    (e.g. Developer → custom-no-SA-tokens) before they log in."""
    from backend.graphene.mutations.organisation import UpdateOrganisationMemberRole

    pending = MagicMock(identity_key="", role=_role("Developer"))
    pending.user = MagicMock()
    caller_membership = MagicMock(role=_role("Owner"))
    MockOM.objects.get.side_effect = [pending, caller_membership]

    safe_role = _role("Custom")
    MockRole.objects.get.return_value = safe_role

    with patch(
        "backend.graphene.mutations.organisation.role_has_global_access",
        return_value=False,
    ), patch(
        "backend.graphene.mutations.organisation.role_has_permission",
        return_value=False,
    ):
        UpdateOrganisationMemberRole.mutate(
            None, _info(MagicMock()), member_id="m1", role_id="r1"
        )

    assert pending.role is safe_role
    pending.save.assert_called_once()


@patch("backend.graphene.mutations.organisation.Role")
@patch("backend.graphene.mutations.organisation.OrganisationMember")
@patch("backend.graphene.mutations.organisation.user_has_permission", return_value=True)
def test_active_member_can_take_global_access_role(
    _mock_perm, MockOM, MockRole
):
    """Members who've completed their key ceremony can be promoted to
    global-access roles like normal — the guard only fires on empty
    identity_key."""
    from backend.graphene.mutations.organisation import UpdateOrganisationMemberRole

    active = MagicMock(identity_key="not-empty", role=_role("Developer"))
    active.user = MagicMock()
    caller_membership = MagicMock(role=_role("Owner"))
    MockOM.objects.get.side_effect = [active, caller_membership]

    admin_role = _role("Admin")
    MockRole.objects.get.return_value = admin_role

    with patch(
        "backend.graphene.mutations.organisation.role_has_global_access",
        side_effect=lambda r: r is admin_role,
    ), patch(
        "backend.graphene.mutations.organisation.role_has_permission",
        return_value=False,
    ):
        UpdateOrganisationMemberRole.mutate(
            None, _info(MagicMock()), member_id="m1", role_id="r1"
        )

    assert active.role is admin_role
    active.save.assert_called_once()
