"""Unit tests for UpdateMemberEnvScopeMutation grant handling
(F5 of QA batch 1).

A single EnvironmentKey row can carry multiple EnvironmentKeyGrant
entries — `provision_team_environment_keys` re-uses an existing key
rather than creating a duplicate, so a member can simultaneously hold
an `individual` and a `team` grant on the same key. The previous
implementation deleted ALL grants on the old keys when updating direct
scope, then soft-deleted the keys, silently revoking team-provided
access. The fix:

1. Delete only `grant_type='individual'` grants on the existing keys.
2. Soft-delete only the keys with no remaining grants.
3. For envs in the new direct scope where the existing key is
   preserved (because a team grant survives), attach a new individual
   grant to the existing row instead of trying to create a duplicate
   row (which would violate the (env, user|sa) uniqueness constraint).
"""

from unittest.mock import MagicMock, patch


def _make_info(user):
    info = MagicMock()
    info.context.user = user
    return info


def _make_env_key_input(env_id, user_id="u1", wrapped_seed="ws", wrapped_salt="wsl",
                       identity_key="ik"):
    k = MagicMock()
    k.env_id = env_id
    k.user_id = user_id
    k.wrapped_seed = wrapped_seed
    k.wrapped_salt = wrapped_salt
    k.identity_key = identity_key
    return k


@patch("backend.graphene.mutations.environment.log_audit_event")
@patch("backend.graphene.mutations.environment.get_resolver_request_meta",
       return_value=("127.0.0.1", "pytest"))
@patch("backend.graphene.mutations.environment.get_actor_info_from_graphql",
       return_value=("user", "actor-1", {}))
@patch("backend.graphene.mutations.environment.get_member_display_name",
       return_value="Test Member")
@patch("backend.graphene.mutations.environment.Environment")
@patch("backend.graphene.mutations.environment.timezone")
@patch("backend.graphene.mutations.environment.transaction")
@patch("backend.graphene.mutations.environment.EnvironmentKeyGrant")
@patch("backend.graphene.mutations.environment.EnvironmentKey")
@patch("backend.graphene.mutations.environment.OrganisationMember")
@patch("backend.graphene.mutations.environment.App")
@patch("backend.graphene.mutations.environment.user_can_access_app", return_value=True)
@patch("backend.graphene.mutations.environment.user_has_permission", return_value=True)
def test_team_granted_keys_survive_direct_scope_edit(
    _mock_perm, _mock_access, MockApp, MockOM, MockEnvKey, MockGrant, mock_tx, mock_tz,
    MockEnv, _mock_display, _mock_actor, _mock_meta, _mock_audit,
):
    """A key carrying both an individual grant and a team grant for the
    same member must keep the team grant (and itself) when the direct
    scope is reduced. Previously this would delete all grants and
    soft-delete the key, silently revoking team access."""
    from backend.graphene.mutations.environment import UpdateMemberEnvScopeMutation
    from backend.graphene.types import MemberType

    # Setup: app + member context.
    app = MagicMock()
    MockApp.objects.get.return_value = app
    member = MagicMock()
    MockOM.objects.get.return_value = member
    app.members.all.return_value = [member]

    # Two existing keys for this member:
    # - K1 on env-A: individual + team grants
    # - K2 on env-B: individual grant only
    k1 = MagicMock(id="k1", environment_id="env-A")
    k2 = MagicMock(id="k2", environment_id="env-B")

    # The mutation calls `EnvironmentKey.objects.filter(...)` three times:
    #   (a) audit snapshot of old env scope (line 475 in environment.py)
    #   (b) load old keys for grant rewrite (line 487)
    #   (c) soft-delete orphan keys (line 501)
    # Each side_effect entry must satisfy the consumer pattern at that
    # call site. Providing too few entries exhausts side_effect mid-flow
    # and PEP 479 promotes the resulting StopIteration to a RuntimeError.
    audit_old_env_qs = MagicMock()
    audit_old_env_qs.values_list.return_value = ["env-A", "env-B"]

    old_keys_qs = MagicMock()
    old_keys_qs.__iter__ = MagicMock(return_value=iter([k1, k2]))

    soft_delete_qs = MagicMock()

    MockEnvKey.objects.filter.side_effect = [
        audit_old_env_qs,   # (a)
        old_keys_qs,        # (b)
        soft_delete_qs,     # (c)
    ]

    # `EnvironmentKeyGrant.objects.filter(...)` is also called three times:
    #   (1) delete individual grants on old keys (line 492)
    #   (2) collect ids of keys with remaining grants (line 497)
    #   (3) get_or_create for the preserved-key individual grant (line 517)
    # NOTE: call #3 is `.get_or_create(...)`, not `.filter(...)`, so it
    # doesn't consume from this side_effect chain — only (1) and (2) do.
    delete_mock = MagicMock()
    remaining_qs = MagicMock()
    remaining_qs.values_list.return_value = ["k1"]
    MockGrant.objects.filter.side_effect = [delete_mock, remaining_qs]

    user = MagicMock()
    user.userId = "u1"

    # New direct scope: only env-A (env-B is dropped).
    UpdateMemberEnvScopeMutation.mutate(
        None,
        _make_info(user),
        member_id="m1",
        app_id="app-1",
        env_keys=[_make_env_key_input("env-A")],
        member_type=MemberType.USER,
    )

    # Assertions:
    # 1. Individual grants were deleted on the old keys.
    delete_mock.delete.assert_called_once()
    # 2. Soft-delete was called on keys WITHOUT remaining grants — the
    #    queryset filter should have included k2 but excluded k1
    #    (k1 still has a team grant).
    soft_delete_qs.update.assert_called_once()
    # 3. For env-A (the preserved key with a team grant), the mutation
    #    used get_or_create on the EXISTING row rather than creating a
    #    duplicate EnvironmentKey row.
    MockGrant.objects.get_or_create.assert_called_once()
    create_call = MockGrant.objects.get_or_create.call_args
    assert create_call.kwargs["environment_key"] is k1
    assert create_call.kwargs["grant_type"] == "individual"
    # 4. No new EnvironmentKey row was created for env-A — the mutation
    #    re-used the preserved row to avoid a uniqueness conflict.
    MockEnvKey.objects.create.assert_not_called()


@patch("backend.graphene.mutations.environment.role_has_global_access", return_value=True)
@patch("backend.graphene.mutations.environment.EnvironmentKey")
@patch("backend.graphene.mutations.environment.OrganisationMember")
@patch("backend.graphene.mutations.environment.App")
@patch("backend.graphene.mutations.environment.user_can_access_app", return_value=True)
@patch("backend.graphene.mutations.environment.user_has_permission", return_value=True)
def test_global_access_target_cannot_be_scoped(
    _mock_perm, _mock_access, MockApp, MockOM, MockEnvKey, _mock_ga,
):
    """A member with a global-access role (Owner / Admin) has access to all
    apps and envs by definition — their env scope cannot be modified while
    they hold that role."""
    from backend.graphene.mutations.environment import UpdateMemberEnvScopeMutation
    from backend.graphene.types import MemberType
    from graphql import GraphQLError
    import pytest as _pytest

    app = MagicMock()
    MockApp.objects.get.return_value = app
    member = MagicMock()
    MockOM.objects.get.return_value = member
    app.members.all.return_value = [member]

    user = MagicMock()
    user.userId = "u1"

    with _pytest.raises(GraphQLError, match="global access role"):
        UpdateMemberEnvScopeMutation.mutate(
            None, _make_info(user),
            member_id="m1", app_id="app-1",
            env_keys=[_make_env_key_input("env-A")],
            member_type=MemberType.USER,
        )

    # Mutation must short-circuit before any DB modification.
    MockEnvKey.objects.filter.assert_not_called()
