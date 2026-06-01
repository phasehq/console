"""Regression tests for RemoveAppMemberMutation global-access guard.

A member with a global-access role (Owner / Admin) has access to all
apps and environments by definition. Removing them from an app's
members list — which also revokes their per-env EnvironmentKey rows —
would violate that invariant, so the mutation must refuse for any
caller while the target holds a GA role.
"""

from unittest.mock import MagicMock, patch

import pytest
from graphql import GraphQLError


def _make_info(user):
    info = MagicMock()
    info.context.user = user
    return info


@patch("backend.graphene.mutations.app.role_has_global_access", return_value=True)
@patch("backend.graphene.mutations.app.OrganisationMember")
@patch("backend.graphene.mutations.app.App")
@patch("backend.graphene.mutations.app.user_can_access_app", return_value=True)
@patch("backend.graphene.mutations.app.user_has_permission", return_value=True)
def test_global_access_member_cannot_be_removed(
    _mock_perm, _mock_access, MockApp, MockOM, _mock_ga,
):
    from backend.graphene.mutations.app import RemoveAppMemberMutation
    from backend.graphene.types import MemberType

    app = MagicMock()
    MockApp.objects.get.return_value = app
    member = MagicMock()
    MockOM.objects.get.return_value = member
    app.members.all.return_value = [member]

    user = MagicMock()
    user.userId = "u1"

    with pytest.raises(GraphQLError, match="global access role"):
        RemoveAppMemberMutation.mutate(
            None, _make_info(user),
            member_id="m1", app_id="app-1",
            member_type=MemberType.USER,
        )

    # Must short-circuit before mutating M2M / revoking keys.
    app.members.remove.assert_not_called()


@patch("backend.graphene.mutations.app._revoke_individual_keys_for_app")
@patch("backend.graphene.mutations.app.log_audit_event")
@patch("backend.graphene.mutations.app.get_resolver_request_meta",
       return_value=("127.0.0.1", "pytest"))
@patch("backend.graphene.mutations.app.get_actor_info_from_graphql",
       return_value=("user", "actor-1", {}))
@patch("backend.graphene.mutations.app.get_member_display_name",
       return_value="Test Member")
@patch("backend.graphene.mutations.app.Environment")
@patch("backend.graphene.mutations.app.EnvironmentKey")
@patch("backend.graphene.mutations.app.role_has_global_access", return_value=False)
@patch("backend.graphene.mutations.app.OrganisationMember")
@patch("backend.graphene.mutations.app.App")
@patch("backend.graphene.mutations.app.user_can_access_app", return_value=True)
@patch("backend.graphene.mutations.app.user_has_permission", return_value=True)
def test_non_global_access_member_can_still_be_removed(
    _mock_perm, _mock_access, MockApp, MockOM, _mock_ga, MockEnvKey, MockEnv,
    _mock_display, _mock_actor, _mock_meta, _mock_audit, _mock_revoke,
):
    """Sanity check: the guard fires only on GA targets; a regular
    (Developer) member is still removable via this mutation."""
    from backend.graphene.mutations.app import RemoveAppMemberMutation
    from backend.graphene.types import MemberType

    app = MagicMock()
    MockApp.objects.get.return_value = app
    member = MagicMock()
    MockOM.objects.get.return_value = member
    app.members.all.return_value = [member]
    MockEnvKey.objects.filter.return_value.values_list.return_value = []
    MockEnv.objects.filter.return_value.values_list.return_value = []

    user = MagicMock()
    user.userId = "u1"

    RemoveAppMemberMutation.mutate(
        None, _make_info(user),
        member_id="m1", app_id="app-1",
        member_type=MemberType.USER,
    )

    app.members.remove.assert_called_once_with(member)
