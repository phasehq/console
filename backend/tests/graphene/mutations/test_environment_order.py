"""Reordering an app's environments: one that is pending deletion keeps its
place among them, where the secrets grid draws its column and a restore puts
it back.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from graphql import GraphQLError

_M = "backend.graphene.mutations.environment"


def _env(env_id, index):
    return SimpleNamespace(id=env_id, index=index)


def _reorder(live, pending, order):
    """Runs the mutation over an app with those environments. Returns the
    index each environment was given."""
    from backend.graphene.mutations.environment import (
        UpdateEnvironmentOrderMutation,
    )

    given = {}

    def rows(**filters):
        row = MagicMock()
        if "id" in filters:
            row.update.side_effect = lambda index: given.__setitem__(
                filters["id"], index
            )
        return row

    with patch(f"{_M}.App"), patch(f"{_M}.Environment") as environments, patch(
        f"{_M}.user_has_permission", return_value=True
    ), patch(f"{_M}.can_use_custom_envs", return_value=True), patch(
        f"{_M}.pending_deletion", return_value=pending
    ):
        environments.objects.filter.return_value = live
        environments.all_objects.filter.side_effect = rows
        UpdateEnvironmentOrderMutation.mutate(None, MagicMock(), "app-1", order)
    return given


def test_the_given_order_becomes_the_environments_indexes():
    given = _reorder(
        [_env("dev", 0), _env("staging", 1), _env("prod", 2)],
        [],
        ["prod", "dev", "staging"],
    )

    assert given == {"prod": 0, "dev": 1, "staging": 2}


def test_an_environment_pending_deletion_keeps_its_place():
    # dev, (staging), qa, prod: the three that are left trade places around it
    given = _reorder(
        [_env("dev", 0), _env("qa", 2), _env("prod", 3)],
        [_env("staging", 1)],
        ["prod", "qa", "dev"],
    )

    assert given == {"prod": 0, "staging": 1, "qa": 2, "dev": 3}


def test_pending_environments_at_either_end_stay_there():
    given = _reorder(
        [_env("staging", 1), _env("qa", 2)],
        [_env("dev", 0), _env("prod", 3)],
        ["qa", "staging"],
    )

    assert given == {"dev": 0, "qa": 1, "staging": 2, "prod": 3}


def test_a_pending_environment_stands_after_one_that_has_its_index():
    """Indexes left by a reorder made before pending environments kept their
    place: the grid draws the pending one after its namesake."""
    given = _reorder(
        [_env("dev", 0), _env("qa", 1), _env("prod", 2)],
        [_env("staging", 1)],
        ["dev", "qa", "prod"],
    )

    assert given == {"dev": 0, "qa": 1, "staging": 2, "prod": 3}


@pytest.mark.parametrize(
    "order",
    [
        ["dev", "prod"],  # one of the app's is missing
        ["dev", "staging", "prod", "other"],  # one that isn't the app's
        ["dev", "staging", "prod", "prod"],  # one twice
        ["dev", "staging", "prod", "old"],  # the pending one is not to be given
    ],
)
def test_a_list_that_is_not_the_apps_environments_is_refused(order):
    with pytest.raises(GraphQLError, match="doesn't match the app's environments"):
        _reorder(
            [_env("dev", 0), _env("staging", 1), _env("prod", 2)],
            [_env("old", 3)],
            order,
        )
