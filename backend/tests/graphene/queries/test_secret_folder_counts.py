"""SecretFolderType.secret_count must exclude soft-deleted secrets.

Deleting a secret only sets deleted_at, so a count that doesn't filter on it
keeps counting deleted secrets in the folder rows on the environment page.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock

from backend.graphene import types


def _patch_secret_models(monkeypatch, *, secrets=0, dynamic_secrets=0):
    mock_secret_model = MagicMock()
    mock_secret_model.objects.filter.return_value.count.return_value = secrets
    monkeypatch.setattr(types, "Secret", mock_secret_model)

    mock_dynamic_secret_model = MagicMock()
    mock_dynamic_secret_model.objects.filter.return_value.count.return_value = (
        dynamic_secrets
    )
    monkeypatch.setattr(types, "DynamicSecret", mock_dynamic_secret_model)

    return SimpleNamespace(
        secret_model=mock_secret_model,
        dynamic_secret_model=mock_dynamic_secret_model,
    )


def test_folder_secret_count_excludes_deleted_secrets(monkeypatch):
    mocks = _patch_secret_models(monkeypatch)
    folder = SimpleNamespace(id="folder-1")

    types.SecretFolderType.resolve_secret_count(folder, None)

    mocks.secret_model.objects.filter.assert_called_once_with(
        folder=folder, deleted_at=None
    )


def test_folder_secret_count_excludes_deleted_dynamic_secrets(monkeypatch):
    mocks = _patch_secret_models(monkeypatch)
    folder = SimpleNamespace(id="folder-1")

    types.SecretFolderType.resolve_secret_count(folder, None)

    mocks.dynamic_secret_model.objects.filter.assert_called_once_with(
        folder=folder, deleted_at=None
    )


def test_folder_secret_count_sums_secrets_and_dynamic_secrets(monkeypatch):
    """Folder rows list dynamic secrets too, so they stay in the count."""
    _patch_secret_models(monkeypatch, secrets=3, dynamic_secrets=2)

    count = types.SecretFolderType.resolve_secret_count(
        SimpleNamespace(id="folder-1"), None
    )

    assert count == 5
