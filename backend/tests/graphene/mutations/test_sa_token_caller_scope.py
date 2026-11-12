"""A service account token carries the account's own role and environment
access. A caller may create one, or attach an external identity that can obtain
one, only for an account that holds nothing the caller does not: every role the
account acts with is within the caller's grant ceiling, and every environment it
can access is one the caller can access. Callers with global access are exempt.

Removing access is not gated by this: deleting a token, detaching an identity
and deleting an identity only need the usual permission.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from graphql import GraphQLError

from api.utils.access import permissions
from api.utils.access.permissions import (
    _check_identity_change,
    _check_sa_token_ceiling,
    sa_ceiling_message,
    service_account_access_beyond,
)

PERM = "api.utils.access.permissions"
MUTATIONS = "backend.graphene.mutations.service_accounts"
ACCESS = "backend.graphene.mutations.access"
BEYOND = "beyond your own"


def _role(managed_key=None, permissions=None, name=None):
    """A default role by key, or a custom role from a permissions policy."""
    return SimpleNamespace(
        is_default=managed_key is not None,
        managed_key=managed_key,
        permissions=permissions or {},
        name=name or (managed_key or "custom").title(),
    )


MANAGER, DEVELOPER, SERVICE, OWNER = (
    _role("manager"),
    _role("developer"),
    _role("service"),
    _role("owner"),
)
SECRETS_READER = _role(
    permissions={"permissions": {}, "app_permissions": {"Secrets": ["read"]}},
    name="Secrets reader",
)


def _member(role, member_id="member-1"):
    return SimpleNamespace(id=member_id, role=role)


def _account(role=SERVICE, team=None, account_id="sa-1"):
    return SimpleNamespace(id=account_id, role=role, team=team, organisation="org")


@pytest.fixture
def world():
    """Environment keys and team role overrides, without a database.
    `world.envs[holder_id]` is the set of environments a member or service
    account holds; `world.team_roles[account_id]` lists the role overrides of
    the teams a service account belongs to."""
    state = SimpleNamespace(envs={}, team_roles={})

    def environment_keys(**filters):
        holder = filters.get("service_account") or filters.get("user")
        held = set(state.envs.get(holder.id, ()))
        if "environment_id__in" in filters:
            held &= set(filters["environment_id__in"])
        return MagicMock(**{"values_list.return_value": sorted(held)})

    def teams(memberships__service_account, **filters):
        overrides = state.team_roles.get(memberships__service_account.id, [])
        return MagicMock(
            **{
                "distinct.return_value": [
                    SimpleNamespace(service_account_role=role) for role in overrides
                ]
            }
        )

    fakes = {"EnvironmentKey": MagicMock(), "Team": MagicMock()}
    fakes["EnvironmentKey"].objects.filter.side_effect = environment_keys
    fakes["Team"].objects.filter.side_effect = teams
    real_get_model = permissions.apps.get_model

    def get_model(app_label, name):
        return fakes.get(name) or real_get_model(app_label, name)

    with patch(f"{PERM}.apps.get_model", side_effect=get_model):
        yield state


# ──────────────────────────────────────────────────────────────────────
# service_account_access_beyond
# ──────────────────────────────────────────────────────────────────────

PERMISSIONS, ENVIRONMENTS = "permissions", "environments"


def test_nothing_beyond_when_role_and_environments_are_covered(world):
    world.envs = {"sa-1": {"dev"}, "member-1": {"dev", "staging"}}

    assert service_account_access_beyond(_account(), _member(MANAGER)) == []


def test_environments_beyond_when_the_account_holds_one_the_actor_does_not(world):
    """The default Service role sits inside the Manager role, so the role
    check alone would pass."""
    world.envs = {"sa-1": {"dev", "prod"}, "member-1": {"dev"}}

    beyond = service_account_access_beyond(_account(), _member(MANAGER))

    assert beyond == [ENVIRONMENTS]


def test_permissions_beyond_when_the_account_role_exceeds_the_actor(world):
    world.envs = {"sa-1": {"dev"}, "member-1": {"dev"}}

    beyond = service_account_access_beyond(_account(), _member(DEVELOPER))

    assert beyond == [PERMISSIONS]


def test_both_beyond_are_reported_together(world):
    world.envs = {"sa-1": {"dev", "prod"}, "member-1": {"dev"}}

    beyond = service_account_access_beyond(_account(), _member(DEVELOPER))

    assert beyond == [PERMISSIONS, ENVIRONMENTS]


def test_nothing_beyond_when_the_account_holds_no_environments(world):
    assert service_account_access_beyond(_account(), _member(MANAGER)) == []


def test_actor_with_global_access_is_exempt(world):
    world.envs = {"sa-1": {"prod"}}

    assert service_account_access_beyond(_account(), _member(OWNER)) == []


def test_owning_team_override_counts_towards_the_actor_ceiling(world):
    """Same union as role assignment on a team-owned service account."""
    world.envs = {"sa-1": {"dev"}, "member-1": {"dev"}}
    team = SimpleNamespace(member_role=MANAGER, service_account_role=None)

    assert service_account_access_beyond(_account(team=team), _member(DEVELOPER)) == []
    assert service_account_access_beyond(_account(), _member(DEVELOPER)) == [
        PERMISSIONS
    ]


def test_a_team_override_can_put_the_account_beyond_the_actor(world):
    world.envs = {"sa-1": {"dev"}, "member-1": {"dev"}}
    world.team_roles = {"sa-1": [MANAGER]}
    account = _account(role=SECRETS_READER)

    assert service_account_access_beyond(account, _member(MANAGER)) == []
    assert service_account_access_beyond(account, _member(SECRETS_READER)) == [
        PERMISSIONS
    ]


def test_service_account_actor_is_compared_by_its_own_role_and_keys(world):
    world.envs = {"sa-1": {"dev", "prod"}, "caller": {"dev"}}
    caller = _account(account_id="caller")

    assert service_account_access_beyond(
        _account(), caller, actor_is_service_account=True
    ) == [ENVIRONMENTS]

    world.envs["caller"] = {"dev", "prod"}
    assert (
        service_account_access_beyond(_account(), caller, actor_is_service_account=True)
        == []
    )


def test_service_account_has_nothing_beyond_itself(world):
    world.envs = {"sa-1": {"prod"}}
    account = _account()

    assert (
        service_account_access_beyond(account, account, actor_is_service_account=True)
        == []
    )


@pytest.mark.parametrize(
    "beyond, expected",
    [
        ([PERMISSIONS], "has permissions beyond your own, so"),
        ([ENVIRONMENTS], "has environment access beyond your own, so"),
        (
            [PERMISSIONS, ENVIRONMENTS],
            "has permissions and environment access beyond your own, so",
        ),
    ],
)
def test_message_names_what_is_beyond_the_caller(beyond, expected):
    message = sa_ceiling_message(beyond, "create tokens for it")

    assert expected in message
    assert message.endswith("you can't create tokens for it")


# ──────────────────────────────────────────────────────────────────────
# _check_sa_token_ceiling
# ──────────────────────────────────────────────────────────────────────


def _info():
    info = MagicMock()
    info.context.user = MagicMock()
    return info


def test_check_raises_and_says_what_is_beyond_the_caller():
    member = _member(MANAGER)
    account = _account()
    with patch(
        f"{PERM}.service_account_access_beyond", return_value=[ENVIRONMENTS]
    ) as beyond:
        with patch(f"{PERM}.apps.get_model") as get_model:
            get_model.return_value.objects.get.return_value = member
            with pytest.raises(GraphQLError) as error:
                _check_sa_token_ceiling(MagicMock(), account)

    assert str(error.value) == (
        "This Service Account has environment access beyond your own, "
        "so you can't create tokens for it"
    )
    beyond.assert_called_once_with(account, member)


def test_check_passes_when_nothing_is_beyond_the_caller():
    with patch(f"{PERM}.service_account_access_beyond", return_value=[]):
        with patch(f"{PERM}.apps.get_model"):
            _check_sa_token_ceiling(MagicMock(), _account())


def test_check_refuses_a_caller_outside_the_organisation():
    class DoesNotExist(Exception):
        pass

    with patch(f"{PERM}.apps.get_model") as get_model:
        get_model.return_value.DoesNotExist = DoesNotExist
        get_model.return_value.objects.get.side_effect = DoesNotExist
        with pytest.raises(GraphQLError, match="access to this Service Account"):
            _check_sa_token_ceiling(MagicMock(), _account())


# ──────────────────────────────────────────────────────────────────────
# Creating tokens
# ──────────────────────────────────────────────────────────────────────


@pytest.fixture
def mutation():
    """Service account mutations with models patched. `mutation.ceiling` is
    the ceiling check: set its side_effect to refuse."""
    with patch(f"{MUTATIONS}.ServiceAccount") as sa_model, patch(
        f"{MUTATIONS}.OrganisationMember"
    ), patch(f"{MUTATIONS}.ServiceAccountToken") as token_model, patch(
        f"{MUTATIONS}.Role"
    ) as role_model, patch(f"{MUTATIONS}.Identity") as identity_model, patch(
        f"{MUTATIONS}._check_sa_permission"
    ) as sa_permission, patch(
        f"{MUTATIONS}._check_sa_token_ceiling"
    ) as ceiling, patch(
        f"{MUTATIONS}.role_has_global_access", return_value=False
    ), patch(
        f"{MUTATIONS}.log_audit_event"
    ) as audit, patch(
        f"{MUTATIONS}.get_actor_info_from_graphql", return_value=("user", "m-1", {})
    ), patch(
        f"{MUTATIONS}.get_resolver_request_meta", return_value=("127.0.0.1", "pytest")
    ):
        account = MagicMock(role_id="role-1")
        sa_model.objects.get.return_value = account
        role_model.objects.get.return_value = SimpleNamespace(id="role-1", name="Service")
        identity_model.objects.filter.side_effect = lambda id__in, **_: [
            SimpleNamespace(id=identity_id) for identity_id in id__in
        ]
        yield SimpleNamespace(
            account=account,
            token_model=token_model,
            sa_permission=sa_permission,
            ceiling=ceiling,
            audit=audit,
        )


REFUSED = GraphQLError(f"This Service Account has access {BEYOND}")


def test_server_side_create_is_refused_before_the_keyring_is_used(mutation):
    from backend.graphene.mutations.service_accounts import (
        CreateServerSideServiceAccountTokenMutation,
    )

    mutation.ceiling.side_effect = REFUSED
    with patch(f"{MUTATIONS}.unwrap_server_managed_sa_keyring") as unwrap:
        with pytest.raises(GraphQLError, match=BEYOND):
            CreateServerSideServiceAccountTokenMutation.mutate(
                None, _info(), service_account_id="sa-1", name="tok"
            )

    unwrap.assert_not_called()
    mutation.token_model.objects.create.assert_not_called()


def test_client_side_create_is_refused_even_with_the_account_keyring(mutation):
    """Holding the keyring as a handler does not lift the ceiling."""
    from backend.graphene.mutations.service_accounts import (
        CreateServiceAccountTokenMutation,
    )

    mutation.ceiling.side_effect = REFUSED
    with patch(f"{MUTATIONS}.verify_ed25519_signature", return_value=True) as verify:
        with pytest.raises(GraphQLError, match=BEYOND):
            CreateServiceAccountTokenMutation.mutate(
                None,
                _info(),
                service_account_id="sa-1",
                name="tok",
                identity_key="kx",
                token="t",
                wrapped_key_share="w",
                expiry=None,
                signature="sig",
            )

    verify.assert_not_called()
    mutation.token_model.objects.create.assert_not_called()


@pytest.mark.parametrize("mutation_name", ["server_side", "client_side"])
def test_create_checks_the_permission_and_then_the_ceiling(mutation, mutation_name):
    from backend.graphene.mutations import service_accounts

    info = _info()
    mutation.ceiling.side_effect = REFUSED
    with pytest.raises(GraphQLError):
        if mutation_name == "server_side":
            service_accounts.CreateServerSideServiceAccountTokenMutation.mutate(
                None, info, service_account_id="sa-1", name="tok"
            )
        else:
            service_accounts.CreateServiceAccountTokenMutation.mutate(
                None,
                info,
                service_account_id="sa-1",
                name="tok",
                identity_key="kx",
                token="t",
                wrapped_key_share="w",
                expiry=None,
                signature="sig",
            )

    mutation.sa_permission.assert_called_once_with(
        info.context.user, mutation.account, "create", "ServiceAccountTokens"
    )
    mutation.ceiling.assert_called_once_with(info.context.user, mutation.account)


# ──────────────────────────────────────────────────────────────────────
# Deleting tokens
# ──────────────────────────────────────────────────────────────────────


def test_token_delete_needs_only_the_delete_permission(mutation):
    from backend.graphene.mutations.service_accounts import (
        DeleteServiceAccountTokenMutation,
    )

    info = _info()
    token = MagicMock()
    mutation.token_model.objects.get.return_value = token
    mutation.ceiling.side_effect = REFUSED

    result = DeleteServiceAccountTokenMutation.mutate(None, info, token_id="tok-1")

    assert result.ok is True
    token.delete.assert_called_once()
    mutation.sa_permission.assert_called_once_with(
        info.context.user, token.service_account, "delete", "ServiceAccountTokens"
    )
    mutation.ceiling.assert_not_called()


# ──────────────────────────────────────────────────────────────────────
# updateServiceAccount: attaching and detaching identities
# ──────────────────────────────────────────────────────────────────────


def _update(mutation, identity_ids, attached):
    """Update with the role unchanged. Returns the identity ids passed to
    `identities.set`, or None when the set was left alone."""
    from backend.graphene.mutations.service_accounts import (
        UpdateServiceAccountMutation,
    )

    account = mutation.account
    account.identities.filter.return_value.values_list.return_value = attached
    kwargs = {} if identity_ids is None else {"identity_ids": identity_ids}
    UpdateServiceAccountMutation.mutate(
        None,
        _info(),
        service_account_id="sa-1",
        name="deployer",
        role_id="role-1",
        **kwargs,
    )
    if not account.identities.set.called:
        return None
    (identities,) = account.identities.set.call_args.args
    return [identity.id for identity in identities]


@pytest.mark.parametrize(
    "identity_ids, attached",
    [
        (["id-new"], []),  # attach
        (["id-1", "id-new"], ["id-1"]),  # attach one more
        (["id-other"], ["id-1"]),  # swap
    ],
)
def test_attaching_an_identity_is_refused_above_the_ceiling(
    mutation, identity_ids, attached
):
    mutation.ceiling.side_effect = REFUSED

    with pytest.raises(GraphQLError, match=BEYOND):
        _update(mutation, identity_ids, attached)

    mutation.account.identities.set.assert_not_called()
    mutation.account.save.assert_not_called()


def test_attaching_an_identity_within_the_ceiling(mutation):
    assert _update(mutation, ["id-1", "id-new"], ["id-1"]) == ["id-1", "id-new"]
    mutation.ceiling.assert_called_once()
    assert mutation.ceiling.call_args.args[2] == "attach identities to it"
    mutation.account.save.assert_called_once()


@pytest.mark.parametrize(
    "identity_ids, attached",
    [
        ([], ["id-1"]),  # detach all
        (["id-1"], ["id-1", "id-2"]),  # detach one
        (["id-2", "id-1"], ["id-1", "id-2"]),  # unchanged
    ],
)
def test_detaching_identities_is_not_subject_to_the_ceiling(
    mutation, identity_ids, attached
):
    mutation.ceiling.side_effect = REFUSED

    assert _update(mutation, identity_ids, attached) == identity_ids
    mutation.ceiling.assert_not_called()


def test_update_without_identity_ids_is_not_subject_to_the_ceiling(mutation):
    """Renaming or changing the role does not touch identities."""
    mutation.ceiling.side_effect = REFUSED

    assert _update(mutation, None, ["id-1"]) is None
    mutation.ceiling.assert_not_called()
    mutation.account.save.assert_called_once()


# ──────────────────────────────────────────────────────────────────────
# updateIdentity / deleteIdentity: identities attached to service accounts
# ──────────────────────────────────────────────────────────────────────

CANNOT_CHANGE = "attached to a Service Account you can't create tokens for"
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


def _change_identity(mutation_name, identity, sa_permission=None, ceiling=None):
    import backend.graphene.mutations.access as access

    with patch(f"{ACCESS}.Identity") as identity_model, patch(
        f"{ACCESS}.user_has_permission", return_value=True
    ), patch(f"{PERM}._check_sa_permission", side_effect=sa_permission), patch(
        f"{PERM}._check_sa_token_ceiling", side_effect=ceiling
    ) as ceiling_check:
        identity_model.objects.get.return_value = identity
        identity.ceiling_check = ceiling_check
        if mutation_name == "update":
            return access.UpdateIdentityMutation.mutate(
                None, _info(), id="identity-1", trusted_principals=OTHER_PRINCIPAL
            )
        return access.DeleteIdentityMutation.mutate(None, _info(), id="identity-1")


def test_editing_an_identity_attached_above_the_ceiling_is_refused():
    identity = _identity(attached_to=[_account()])

    with pytest.raises(GraphQLError, match=CANNOT_CHANGE):
        _change_identity("update", identity, ceiling=REFUSED)

    identity.save.assert_not_called()
    assert identity.config == {"trustedPrincipals": [TRUSTED_PRINCIPAL]}


def test_editing_an_identity_on_an_account_the_caller_cannot_update_is_refused():
    """e.g. a team-owned service account of a team the caller is not in."""
    identity = _identity(attached_to=[_account()])

    with pytest.raises(GraphQLError, match=CANNOT_CHANGE):
        _change_identity(
            "update",
            identity,
            sa_permission=GraphQLError("You don't have access to this Service Account"),
        )

    identity.save.assert_not_called()


def test_one_account_above_the_ceiling_blocks_the_edit():
    within, above = _account(account_id="sa-1"), _account(account_id="sa-2")
    identity = _identity(attached_to=[within, above])

    def ceiling(user, service_account):
        if service_account is above:
            raise REFUSED

    with pytest.raises(GraphQLError, match=CANNOT_CHANGE):
        _change_identity("update", identity, ceiling=ceiling)

    identity.save.assert_not_called()


def test_editing_an_identity_within_the_ceiling():
    identity = _identity(attached_to=[_account()])

    _change_identity("update", identity)

    assert identity.config["trustedPrincipals"] == [OTHER_PRINCIPAL]
    identity.save.assert_called_once()
    identity.ceiling_check.assert_called_once()


def test_editing_an_unattached_identity_is_not_subject_to_the_ceiling():
    identity = _identity(attached_to=[])

    _change_identity("update", identity, ceiling=REFUSED)

    identity.save.assert_called_once()
    identity.service_accounts.filter.assert_called_once_with(deleted_at=None)


def test_deleting_an_identity_is_not_subject_to_the_ceiling():
    identity = _identity(attached_to=[_account()])

    result = _change_identity("delete", identity, ceiling=REFUSED)

    assert result.ok is True
    assert identity.deleted_at is not None
    identity.save.assert_called_once()
    identity.ceiling_check.assert_not_called()


def test_identity_check_uses_the_service_account_update_permission():
    account = _account()
    identity = _identity(attached_to=[account])
    user = MagicMock()

    with patch(f"{PERM}._check_sa_permission") as sa_permission, patch(
        f"{PERM}._check_sa_token_ceiling"
    ) as ceiling:
        _check_identity_change(user, identity)

    sa_permission.assert_called_once_with(user, account, "update", "ServiceAccounts")
    ceiling.assert_called_once_with(user, account)


# ──────────────────────────────────────────────────────────────────────
# ServiceAccountType.accessBeyondCaller (tells the console up front)
# ──────────────────────────────────────────────────────────────────────

TYPES = "backend.graphene.types"


@pytest.mark.parametrize("beyond", [[], [PERMISSIONS], [PERMISSIONS, ENVIRONMENTS]])
def test_access_beyond_caller_reports_what_the_ceiling_found(beyond):
    from backend.graphene.types import ServiceAccountType

    account, member, info = _account(), _member(MANAGER), _info()
    with patch(f"{TYPES}.OrganisationMember") as member_model, patch(
        f"{PERM}.service_account_access_beyond", return_value=beyond
    ) as ceiling:
        member_model.objects.filter.return_value.first.return_value = member

        assert ServiceAccountType.resolve_access_beyond_caller(account, info) == beyond

    ceiling.assert_called_once_with(account, member)
    member_model.objects.filter.assert_called_once_with(
        user=info.context.user, organisation="org", deleted_at=None
    )


def test_access_beyond_caller_for_a_caller_outside_the_organisation():
    from backend.graphene.types import ServiceAccountType

    with patch(f"{TYPES}.OrganisationMember") as member_model:
        member_model.objects.filter.return_value.first.return_value = None

        beyond = ServiceAccountType.resolve_access_beyond_caller(_account(), _info())

    assert beyond == [PERMISSIONS, ENVIRONMENTS]
