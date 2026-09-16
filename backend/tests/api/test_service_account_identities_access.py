"""External Identity access checks on the Service Account detail path.

A member who can reach a Service Account (org-level `ServiceAccounts.read`
or team-based access) but has no `ExternalIdentities` permission — the
default Developer role, or any custom role that leaves the resource empty
— was still served the account's linked identities, and the console fired
an ungated `identities` query at them, producing a permission error toast
on page load.

The resolver now withholds the rows silently (an exception here would
fail the whole Service Account query), and the update mutation refuses to
bind identities without ExternalIdentities access — the one point where
the user genuinely has to be blocked.
"""

from unittest.mock import MagicMock, patch

import pytest
from graphql import GraphQLError


_MUTATIONS = "backend.graphene.mutations.service_accounts"


def _info(user):
    info = MagicMock()
    info.context.user = user
    return info


def _make_sa():
    sa = MagicMock()
    sa.organisation = MagicMock()
    return sa


@patch("backend.graphene.types.user_has_permission", return_value=False)
def test_resolve_identities_returns_empty_without_permission(mock_perm):
    """No ExternalIdentities.read → no identity rows, and no error, so
    the rest of the Service Account query still resolves."""
    from backend.graphene.types import ServiceAccountType

    sa = _make_sa()
    user = MagicMock()

    result = ServiceAccountType.resolve_identities(sa, _info(user))

    assert result == []
    sa.identities.filter.assert_not_called()


@patch("backend.graphene.types.user_has_permission", return_value=True)
def test_resolve_identities_returns_rows_when_permitted(mock_perm):
    from backend.graphene.types import ServiceAccountType

    sa = _make_sa()
    user = MagicMock()
    expected_qs = MagicMock()
    sa.identities.filter.return_value = expected_qs

    result = ServiceAccountType.resolve_identities(sa, _info(user))

    assert result is expected_qs
    sa.identities.filter.assert_called_once_with(deleted_at=None)
    # The gate must match the org-level `identities` query's gate.
    args, _kwargs = mock_perm.call_args
    assert args[0] is user
    assert args[1] == "read"
    assert args[2] == "ExternalIdentities"
    assert args[3] is sa.organisation


def _run_update(identity_ids, has_identity_permission):
    from backend.graphene.mutations.service_accounts import (
        UpdateServiceAccountMutation,
    )

    sa = _make_sa()
    user = MagicMock()

    with patch(f"{_MUTATIONS}.ServiceAccount") as mock_sa_cls, patch(
        f"{_MUTATIONS}.Role"
    ) as mock_role_cls, patch(f"{_MUTATIONS}._check_sa_permission"), patch(
        f"{_MUTATIONS}.role_has_global_access", return_value=False
    ), patch(
        f"{_MUTATIONS}.user_has_permission", return_value=has_identity_permission
    ) as mock_perm, patch(
        f"{_MUTATIONS}.Identity"
    ) as mock_identity_cls:
        mock_sa_cls.objects.get.return_value = sa
        mock_role_cls.objects.get.return_value = MagicMock(name="role")

        try:
            UpdateServiceAccountMutation.mutate(
                None,
                _info(user),
                service_account_id="sa-1",
                name="account",
                role_id="role-1",
                identity_ids=identity_ids,
            )
            raised = None
        except GraphQLError as e:
            raised = e

        return sa, mock_perm, mock_identity_cls, raised


def test_update_rejects_identity_binding_without_permission():
    """The one place blocking is warranted — and nothing is persisted."""
    sa, _perm, mock_identity_cls, raised = _run_update(
        identity_ids=["idn-1"], has_identity_permission=False
    )

    assert raised is not None
    assert "External Identities" in str(raised)
    mock_identity_cls.objects.filter.assert_not_called()
    sa.identities.set.assert_not_called()
    sa.save.assert_not_called()


def test_update_binds_identities_when_permitted():
    sa, mock_perm, mock_identity_cls, raised = _run_update(
        identity_ids=["idn-1"], has_identity_permission=True
    )

    assert raised is None
    sa.identities.set.assert_called_once_with(
        mock_identity_cls.objects.filter.return_value
    )
    sa.save.assert_called_once()
    args, _kwargs = mock_perm.call_args
    assert args[1] == "read"
    assert args[2] == "ExternalIdentities"


def test_update_without_identity_ids_needs_no_identity_permission():
    """Renaming or re-roling an account must not start demanding
    ExternalIdentities access."""
    sa, mock_perm, _identity_cls, raised = _run_update(
        identity_ids=None, has_identity_permission=False
    )

    assert raised is None
    mock_perm.assert_not_called()
    sa.identities.set.assert_not_called()
    sa.save.assert_called_once()
