"""CreateEnvironmentMutation plan-tier gating.

Custom (non-default) environments require a paid plan, while the default
dev/staging/prod environments provisioned during app setup must stay
creatable on the Free plan. These guards mirror the REST enforcement in
PublicEnvironmentsView / PublicAppsView so the rule holds on every path.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from graphql import GraphQLError


_M = "backend.graphene.mutations.environment"


def _info():
    info = MagicMock()
    info.context.user.userId = "user-1"
    return info


def _env_data(env_type, name="custom-env"):
    return SimpleNamespace(app_id="app-1", name=name, env_type=env_type)


def test_create_custom_environment_blocked_on_free_plan():
    """env_type=custom + Free plan -> rejected before anything is created."""
    from backend.graphene.mutations.environment import CreateEnvironmentMutation

    env_qs = MagicMock()
    env_qs.exists.return_value = False

    with patch(f"{_M}.user_can_access_app", return_value=True), patch(
        f"{_M}.user_has_permission", return_value=True
    ), patch(f"{_M}.App") as MockApp, patch(f"{_M}.Environment") as MockEnv, patch(
        f"{_M}.can_use_custom_envs", return_value=False
    ), patch(
        f"{_M}.can_add_environment", return_value=True
    ):
        MockApp.objects.get.return_value = MagicMock()
        MockEnv.objects.filter.return_value = env_qs

        with pytest.raises(GraphQLError, match="Custom environments"):
            CreateEnvironmentMutation.mutate(
                None, _info(), _env_data("custom"), []
            )

        MockEnv.objects.create.assert_not_called()


def test_create_default_environment_exempt_from_custom_gate():
    """dev/staging/prod skip the custom-env gate even when custom envs are
    disallowed, so app onboarding still works on the Free plan. The only limit
    that applies to them is the per-app count quota."""
    from backend.graphene.mutations.environment import CreateEnvironmentMutation

    env_qs = MagicMock()
    env_qs.exists.return_value = False

    with patch(f"{_M}.user_can_access_app", return_value=True), patch(
        f"{_M}.user_has_permission", return_value=True
    ), patch(f"{_M}.App") as MockApp, patch(f"{_M}.Environment") as MockEnv, patch(
        f"{_M}.can_use_custom_envs", return_value=False
    ), patch(
        f"{_M}.can_add_environment", return_value=False
    ):
        MockApp.objects.get.return_value = MagicMock()
        MockEnv.objects.filter.return_value = env_qs

        # Falls through the custom gate to the count quota -> count error,
        # NOT the custom-environment error.
        with pytest.raises(GraphQLError, match="cannot add any more"):
            CreateEnvironmentMutation.mutate(
                None, _info(), _env_data("dev", name="Development"), []
            )
