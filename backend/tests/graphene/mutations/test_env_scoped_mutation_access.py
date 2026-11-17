"""Environment-scoped mutations must enforce the per-environment boundary,
not just the app-level permission: renameEnvironment, deleteEnvironment and
(EE) deleteDynamicSecret act on an env named by an input id, so a member
scoped to another env must be refused — matching the secret read/edit/delete
paths and the REST environment endpoints.
"""

from contextlib import ExitStack
from unittest.mock import MagicMock, patch

import pytest
from graphql import GraphQLError

ENV_MUTATIONS = "backend.graphene.mutations.environment"
DYN_MUTATIONS = "ee.integrations.secrets.dynamic.graphene.mutations"
DENIED = "You don't have access to this environment"


def _info():
    info = MagicMock()
    info.context.user.userId = "user-1"
    return info


# ──────────────────────────────────────────────────────────────────────
# renameEnvironment / deleteEnvironment
# ──────────────────────────────────────────────────────────────────────


@pytest.fixture
def env_mocks():
    with ExitStack() as stack:
        m = MagicMock()
        for name in (
            "Environment",
            "RotatingSecret",
            "log_audit_event",
        ):
            stack.enter_context(patch(f"{ENV_MUTATIONS}.{name}", getattr(m, name)))
        stack.enter_context(
            patch(f"{ENV_MUTATIONS}.user_has_permission", return_value=True)
        )
        stack.enter_context(
            patch(f"{ENV_MUTATIONS}.can_use_custom_envs", return_value=True)
        )
        m.user_can_access_environment = stack.enter_context(
            patch(f"{ENV_MUTATIONS}.user_can_access_environment")
        )
        stack.enter_context(
            patch(
                f"{ENV_MUTATIONS}.get_resolver_request_meta",
                return_value=("127.0.0.1", "pytest"),
            )
        )
        env = MagicMock(id="env-prod")
        env.name = "Production"
        m.Environment.objects.get.return_value = env
        m.RotatingSecret.objects.filter.return_value.exists.return_value = False
        m.env = env
        yield m


def test_rename_rejects_env_the_caller_cannot_access(env_mocks):
    from backend.graphene.mutations.environment import RenameEnvironmentMutation

    env_mocks.user_can_access_environment.return_value = False

    with pytest.raises(GraphQLError, match=DENIED):
        RenameEnvironmentMutation.mutate(
            None, _info(), environment_id="env-prod", name="pwned"
        )

    env_mocks.env.save.assert_not_called()


def test_delete_env_rejects_env_the_caller_cannot_access(env_mocks):
    from backend.graphene.mutations.environment import DeleteEnvironmentMutation

    env_mocks.user_can_access_environment.return_value = False

    with pytest.raises(GraphQLError, match=DENIED):
        DeleteEnvironmentMutation.mutate(None, _info(), environment_id="env-prod")

    env_mocks.env.delete.assert_not_called()


def test_rename_allows_env_the_caller_holds(env_mocks):
    from backend.graphene.mutations.environment import RenameEnvironmentMutation

    env_mocks.user_can_access_environment.return_value = True
    env_mocks.Environment.objects.filter.return_value.exclude.return_value.exists.return_value = (
        False
    )

    RenameEnvironmentMutation.mutate(
        None, _info(), environment_id="env-prod", name="prod2"
    )

    env_mocks.env.save.assert_called_once()


# ──────────────────────────────────────────────────────────────────────
# deleteDynamicSecret (EE)
# ──────────────────────────────────────────────────────────────────────


@pytest.fixture
def dyn_mocks():
    with ExitStack() as stack:
        DynamicSecret = stack.enter_context(patch(f"{DYN_MUTATIONS}.DynamicSecret"))
        stack.enter_context(
            patch(f"{DYN_MUTATIONS}.user_has_permission", return_value=True)
        )
        access = stack.enter_context(
            patch(f"{DYN_MUTATIONS}.user_can_access_environment")
        )
        secret = MagicMock()
        secret.environment.id = "env-prod"
        DynamicSecret.objects.get.return_value = secret
        yield secret, access


def test_delete_dynamic_secret_rejects_env_the_caller_cannot_access(dyn_mocks):
    from ee.integrations.secrets.dynamic.graphene.mutations import (
        DeleteDynamicSecretMutation,
    )

    secret, access = dyn_mocks
    access.return_value = False

    with pytest.raises(GraphQLError, match=DENIED):
        DeleteDynamicSecretMutation.mutate(None, _info(), secret_id="ds-prod")

    secret.delete.assert_not_called()


def test_delete_dynamic_secret_allows_env_the_caller_holds(dyn_mocks):
    from ee.integrations.secrets.dynamic.graphene.mutations import (
        DeleteDynamicSecretMutation,
    )

    secret, access = dyn_mocks
    access.return_value = True

    DeleteDynamicSecretMutation.mutate(None, _info(), secret_id="ds-prod")

    secret.delete.assert_called_once()
