"""An App's primary environment: the one other environments' values are
compared with, like a repository's main branch. At most one per App, chosen
when an environment is created or later in its settings."""

from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from graphql import GraphQLError

_M = "backend.graphene.mutations.environment"


def _env(env_id, is_primary=False, name=None):
    return SimpleNamespace(id=env_id, is_primary=is_primary, name=name or env_id)


@pytest.fixture
def envs():
    """The App's environments as the mutations read them, locked"""
    with patch(f"{_M}.Environment") as model, patch(f"{_M}.transaction"):
        model.siblings = []
        model.all_objects.select_for_update.return_value.filter.side_effect = (
            lambda **_: model.siblings
        )
        yield model


# ──────────────────────────────────────────────────────────────────────
# On create
# ──────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "env_type,requested,has_primary,expected",
    [
        # A client that doesn't choose: the production environment, unless there is one
        ("prod", None, False, True),
        ("PROD", None, False, True),
        ("prod", None, True, False),
        ("dev", None, False, False),
        ("custom", None, False, False),
        # One that chooses gets its choice, whatever the type
        ("custom", True, False, True),
        ("dev", True, False, True),
        ("prod", False, False, False),
    ],
)
def test_on_create(envs, env_type, requested, has_primary, expected):
    from backend.graphene.mutations.environment import _primary_on_create

    envs.siblings = [_env("other", is_primary=has_primary)]
    assert _primary_on_create(MagicMock(), env_type, requested) is expected


def test_on_create_a_second_primary_is_refused(envs):
    from backend.graphene.mutations.environment import _primary_on_create

    envs.siblings = [_env("prod", is_primary=True)]
    with pytest.raises(GraphQLError, match="already has a primary environment"):
        _primary_on_create(MagicMock(), "custom", True)


# ──────────────────────────────────────────────────────────────────────
# Moving it
# ──────────────────────────────────────────────────────────────────────


def _updates(envs):
    """(id, is_primary) for each row written, in order"""
    return [
        (call.kwargs["id"], update.kwargs["is_primary"])
        for call, update in zip(
            envs.all_objects.filter.call_args_list,
            [c for c in envs.all_objects.filter.return_value.update.call_args_list],
        )
    ]


def test_moving_it_takes_it_from_the_current_primary(envs):
    from backend.graphene.mutations.environment import _set_primary

    envs.siblings = [_env("prod", is_primary=True), _env("staging")]
    staging = SimpleNamespace(id="staging", app_id="app-1", is_primary=False)

    with patch(f"{_M}.user_can_access_environment", return_value=True):
        _set_primary(SimpleNamespace(userId="user-1"), staging, True)

    assert _updates(envs) == [("prod", False), ("staging", True)]
    assert staging.is_primary is True


def test_moving_it_needs_access_to_the_current_primary(envs):
    from backend.graphene.mutations.environment import _set_primary

    envs.siblings = [_env("prod", is_primary=True, name="Production"), _env("staging")]
    staging = SimpleNamespace(id="staging", app_id="app-1", is_primary=False)

    with patch(f"{_M}.user_can_access_environment", return_value=False), pytest.raises(
        GraphQLError, match="access to Production, the current primary"
    ):
        _set_primary(SimpleNamespace(userId="user-1"), staging, True)

    envs.all_objects.filter.return_value.update.assert_not_called()
    assert staging.is_primary is False


def test_an_app_can_be_left_without_one(envs):
    from backend.graphene.mutations.environment import _set_primary

    envs.siblings = [_env("prod", is_primary=True)]
    prod = SimpleNamespace(id="prod", app_id="app-1", is_primary=True)

    _set_primary(SimpleNamespace(userId="user-1"), prod, False)

    assert _updates(envs) == [("prod", False)]


# ──────────────────────────────────────────────────────────────────────
# In the environment's settings
# ──────────────────────────────────────────────────────────────────────


@pytest.fixture
def update():
    """renameEnvironment against Production, with the move itself stubbed"""
    from backend.graphene.mutations.environment import RenameEnvironmentMutation

    with ExitStack() as stack:
        m = MagicMock()
        m.Environment = stack.enter_context(patch(f"{_M}.Environment"))
        m.log_audit_event = stack.enter_context(patch(f"{_M}.log_audit_event"))
        m.set_primary = stack.enter_context(
            patch(
                f"{_M}._set_primary",
                side_effect=lambda user, env, value: setattr(env, "is_primary", value),
            )
        )
        stack.enter_context(patch(f"{_M}.user_has_permission", return_value=True))
        stack.enter_context(patch(f"{_M}.user_can_access_environment", return_value=True))
        stack.enter_context(
            patch(f"{_M}.get_actor_info_from_graphql", return_value=("user", "user-1", {}))
        )
        stack.enter_context(
            patch(f"{_M}.get_resolver_request_meta", return_value=("127.0.0.1", "pytest"))
        )
        stack.enter_context(patch(f"{_M}.environment_name_conflict", return_value=None))

        env = MagicMock(id="env-prod", color=None, is_primary=False)
        env.name = "Production"
        m.env = env
        m.Environment.objects.get.return_value = env
        info = MagicMock()
        info.context.user.userId = "user-1"
        m.run = lambda **kwargs: RenameEnvironmentMutation.mutate(
            None, info, environment_id="env-prod", **kwargs
        )
        yield m


def test_settings_make_it_primary(update):
    update.run(name="Production", is_primary=True)

    update.set_primary.assert_called_once()
    assert update.set_primary.call_args.args[1:] == (update.env, True)
    # Nothing a sync sends changed, so the environment isn't saved
    update.env.save.assert_not_called()
    event = update.log_audit_event.call_args.kwargs
    assert event["description"] == "Made 'Production' the primary environment"
    assert (event["old_values"]["is_primary"], event["new_values"]["is_primary"]) == (False, True)


def test_settings_leave_it_alone_when_not_given(update):
    update.run(name="Production", color="#10b981")

    update.set_primary.assert_not_called()
    assert update.log_audit_event.call_args.kwargs["description"] == "Updated environment 'Production'"


def test_settings_leave_it_alone_when_unchanged(update):
    update.env.is_primary = True
    update.run(name="Production", is_primary=True)

    update.set_primary.assert_not_called()


def test_settings_refused_for_a_bad_colour_leave_the_designation_alone(update):
    with pytest.raises(GraphQLError, match="hex value"):
        update.run(name="Production", color="red", is_primary=True)

    update.set_primary.assert_not_called()
