"""An environment's colour: validated on create and on update, and written
without re-running the environment's syncs.
"""

from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from graphql import GraphQLError

_M = "backend.graphene.mutations.environment"
NOT_HEX = ["red", "10b981", "#10b98", "#10b9811", "#10b98g", "rgb(16, 185, 129)"]


def _info():
    info = MagicMock()
    info.context.user.userId = "user-1"
    return info


# ──────────────────────────────────────────────────────────────────────
# createEnvironment
# ──────────────────────────────────────────────────────────────────────


def _create(color):
    """Runs the create as far as the per-App quota, which stops it before anything is written."""
    from backend.graphene.mutations.environment import CreateEnvironmentMutation

    data = SimpleNamespace(app_id="app-1", name="Preview", env_type="custom", color=color)

    with patch(f"{_M}.user_can_access_app", return_value=True), patch(
        f"{_M}.user_has_permission", return_value=True
    ), patch(f"{_M}.App"), patch(f"{_M}.Environment") as environments, patch(
        f"{_M}.environment_name_conflict", return_value=None
    ), patch(
        f"{_M}.can_add_environment", return_value=False
    ):
        try:
            CreateEnvironmentMutation.mutate(None, _info(), data, [])
        finally:
            environments.objects.create.assert_not_called()


@pytest.mark.parametrize("color", NOT_HEX)
def test_create_rejects_a_colour_that_is_not_hex(color):
    with pytest.raises(GraphQLError, match="must be a hex value"):
        _create(color)


@pytest.mark.parametrize("color", ["#10b981", "#10B981", " #10b981 ", "", "  ", None])
def test_create_accepts_a_hex_colour_or_none(color):
    # Past the colour check, it is the quota that stops this run
    with pytest.raises(GraphQLError, match="cannot add any more"):
        _create(color)


# ──────────────────────────────────────────────────────────────────────
# renameEnvironment
# ──────────────────────────────────────────────────────────────────────


@pytest.fixture
def update():
    """The mutation against an environment named Production, coloured #ef4444."""
    from backend.graphene.mutations.environment import RenameEnvironmentMutation

    with ExitStack() as stack:
        m = MagicMock()
        m.Environment = stack.enter_context(patch(f"{_M}.Environment"))
        m.log_audit_event = stack.enter_context(patch(f"{_M}.log_audit_event"))
        stack.enter_context(patch(f"{_M}.user_has_permission", return_value=True))
        stack.enter_context(patch(f"{_M}.user_can_access_environment", return_value=True))
        stack.enter_context(
            patch(f"{_M}.get_actor_info_from_graphql", return_value=("user", "user-1", {}))
        )
        stack.enter_context(
            patch(f"{_M}.get_resolver_request_meta", return_value=("127.0.0.1", "pytest"))
        )

        env = MagicMock(id="env-prod", color="#ef4444")
        env.name = "Production"
        m.env = env
        m.Environment.objects.get.return_value = env
        # No other environment of the App has the new name
        stack.enter_context(patch(f"{_M}.environment_name_conflict", return_value=None))
        m.run = lambda **kwargs: RenameEnvironmentMutation.mutate(
            None, _info(), environment_id="env-prod", **kwargs
        )
        yield m


@pytest.mark.parametrize("color", NOT_HEX)
def test_update_rejects_a_colour_that_is_not_hex(update, color):
    with pytest.raises(GraphQLError, match="must be a hex value"):
        update.run(name="Production", color=color)

    update.env.save.assert_not_called()
    update.Environment.objects.filter.return_value.update.assert_not_called()


def test_a_colour_alone_is_written_without_saving_the_environment(update):
    """Environment.save() re-runs every sync of the environment; a colour is nothing they send."""
    update.run(name="Production", color="#10b981")

    update.env.save.assert_not_called()
    update.Environment.objects.filter.assert_called_once_with(id="env-prod")
    written = update.Environment.objects.filter.return_value.update.call_args.kwargs
    assert written == {"color": "#10b981", "updated_at": update.env.updated_at}
    assert update.env.color == "#10b981"

    event = update.log_audit_event.call_args.kwargs
    assert event["description"] == "Updated environment 'Production'"
    assert event["old_values"] == {"name": "Production", "color": "#ef4444"}
    assert event["new_values"] == {"name": "Production", "color": "#10b981"}


def test_a_blank_colour_goes_back_to_the_default(update):
    update.run(name="Production", color="")

    written = update.Environment.objects.filter.return_value.update.call_args.kwargs
    assert written["color"] is None


def test_no_colour_given_leaves_it_as_it_is(update):
    update.run(name="Production")

    written = update.Environment.objects.filter.return_value.update.call_args.kwargs
    assert written["color"] == "#ef4444"


def test_a_rename_saves_the_environment_and_takes_the_colour_along(update):
    update.run(name="Live", color="#10b981")

    update.env.save.assert_called_once_with()
    update.Environment.objects.filter.return_value.update.assert_not_called()
    assert (update.env.name, update.env.color) == ("Live", "#10b981")
    assert update.log_audit_event.call_args.kwargs["description"] == (
        "Renamed environment 'Production' to 'Live'"
    )

