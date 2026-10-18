"""Per-request memoization of the caller's environment keys."""

from types import SimpleNamespace
from unittest.mock import MagicMock

from api.utils.access import permissions


def _info():
    return SimpleNamespace(context=SimpleNamespace(user=SimpleNamespace(userId="u1")))


def test_request_accessible_env_ids_queries_once_per_request(monkeypatch):
    lookup = MagicMock(return_value={"env-1"})
    monkeypatch.setattr(permissions, "accessible_environment_ids", lookup)
    info = _info()

    assert permissions.request_accessible_env_ids(info) == {"env-1"}
    assert permissions.request_accessible_env_ids(info) == {"env-1"}

    lookup.assert_called_once_with("u1")


def test_request_accessible_env_ids_is_not_shared_between_requests(monkeypatch):
    lookup = MagicMock(side_effect=[{"env-1"}, {"env-2"}])
    monkeypatch.setattr(permissions, "accessible_environment_ids", lookup)

    assert permissions.request_accessible_env_ids(_info()) == {"env-1"}
    assert permissions.request_accessible_env_ids(_info()) == {"env-2"}

    assert lookup.call_count == 2
