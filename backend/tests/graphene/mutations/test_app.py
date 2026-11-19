"""App mutations.

CreateAppMutation name validation: App.name is a 64-char column. The mutation
must reject blank and over-long names up front, matching UpdateAppInfoMutation
and PublicAppsView, instead of failing at the database.

updateAppInfo and deleteApp permission: checked with the member's role for
that App, as in the REST detail view and the Console. A team's member-role
override replaces the organisation role for access through that team; direct
app membership keeps the organisation role.
"""

from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from graphql import GraphQLError


_M = "backend.graphene.mutations.app"
_PERM = "api.utils.access.permissions"


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
    )


@pytest.fixture
def mock_app():
    with patch(f"{_M}.Organisation"), patch(
        f"{_M}.user_is_org_member", return_value=True
    ), patch(f"{_M}.user_has_permission", return_value=True), patch(
        f"{_M}.App"
    ) as MockApp:
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


# ──────────────────────────────────────────────────────────────────────
# updateAppInfo / deleteApp: the permission is the member's role for the App
# ──────────────────────────────────────────────────────────────────────


class _DoesNotExist(Exception):
    """Stands in for OrganisationMember.DoesNotExist."""


def _apps_role(*actions):
    """A custom role holding the given actions on Apps."""
    return SimpleNamespace(
        is_default=False,
        managed_key=None,
        permissions={"permissions": {"Apps": list(actions)}, "app_permissions": {}},
    )


CAN_MANAGE = _apps_role("read", "update", "delete")
READ_ONLY = _apps_role("read")

ACTIONS = ["update", "delete"]


@pytest.fixture
def app_world():
    """An App and the calling member, without a database. The permission
    check itself is not mocked. `reach()` sets how the member gets to the App:
    their organisation role, direct app membership, and the member-role
    override of each team that has the App in scope."""
    member = SimpleNamespace(id="member-1", role=None)
    app = MagicMock(id="app-1")
    app.name = "console"
    app.description = ""

    fakes = {"OrganisationMember": MagicMock(), "Team": MagicMock()}
    fakes["OrganisationMember"].DoesNotExist = _DoesNotExist
    fakes["OrganisationMember"].objects.get.return_value = member

    def reach(org_role, direct=False, team_roles=()):
        member.role = org_role
        app.members.all.return_value = [member] if direct else []
        fakes["Team"].objects.filter.return_value.distinct.return_value = [
            SimpleNamespace(member_role=role, owner_id="member-2")
            for role in team_roles
        ]

    with ExitStack() as stack:
        stack.enter_context(
            patch(f"{_PERM}.apps.get_model", side_effect=lambda _, name: fakes[name])
        )
        stack.enter_context(patch(f"{_M}.App")).objects.get.return_value = app
        stack.enter_context(patch(f"{_M}.user_can_access_app", return_value=True))
        stack.enter_context(
            patch(
                f"{_M}.get_actor_info_from_graphql",
                return_value=("user", "member-1", {}),
            )
        )
        stack.enter_context(
            patch(
                f"{_M}.get_resolver_request_meta",
                return_value=("127.0.0.1", "pytest"),
            )
        )
        stack.enter_context(patch(f"{_M}.log_audit_event"))
        stack.enter_context(patch(f"{_M}.audit_app_cascade_envs"))
        yield SimpleNamespace(
            reach=reach, applied={"update": app.save, "delete": app.delete}
        )


def _mutate(action):
    from backend.graphene.mutations.app import (
        DeleteAppMutation,
        UpdateAppInfoMutation,
    )

    if action == "update":
        return UpdateAppInfoMutation.mutate(None, _info(), id="app-1", name="renamed")
    return DeleteAppMutation.mutate(None, _info(), id="app-1")


@pytest.mark.parametrize("action", ACTIONS)
def test_team_role_override_grants_the_permission(app_world, action):
    """The organisation role lacks it; the team's override holds it."""
    app_world.reach(org_role=READ_ONLY, team_roles=[CAN_MANAGE])

    _mutate(action)

    app_world.applied[action].assert_called_once()


@pytest.mark.parametrize("action", ACTIONS)
def test_team_role_override_withholds_the_permission(app_world, action):
    """The organisation role holds it, but the App is reached only through a
    team whose override does not."""
    app_world.reach(org_role=CAN_MANAGE, team_roles=[READ_ONLY])

    with pytest.raises(GraphQLError, match=f"permission to {action} Apps"):
        _mutate(action)

    app_world.applied[action].assert_not_called()


@pytest.mark.parametrize("action", ACTIONS)
def test_direct_member_is_checked_on_the_organisation_role(app_world, action):
    app_world.reach(org_role=CAN_MANAGE, direct=True)

    _mutate(action)

    app_world.applied[action].assert_called_once()


@pytest.mark.parametrize("action", ACTIONS)
def test_direct_member_without_the_permission_is_refused(app_world, action):
    app_world.reach(org_role=READ_ONLY, direct=True)

    with pytest.raises(GraphQLError, match=f"permission to {action} Apps"):
        _mutate(action)

    app_world.applied[action].assert_not_called()
