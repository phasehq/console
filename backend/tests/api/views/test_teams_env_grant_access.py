"""PUT /public/v1/teams/<id>/access/ wraps env keys server-side for every
team member, so a non-global caller may only scope a team to envs they hold.
Mirrors the member and service account access endpoints.
"""

import uuid
from unittest.mock import MagicMock, Mock, patch

import pytest
from rest_framework import status
from rest_framework.test import APIRequestFactory, force_authenticate

from api.views.teams import PublicTeamAccessView

TEAMS = "api.views.teams"
DENIED = "one or more environments in app 'api'"


def _role(managed_key):
    role = Mock()
    role.id = uuid.uuid4()
    role.name = managed_key.capitalize()
    role.is_default = True
    role.managed_key = managed_key
    return role


def _env(name):
    env = Mock()
    env.id = str(uuid.uuid4())
    env.name = name
    return env


def _build_request(org, team_id, data, principal_id, auth_type="User", role="manager"):
    request = APIRequestFactory().put(
        f"/public/v1/teams/{team_id}/access/", data=data, format="json"
    )
    member = Mock()
    member.id = uuid.uuid4()
    member.user = Mock(userId=principal_id, is_authenticated=True, is_active=True)
    member.role = _role(role)
    sa = None
    if auth_type == "ServiceAccount":
        sa = Mock()
        sa.id = principal_id
        sa.role = _role(role)
    auth = {
        "token": "Bearer test_token",
        "auth_type": auth_type,
        "app": None,
        "environment": None,
        "org_member": member if auth_type == "User" else None,
        "service_account": sa,
        "service_account_token": None,
        "organisation": org,
        "org_only": True,
    }
    force_authenticate(request, user=member.user, token=auth)
    return request


class TestTeamAccessEnvGrant:
    @pytest.fixture(autouse=True)
    def setup(self):
        self.org = Mock(id=uuid.uuid4(), plan="PR")
        self.team = Mock(id=uuid.uuid4(), organisation=self.org)
        self.team.name = "platform"
        self.dev, self.prod = _env("Development"), _env("Production")
        self.principal_id = uuid.uuid4()
        self.apps = {}
        self.envs_by_app = {}
        self.accessible = set()
        self.current = []  # (app, env) pairs already on the team's scope

        patches = {
            "transaction": patch(f"{TEAMS}.transaction"),
            "ip": patch(f"{TEAMS}.IsIPAllowed.has_permission", return_value=True),
            "throttle": patch(
                f"{TEAMS}.PlanBasedRateThrottle.allow_request", return_value=True
            ),
            "perm": patch(f"{TEAMS}.user_has_permission", return_value=True),
            "team_member": patch(f"{TEAMS}._is_team_member", return_value=True),
            "serialize": patch(f"{TEAMS}._serialize_team", return_value={}),
            "audit": patch(f"{TEAMS}.log_audit_event"),
            "actor": patch(f"{TEAMS}.get_actor_info", return_value=("user", "uid", {})),
            "meta": patch(
                f"{TEAMS}.get_resolver_request_meta",
                return_value=("127.0.0.1", "pytest"),
            ),
            "user_app": patch(f"{TEAMS}.user_can_access_app", return_value=True),
            "sa_app": patch(
                "api.utils.access.permissions.service_account_can_access_app",
                return_value=True,
            ),
            "user_env": patch(f"{TEAMS}.user_can_access_environment"),
            "sa_env": patch(f"{TEAMS}.service_account_can_access_environment"),
            "Team": patch(f"{TEAMS}.Team"),
            "App": patch(f"{TEAMS}.App"),
            "Environment": patch(f"{TEAMS}.Environment"),
            "TeamAppEnvironment": patch(f"{TEAMS}.TeamAppEnvironment"),
            "provision": patch(f"{TEAMS}.provision_team_environment_keys"),
            "revoke": patch(f"{TEAMS}.revoke_team_environment_keys"),
        }
        self.m = {name: p.start() for name, p in patches.items()}

        self.m["Team"].objects.get.return_value = self.team
        self.m["App"].objects.get.side_effect = lambda id, **kw: self.apps[id]
        self.m["Environment"].objects.filter.side_effect = self._filter_envs
        self.tae_rows = MagicMock()
        self.tae_rows.__iter__.side_effect = lambda: iter(
            Mock(app_id=app.id, environment_id=env.id) for app, env in self.current
        )
        self.m["TeamAppEnvironment"].objects.filter.return_value = self.tae_rows
        self.m["TeamAppEnvironment"].objects.get_or_create.return_value = (
            MagicMock(),
            True,
        )
        has_env = lambda principal_id, env_id: (
            principal_id == self.principal_id and env_id in self.accessible
        )
        self.m["user_env"].side_effect = has_env
        self.m["sa_env"].side_effect = has_env

        self.app = self._app("api", [self.dev, self.prod])
        yield
        for p in patches.values():
            p.stop()

    def _app(self, name, envs):
        app = Mock(id=str(uuid.uuid4()), sse_enabled=True)
        app.name = name
        self.apps[app.id] = app
        self.envs_by_app[app.id] = envs
        return app

    def _filter_envs(self, id__in, app=None):
        envs = (
            self.envs_by_app[app.id]
            if app is not None
            else [e for envs in self.envs_by_app.values() for e in envs]
        )
        return [e for e in envs if e.id in id__in]

    def _put(self, apps, **request_kwargs):
        data = {
            "apps": [
                {"id": app.id, "environments": [e.id for e in envs]}
                for app, envs in apps
            ]
        }
        request = _build_request(
            self.org, self.team.id, data, self.principal_id, **request_kwargs
        )
        return PublicTeamAccessView.as_view()(request, team_id=str(self.team.id))

    def _assert_nothing_changed(self):
        self.m["TeamAppEnvironment"].objects.get_or_create.assert_not_called()
        self.m["provision"].assert_not_called()
        self.m["revoke"].assert_not_called()
        self.tae_rows.delete.assert_not_called()

    def test_rejects_env_the_user_cannot_access(self):
        self.accessible = {self.dev.id}

        response = self._put([(self.app, [self.dev, self.prod])])

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert DENIED in response.data["error"]
        self._assert_nothing_changed()

    def test_rejects_env_the_service_account_cannot_access(self):
        self.accessible = {self.dev.id}

        response = self._put([(self.app, [self.prod])], auth_type="ServiceAccount")

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert DENIED in response.data["error"]
        self._assert_nothing_changed()

    def test_rejects_swapping_to_env_the_caller_cannot_access(self):
        self.current = [(self.app, self.dev)]
        self.accessible = {self.dev.id}

        response = self._put([(self.app, [self.prod])])

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert DENIED in response.data["error"]
        self._assert_nothing_changed()

    def test_rejects_env_in_a_repeated_app_entry(self):
        self.accessible = {self.dev.id}

        response = self._put([(self.app, [self.dev]), (self.app, [self.prod])])

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert DENIED in response.data["error"]
        self._assert_nothing_changed()

    def test_rejects_before_writing_any_app(self):
        other_env = _env("Development")
        other = self._app("web", [other_env])
        self.accessible = {other_env.id, self.dev.id}

        response = self._put([(other, [other_env]), (self.app, [self.prod])])

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert DENIED in response.data["error"]
        self._assert_nothing_changed()

    def test_allows_envs_the_caller_holds(self):
        self.accessible = {self.dev.id, self.prod.id}

        response = self._put([(self.app, [self.dev, self.prod])])

        assert response.status_code == status.HTTP_200_OK
        self.m["provision"].assert_called_once_with(self.team, self.app)

    def test_allows_swapping_between_envs_the_caller_holds(self):
        self.current = [(self.app, self.dev)]
        self.accessible = {self.dev.id, self.prod.id}

        response = self._put([(self.app, [self.prod])])

        assert response.status_code == status.HTTP_200_OK
        self.m["revoke"].assert_called_once_with(self.team, environments=[self.dev])
        self.tae_rows.delete.assert_called_once()
        self.m["provision"].assert_called_once_with(self.team, self.app)

    def test_global_access_caller_is_exempt(self):
        response = self._put([(self.app, [self.prod])], role="admin")

        assert response.status_code == status.HTTP_200_OK
        self.m["user_env"].assert_not_called()
        self.m["provision"].assert_called_once_with(self.team, self.app)
