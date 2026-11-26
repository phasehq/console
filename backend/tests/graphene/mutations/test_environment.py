"""CreateEnvironmentMutation: custom environments on every plan, and the place
a new environment takes in its App's order.

Custom environments used to need a paid plan. They are open to every plan
now: the only limit is the per-App count quota (can_add_environment), as on
the REST API.
"""

from contextlib import ExitStack
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
    return SimpleNamespace(
        app_id="app-1",
        name=name,
        env_type=env_type,
        color=None,
        identity_key="env-ik",
        wrapped_seed="env-seed",
        wrapped_salt="env-salt",
    )


@pytest.fixture
def create():
    """Runs the mutation end to end against mocks. `max_index` is the highest
    index the App's environments have now, None when it has none."""
    from backend.graphene.mutations.environment import CreateEnvironmentMutation

    with ExitStack() as stack:
        m = MagicMock()
        for name in (
            "App",
            "Environment",
            "EnvironmentKey",
            "EnvironmentKeyGrant",
            "ServerEnvironmentKey",
            "OrganisationMember",
            "transaction",
            "log_audit_event",
        ):
            setattr(m, name, stack.enter_context(patch(f"{_M}.{name}")))
        stack.enter_context(patch(f"{_M}.user_can_access_app", return_value=True))
        stack.enter_context(patch(f"{_M}.user_has_permission", return_value=True))
        stack.enter_context(patch(f"{_M}.environment_name_conflict", return_value=None))
        stack.enter_context(
            patch(f"{_M}.get_actor_info_from_graphql", return_value=("user", "user-1", {}))
        )
        stack.enter_context(
            patch(f"{_M}.get_resolver_request_meta", return_value=("127.0.0.1", "pytest"))
        )
        m.can_add_environment = stack.enter_context(
            patch(f"{_M}.can_add_environment", return_value=True)
        )
        # No admin keys are sent, so no other member is looked up
        m.OrganisationMember.objects.filter.return_value.select_related.return_value = []

        def run(env_type, name="custom-env", max_index=None):
            m.Environment.all_objects.filter.return_value.aggregate.return_value = {
                "index__max": max_index
            }
            return CreateEnvironmentMutation.mutate(None, _info(), _env_data(env_type, name), [])

        m.run = run
        yield m


@pytest.mark.parametrize("env_type", ["custom", "dev", "staging", "prod"])
def test_any_environment_is_created_while_the_app_has_room(create, env_type):
    create.run(env_type)

    created = create.Environment.objects.create.call_args.kwargs
    assert created["env_type"] == env_type
    assert created["name"] == "custom-env"


@pytest.mark.parametrize("env_type", ["custom", "dev"])
def test_the_per_app_quota_is_the_only_limit(create, env_type):
    create.can_add_environment.return_value = False

    with pytest.raises(GraphQLError, match="cannot add any more"):
        create.run(env_type)

    create.Environment.objects.create.assert_not_called()


@pytest.mark.parametrize(
    "max_index,expected",
    [
        (None, 0),  # the App's first environment
        (0, 1),  # after an App whose only environment is at 0
        (2, 3),  # after Development, Staging and Production
        (6, 7),
    ],
)
def test_a_custom_environment_goes_after_the_last_one(create, max_index, expected):
    create.run("custom", max_index=max_index)

    assert create.Environment.objects.create.call_args.kwargs["index"] == expected


@pytest.mark.parametrize("env_type,expected", [("dev", 0), ("staging", 1), ("prod", 2)])
def test_the_standard_environments_keep_their_places(create, env_type, expected):
    create.run(env_type, name="Renamed", max_index=5)

    assert create.Environment.objects.create.call_args.kwargs["index"] == expected
