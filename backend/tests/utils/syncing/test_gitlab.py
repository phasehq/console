"""GitLab CI sync: environment scope validation, scope-aware variable sync and
listing project environments."""

import urllib.parse
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from api.utils.syncing.gitlab import main as gitlab
from api.utils.syncing.gitlab.main import (
    get_environment_scopes_of_other_syncs,
    list_gitlab_environments,
    list_gitlab_group_environment_scopes,
    normalize_environment_scope,
    sync_gitlab_secrets,
)

GITLAB_HOST = "https://gitlab.example.com"
REAL_GET_GITLAB_CREDENTIALS = gitlab.get_gitlab_credentials


@pytest.fixture(autouse=True)
def gitlab_credentials():
    with patch.object(
        gitlab, "get_gitlab_credentials", return_value=(GITLAB_HOST, "glpat-test")
    ) as mock_credentials:
        yield mock_credentials


def _response(status_code=200, json_data=None, headers=None):
    response = MagicMock()
    response.status_code = status_code
    response.json.return_value = json_data if json_data is not None else {}
    response.headers = headers or {}
    response.text = str(json_data)
    return response


class FakeGitLab:
    """In-memory GitLab CI/CD variables API for one project or group, following
    GitLab's behaviour: keys are unique per environment scope, GET, PUT and DELETE
    select a variable with filter[environment_scope], and group PUTs (only) fall back
    to any variable with the key when the filter matches nothing."""

    def __init__(self, variables=(), is_group=False, drops_scope=False):
        self.is_group = is_group
        # GitLab tiers without scoped group variables ignore environment_scope
        self.drops_scope = drops_scope
        self.variables = [
            {
                "key": key,
                "value": value,
                "environment_scope": scope,
                "masked": False,
                "protected": False,
                "raw": True,
                "description": "",
            }
            for key, value, scope in variables
        ]
        # Ignore the environment_scope sent when updating a variable
        self.ignores_update_scope = False
        self.calls = []
        self.fail_delete_scopes = set()
        self.base_url = (
            f"{GITLAB_HOST}/api/v4/{'groups' if is_group else 'projects'}/123/variables"
        )

    def scoped(self, scope):
        return {
            v["key"]: v["value"]
            for v in self.variables
            if v["environment_scope"] == scope
        }

    def find(self, key, scope):
        return next(
            (
                v
                for v in self.variables
                if v["key"] == key and v["environment_scope"] == scope
            ),
            None,
        )

    def request(self, method, url, headers=None, params=None, json=None, **kwargs):
        self.calls.append(
            SimpleNamespace(
                method=method, url=url, params=params, json=json, kwargs=kwargs
            )
        )
        params = params or {}
        scope_filter = params.get("filter[environment_scope]")

        if url == self.base_url and method == "GET":
            page, per_page = int(params["page"]), int(params["per_page"])
            variables = self.variables[(page - 1) * per_page : page * per_page]
            return _response(200, [dict(v) for v in variables])

        if url == self.base_url and method == "POST":
            scope = "*" if self.drops_scope else json.get("environment_scope", "*")
            if self.find(json["key"], scope):
                return _response(
                    400, {"key": [f"({json['key']}) has already been taken"]}
                )
            variable = {**json, "environment_scope": scope}
            self.variables.append(variable)
            return _response(201, dict(variable))

        key = urllib.parse.unquote_plus(url[len(self.base_url) + 1 :])
        variable = self.find(key, scope_filter)

        if method == "GET":
            if variable is None:
                return _response(404, {"message": "404 Variable Not Found"})
            return _response(200, dict(variable))

        if method == "PUT":
            if variable is None and self.is_group:
                variable = next((v for v in self.variables if v["key"] == key), None)
            if variable is None:
                return _response(404, {"message": "404 Variable Not Found"})
            update = dict(json)
            if self.drops_scope or self.ignores_update_scope:
                update.pop("environment_scope", None)
            new_scope = update.get("environment_scope", variable["environment_scope"])
            if new_scope != variable["environment_scope"] and self.find(key, new_scope):
                return _response(400, {"key": [f"({key}) has already been taken"]})
            variable.update(update)
            return _response(200, dict(variable))

        if method == "DELETE":
            if variable is None:
                return _response(404, {"message": "404 Variable Not Found"})
            if scope_filter in self.fail_delete_scopes:
                return _response(500, {"message": "500 Internal Server Error"})
            self.variables.remove(variable)
            return _response(204)

        raise AssertionError(f"Unexpected request {method} {url}")


def _sync(fake, secrets, request=None, **kwargs):
    with patch.object(gitlab.requests, "request", side_effect=request or fake.request):
        return sync_gitlab_secrets(
            secrets, "cred-1", "123", is_group=fake.is_group, **kwargs
        )


# ---- normalize_environment_scope ------------------------------------------------


@pytest.mark.parametrize(
    ("scope", "expected"),
    [
        (None, "*"),
        ("", "*"),
        ("   ", "*"),
        ("*", "*"),
        ("production", "production"),
        ("  staging ", "staging"),
        ("review/*", "review/*"),
        ("review/feature-login", "review/feature-login"),
        ("${CI_ENVIRONMENT_NAME}", "${CI_ENVIRONMENT_NAME}"),
        ("prod eu.1", "prod eu.1"),
        ("a" * 255, "a" * 255),
    ],
)
def test_normalize_environment_scope_accepts_valid_scopes(scope, expected):
    assert normalize_environment_scope(scope) == expected


@pytest.mark.parametrize(
    "scope",
    [
        "prod;rm -rf",
        "prod?x=1",
        "prod\nuction",
        "production\x00",
        "prod#1",
        "prodüction",
        "a" * 256,
    ],
)
def test_normalize_environment_scope_rejects_invalid_scopes(scope):
    with pytest.raises(ValueError):
        normalize_environment_scope(scope)


# ---- sync_gitlab_secrets: syncs with a scope ---------------------------------------


def test_scoped_sync_only_manages_variables_in_its_scope():
    fake = FakeGitLab(
        [
            ("DATABASE_URL", "old-prod-url", "production"),
            ("STALE_KEY", "stale", "production"),
            ("DATABASE_URL", "staging-url", "staging"),
            ("UNSCOPED_ONLY", "unscoped", "*"),
        ]
    )

    success, result = _sync(
        fake,
        [
            ("DATABASE_URL", "new-prod-url", "Primary database"),
            ("API_KEY", "prod-api-key", ""),
        ],
        environment_scope="production",
    )

    assert success, result
    assert result["message"] == "Secrets synchronized successfully."
    assert fake.scoped("production") == {
        "DATABASE_URL": "new-prod-url",
        "API_KEY": "prod-api-key",
    }
    assert fake.find("DATABASE_URL", "production")["description"] == "Primary database"
    assert fake.scoped("staging") == {"DATABASE_URL": "staging-url"}
    assert fake.scoped("*") == {"UNSCOPED_ONLY": "unscoped"}


def test_all_environments_sync_only_manages_unscoped_variables():
    fake = FakeGitLab(
        [
            ("SHARED", "unscoped-value", "*"),
            ("SHARED", "production-value", "production"),
            ("PROD_ONLY", "production-only", "production"),
        ]
    )

    success, result = _sync(fake, [("SHARED", "new-value", "")], environment_scope="*")

    assert success, result
    assert fake.scoped("*") == {"SHARED": "new-value"}
    assert fake.scoped("production") == {
        "SHARED": "production-value",
        "PROD_ONLY": "production-only",
    }


def test_scoped_sync_reports_no_changes_when_in_sync():
    fake = FakeGitLab(
        [("API_KEY", "value", "staging"), ("API_KEY", "other", "production")]
    )
    fake.find("API_KEY", "staging")["description"] = "comment"

    success, result = _sync(
        fake, [("API_KEY", "value", "comment")], environment_scope="staging"
    )

    assert success, result
    assert result["message"] == "No changes needed. Secrets are already synchronized."
    assert [call.method for call in fake.calls] == ["GET", "GET"]


def test_scoped_sync_updates_variable_when_masked_or_protected_changes():
    fake = FakeGitLab([("API_KEY", "value12345", "staging")])

    success, _ = _sync(
        fake,
        [("API_KEY", "value12345", "")],
        is_masked=True,
        is_protected=True,
        environment_scope="staging",
    )

    assert success
    variable = fake.find("API_KEY", "staging")
    assert variable["masked"] is True
    assert variable["protected"] is True


def test_scoped_sync_paginates_through_variables_of_other_scopes():
    fake = FakeGitLab(
        [(f"OTHER_{i}", "x", "loadtest") for i in range(150)]
        + [("STALE_KEY", "stale", "production")]
    )

    success, result = _sync(
        fake, [("API_KEY", "value", "")], environment_scope="production"
    )

    assert success, result
    assert fake.scoped("production") == {"API_KEY": "value"}
    assert len(fake.scoped("loadtest")) == 150


def test_sync_fails_when_there_are_too_many_variable_pages(monkeypatch):
    monkeypatch.setattr(gitlab, "GITLAB_VARIABLES_MAX_PAGES", 3)
    fake = FakeGitLab([(f"KEY_{i}", "x", "other") for i in range(500)])

    success, result = _sync(fake, [], environment_scope="production")

    assert not success
    assert "Too many CI/CD variables" in result["error"]


def test_sync_targets_the_group_variables_api():
    fake = FakeGitLab(is_group=True)

    with patch.object(gitlab.requests, "request", side_effect=fake.request) as request:
        sync_gitlab_secrets([], "cred-1", "my-group/sub group", is_group=True)

    assert request.call_args.args[1] == (
        f"{GITLAB_HOST}/api/v4/groups/my-group%2Fsub+group/variables"
    )


def test_requests_do_not_follow_redirects_and_time_out():
    fake = FakeGitLab(
        [("STALE_KEY", "stale", "production"), ("API_KEY", "old", "production")]
    )

    _sync(
        fake,
        [("API_KEY", "new", ""), ("NEW_KEY", "new", "")],
        environment_scope="production",
    )

    assert {call.method for call in fake.calls} == {"GET", "PUT", "POST", "DELETE"}
    for call in fake.calls:
        assert call.kwargs["allow_redirects"] is False
        assert call.kwargs["timeout"] == gitlab.GITLAB_REQUEST_TIMEOUT


def _redirect(location, status_code=301):
    return _response(status_code, {}, headers={"Location": location})


@pytest.mark.parametrize("status_code", [301, 302, 303, 307, 308])
def test_request_follows_redirect_to_https_on_the_same_host(status_code):
    """GitLab hosts entered as http:// often redirect to https://. Requests used to
    follow that, so syncs using such hosts must keep working."""

    request = MagicMock(
        side_effect=[
            _redirect(
                "https://gitlab.example.com/api/v4/projects/1/variables/KEY",
                status_code,
            ),
            _response(200, {"key": "KEY"}),
        ]
    )

    with patch.object(gitlab.requests, "request", request):
        response = gitlab.gitlab_request(
            "PUT",
            "http://gitlab.example.com/api/v4/projects/1/variables/KEY",
            headers={"Private-Token": "glpat-test"},
            json={"value": "secret"},
        )

    assert response.status_code == 200
    first, second = request.call_args_list
    assert second.args == (
        "PUT",
        "https://gitlab.example.com/api/v4/projects/1/variables/KEY",
    )
    # The method, body and token are kept: the host is the same
    assert second.kwargs["json"] == {"value": "secret"}
    assert second.kwargs["headers"] == {"Private-Token": "glpat-test"}
    assert second.kwargs["allow_redirects"] is False


def test_request_follows_relative_redirect():
    request = MagicMock(
        side_effect=[_redirect("/gitlab/api/v4/user"), _response(200, {"id": 1})]
    )

    with patch.object(gitlab.requests, "request", request):
        gitlab.gitlab_request("GET", "https://gitlab.example.com/api/v4/user")

    assert request.call_args.args == (
        "GET",
        "https://gitlab.example.com/gitlab/api/v4/user",
    )


@pytest.mark.parametrize(
    "location",
    [
        "https://attacker.example.net/api/v4/projects/1/variables",
        "http://169.254.169.254/latest/meta-data/",
        "https://gitlab.example.com.attacker.example.net/api/v4/user",
        # No downgrade from https to http
        "http://gitlab.example.com/api/v4/projects/1/variables",
        "ftp://gitlab.example.com/api/v4/projects/1/variables",
    ],
)
def test_request_does_not_follow_redirect_elsewhere(location):
    request = MagicMock(return_value=_redirect(location))

    with patch.object(gitlab.requests, "request", request):
        with pytest.raises(
            Exception, match="redirected the request to another address"
        ):
            gitlab.gitlab_request(
                "POST",
                "https://gitlab.example.com/api/v4/projects/1/variables",
                headers={"Private-Token": "glpat-test"},
                json={"key": "KEY", "value": "secret"},
            )

    request.assert_called_once()


def test_request_stops_after_too_many_redirects():
    request = MagicMock(
        return_value=_redirect("https://gitlab.example.com/api/v4/user")
    )

    with patch.object(gitlab.requests, "request", request):
        with pytest.raises(Exception, match="too many times"):
            gitlab.gitlab_request("GET", "https://gitlab.example.com/api/v4/user")

    assert request.call_count == gitlab.GITLAB_MAX_REDIRECTS + 1


def test_sync_rejects_invalid_environment_scope_before_calling_gitlab():
    fake = FakeGitLab()

    success, result = _sync(
        fake, [("API_KEY", "value", "")], environment_scope="prod;uction"
    )

    assert not success
    assert "Environment scope" in result["error"]
    assert fake.calls == []


def test_sync_fails_when_update_fails():
    fake = FakeGitLab([("API_KEY", "old", "production")])

    def failing_update(method, url, **kwargs):
        if method == "PUT":
            return _response(400, {"message": "bad request"})
        return fake.request(method, url, **kwargs)

    success, result = _sync(
        fake,
        [("API_KEY", "new", "")],
        request=failing_update,
        environment_scope="production",
    )

    assert not success
    assert "Failed to update secret API_KEY" in result["error"]


# ---- sync_gitlab_secrets: GitLab scope handling ------------------------------------


def test_group_sync_checks_scope_support_before_writing_secrets():
    """GitLab tiers without scoped group variables drop the scope and create the
    variable for all environments. No secret may be written there."""

    fake = FakeGitLab([("UNSCOPED", "unscoped", "*")], is_group=True, drops_scope=True)

    success, result = _sync(
        fake, [("API_KEY", "prod-secret", "")], environment_scope="production"
    )

    assert not success
    assert "Premium or Ultimate" in result["error"]
    assert all(v["value"] != "prod-secret" for v in fake.variables)
    # The throwaway variable used for the check was removed again
    assert fake.scoped("*") == {"UNSCOPED": "unscoped"}
    check = next(call for call in fake.calls if call.method == "POST")
    assert check.json["key"].startswith("PHASE_SCOPE_CHECK_")


def test_group_sync_checks_scope_support_before_updating_secrets():
    """Groups downgraded to a tier without scoped variables can still have them."""

    fake = FakeGitLab(
        [("API_KEY", "unscoped-value", "*"), ("API_KEY", "old-prod", "production")],
        is_group=True,
        drops_scope=True,
    )

    success, result = _sync(
        fake, [("API_KEY", "new-prod", "")], environment_scope="production"
    )

    assert not success
    assert "Premium or Ultimate" in result["error"]
    assert fake.scoped("*") == {"API_KEY": "unscoped-value"}
    assert fake.scoped("production") == {"API_KEY": "old-prod"}


def test_group_sync_reports_scope_check_variable_it_could_not_remove():
    fake = FakeGitLab(is_group=True, drops_scope=True)
    fake.fail_delete_scopes.add("*")

    success, result = _sync(
        fake, [("API_KEY", "prod-secret", "")], environment_scope="production"
    )

    assert not success
    assert "Please delete the PHASE_SCOPE_CHECK_" in result["error"]
    assert all(v["value"] != "prod-secret" for v in fake.variables)


def test_group_sync_skips_scope_check_when_nothing_changes():
    fake = FakeGitLab([("API_KEY", "value", "production")], is_group=True)

    success, result = _sync(
        fake, [("API_KEY", "value", "")], environment_scope="production"
    )

    assert success, result
    assert [call.method for call in fake.calls] == ["GET", "GET"]


def test_group_sync_creates_scoped_variables_when_supported():
    fake = FakeGitLab(is_group=True)

    success, result = _sync(
        fake, [("API_KEY", "prod-secret", "")], environment_scope="production"
    )

    assert success, result
    assert fake.scoped("production") == {"API_KEY": "prod-secret"}
    assert fake.scoped("*") == {}


def test_sync_removes_variable_created_in_another_scope():
    fake = FakeGitLab(drops_scope=True)

    success, result = _sync(
        fake, [("API_KEY", "prod-secret", "")], environment_scope="production"
    )

    assert not success
    assert "It was removed again." in result["error"]
    assert fake.variables == []


def test_sync_reports_when_removing_variable_from_another_scope_fails():
    fake = FakeGitLab(drops_scope=True)
    fake.fail_delete_scopes.add("*")

    success, result = _sync(
        fake, [("API_KEY", "prod-secret", "")], environment_scope="production"
    )

    assert not success
    assert "Removing it failed" in result["error"]


def _delete_before_update(fake, key, scope):
    """Simulate the variable being deleted after it was listed, e.g. by a
    concurrent run of the same sync."""

    def request(method, url, **kwargs):
        if method == "PUT" and fake.find(key, scope):
            fake.variables.remove(fake.find(key, scope))
        return fake.request(method, url, **kwargs)

    return request


def test_group_update_never_writes_the_secret_into_another_scope():
    """When the filter matches nothing, GitLab updates any group variable with the
    same key."""

    fake = FakeGitLab(
        [("API_KEY", "unscoped-value", "*"), ("API_KEY", "old-prod", "production")],
        is_group=True,
    )

    _sync(
        fake,
        [("API_KEY", "new-prod", "")],
        request=_delete_before_update(fake, "API_KEY", "production"),
        environment_scope="production",
    )

    assert all(
        v["value"] != "new-prod"
        for v in fake.variables
        if v["environment_scope"] != "production"
    )


def test_group_update_recreates_variable_gitlab_took_from_another_scope():
    """When the variable being updated was deleted after it was listed, GitLab moves
    another variable with the same key into the scope. That variable, e.g. a manual
    one no sync manages, is recreated."""

    fake = FakeGitLab(
        [
            ("API_KEY", "manual-staging", "staging"),
            ("API_KEY", "old-prod", "production"),
        ],
        is_group=True,
    )
    fake.find("API_KEY", "staging").update(
        masked=True, protected=True, raw=False, description="Set by hand"
    )

    success, result = _sync(
        fake,
        [("API_KEY", "new-prod", "")],
        request=_delete_before_update(fake, "API_KEY", "production"),
        environment_scope="production",
    )

    assert success, result
    assert fake.scoped("production") == {"API_KEY": "new-prod"}
    assert fake.scoped("staging") == {"API_KEY": "manual-staging"}
    assert {
        field: fake.find("API_KEY", "staging")[field]
        for field in ("masked", "protected", "raw", "description")
    } == {"masked": True, "protected": True, "raw": False, "description": "Set by hand"}


def test_group_update_checks_other_scopes_without_recreating_them_normally():
    fake = FakeGitLab(
        [
            ("API_KEY", "staging-value", "staging"),
            ("API_KEY", "old-prod", "production"),
        ],
        is_group=True,
    )

    success, result = _sync(
        fake, [("API_KEY", "new-prod", "")], environment_scope="production"
    )

    assert success, result
    assert [(c.method, c.params) for c in fake.calls if c.method in ("GET", "POST")][
        -1
    ] == ("GET", {"filter[environment_scope]": "staging"})
    assert fake.scoped("staging") == {"API_KEY": "staging-value"}


def test_project_update_does_not_check_other_scopes():
    """Project PUTs don't fall back to another variable."""

    fake = FakeGitLab(
        [("API_KEY", "staging-value", "staging"), ("API_KEY", "old-prod", "production")]
    )

    _sync(fake, [("API_KEY", "new-prod", "")], environment_scope="production")

    assert [c.method for c in fake.calls] == ["GET", "GET", "PUT"]


def test_group_update_reports_variable_it_cannot_recreate():
    fake = FakeGitLab(
        [("API_KEY", "hidden", "staging"), ("API_KEY", "old-prod", "production")],
        is_group=True,
    )
    # GitLab doesn't return the value of hidden variables
    fake.find("API_KEY", "staging")["value"] = None

    success, result = _sync(
        fake,
        [("API_KEY", "new-prod", "")],
        request=_delete_before_update(fake, "API_KEY", "production"),
        environment_scope="production",
    )

    assert not success
    assert (
        "replaced the API_KEY variable in environment scope 'staging'"
        in result["error"]
    )
    assert "value is hidden" in result["error"]


def test_group_update_reports_when_recreating_a_variable_fails():
    fake = FakeGitLab(
        [
            ("API_KEY", "manual-staging", "staging"),
            ("API_KEY", "old-prod", "production"),
        ],
        is_group=True,
    )
    deleting = _delete_before_update(fake, "API_KEY", "production")

    def failing_create(method, url, **kwargs):
        if method == "POST" and kwargs["json"]["key"] == "API_KEY":
            return _response(500, {"message": "500 Internal Server Error"})
        return deleting(method, url, **kwargs)

    success, result = _sync(
        fake,
        [("API_KEY", "new-prod", "")],
        request=failing_create,
        environment_scope="production",
    )

    assert not success
    assert "recreating it failed" in result["error"]


def test_sync_restores_variable_gitlab_updated_in_another_scope():
    fake = FakeGitLab(
        [("API_KEY", "unscoped-value", "*"), ("API_KEY", "old-prod", "production")],
        is_group=True,
    )
    fake.ignores_update_scope = True

    success, result = _sync(
        fake,
        [("API_KEY", "new-prod", "")],
        request=_delete_before_update(fake, "API_KEY", "production"),
        environment_scope="production",
    )

    assert not success
    assert "in environment scope '*' instead of 'production'" in result["error"]
    assert "That variable was restored." in result["error"]
    assert fake.scoped("*") == {"API_KEY": "unscoped-value"}


def test_sync_reports_when_restoring_variable_in_another_scope_fails():
    fake = FakeGitLab(
        [("API_KEY", "unscoped-value", "*"), ("API_KEY", "old-prod", "production")],
        is_group=True,
    )
    fake.ignores_update_scope = True
    deleting = _delete_before_update(fake, "API_KEY", "production")
    puts = []

    def failing_restore(method, url, **kwargs):
        if method == "PUT":
            puts.append(kwargs)
            if len(puts) > 1:
                return _response(500, {"message": "500 Internal Server Error"})
        return deleting(method, url, **kwargs)

    success, result = _sync(
        fake,
        [("API_KEY", "new-prod", "")],
        request=failing_restore,
        environment_scope="production",
    )

    assert not success
    assert "Restoring it failed" in result["error"]
    assert "environments it was not meant for" in result["error"]


# ---- sync_gitlab_secrets: syncs without a scope -----------------------------------


def test_unscoped_sync_manages_variables_for_all_environments():
    fake = FakeGitLab(
        [
            ("SHARED", "old", "*"),
            ("SHARED", "override", "production"),
            ("STALE", "stale", "*"),
        ]
    )

    success, result = _sync(fake, [("SHARED", "new", ""), ("NEW_KEY", "new", "")])

    assert success, result
    assert fake.scoped("*") == {"SHARED": "new", "NEW_KEY": "new"}
    # Overrides in other scopes are neither updated nor deleted
    assert fake.scoped("production") == {"SHARED": "override"}


def test_unscoped_sync_keeps_updating_variable_moved_to_another_scope():
    """Before environment scopes, moving a synced variable to another scope in
    GitLab was the way to scope it, and the sync kept updating it there."""

    fake = FakeGitLab([("MOVED", "old", "production")])

    success, result = _sync(fake, [("MOVED", "new", "")])

    assert success, result
    assert fake.scoped("production") == {"MOVED": "new"}
    assert fake.scoped("*") == {}


def test_unscoped_sync_deletes_variable_moved_to_another_scope():
    fake = FakeGitLab([("MOVED", "old", "production"), ("KEPT", "kept", "*")])

    success, result = _sync(fake, [("KEPT", "kept", "")])

    assert success, result
    assert fake.scoped("production") == {}
    assert fake.scoped("*") == {"KEPT": "kept"}


def test_unscoped_sync_fails_for_key_in_several_scopes_but_not_all_environments():
    """It can't tell which variable to update. Like before environment scopes, when
    GitLab rejected the update, the sync fails, and deletes nothing."""

    fake = FakeGitLab(
        [
            ("API_KEY", "a", "staging"),
            ("API_KEY", "b", "production"),
            ("STALE", "stale", "*"),
        ]
    )

    success, result = _sync(fake, [("API_KEY", "new", ""), ("OTHER", "new", "")])

    assert not success
    assert "can't tell which variable to update: API_KEY (production, staging)" in (
        result["error"]
    )
    assert "no other variables are deleted either: STALE." in result["error"]
    assert "New and changed secrets were synced." in result["error"]
    assert fake.scoped("*") == {"OTHER": "new", "STALE": "stale"}
    assert fake.scoped("staging") == {"API_KEY": "a"}
    assert fake.scoped("production") == {"API_KEY": "b"}


@pytest.mark.parametrize(
    "removed",
    [
        [("REMOVED", "a", "staging"), ("REMOVED", "b", "production")],
        # A default and an override: GitLab refused to delete these before too
        [("REMOVED", "a", "*"), ("REMOVED", "b", "production")],
    ],
)
def test_unscoped_sync_fails_for_removed_key_in_several_scopes(removed):
    """Removing a secret from Phase must not silently leave its variables behind.
    Before environment scopes, GitLab refused to delete such a key and the sync
    stopped, so variables after it were never deleted: pipelines may rely on that,
    so nothing is deleted."""

    fake = FakeGitLab([*removed, ("STALE", "stale", "*"), ("KEPT", "old", "*")])

    success, result = _sync(fake, [("KEPT", "new", "")])

    assert not success
    assert "can't tell which variables to delete: REMOVED (" in result["error"]
    assert "no other variables are deleted either: STALE." in result["error"]
    assert fake.scoped("*")["KEPT"] == "new"
    assert len(fake.variables) == 4


def test_unscoped_sync_names_a_limited_number_of_ambiguous_keys():
    fake = FakeGitLab(
        [(f"KEY_{i:02}", "v", scope) for i in range(12) for scope in ("a", "b")]
    )

    success, result = _sync(fake, [])

    assert not success
    assert "KEY_09 (a, b), and 2 more." in result["error"]
    assert "New and changed secrets were synced." not in result["error"]
    assert "no other variables are deleted" not in result["error"]


def test_scoped_sync_is_never_ambiguous():
    fake = FakeGitLab([("REMOVED", "a", "staging"), ("REMOVED", "b", "production")])

    success, result = _sync(fake, [], environment_scope="review/*")

    assert success, result
    assert len(fake.variables) == 2


def test_unscoped_sync_accepts_key_in_several_scopes_that_is_in_sync():
    fake = FakeGitLab(
        [("API_KEY", "same", "staging"), ("API_KEY", "same", "production")]
    )

    success, result = _sync(fake, [("API_KEY", "same", "")])

    assert success, result
    assert result["message"] == "No changes needed. Secrets are already synchronized."


def test_unscoped_group_sync_skips_the_scope_check():
    fake = FakeGitLab(is_group=True, drops_scope=True)

    success, result = _sync(fake, [("API_KEY", "value", "")])

    assert success, result
    assert fake.scoped("*") == {"API_KEY": "value"}
    assert [call.json["key"] for call in fake.calls if call.method == "POST"] == [
        "API_KEY"
    ]


def test_unscoped_sync_leaves_scopes_of_other_syncs_alone():
    fake = FakeGitLab(
        [
            ("DATABASE_URL", "prod-url", "production"),
            ("PROD_ONLY", "prod", "production"),
        ]
    )

    success, result = _sync(
        fake,
        [("DATABASE_URL", "default-url", ""), ("PROD_ONLY", "default", "")],
        get_excluded_scopes=lambda: {"production"},
    )

    assert success, result
    assert fake.scoped("production") == {
        "DATABASE_URL": "prod-url",
        "PROD_ONLY": "prod",
    }
    assert fake.scoped("*") == {"DATABASE_URL": "default-url", "PROD_ONLY": "default"}


def test_unscoped_sync_always_manages_the_all_environments_scope():
    fake = FakeGitLab([("DATABASE_URL", "old-default", "*")])

    success, result = _sync(
        fake,
        [("DATABASE_URL", "default-url", "")],
        get_excluded_scopes=lambda: {"*"},
    )

    assert success, result
    assert fake.scoped("*") == {"DATABASE_URL": "default-url"}


def test_unscoped_sync_fails_cleanly_when_excluded_scopes_cannot_be_determined():
    def get_excluded_scopes():
        raise ValueError("Invalid ciphertext")

    fake = FakeGitLab([("MOVED", "old", "production")])

    success, result = _sync(
        fake, [("MOVED", "new", "")], get_excluded_scopes=get_excluded_scopes
    )

    assert not success
    assert "Invalid ciphertext" in result["error"]
    assert fake.calls == []


# ---- get_environment_scopes_of_other_syncs -----------------------------------------


def _sync_record(sync_id="sync-1", host=GITLAB_HOST, **options):
    return SimpleNamespace(
        id=sync_id,
        service="gitlab_ci",
        authentication=(
            SimpleNamespace(credentials={"gitlab_host": host}) if host else None
        ),
        environment=SimpleNamespace(app=SimpleNamespace(organisation="org-1")),
        options={"resource_id": "1", "is_group": False, **options},
    )


def test_get_environment_scopes_of_other_syncs():
    this_sync = _sync_record()
    other_syncs = [
        _sync_record("s2", environment_scope="production"),
        _sync_record("s3", environment_scope="review/*"),
        _sync_record("s4", host=None, environment_scope="staging"),
        _sync_record("s5"),  # another sync without a scope
        _sync_record("s6", environment_scope="qa", resource_id="2"),
        _sync_record("s7", environment_scope="qa", is_group=True),
        _sync_record(
            "s8", host="https://gitlab.other.example.com", environment_scope="qa"
        ),
    ]
    model = MagicMock()
    model.objects.filter.return_value.exclude.return_value.select_related.return_value = (
        other_syncs
    )

    with patch.object(gitlab.apps, "get_model", return_value=model), patch.object(
        gitlab,
        "get_gitlab_host",
        side_effect=lambda credentials: credentials["gitlab_host"],
    ):
        scopes = get_environment_scopes_of_other_syncs(this_sync)

    assert scopes == {"production", "review/*", "staging"}
    model.objects.filter.assert_called_once_with(
        service="gitlab_ci", deleted_at=None, environment__app__organisation="org-1"
    )
    model.objects.filter.return_value.exclude.assert_called_once_with(id="sync-1")


def test_get_environment_scopes_of_other_syncs_when_a_host_cannot_be_read():
    this_sync = _sync_record()
    other_sync = _sync_record("s2", host="unreadable", environment_scope="production")
    model = MagicMock()
    model.objects.filter.return_value.exclude.return_value.select_related.return_value = [
        other_sync
    ]

    def get_gitlab_host(credentials):
        if credentials["gitlab_host"] == "unreadable":
            raise ValueError("Invalid ciphertext")
        return credentials["gitlab_host"]

    with patch.object(gitlab.apps, "get_model", return_value=model), patch.object(
        gitlab, "get_gitlab_host", side_effect=get_gitlab_host
    ):
        assert get_environment_scopes_of_other_syncs(this_sync) == {"production"}


def test_get_environment_scopes_of_other_syncs_for_sync_that_only_stored_the_path():
    """Syncs created before July 2024 only stored the project or group path. They
    must still leave the scopes of other syncs to the same project alone."""

    this_sync = _sync_record(resource_path="Phase/Backend")
    del this_sync.options["resource_id"]
    other_syncs = [
        _sync_record(
            "s2", resource_path="phase/backend", environment_scope="production"
        ),
        _sync_record("s3", resource_path="phase/frontend", environment_scope="staging"),
    ]
    model = MagicMock()
    model.objects.filter.return_value.exclude.return_value.select_related.return_value = (
        other_syncs
    )

    with patch.object(gitlab.apps, "get_model", return_value=model), patch.object(
        gitlab,
        "get_gitlab_host",
        side_effect=lambda credentials: credentials["gitlab_host"],
    ):
        assert get_environment_scopes_of_other_syncs(this_sync) == {"production"}


@pytest.mark.parametrize(
    ("options", "other_options", "expected"),
    [
        ({"resource_id": "1"}, {"resource_id": "1"}, True),
        ({"resource_id": 1}, {"resource_id": "1"}, True),
        ({"resource_id": "1"}, {"resource_id": "2"}, False),
        # IDs decide when both syncs have one, even if the path was reused
        (
            {"resource_id": "1", "resource_path": "a/b"},
            {"resource_id": "2", "resource_path": "a/b"},
            False,
        ),
        ({"resource_id": "1"}, {"resource_id": "1", "is_group": True}, False),
        # Syncs created before July 2024 only stored the path
        ({"resource_path": "a/b"}, {"resource_id": "1", "resource_path": "A/B/"}, True),
        ({"resource_path": "a/b"}, {"resource_id": "1", "resource_path": "a/c"}, False),
        ({"resource_path": ""}, {"resource_path": ""}, False),
        ({"resource_id": None, "resource_path": "a"}, {"resource_path": "a"}, True),
    ],
)
def test_same_gitlab_resource(options, other_options, expected):
    assert gitlab.same_gitlab_resource(options, other_options) is expected
    assert gitlab.same_gitlab_resource(other_options, options) is expected


def test_get_environment_scopes_of_other_syncs_without_credentials():
    assert get_environment_scopes_of_other_syncs(_sync_record(host=None)) == set()


# ---- list_gitlab_environments ----------------------------------------------------


def test_list_gitlab_environments_paginates_and_sorts_names():
    request = MagicMock(
        side_effect=[
            _response(
                json_data=[{"name": "staging"}, {"name": "production"}],
                headers={"X-Next-Page": "2"},
            ),
            _response(
                json_data=[{"name": "review/feature-login"}, {"name": "development"}],
                headers={"X-Next-Page": ""},
            ),
        ]
    )

    with patch.object(gitlab.requests, "request", request):
        environments = list_gitlab_environments("cred-1", "123")

    assert environments == [
        "development",
        "production",
        "review/feature-login",
        "staging",
    ]
    first_call, second_call = request.call_args_list
    assert first_call.args == (
        "GET",
        f"{GITLAB_HOST}/api/v4/projects/123/environments",
    )
    assert first_call.kwargs["params"] == {"per_page": 100, "page": "1"}
    assert first_call.kwargs["allow_redirects"] is False
    assert second_call.kwargs["params"] == {"per_page": 100, "page": "2"}


def test_list_gitlab_environments_encodes_the_project_id():
    request = MagicMock(return_value=_response(json_data=[]))

    with patch.object(gitlab.requests, "request", request):
        list_gitlab_environments("cred-1", "../../users?x=1")

    assert request.call_args.args[1] == (
        f"{GITLAB_HOST}/api/v4/projects/..%2F..%2Fusers%3Fx%3D1/environments"
    )


def test_list_gitlab_environments_stops_after_max_pages():
    request = MagicMock(
        return_value=_response(
            json_data=[{"name": "production"}], headers={"X-Next-Page": "2"}
        )
    )

    with patch.object(gitlab.requests, "request", request):
        environments = list_gitlab_environments("cred-1", "123")

    assert environments == ["production"]
    assert request.call_count == gitlab.GITLAB_ENVIRONMENTS_MAX_PAGES


def test_list_gitlab_environments_is_empty_when_environments_are_disabled():
    request = MagicMock(return_value=_response(403, {"message": "403 Forbidden"}))

    with patch.object(gitlab.requests, "request", request):
        assert list_gitlab_environments("cred-1", "123") == []


def test_list_gitlab_environments_raises_on_error():
    request = MagicMock(
        return_value=_response(404, {"message": "404 Project Not Found"})
    )

    with patch.object(gitlab.requests, "request", request):
        with pytest.raises(Exception, match="HTTP 404"):
            list_gitlab_environments("cred-1", "123")


# ---- list_gitlab_group_environment_scopes ------------------------------------------


def _group_scopes_response(names):
    return _response(
        json_data={
            "data": {
                "group": {"environmentScopes": {"nodes": [{"name": n} for n in names]}}
            }
        }
    )


def test_list_gitlab_group_environment_scopes_returns_sorted_scopes_without_default():
    request = MagicMock(
        return_value=_group_scopes_response(["staging", "*", "production", "review/*"])
    )

    with patch.object(gitlab.requests, "request", request):
        scopes = list_gitlab_group_environment_scopes("cred-1", "phase/platform")

    assert scopes == ["production", "review/*", "staging"]
    assert request.call_args.args == ("POST", f"{GITLAB_HOST}/api/graphql")
    assert request.call_args.kwargs["json"]["variables"] == {
        "fullPath": "phase/platform"
    }
    # Only scope names are requested, never variable values
    assert "value" not in request.call_args.kwargs["json"]["query"]
    assert request.call_args.kwargs["allow_redirects"] is False


@pytest.mark.parametrize(
    "response",
    [
        _response(404, {"message": "404 Not Found"}),
        # Older GitLab versions don't have the environmentScopes field
        _response(json_data={"errors": [{"message": "Field doesn't exist"}]}),
        # Group not found, or not visible with this token
        _response(json_data={"data": {"group": None}}),
    ],
)
def test_list_gitlab_group_environment_scopes_is_empty_when_unavailable(response):
    with patch.object(gitlab.requests, "request", MagicMock(return_value=response)):
        assert list_gitlab_group_environment_scopes("cred-1", "phase") == []


# ---- get_gitlab_host -------------------------------------------------------------


@pytest.mark.parametrize(
    ("stored_host", "expected"),
    [
        ("https://gitlab.com", "gitlab.com"),
        ("https://GitLab.Example.com/", "gitlab.example.com"),
        (" https://gitlab.example.com// ", "gitlab.example.com"),
        # The same instance, over http and https (often redirected)
        ("http://gitlab.example.com", "gitlab.example.com"),
        ("https://gitlab.example.com:443", "gitlab.example.com"),
        ("http://gitlab.example.com:80/", "gitlab.example.com"),
        ("gitlab.example.com", "gitlab.example.com"),
        # Other ports and paths are other instances
        ("http://gitlab.example.com:8080", "gitlab.example.com:8080"),
        ("https://example.com/GitLab/", "example.com/gitlab"),
        ("http://gitlab.example.com:notaport", "http://gitlab.example.com:notaport"),
        (None, ""),
    ],
)
def test_get_gitlab_host_normalizes_the_stored_host(stored_host, expected):
    with patch.object(
        gitlab,
        "decrypt_credential_values",
        return_value={"gitlab_host": stored_host} if stored_host else {},
    ) as mock_decrypt:
        assert gitlab.get_gitlab_host({"gitlab_host": "ph:v1:..."}) == expected

    # Only the host is decrypted, never the token
    mock_decrypt.assert_called_once_with({"gitlab_host": "ph:v1:..."}, ["gitlab_host"])


# ---- credentials and requests ------------------------------------------------------


def test_get_gitlab_credentials_strips_the_token():
    with patch.object(
        gitlab,
        "get_credentials",
        return_value={"gitlab_host": GITLAB_HOST, "gitlab_token": " glpat-abc\n"},
    ), patch.object(gitlab.settings, "APP_HOST", "self-hosted"):
        assert REAL_GET_GITLAB_CREDENTIALS("cred-1") == (GITLAB_HOST, "glpat-abc")


def test_invalid_token_is_not_included_in_errors():
    with patch.object(
        gitlab.requests,
        "request",
        side_effect=gitlab.requests.exceptions.InvalidHeader(
            "Invalid return character or leading space in header: Private-Token: glpat-secret\n"
        ),
    ):
        with pytest.raises(Exception) as excinfo:
            gitlab.gitlab_request("GET", f"{GITLAB_HOST}/api/v4/user")

    assert "glpat-secret" not in str(excinfo.value)
    assert excinfo.value.__suppress_context__
