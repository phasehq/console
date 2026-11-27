"""Reordering an app's environments: one that is pending deletion keeps its
place among them, where the secrets grid draws its column and a restore puts
it back. The app's environments are read once, locked, and renumbered in one
transaction, so a deletion scheduled or undone meanwhile can't leave two with
one index.
"""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from graphql import GraphQLError

_M = "backend.graphene.mutations.environment"


def _env(env_id, index, pending=False):
    deleted_at = datetime(2026, 1, 1, tzinfo=timezone.utc) if pending else None
    return SimpleNamespace(
        id=env_id, index=index, deleted_at=deleted_at, is_deleted=False
    )


def _pending(env_id, index):
    return _env(env_id, index, pending=True)


def _reorder(live, pending, order, calls=None):
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
        f"{_M}.transaction"
    ) as transaction:
        locked = environments.all_objects.select_for_update.return_value
        locked.filter.return_value.order_by.return_value = [*live, *pending]
        environments.all_objects.filter.side_effect = rows
        UpdateEnvironmentOrderMutation.mutate(None, MagicMock(), "app-1", order)
        if calls is not None:
            calls.update(environments=environments, transaction=transaction)
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
        [_pending("staging", 1)],
        ["prod", "qa", "dev"],
    )

    assert given == {"prod": 0, "staging": 1, "qa": 2, "dev": 3}


def test_pending_environments_at_either_end_stay_there():
    given = _reorder(
        [_env("staging", 1), _env("qa", 2)],
        [_pending("dev", 0), _pending("prod", 3)],
        ["qa", "staging"],
    )

    assert given == {"dev": 0, "qa": 1, "staging": 2, "prod": 3}


def test_a_pending_environment_stands_after_one_that_has_its_index():
    """Indexes left by a reorder made before pending environments kept their
    place: the grid draws the pending one after its namesake."""
    given = _reorder(
        [_env("dev", 0), _env("qa", 1), _env("prod", 2)],
        [_pending("staging", 1)],
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
            [_pending("old", 3)],
            order,
        )


def test_the_environments_are_read_once_locked_in_the_transaction_that_writes_them():
    calls = {}
    _reorder(
        [_env("dev", 0), _env("prod", 2)],
        [_pending("staging", 1)],
        ["prod", "dev"],
        calls,
    )

    environments, transaction = calls["environments"], calls["transaction"]
    transaction.atomic.assert_called_once_with()
    environments.all_objects.select_for_update.assert_called_once_with()
    # Not a second, later read of those that are live or pending
    environments.objects.filter.assert_not_called()


def test_a_soft_deleted_environment_of_an_old_release_takes_no_place():
    gone = SimpleNamespace(
        id="gone",
        index=1,
        deleted_at=datetime(2023, 1, 1, tzinfo=timezone.utc),
        is_deleted=True,
    )

    given = _reorder([_env("dev", 0), _env("prod", 2)], [gone], ["prod", "dev"])

    assert given == {"prod": 0, "dev": 1}
