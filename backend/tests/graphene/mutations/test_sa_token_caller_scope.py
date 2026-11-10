"""Server-side service-account token minting issues a bearer that inherits
the SA's own access, so a non-global caller must not target an org-level SA
(only global-access roles, or team members of a team-owned SA). Mirrors the
REST `_caller_can_manage_sa_tokens` gate. The client-side mint stays
signature-gated and is unaffected.

The same rule covers revoking a token and changing the external identities
that can obtain one: attaching or detaching an identity, and editing or
deleting an identity that is attached to a service account.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from graphql import GraphQLError

PERM = "api.utils.access.permissions"
MUTATIONS = "backend.graphene.mutations.service_accounts"
ACCESS = "backend.graphene.mutations.access"
NO_SA_ACCESS = "access to this Service Account"


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


# ──────────────────────────────────────────────────────────────────────
# deleteServiceAccountToken
# ──────────────────────────────────────────────────────────────────────


def _delete_token(token, is_global):
    from backend.graphene.mutations.service_accounts import (
        DeleteServiceAccountTokenMutation,
    )

    with patch(f"{MUTATIONS}.ServiceAccountToken") as token_model, patch(
        f"{MUTATIONS}._check_sa_permission"
    ), patch(f"{MUTATIONS}.log_audit_event") as audit, patch(
        f"{MUTATIONS}.get_actor_info_from_graphql", return_value=("user", "m-1", {})
    ), patch(
        f"{MUTATIONS}.get_resolver_request_meta", return_value=("127.0.0.1", "pytest")
    ), patch(
        f"{PERM}.user_has_global_access", return_value=is_global
    ):
        token_model.objects.get.return_value = token
        token.audit = audit
        return DeleteServiceAccountTokenMutation.mutate(
            None, _info(), token_id="tok-1"
        )


def test_token_delete_blocks_non_global_caller_on_org_level_sa():
    token = MagicMock(service_account=_sa(team=None))

    with pytest.raises(GraphQLError, match=NO_SA_ACCESS):
        _delete_token(token, is_global=False)

    token.delete.assert_not_called()
    token.audit.assert_not_called()


def test_token_delete_allows_global_caller_on_org_level_sa():
    token = MagicMock(service_account=_sa(team=None))

    assert _delete_token(token, is_global=True).ok is True
    token.delete.assert_called_once()


def test_token_delete_allows_team_scoped_caller_on_team_owned_sa():
    token = MagicMock(service_account=_sa(team=MagicMock()))

    assert _delete_token(token, is_global=False).ok is True
    token.delete.assert_called_once()


# ──────────────────────────────────────────────────────────────────────
# updateServiceAccount: attaching and detaching identities
# ──────────────────────────────────────────────────────────────────────


def _update_sa(sa, identity_ids, attached, is_global):
    """Update with the role unchanged. Returns the identities passed to
    `identities.set`, or None when the set was left alone."""
    from backend.graphene.mutations.service_accounts import (
        UpdateServiceAccountMutation,
    )

    sa.role_id = "role-1"
    sa.identities.filter.return_value.values_list.return_value = attached
    with patch(f"{MUTATIONS}.ServiceAccount") as sa_model, patch(
        f"{MUTATIONS}.Role"
    ) as role_model, patch(f"{MUTATIONS}.Identity") as identity_model, patch(
        f"{MUTATIONS}._check_sa_permission"
    ), patch(
        f"{MUTATIONS}.role_has_global_access", return_value=False
    ), patch(
        f"{PERM}.user_has_global_access", return_value=is_global
    ) as global_access:
        sa_model.objects.get.return_value = sa
        role_model.objects.get.return_value = SimpleNamespace(
            id="role-1", name="Service"
        )
        identity_model.objects.filter.side_effect = lambda id__in, **_: [
            SimpleNamespace(id=identity_id) for identity_id in id__in
        ]
        kwargs = {} if identity_ids is None else {"identity_ids": identity_ids}
        UpdateServiceAccountMutation.mutate(
            None,
            _info(),
            service_account_id="sa-1",
            name="deployer",
            role_id="role-1",
            **kwargs,
        )
    sa.checked_global_access = global_access.called
    if not sa.identities.set.called:
        return None
    (identities,) = sa.identities.set.call_args.args
    return [identity.id for identity in identities]


@pytest.mark.parametrize(
    "identity_ids, attached",
    [
        (["id-new"], []),  # attach
        (["id-1", "id-new"], ["id-1"]),  # attach one more
        ([], ["id-1"]),  # detach
        (["id-other"], ["id-1"]),  # swap
    ],
)
def test_identity_change_blocks_non_global_caller_on_org_level_sa(
    identity_ids, attached
):
    sa = _sa(team=None)

    with pytest.raises(GraphQLError, match=NO_SA_ACCESS):
        _update_sa(sa, identity_ids, attached, is_global=False)

    sa.identities.set.assert_not_called()
    sa.save.assert_not_called()


def test_identity_change_allows_global_caller_on_org_level_sa():
    sa = _sa(team=None)

    updated = _update_sa(sa, ["id-1", "id-new"], ["id-1"], is_global=True)

    assert updated == ["id-1", "id-new"]
    sa.save.assert_called_once()


def test_identity_change_allows_team_scoped_caller_on_team_owned_sa():
    sa = _sa(team=MagicMock())

    assert _update_sa(sa, ["id-new"], [], is_global=False) == ["id-new"]


def test_update_without_identity_ids_is_not_gated():
    """Renaming or changing the role does not touch identities."""
    sa = _sa(team=None)

    assert _update_sa(sa, None, ["id-1"], is_global=False) is None
    assert sa.checked_global_access is False
    sa.save.assert_called_once()


def test_update_with_the_same_identities_is_not_gated():
    sa = _sa(team=None)

    updated = _update_sa(sa, ["id-2", "id-1"], ["id-1", "id-2"], is_global=False)

    assert updated == ["id-2", "id-1"]
    assert sa.checked_global_access is False


# ──────────────────────────────────────────────────────────────────────
# updateIdentity / deleteIdentity: identities attached to service accounts
# ──────────────────────────────────────────────────────────────────────

ATTACHED_ELSEWHERE = "attached to a Service Account you don't have access to"
TRUSTED_PRINCIPAL = "arn:aws:iam::111111111111:role/ci"
OTHER_PRINCIPAL = "arn:aws:iam::999999999999:user/other"


def _identity(attached_to):
    identity = MagicMock()
    identity.provider = "aws_iam"
    identity.config = {"trustedPrincipals": [TRUSTED_PRINCIPAL]}
    identity.default_ttl_seconds, identity.max_ttl_seconds = 900, 3600
    identity.deleted_at = None
    identity.service_accounts.filter.return_value = attached_to
    return identity


def _change_identity(mutation_name, identity, is_global, sa_permission=None):
    import backend.graphene.mutations.access as access

    with patch(f"{ACCESS}.Identity") as identity_model, patch(
        f"{ACCESS}.user_has_permission", return_value=True
    ), patch(f"{PERM}._check_sa_permission", side_effect=sa_permission), patch(
        f"{PERM}.user_has_global_access", return_value=is_global
    ):
        identity_model.objects.get.return_value = identity
        if mutation_name == "update":
            return access.UpdateIdentityMutation.mutate(
                None, _info(), id="identity-1", trusted_principals=OTHER_PRINCIPAL
            )
        return access.DeleteIdentityMutation.mutate(None, _info(), id="identity-1")


@pytest.mark.parametrize("mutation_name", ["update", "delete"])
def test_identity_on_org_level_sa_blocks_non_global_caller(mutation_name):
    identity = _identity(attached_to=[_sa(team=None)])

    with pytest.raises(GraphQLError, match=ATTACHED_ELSEWHERE):
        _change_identity(mutation_name, identity, is_global=False)

    identity.save.assert_not_called()
    assert identity.config == {"trustedPrincipals": [TRUSTED_PRINCIPAL]}
    assert identity.deleted_at is None


@pytest.mark.parametrize("mutation_name", ["update", "delete"])
def test_identity_on_sa_the_caller_cannot_update_is_blocked(mutation_name):
    """e.g. a team-owned service account of a team the caller is not in."""
    identity = _identity(attached_to=[_sa(team=MagicMock())])

    with pytest.raises(GraphQLError, match=ATTACHED_ELSEWHERE):
        _change_identity(
            mutation_name,
            identity,
            is_global=False,
            sa_permission=GraphQLError("You don't have access to this Service Account"),
        )

    identity.save.assert_not_called()


def test_one_unreachable_sa_blocks_the_identity_change():
    identity = _identity(attached_to=[_sa(team=MagicMock()), _sa(team=None)])

    with pytest.raises(GraphQLError, match=ATTACHED_ELSEWHERE):
        _change_identity("update", identity, is_global=False)

    identity.save.assert_not_called()


@pytest.mark.parametrize("mutation_name", ["update", "delete"])
def test_unattached_identity_is_not_gated(mutation_name):
    identity = _identity(attached_to=[])

    _change_identity(mutation_name, identity, is_global=False)

    identity.save.assert_called_once()


@pytest.mark.parametrize("mutation_name", ["update", "delete"])
def test_identity_on_team_owned_sa_allows_team_scoped_caller(mutation_name):
    identity = _identity(attached_to=[_sa(team=MagicMock())])

    _change_identity(mutation_name, identity, is_global=False)

    identity.save.assert_called_once()


def test_identity_on_org_level_sa_allows_global_caller():
    identity = _identity(attached_to=[_sa(team=None)])

    _change_identity("update", identity, is_global=True)

    assert identity.config["trustedPrincipals"] == [OTHER_PRINCIPAL]
    identity.save.assert_called_once()


def test_identity_check_only_looks_at_live_service_accounts():
    identity = _identity(attached_to=[])

    _change_identity("update", identity, is_global=False)

    identity.service_accounts.filter.assert_called_once_with(deleted_at=None)
