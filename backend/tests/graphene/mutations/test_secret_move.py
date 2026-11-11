"""Editing a secret's path moves it to another folder.

The folder link (Secret.folder) has to follow the path: deleting a folder
cascades to the secrets linked to it, so a moved secret left pointing at its
old folder would be deleted with it. The REST API already keeps the two in
step; these guard the GraphQL edit mutations.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

_M = "backend.graphene.mutations.environment"

OLD_FOLDER = object()
NEW_FOLDER = object()


def _info():
    info = MagicMock()
    info.context.user.userId = "user-1"
    return info


def _secret(path="/", rotating_secret_id=None):
    env = SimpleNamespace(id="env-1", app=SimpleNamespace(organisation="org"), save=MagicMock())
    return SimpleNamespace(
        id="secret-1",
        environment=env,
        path=path,
        folder=OLD_FOLDER,
        type="secret",
        rotating_secret_id=rotating_secret_id,
        version=1,
        value="old-value",
        tags=MagicMock(),
        save=MagicMock(),
    )


def _data(path):
    return SimpleNamespace(
        id="secret-1",
        path=path,
        key="key",
        key_digest="digest",
        value="value",
        comment="",
        tags=[],
        type=None,
    )


def _edit(secret, path, bulk=False):
    """Runs the single or the bulk edit on one secret; returns the folder helper's mock."""
    from backend.graphene.mutations.environment import (
        BulkEditSecretMutation,
        EditSecretMutation,
    )

    with patch(f"{_M}.Secret") as MockSecret, patch(
        f"{_M}.user_has_permission", return_value=True
    ), patch(f"{_M}.user_can_access_environment", return_value=True), patch(
        f"{_M}.SecretTag"
    ), patch(
        f"{_M}.create_environment_folder_structure", return_value=NEW_FOLDER
    ) as create_folders, patch(
        f"{_M}._sync_rotating_key_map"
    ), patch(
        f"{_M}.get_resolver_request_meta", return_value=("127.0.0.1", "test")
    ), patch(
        f"{_M}.OrganisationMember"
    ), patch(
        f"{_M}.log_secret_event"
    ), patch(
        f"{_M}.log_secret_events_bulk"
    ):
        MockSecret.objects.get.return_value = secret
        if bulk:
            BulkEditSecretMutation.mutate(None, _info(), [_data(path)])
        else:
            EditSecretMutation.mutate(None, _info(), "secret-1", _data(path))
    return create_folders


def test_edit_secret_move_takes_the_folder_link_along():
    secret = _secret(path="/")

    create_folders = _edit(secret, "/workers")

    create_folders.assert_called_once_with("/workers", "env-1")
    assert secret.path == "/workers"
    assert secret.folder is NEW_FOLDER


def test_edit_secret_move_to_root_clears_the_folder_link():
    secret = _secret(path="/workers")

    create_folders = _edit(secret, "/")

    create_folders.assert_not_called()
    assert secret.path == "/"
    assert secret.folder is None


def test_edit_secret_in_place_leaves_the_folder_link_alone():
    secret = _secret(path="/workers")

    create_folders = _edit(secret, "/workers")

    create_folders.assert_not_called()
    assert secret.folder is OLD_FOLDER


def test_edit_rotating_secret_stays_where_its_rotation_is():
    secret = _secret(path="/", rotating_secret_id="rotation-1")

    create_folders = _edit(secret, "/workers")

    create_folders.assert_not_called()
    assert secret.path == "/"
    assert secret.folder is OLD_FOLDER


def test_bulk_edit_secret_move_takes_the_folder_link_along():
    secret = _secret(path="/")

    create_folders = _edit(secret, "/workers/queues", bulk=True)

    create_folders.assert_called_once_with("/workers/queues", "env-1")
    assert secret.path == "/workers/queues"
    assert secret.folder is NEW_FOLDER


def test_bulk_edit_rotating_secret_stays_where_its_rotation_is():
    secret = _secret(path="/", rotating_secret_id="rotation-1")

    create_folders = _edit(secret, "/workers", bulk=True)

    create_folders.assert_not_called()
    assert secret.path == "/"
    assert secret.folder is OLD_FOLDER
