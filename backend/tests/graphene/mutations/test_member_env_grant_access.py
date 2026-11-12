"""Member access-grant mutations provision EnvironmentKeys that then pass
every per-environment access check, so a non-global caller may only grant
environments they hold themselves (global-access roles exempt). Covers the
shared helper plus wiring in addAppMember, bulkAddAppMembers and
updateMemberEnvironmentScope — the individual-member analogue of the
team-grant check.
"""

from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from graphql import GraphQLError

PERM = "api.utils.access.permissions"
APP = "backend.graphene.mutations.app"
ENV = "backend.graphene.mutations.environment"
DENIED = "one or more of the selected environments"


def _env(env_id):
    env = MagicMock(id=env_id)
    env.name = env_id
    return env


DEV, PROD = _env("env-dev"), _env("env-prod")


def _info():
    info = MagicMock()
    info.context.user.userId = "user-1"
    return info


# ──────────────────────────────────────────────────────────────────────
# check_caller_can_grant_environments helper
# ──────────────────────────────────────────────────────────────────────


def _patch_access(stack, held_env_ids, global_access=False):
    stack.enter_context(
        patch(f"{PERM}.user_has_global_access", return_value=global_access)
    )
    stack.enter_context(
        patch(
            f"{PERM}.user_can_access_environment",
            side_effect=lambda user_id, env_id: env_id in held_env_ids,
        )
    )


def test_helper_blocks_env_the_caller_cannot_access():
    from api.utils.access.permissions import check_caller_can_grant_environments

    with ExitStack() as stack:
        _patch_access(stack, held_env_ids={DEV.id})
        with pytest.raises(GraphQLError, match=DENIED):
            check_caller_can_grant_environments(
                _info().context.user, MagicMock(), [DEV, PROD]
            )


def test_helper_allows_envs_the_caller_holds():
    from api.utils.access.permissions import check_caller_can_grant_environments

    with ExitStack() as stack:
        _patch_access(stack, held_env_ids={DEV.id, PROD.id})
        check_caller_can_grant_environments(
            _info().context.user, MagicMock(), [DEV, PROD]
        )


def test_helper_global_caller_is_exempt():
    from api.utils.access.permissions import check_caller_can_grant_environments

    with ExitStack() as stack:
        access = patch(f"{PERM}.user_can_access_environment")
        _patch_access(stack, held_env_ids=set(), global_access=True)
        checked = stack.enter_context(access)
        check_caller_can_grant_environments(_info().context.user, MagicMock(), [PROD])
        checked.assert_not_called()


# ──────────────────────────────────────────────────────────────────────
# Mutation wiring: each grant path rejects before writing
# ──────────────────────────────────────────────────────────────────────


def test_update_member_scope_rejects_env_the_caller_cannot_access():
    from backend.graphene.mutations.environment import (
        UpdateMemberEnvScopeMutation,
        MemberType,
    )

    with ExitStack() as stack:
        app = MagicMock()
        member = MagicMock(id="member-1")
        member.role = MagicMock()
        app.members.all.return_value = [member]
        env_key_model = MagicMock()
        for name, obj in (
            ("App", MagicMock(objects=MagicMock(get=MagicMock(return_value=app)))),
            (
                "OrganisationMember",
                MagicMock(objects=MagicMock(get=MagicMock(return_value=member))),
            ),
            ("EnvironmentKey", env_key_model),
        ):
            stack.enter_context(patch(f"{ENV}.{name}", obj))
        stack.enter_context(patch(f"{ENV}.user_has_permission", return_value=True))
        stack.enter_context(patch(f"{ENV}.user_can_access_app", return_value=True))
        stack.enter_context(patch(f"{ENV}.role_has_global_access", return_value=False))
        stack.enter_context(
            patch(
                f"{ENV}.validate_member_environment_keys",
                return_value=[(SimpleNamespace(env_id=PROD.id), PROD)],
            )
        )
        _patch_access(stack, held_env_ids={DEV.id})

        with pytest.raises(GraphQLError, match=DENIED):
            UpdateMemberEnvScopeMutation.mutate(
                None,
                _info(),
                member_id="member-1",
                app_id="app-1",
                env_keys=[SimpleNamespace(env_id=PROD.id)],
                member_type=MemberType.USER,
            )

        env_key_model.objects.create.assert_not_called()


def _app_grant_stack(stack, validated):
    app = MagicMock()
    stack.enter_context(
        patch(
            f"{APP}.App", MagicMock(objects=MagicMock(get=MagicMock(return_value=app)))
        )
    )
    stack.enter_context(
        patch(
            f"{APP}.OrganisationMember",
            MagicMock(
                objects=MagicMock(get=MagicMock(return_value=MagicMock(id="member-1")))
            ),
        )
    )
    upsert = stack.enter_context(patch(f"{APP}._upsert_active_env_key"))
    stack.enter_context(patch(f"{APP}.user_has_permission", return_value=True))
    stack.enter_context(patch(f"{APP}.user_can_access_app", return_value=True))
    stack.enter_context(
        patch(f"{APP}.validate_member_environment_keys", return_value=validated)
    )
    _patch_access(stack, held_env_ids={DEV.id})
    return app, upsert


def test_add_app_member_rejects_env_the_caller_cannot_access():
    from backend.graphene.mutations.app import AddAppMemberMutation, MemberType

    with ExitStack() as stack:
        app, upsert = _app_grant_stack(stack, [(SimpleNamespace(env_id=PROD.id), PROD)])
        with pytest.raises(GraphQLError, match=DENIED):
            AddAppMemberMutation.mutate(
                None,
                _info(),
                member_id="member-1",
                app_id="app-1",
                env_keys=[SimpleNamespace(env_id=PROD.id)],
                member_type=MemberType.USER,
            )
        app.members.add.assert_not_called()
        upsert.assert_not_called()


def test_bulk_add_app_members_rejects_env_the_caller_cannot_access():
    from backend.graphene.mutations.app import BulkAddAppMembersMutation, MemberType

    with ExitStack() as stack:
        app, upsert = _app_grant_stack(stack, [(SimpleNamespace(env_id=PROD.id), PROD)])
        member_input = SimpleNamespace(
            member_id="member-1", member_type=MemberType.USER, env_keys=[]
        )
        with pytest.raises(GraphQLError, match=DENIED):
            BulkAddAppMembersMutation.mutate(
                None, _info(), app_id="app-1", members=[member_input]
            )
        app.members.add.assert_not_called()
