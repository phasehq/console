"""Tests for UpdateAccountProfileMutation (account display name)."""

import pytest
from unittest.mock import MagicMock

from graphql import GraphQLError


def _mutate(user, full_name):
    from backend.graphene.mutations.account import UpdateAccountProfileMutation

    info = MagicMock()
    info.context.user = user
    return UpdateAccountProfileMutation.mutate(None, info, full_name)


def test_sets_trimmed_name():
    user = MagicMock()
    result = _mutate(user, "  Alice Example  ")
    assert result.ok is True
    assert user.full_name == "Alice Example"
    user.save.assert_called_once_with(update_fields=["full_name"])


def test_empty_name_clears_custom_name():
    """Clearing the name reverts /auth/me to the provider-reported name."""
    user = MagicMock()
    result = _mutate(user, "   ")
    assert result.ok is True
    assert user.full_name == ""


def test_overlong_name_rejected():
    user = MagicMock()
    with pytest.raises(GraphQLError, match="128 characters"):
        _mutate(user, "x" * 129)
    user.save.assert_not_called()
