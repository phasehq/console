"""
Unit tests for the rotation exposure helper (virtual merging).

Uses real Django model classes from the registry. The RotatingSecret manager
is patched at the test-class level to return stubbed querysets so we don't
need DB fixtures.
"""

from unittest.mock import MagicMock, patch

import pytest

from api.models import RotatingSecret, RotatingSecretCredential
from ee.integrations.secrets.rotation.exposure import (
    build_rotating_secret_rows,
    find_active_credential_for_digest,
)


def _stub_credential(*, id="cred-1", values=None, created_at=None):
    cred = MagicMock(spec=RotatingSecretCredential)
    cred.id = id
    cred.encrypted_values = values or {}
    cred.created_at = created_at
    return cred


def _stub_rs(*, id="rs-1", path="/", key_map=None, active_credential=None, env=None):
    rs = MagicMock(spec=RotatingSecret)
    rs.id = id
    rs.path = path
    rs.key_map = key_map or []
    rs.folder = None
    rs.environment = env
    creds_manager = MagicMock()
    qs = MagicMock()
    qs.first.return_value = active_credential
    creds_manager.filter.return_value.order_by.return_value = qs
    rs.credentials = creds_manager
    return rs


def _qs_from_iterable(iterable):
    qs = MagicMock()
    qs.filter.return_value = qs
    qs.prefetch_related.return_value = qs
    qs.__iter__ = MagicMock(return_value=iter(iterable))
    return qs


@patch.object(RotatingSecret, "objects")
def test_build_returns_synthetic_secret_per_key_map_entry(mock_manager):
    env = MagicMock()
    cred = _stub_credential(
        id="cred-1",
        values={"api_key": "ph:v1:enc-key", "key_id": "ph:v1:enc-keyid"},
        created_at="2026-06-01T00:00:00Z",
    )
    rs = _stub_rs(
        id="rs-1",
        path="/",
        key_map=[
            {"id": "api_key", "key_name": "ph:v1:enc-key-name", "key_digest": "abc123"},
            {"id": "key_id", "key_name": "ph:v1:enc-id-name", "key_digest": "def456"},
        ],
        active_credential=cred,
        env=env,
    )
    mock_manager.filter.return_value = _qs_from_iterable([rs])

    rows = build_rotating_secret_rows(env)

    assert len(rows) == 2
    keys = {r.key for r in rows}
    assert keys == {"ph:v1:enc-key-name", "ph:v1:enc-id-name"}
    ids = {r.id for r in rows}
    assert ids == {"rs:cred-1:api_key", "rs:cred-1:key_id"}
    for r in rows:
        assert r.id.startswith("rs:")
        assert r._rotating_secret_id == "rs-1"
        assert r._rotating_credential_id == "cred-1"
        assert r.path == "/"
        assert r.type == "secret"


@patch.object(RotatingSecret, "objects")
def test_build_skips_when_no_active_credential(mock_manager):
    rs = _stub_rs(
        id="rs-2",
        key_map=[{"id": "api_key", "key_name": "k", "key_digest": "d"}],
        active_credential=None,
    )
    mock_manager.filter.return_value = _qs_from_iterable([rs])
    assert build_rotating_secret_rows(MagicMock()) == []


@patch.object(RotatingSecret, "objects")
def test_build_skips_outputs_with_missing_encrypted_value(mock_manager):
    cred = _stub_credential(values={"api_key": "enc"})
    rs = _stub_rs(
        id="rs-3",
        key_map=[
            {"id": "api_key", "key_name": "ka", "key_digest": "da"},
            {"id": "key_id", "key_name": "ki", "key_digest": "di"},
        ],
        active_credential=cred,
    )
    mock_manager.filter.return_value = _qs_from_iterable([rs])
    rows = build_rotating_secret_rows(MagicMock())
    assert len(rows) == 1
    assert rows[0].key == "ka"
    assert rows[0].value == "enc"


@patch.object(RotatingSecret, "objects")
def test_find_active_credential_for_digest_match(mock_manager):
    cred = _stub_credential(values={"api_key": "enc-value"})
    rs = _stub_rs(
        id="rs-9",
        key_map=[{"id": "api_key", "key_name": "k", "key_digest": "target-digest"}],
        active_credential=cred,
    )
    mock_manager.filter.return_value = _qs_from_iterable([rs])

    match = find_active_credential_for_digest(MagicMock(), "target-digest")
    assert match is not None
    _, _, encrypted_value = match
    assert encrypted_value == "enc-value"


@patch.object(RotatingSecret, "objects")
def test_find_active_credential_for_digest_no_match(mock_manager):
    rs = _stub_rs(
        id="rs-9",
        key_map=[{"id": "api_key", "key_name": "k", "key_digest": "other-digest"}],
        active_credential=_stub_credential(values={"api_key": "v"}),
    )
    mock_manager.filter.return_value = _qs_from_iterable([rs])

    assert find_active_credential_for_digest(MagicMock(), "target-digest") is None
