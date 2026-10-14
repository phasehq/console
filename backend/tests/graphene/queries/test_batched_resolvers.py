"""List resolvers batch per-row relations instead of querying once per row.

`apps` backs the navbar, command palette and org home page, so its
members, environments and syncs must cost one query per field, not one
per app or environment. The audit log count is deferred until selected.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from backend.graphene.types import (
    AppType,
    AuditLogsResponseType,
    EnvironmentType,
    ResolveBatch,
    _first_by_pk,
    _load_app_environments,
)

_M = "backend.graphene.types"


def _info(user_id="u1", **context):
    return SimpleNamespace(
        context=SimpleNamespace(user=SimpleNamespace(userId=user_id), **context)
    )


def test_first_by_pk_uses_all_not_first():
    manager = MagicMock()
    manager.all.return_value = [SimpleNamespace(pk=3), SimpleNamespace(pk=1)]
    assert _first_by_pk(manager).pk == 1
    manager.first.assert_not_called()


def test_first_by_pk_empty_relation():
    manager = MagicMock()
    manager.all.return_value = []
    assert _first_by_pk(manager) is None


def test_resolve_batch_runs_each_loader_once():
    rows = [SimpleNamespace(), SimpleNamespace()]
    batch = ResolveBatch(rows)
    loader = MagicMock()

    batch.load("members", loader)
    batch.load("members", loader)

    loader.assert_called_once_with(batch)
    assert all(row._resolve_batch is batch for row in rows)


def test_app_members_load_once_for_the_batch():
    apps = [SimpleNamespace(id="a1"), SimpleNamespace(id="a2")]
    ResolveBatch(apps)

    def load(rows):
        for row in rows:
            row.active_members = [f"member-of-{row.id}"]

    with patch(f"{_M}._load_app_members", side_effect=load) as loader:
        assert AppType.resolve_members(apps[0], _info()) == ["member-of-a1"]
        assert AppType.resolve_members(apps[1], _info()) == ["member-of-a2"]

    loader.assert_called_once()


def test_app_members_without_batch_query_per_app():
    app = MagicMock(spec=["members"])
    AppType.resolve_members(app, _info())
    app.members.filter.assert_called_once_with(deleted_at=None)


def test_app_service_accounts_load_once_for_the_batch():
    apps = [SimpleNamespace(id="a1"), SimpleNamespace(id="a2")]
    ResolveBatch(apps)

    def load(rows):
        for row in rows:
            row.active_service_accounts = [f"sa-of-{row.id}"]

    with patch(f"{_M}._load_app_service_accounts", side_effect=load) as loader:
        assert AppType.resolve_service_accounts(apps[1], _info()) == ["sa-of-a2"]
        assert AppType.resolve_service_accounts(apps[0], _info()) == ["sa-of-a1"]

    loader.assert_called_once()


def test_app_environments_load_once_for_the_batch():
    apps = [SimpleNamespace(id="a1"), SimpleNamespace(id="a2")]
    ResolveBatch(apps)

    def load(rows, user_id):
        assert user_id == "u1"
        for row in rows:
            row.filtered_environments = [f"env-of-{row.id}"]

    with patch(f"{_M}._load_app_environments", side_effect=load) as loader:
        assert AppType.resolve_environments(apps[0], _info()) == ["env-of-a1"]
        assert AppType.resolve_environments(apps[1], _info()) == ["env-of-a2"]

    loader.assert_called_once()


def test_load_app_environments_keeps_only_the_callers_envs():
    e1, e2, e3 = (SimpleNamespace(id=f"e{i}") for i in (1, 2, 3))
    app = SimpleNamespace(environments=MagicMock())
    app.environments.all.return_value = [e1, e2, e3]

    with patch(f"{_M}.prefetch_related_objects"), patch(
        f"{_M}.EnvironmentKey"
    ) as env_key:
        env_key.objects.filter.return_value.values_list.return_value = ["e1", "e3"]
        _load_app_environments([app], "u1")

    assert app.filtered_environments == [e1, e3]
    kwargs = env_key.objects.filter.call_args.kwargs
    assert kwargs["user__user_id"] == "u1"
    assert kwargs["user__deleted_at"] is None
    assert kwargs["deleted_at__isnull"] is True
    # Environments are batched in turn, for their syncs.
    assert e1._resolve_batch == [e1, e3]
    assert not hasattr(e2, "_resolve_batch")


def _env(env_id):
    return SimpleNamespace(id=env_id, app_id="a1", app=SimpleNamespace(organisation="o"))


def test_environment_syncs_load_once_for_the_batch():
    envs = [_env("e1"), _env("e2")]
    ResolveBatch(envs)
    info = _info(_sync_read_access={"env_ids": {"e1", "e2"}, "apps": {"a1": True}})

    def load(rows):
        for row in rows:
            row.active_syncs = [f"sync-of-{row.id}"]

    with patch(f"{_M}._load_environment_syncs", side_effect=load) as loader:
        assert EnvironmentType.resolve_syncs(envs[0], info) == ["sync-of-e1"]
        assert EnvironmentType.resolve_syncs(envs[1], info) == ["sync-of-e2"]

    loader.assert_called_once()


def test_environment_syncs_still_check_access_before_loading():
    envs = [_env("e1")]
    ResolveBatch(envs)
    info = _info(_sync_read_access={"env_ids": set(), "apps": {}})

    with patch(f"{_M}._load_environment_syncs") as loader:
        assert EnvironmentType.resolve_syncs(envs[0], info) == []

    loader.assert_not_called()


def test_audit_log_count_is_deferred_until_resolved():
    count = MagicMock(return_value=42)
    response = AuditLogsResponseType(logs=[], count=count)

    count.assert_not_called()
    assert AuditLogsResponseType.resolve_count(response, None) == 42


def test_audit_log_count_accepts_a_plain_value():
    response = AuditLogsResponseType(logs=[], count=7)
    assert AuditLogsResponseType.resolve_count(response, None) == 7
