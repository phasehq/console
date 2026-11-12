"""AddTeamApps and UpdateTeamAppEnvironments wrap env keys server-side for
every team member, so a non-global caller may only scope a team to envs they
hold themselves. Team ownership does not exempt; global access does.
"""

from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from graphql import GraphQLError

TEAMS = "backend.graphene.mutations.teams"


def _role(managed_key):
    role = MagicMock()
    role.is_default = True
    role.managed_key = managed_key
    return role


MANAGER = _role("manager")
ADMIN = _role("admin")


class _QS(list):
    def values_list(self, field, flat=False):
        return [getattr(obj, field) for obj in self]


def _env(env_id, name):
    env = MagicMock()
    env.id = env_id
    env.name = name
    return env


DEV = _env("env-dev", "Development")
STAGING = _env("env-staging", "Staging")
PROD = _env("env-prod", "Production")
ENVS = {e.id: e for e in (DEV, STAGING, PROD)}
DENIED = "one or more environments in app 'api'"


def _info():
    info = MagicMock()
    info.context.user.userId = "user-1"
    return info


def _team(owned_by_caller=True):
    team = MagicMock()
    team.name = "platform"
    team.owner.user_id = "user-1" if owned_by_caller else "someone-else"
    return team


@pytest.fixture
def mocks():
    with ExitStack() as stack:
        stack.enter_context(
            patch("django.db.transaction.Atomic.__enter__", return_value=None)
        )
        stack.enter_context(
            patch("django.db.transaction.Atomic.__exit__", return_value=False)
        )
        m = SimpleNamespace()
        for name in (
            "App",
            "Environment",
            "OrganisationMember",
            "Team",
            "TeamAppEnvironment",
            "log_audit_event",
            "provision_team_environment_keys",
            "revoke_team_environment_keys",
        ):
            setattr(m, name, stack.enter_context(patch(f"{TEAMS}.{name}")))
        for name in (
            "user_is_org_member",
            "user_is_team_member",
            "user_can_access_app",
        ):
            stack.enter_context(patch(f"{TEAMS}.{name}", return_value=True))
        m.user_has_permission = stack.enter_context(
            patch(f"{TEAMS}.user_has_permission", return_value=True)
        )
        m.user_can_access_environment = stack.enter_context(
            patch(f"{TEAMS}.user_can_access_environment")
        )
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

        m.team = _team()
        m.Team.objects.get.return_value = m.team
        m.app = MagicMock(sse_enabled=True)
        m.app.name = "api"
        m.App.objects.get.return_value = m.app
        m.Environment.objects.get.side_effect = lambda id, app: ENVS[id]
        m.Environment.objects.filter.side_effect = lambda id__in, **kw: _QS(
            ENVS[i] for i in id__in if i in ENVS
        )
        m.TeamAppEnvironment.objects.get_or_create.return_value = (MagicMock(), True)
        yield m


def _caller(mocks, role, accessible):
    mocks.OrganisationMember.objects.get.return_value = MagicMock(role=role)
    held = {e.id for e in accessible}
    mocks.user_can_access_environment.side_effect = (
        lambda user_id, env_id: user_id == "user-1" and env_id in held
    )


def _add(env_ids):
    from backend.graphene.mutations.teams import AddTeamAppsMutation

    return AddTeamAppsMutation.mutate(
        None,
        _info(),
        team_id="team-1",
        app_envs=[SimpleNamespace(app_id="app-1", env_ids=env_ids)],
    )


def _update(mocks, current, env_ids):
    from backend.graphene.mutations.teams import UpdateTeamAppEnvironmentsMutation

    mocks.TeamAppEnvironment.objects.filter.return_value.values_list.return_value = [
        e.id for e in current
    ]
    return UpdateTeamAppEnvironmentsMutation.mutate(
        None, _info(), team_id="team-1", app_id="app-1", env_ids=env_ids
    )


# ────────────────────────────────────────────────────────────────────
# AddTeamApps
# ────────────────────────────────────────────────────────────────────


def test_add_rejects_env_the_team_owner_cannot_access(mocks):
    """The pentest chain: a Manager scoped to Development owns the team, which
    exempts them from the app-level Teams permission, and names Production."""
    _caller(mocks, MANAGER, accessible=[DEV])
    mocks.user_has_permission.side_effect = (
        lambda *args, is_app_resource=False, **kw: not is_app_resource
    )

    with pytest.raises(GraphQLError, match=DENIED):
        _add([PROD.id])

    mocks.TeamAppEnvironment.objects.get_or_create.assert_not_called()
    mocks.provision_team_environment_keys.assert_not_called()


def test_add_rejects_whole_grant_if_any_env_is_inaccessible(mocks):
    _caller(mocks, MANAGER, accessible=[DEV])

    with pytest.raises(GraphQLError, match=DENIED):
        _add([DEV.id, PROD.id])

    mocks.TeamAppEnvironment.objects.get_or_create.assert_not_called()
    mocks.provision_team_environment_keys.assert_not_called()


def test_add_rejects_inaccessible_env_for_non_owner(mocks):
    mocks.team.owner.user_id = "someone-else"
    _caller(mocks, MANAGER, accessible=[DEV])

    with pytest.raises(GraphQLError, match=DENIED):
        _add([PROD.id])

    mocks.provision_team_environment_keys.assert_not_called()


def test_add_allows_envs_the_caller_holds(mocks):
    _caller(mocks, MANAGER, accessible=[DEV, STAGING])

    result = _add([DEV.id, STAGING.id])

    granted = [
        c.kwargs["environment"]
        for c in mocks.TeamAppEnvironment.objects.get_or_create.call_args_list
    ]
    assert granted == [DEV, STAGING]
    mocks.provision_team_environment_keys.assert_called_once_with(mocks.team, mocks.app)
    assert result.team is mocks.team


def test_add_global_access_caller_is_exempt(mocks):
    _caller(mocks, ADMIN, accessible=[])

    _add([PROD.id])

    mocks.user_can_access_environment.assert_not_called()
    mocks.provision_team_environment_keys.assert_called_once()


# ────────────────────────────────────────────────────────────────────
# UpdateTeamAppEnvironments
# ────────────────────────────────────────────────────────────────────


def test_update_rejects_adding_env_the_caller_cannot_access(mocks):
    _caller(mocks, MANAGER, accessible=[DEV])

    with pytest.raises(GraphQLError, match=DENIED):
        _update(mocks, current=[DEV], env_ids=[DEV.id, PROD.id])

    mocks.TeamAppEnvironment.objects.get_or_create.assert_not_called()
    mocks.provision_team_environment_keys.assert_not_called()
    mocks.revoke_team_environment_keys.assert_not_called()


def test_update_rejects_swapping_to_env_the_caller_cannot_access(mocks):
    """Dropping an env in the same request must not happen either."""
    _caller(mocks, MANAGER, accessible=[DEV])

    with pytest.raises(GraphQLError, match=DENIED):
        _update(mocks, current=[DEV], env_ids=[PROD.id])

    mocks.revoke_team_environment_keys.assert_not_called()
    mocks.TeamAppEnvironment.objects.filter.return_value.delete.assert_not_called()
    mocks.provision_team_environment_keys.assert_not_called()


def test_update_allows_envs_the_caller_holds(mocks):
    _caller(mocks, MANAGER, accessible=[DEV, STAGING])

    _update(mocks, current=[DEV], env_ids=[DEV.id, STAGING.id])

    mocks.TeamAppEnvironment.objects.get_or_create.assert_called_once_with(
        team=mocks.team, app=mocks.app, environment=STAGING
    )
    mocks.provision_team_environment_keys.assert_called_once_with(mocks.team, mocks.app)


def test_update_global_access_caller_is_exempt(mocks):
    _caller(mocks, ADMIN, accessible=[])

    _update(mocks, current=[DEV], env_ids=[DEV.id, PROD.id])

    mocks.user_can_access_environment.assert_not_called()
    mocks.TeamAppEnvironment.objects.get_or_create.assert_called_once_with(
        team=mocks.team, app=mocks.app, environment=PROD
    )
