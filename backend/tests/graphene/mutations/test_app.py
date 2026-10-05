"""CreateAppMutation name validation.

App.name is a 64-char column. The mutation must reject blank and over-long
names up front, matching UpdateAppInfoMutation and PublicAppsView, instead of
failing at the database.
"""

from unittest.mock import MagicMock, patch

import pytest
from graphql import GraphQLError


_M = "backend.graphene.mutations.app"


class _Created(Exception):
    """Stops the mutation once App.objects.create is reached."""


def _info():
    info = MagicMock()
    info.context.user.userId = "user-1"
    return info


def _create(name):
    from backend.graphene.mutations.app import CreateAppMutation

    return CreateAppMutation.mutate(
        None,
        _info(),
        id="app-1",
        organisation_id="org-1",
        name=name,
        identity_key="identity-key",
        app_token="app-token",
        app_seed="app-seed",
        wrapped_key_share="wrapped-key-share",
        app_version=1,
    )


@pytest.fixture
def mock_app():
    with patch(f"{_M}.Organisation"), patch(
        f"{_M}.user_is_org_member", return_value=True
    ), patch(f"{_M}.user_has_permission", return_value=True), patch(
        f"{_M}.App"
    ) as MockApp:
        MockApp.objects.filter.return_value.exists.return_value = False
        MockApp.objects.create.side_effect = _Created
        yield MockApp


@pytest.mark.parametrize("name", ["", "   "])
def test_create_app_rejects_blank_name(mock_app, name):
    with pytest.raises(GraphQLError, match="cannot be blank"):
        _create(name)

    mock_app.objects.create.assert_not_called()


def test_create_app_rejects_name_over_64_chars(mock_app):
    with pytest.raises(GraphQLError, match="cannot exceed 64 characters"):
        _create("a" * 65)

    mock_app.objects.create.assert_not_called()


def test_create_app_accepts_64_char_name(mock_app):
    name = "a" * 64

    with pytest.raises(_Created):
        _create(name)

    assert mock_app.objects.create.call_args.kwargs["name"] == name
