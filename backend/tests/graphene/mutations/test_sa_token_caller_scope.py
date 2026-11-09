"""Server-side service-account token minting issues a bearer that inherits
the SA's own access, so a non-global caller must not target an org-level SA
(only global-access roles, or team members of a team-owned SA). Mirrors the
REST `_caller_can_manage_sa_tokens` gate. The client-side mint stays
signature-gated and is unaffected.
"""

from unittest.mock import MagicMock, patch

import pytest
from graphql import GraphQLError

PERM = "api.utils.access.permissions"
MUTATIONS = "backend.graphene.mutations.service_accounts"


def _sa(team=None):
    sa = MagicMock()
    sa.team = team
    sa.organisation = MagicMock()
    sa.name = "deployer"
    sa.server_wrapped_keyring = "wrapped"
    return sa


def _info():
    info = MagicMock()
    info.context.user = MagicMock()
    return info


# ──────────────────────────────────────────────────────────────────────
# _check_sa_token_management helper
# ──────────────────────────────────────────────────────────────────────


def test_helper_blocks_non_global_caller_on_org_level_sa():
    from api.utils.access.permissions import _check_sa_token_management

    with patch(f"{PERM}.user_has_global_access", return_value=False):
        with pytest.raises(GraphQLError, match="access to this Service Account"):
            _check_sa_token_management(MagicMock(), _sa(team=None))


def test_helper_allows_global_caller_on_org_level_sa():
    from api.utils.access.permissions import _check_sa_token_management

    with patch(f"{PERM}.user_has_global_access", return_value=True) as global_access:
        _check_sa_token_management(MagicMock(), _sa(team=None))
    global_access.assert_called_once()


def test_helper_allows_any_caller_on_team_owned_sa():
    """Team-owned SAs are scoped by _check_sa_permission; the token gate is a
    no-op for them, so it must not consult global access."""
    from api.utils.access.permissions import _check_sa_token_management

    with patch(f"{PERM}.user_has_global_access", return_value=False) as global_access:
        _check_sa_token_management(MagicMock(), _sa(team=MagicMock()))
    global_access.assert_not_called()


# ──────────────────────────────────────────────────────────────────────
# CreateServerSideServiceAccountTokenMutation wiring
# ──────────────────────────────────────────────────────────────────────


def test_server_side_mint_blocks_non_global_caller_on_org_level_sa():
    """The gate must fire before the keyring is unwrapped, so no token is
    minted for the escalation path."""
    from backend.graphene.mutations.service_accounts import (
        CreateServerSideServiceAccountTokenMutation,
    )

    sa = _sa(team=None)
    with patch(f"{MUTATIONS}.ServiceAccount") as sa_model, patch(
        f"{MUTATIONS}.OrganisationMember"
    ), patch(f"{MUTATIONS}._check_sa_permission"), patch(
        f"{MUTATIONS}.unwrap_server_managed_sa_keyring"
    ) as unwrap, patch(
        f"{MUTATIONS}.ServiceAccountToken"
    ) as token_model, patch(
        f"{PERM}.user_has_global_access", return_value=False
    ):
        sa_model.objects.get.return_value = sa

        with pytest.raises(GraphQLError, match="access to this Service Account"):
            CreateServerSideServiceAccountTokenMutation.mutate(
                None, _info(), service_account_id="sa-1", name="tok"
            )

    unwrap.assert_not_called()
    token_model.objects.create.assert_not_called()
