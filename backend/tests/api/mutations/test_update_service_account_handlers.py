"""Unit tests for UpdateServiceAccountHandlersMutation (F4 of QA batch 1).

A non-global user with org-level `ServiceAccounts.update` could
previously pass team-owned SA ids in `handlers` — the bulk delete at
the top of the mutation wiped handlers before any per-SA visibility
check ran. The fix pre-flights `_check_sa_permission` over every
submitted SA before any deletion happens, so a single inaccessible SA
in the payload aborts the whole mutation with no side effects.
"""

import pytest
from unittest.mock import MagicMock, patch

from graphql import GraphQLError


def _make_info(user):
    info = MagicMock()
    info.context.user = user
    return info


def _make_handler_input(sa_id, member_id="m1"):
    h = MagicMock()
    h.service_account_id = sa_id
    h.member_id = member_id
    h.wrapped_keyring = "wk"
    h.wrapped_recovery = "wr"
    return h


@patch("backend.graphene.mutations.service_accounts.ServiceAccountHandler")
@patch("backend.graphene.mutations.service_accounts.ServiceAccount")
@patch("backend.graphene.mutations.service_accounts._check_sa_permission")
@patch("backend.graphene.mutations.service_accounts.user_has_permission", return_value=True)
@patch("backend.graphene.mutations.service_accounts.user_is_org_member", return_value=True)
@patch("backend.graphene.mutations.service_accounts.Organisation")
def test_pre_flight_check_blocks_inaccessible_team_sa(
    MockOrg,
    _mock_org_member,
    _mock_perm,
    mock_check_sa,
    MockSA,
    MockHandler,
):
    """An inaccessible SA in the payload aborts the whole mutation
    before any handler row is touched."""
    from backend.graphene.mutations.service_accounts import (
        UpdateServiceAccountHandlersMutation,
    )

    org = MagicMock()
    MockOrg.objects.get.return_value = org

    accessible_sa = MagicMock(id="sa-ok")
    inaccessible_sa = MagicMock(id="sa-blocked")
    MockSA.objects.filter.return_value.select_related.return_value = [
        accessible_sa, inaccessible_sa,
    ]

    # _check_sa_permission raises on the second SA (the team-owned one
    # the caller can't access).
    mock_check_sa.side_effect = [None, GraphQLError("denied")]

    user = MagicMock()
    user.userId = "u1"

    with pytest.raises(GraphQLError):
        UpdateServiceAccountHandlersMutation.mutate(
            None,
            _make_info(user),
            organisation_id="org-1",
            handlers=[
                _make_handler_input("sa-ok"),
                _make_handler_input("sa-blocked"),
            ],
        )

    # No bulk delete and no handler creation should have happened.
    MockHandler.objects.filter.return_value.delete.assert_not_called()
    MockHandler.objects.create.assert_not_called()


@patch("backend.graphene.mutations.service_accounts.ServiceAccountHandler")
@patch("backend.graphene.mutations.service_accounts.ServiceAccount")
@patch("backend.graphene.mutations.service_accounts._check_sa_permission", return_value=None)
@patch("backend.graphene.mutations.service_accounts.user_has_permission", return_value=True)
@patch("backend.graphene.mutations.service_accounts.user_is_org_member", return_value=True)
@patch("backend.graphene.mutations.service_accounts.Organisation")
def test_pre_flight_passes_when_all_sas_accessible(
    MockOrg,
    _mock_org_member,
    _mock_perm,
    _mock_check_sa,
    MockSA,
    MockHandler,
):
    """Regression: when every SA in the payload passes the per-SA
    permission check, the mutation proceeds to delete handlers and
    create the new ones."""
    from backend.graphene.mutations.service_accounts import (
        UpdateServiceAccountHandlersMutation,
    )

    org = MagicMock()
    MockOrg.objects.get.return_value = org

    sa = MagicMock(id="sa-1")
    MockSA.objects.filter.return_value.select_related.return_value = [sa]
    # `ServiceAccount.objects.get(...)` for the per-handler create loop
    MockSA.objects.get.return_value = sa
    # No existing handler for this (sa, member) pair.
    MockHandler.objects.filter.return_value.exists.return_value = False

    user = MagicMock()
    user.userId = "u1"

    UpdateServiceAccountHandlersMutation.mutate(
        None,
        _make_info(user),
        organisation_id="org-1",
        handlers=[_make_handler_input("sa-1")],
    )

    # Bulk delete fired; new handler created.
    MockHandler.objects.filter.return_value.delete.assert_called()
    MockHandler.objects.create.assert_called_once()
