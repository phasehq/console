"""DeleteOrganisationMemberMutation: SCIM-provisioned members are now
deletable from the console. For SCIM-linked OMs the mutation must route
through deactivate_scim_user (wipes crypto, revokes team keys) AND
hard-delete the SCIMUser row — otherwise the identity-bricking guard in
provision_scim_user would block re-provisioning, and PATCH/GET/PUT/DELETE
on the orphan would 500 instead of cleanly 404'ing.
"""

from unittest.mock import MagicMock, patch

import pytest


def _info(user):
    info = MagicMock()
    info.context.user = user
    return info


@patch("backend.graphene.mutations.organisation.settings")
@patch("ee.authentication.scim.utils.deactivate_scim_user")
@patch("backend.graphene.mutations.organisation.OrganisationMember")
@patch("backend.graphene.mutations.organisation.user_has_permission", return_value=True)
def test_non_scim_member_soft_deletes_om(
    _mock_perm, MockOM, mock_deactivate, mock_settings
):
    """Non-SCIM members keep the existing soft-delete behavior."""
    from backend.graphene.mutations.organisation import DeleteOrganisationMemberMutation

    target = MagicMock()
    target.user = MagicMock()
    target.scimuser_set.all.return_value = []
    MockOM.objects.get.return_value = target

    mock_settings.APP_HOST = "self"

    DeleteOrganisationMemberMutation.mutate(
        None, _info(MagicMock()), member_id="m1"
    )

    target.delete.assert_called_once()
    mock_deactivate.assert_not_called()


@patch("backend.graphene.mutations.organisation.settings")
@patch("ee.authentication.scim.utils.deactivate_scim_user")
@patch("backend.graphene.mutations.organisation.OrganisationMember")
@patch("backend.graphene.mutations.organisation.user_has_permission", return_value=True)
def test_scim_member_routes_through_deactivate_and_hard_deletes_scim_user(
    _mock_perm, MockOM, mock_deactivate, mock_settings
):
    """SCIM-linked OMs go through deactivate_scim_user (crypto wipe,
    team-key revoke, OM soft-delete) and then the SCIMUser is hard-deleted
    so re-provisioning isn't blocked by the identity-bricking guard."""
    from backend.graphene.mutations.organisation import DeleteOrganisationMemberMutation

    scim_user = MagicMock()
    target = MagicMock()
    target.user = MagicMock()
    target.scimuser_set.all.return_value = [scim_user]
    MockOM.objects.get.return_value = target

    mock_settings.APP_HOST = "self"

    DeleteOrganisationMemberMutation.mutate(
        None, _info(MagicMock()), member_id="m1"
    )

    mock_deactivate.assert_called_once_with(scim_user)
    scim_user.delete.assert_called_once()
    # Don't double-soft-delete the OM — deactivate_scim_user already does.
    target.delete.assert_not_called()


@patch("backend.graphene.mutations.organisation.settings")
@patch("ee.authentication.scim.utils.deactivate_scim_user")
@patch("backend.graphene.mutations.organisation.OrganisationMember")
@patch("backend.graphene.mutations.organisation.user_has_permission", return_value=True)
def test_caller_cannot_remove_themselves(
    _mock_perm, MockOM, mock_deactivate, mock_settings
):
    from backend.graphene.mutations.organisation import DeleteOrganisationMemberMutation
    from graphql import GraphQLError

    caller = MagicMock()
    target = MagicMock()
    target.user = caller
    MockOM.objects.get.return_value = target

    with pytest.raises(GraphQLError, match="can't remove yourself"):
        DeleteOrganisationMemberMutation.mutate(
            None, _info(caller), member_id="m1"
        )

    mock_deactivate.assert_not_called()
    target.delete.assert_not_called()


@patch("backend.graphene.mutations.organisation.settings")
@patch("ee.authentication.scim.utils.deactivate_scim_user")
@patch("backend.graphene.mutations.organisation.OrganisationMember")
@patch("backend.graphene.mutations.organisation.user_has_permission", return_value=False)
def test_rbac_check_blocks_unauthorized_caller(
    _mock_perm, MockOM, mock_deactivate, mock_settings
):
    """Members.delete permission is required regardless of SCIM status."""
    from backend.graphene.mutations.organisation import DeleteOrganisationMemberMutation
    from graphql import GraphQLError

    target = MagicMock()
    target.user = MagicMock()
    target.scimuser_set.all.return_value = [MagicMock()]
    MockOM.objects.get.return_value = target

    with pytest.raises(GraphQLError, match="permission"):
        DeleteOrganisationMemberMutation.mutate(
            None, _info(MagicMock()), member_id="m1"
        )

    mock_deactivate.assert_not_called()


@patch("backend.graphene.mutations.organisation.settings")
@patch("ee.authentication.scim.utils.deactivate_scim_user")
@patch("backend.graphene.mutations.organisation.OrganisationMember")
@patch("backend.graphene.mutations.organisation.user_has_permission", return_value=True)
def test_scim_owner_delete_surfaces_forbidden_error(
    _mock_perm, MockOM, mock_deactivate, mock_settings
):
    """The console delete-member flow uses deactivate_scim_user for SCIM
    members; if the OM is an Owner, that helper raises and the mutation
    must surface a meaningful GraphQLError rather than 500."""
    from backend.graphene.mutations.organisation import DeleteOrganisationMemberMutation
    from ee.authentication.scim.exceptions import SCIMDeactivationForbidden
    from graphql import GraphQLError

    scim_user = MagicMock()
    target = MagicMock()
    target.user = MagicMock()
    target.scimuser_set.all.return_value = [scim_user]
    MockOM.objects.get.return_value = target

    mock_deactivate.side_effect = SCIMDeactivationForbidden(
        "Cannot deactivate 'alice@example.com' — they are an organisation owner."
    )

    with pytest.raises(GraphQLError, match="organisation owner"):
        DeleteOrganisationMemberMutation.mutate(
            None, _info(MagicMock()), member_id="m1"
        )

    # SCIMUser must not be hard-deleted when the deactivate step failed.
    scim_user.delete.assert_not_called()
