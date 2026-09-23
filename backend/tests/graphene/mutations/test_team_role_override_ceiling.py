"""Grant ceiling for team role overrides set through CreateTeam and
UpdateTeam: an override must be within the setter's own permissions
(global-access setters exempt). Re-saving or clearing an override is never
checked. SCIM-managed teams keep console-managed overrides, so the ceiling
applies to them like any other team.
"""

from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from graphql import GraphQLError

TEAMS = "backend.graphene.mutations.teams"



def _info():
    info = MagicMock()
    info.context.user = MagicMock()
    return info


def _default_role(managed_key):
    role = MagicMock()
    role.id = f"{managed_key}-role"
    role.name = managed_key.capitalize()
    role.is_default = True
    role.managed_key = managed_key
    role.permissions = {}
    return role


def _custom_role(name, permissions):
    role = MagicMock()
    role.id = name.lower().replace(" ", "-")
    role.name = name
    role.is_default = False
    role.managed_key = None
    role.permissions = permissions
    return role


OWNER = _default_role("owner")
ADMIN = _default_role("admin")
MANAGER = _default_role("manager")
DEVELOPER = _default_role("developer")
# No global access or SA-token create, so only the ceiling can reject it
SSO_ADMIN = _custom_role(
    "SSO Admin", {"permissions": {"SSO": ["create"]}, "app_permissions": {}}
)
# Admin holds only Organisation read/update, so this is above its own ceiling
ORG_DELETER = _custom_role(
    "Org Deleter", {"permissions": {"Organisation": ["delete"]}, "app_permissions": {}}
)
ROLES = {r.id: r for r in (OWNER, ADMIN, MANAGER, DEVELOPER, SSO_ADMIN, ORG_DELETER)}


def _actor(role):
    member = MagicMock()
    member.role = role
    return member


def _team(member_role=None, service_account_role=None, is_scim_managed=False):
    team = MagicMock()
    team.name = "platform"
    team.description = ""
    team.is_scim_managed = is_scim_managed
    team.member_role = member_role
    team.member_role_id = member_role.id if member_role else None
    team.service_account_role = service_account_role
    team.service_account_role_id = (
        service_account_role.id if service_account_role else None
    )
    return team


@pytest.fixture
def mocks():
    with ExitStack() as stack:
        # CreateTeam is decorated with @transaction.atomic; nothing here touches the DB
        stack.enter_context(
            patch("django.db.transaction.Atomic.__enter__", return_value=None)
        )
        stack.enter_context(
            patch("django.db.transaction.Atomic.__exit__", return_value=False)
        )
        m = SimpleNamespace()
        for name in (
            "Organisation",
            "OrganisationMember",
            "Role",
            "Team",
            "TeamMembership",
            "log_audit_event",
        ):
            setattr(m, name, stack.enter_context(patch(f"{TEAMS}.{name}")))
        for name in (
            "user_is_org_member",
            "user_has_permission",
            "user_is_team_member",
            "can_use_teams",
        ):
            stack.enter_context(patch(f"{TEAMS}.{name}", return_value=True))
        stack.enter_context(
            patch(
                f"{TEAMS}.get_actor_info_from_graphql",
                return_value=("user", "member-1", {}),
            )
        )
        stack.enter_context(
            patch(
                f"{TEAMS}.get_resolver_request_meta",
                return_value=("127.0.0.1", "pytest"),
            )
        )
        m.Role.objects.get.side_effect = lambda id, organisation: ROLES[id]
        yield m


def _create(mocks, actor_role, **overrides):
    from backend.graphene.mutations.teams import CreateTeamMutation

    mocks.OrganisationMember.objects.get.return_value = _actor(actor_role)
    return CreateTeamMutation.mutate(
        None, _info(), organisation_id="org-1", name="platform", **overrides
    )


def _update(mocks, actor_role, team, **changes):
    from backend.graphene.mutations.teams import UpdateTeamMutation

    mocks.Team.objects.get.return_value = team
    mocks.OrganisationMember.objects.get.return_value = _actor(actor_role)
    return UpdateTeamMutation.mutate(None, _info(), team_id="team-1", **changes)


# ────────────────────────────────────────────────────────────────────
# CreateTeam
# ────────────────────────────────────────────────────────────────────


def test_create_rejects_owner_member_override_above_manager(mocks):
    with pytest.raises(
        GraphQLError, match="You cannot assign the 'Owner' role"
    ) as exc_info:
        _create(mocks, MANAGER, member_role_id=OWNER.id)

    assert "global_access" in str(exc_info.value)
    mocks.Team.objects.create.assert_not_called()


def test_create_rejects_custom_member_override_above_manager(mocks):
    with pytest.raises(
        GraphQLError, match="You cannot assign the 'SSO Admin' role"
    ) as exc_info:
        _create(mocks, MANAGER, member_role_id=SSO_ADMIN.id)

    assert "permissions:SSO:create" in str(exc_info.value)
    mocks.Team.objects.create.assert_not_called()


def test_create_accepts_member_override_within_manager_ceiling(mocks):
    result = _create(mocks, MANAGER, member_role_id=MANAGER.id)

    mocks.Team.objects.create.assert_called_once()
    assert mocks.Team.objects.create.call_args.kwargs["member_role"] is MANAGER
    assert result.team is mocks.Team.objects.create.return_value


def test_create_global_access_setter_exempt_from_ceiling(mocks):
    """Admin lacks Owner's permissions itself, but global access is the
    delegation escape hatch."""
    _create(mocks, ADMIN, member_role_id=OWNER.id, service_account_role_id=ORG_DELETER.id)

    mocks.Team.objects.create.assert_called_once()


def test_create_rejects_owner_service_account_override_above_manager(mocks):
    with pytest.raises(
        GraphQLError, match="You cannot assign the 'Owner' role"
    ) as exc_info:
        _create(mocks, MANAGER, service_account_role_id=OWNER.id)

    assert "global_access" in str(exc_info.value)
    mocks.Team.objects.create.assert_not_called()


# ────────────────────────────────────────────────────────────────────
# UpdateTeam
# ────────────────────────────────────────────────────────────────────


def test_update_resubmitting_grandfathered_override_skips_ceiling(mocks):
    # The console dialog resends both overrides on every save
    team = _team(member_role=OWNER, service_account_role=OWNER)

    with patch(f"{TEAMS}.role_assignment_error") as mock_ceiling:
        _update(
            mocks,
            MANAGER,
            team,
            name="renamed",
            member_role_id=OWNER.id,
            service_account_role_id=OWNER.id,
        )

    mock_ceiling.assert_not_called()
    team.save.assert_called_once()
    assert team.name == "renamed"
    assert team.member_role is OWNER


def test_update_clearing_override_skips_ceiling(mocks):
    team = _team(member_role=OWNER, service_account_role=OWNER)

    with patch(f"{TEAMS}.role_assignment_error") as mock_ceiling:
        _update(mocks, MANAGER, team, member_role_id="", service_account_role_id="")

    mock_ceiling.assert_not_called()
    team.save.assert_called_once()
    assert team.member_role is None
    assert team.service_account_role is None


def test_update_rejects_member_override_change_above_manager(mocks):
    team = _team(member_role=MANAGER)

    with pytest.raises(
        GraphQLError, match="You cannot assign the 'Owner' role"
    ) as exc_info:
        _update(mocks, MANAGER, team, member_role_id=OWNER.id)

    assert "global_access" in str(exc_info.value)
    team.save.assert_not_called()


def test_update_rejects_service_account_override_change_above_manager(mocks):
    team = _team(service_account_role=DEVELOPER)

    with pytest.raises(GraphQLError, match="You cannot assign the 'SSO Admin' role"):
        _update(mocks, MANAGER, team, service_account_role_id=SSO_ADMIN.id)

    team.save.assert_not_called()


def test_update_accepts_override_change_within_manager_ceiling(mocks):
    team = _team(member_role=DEVELOPER)

    _update(mocks, MANAGER, team, member_role_id=MANAGER.id)

    team.save.assert_called_once()
    assert team.member_role is MANAGER


def test_update_global_access_setter_exempt_from_ceiling(mocks):
    team = _team()

    _update(mocks, ADMIN, team, member_role_id=ORG_DELETER.id)

    team.save.assert_called_once()
    assert team.member_role is ORG_DELETER


# ────────────────────────────────────────────────────────────────────
# SCIM-managed teams: overrides stay console-managed, so the ceiling
# applies but a change within it still saves
# ────────────────────────────────────────────────────────────────────


def test_update_scim_team_accepts_override_change_within_ceiling(mocks):
    team = _team(member_role=DEVELOPER, is_scim_managed=True)

    _update(mocks, MANAGER, team, member_role_id=MANAGER.id)

    team.save.assert_called_once()
    assert team.member_role is MANAGER


def test_update_scim_team_rejects_override_change_above_ceiling(mocks):
    team = _team(member_role=DEVELOPER, is_scim_managed=True)

    with pytest.raises(GraphQLError, match="You cannot assign the 'Owner' role"):
        _update(mocks, MANAGER, team, member_role_id=OWNER.id)

    team.save.assert_not_called()
