"""Editing a secret's path moves it to another folder.

The folder link (Secret.folder) has to follow the path: deleting a folder
cascades to the secrets linked to it, so a moved secret left pointing at its
old folder would be deleted with it. The REST API already keeps the two in
step; these guard the GraphQL edit mutation.
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


def _edit(secret, path):
    """Runs the edit on one secret; returns the folder helper's mock."""
    from backend.graphene.mutations.environment import BulkEditSecretMutation

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
        f"{_M}.log_secret_events_bulk"
    ):
        MockSecret.objects.get.return_value = secret
        BulkEditSecretMutation.mutate(None, _info(), [_data(path)])
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


def test_edit_secret_move_into_a_nested_folder_links_the_innermost_one():
    secret = _secret(path="/")

    create_folders = _edit(secret, "/workers/queues")

    create_folders.assert_called_once_with("/workers/queues", "env-1")
    assert secret.path == "/workers/queues"
    assert secret.folder is NEW_FOLDER


def test_deleting_the_old_folder_keeps_a_moved_secrets_history():
    """Events recorded while a secret sat in a folder point at that folder.

    Once the secret has moved out, deleting the folder must let go of those
    events (null their link), not take them, and the secret's history, with it.
    """
    from django.db.models.deletion import Collector

    from api.models import SecretEvent, SecretFolder

    old_folder = SecretFolder(id="folder-old", environment_id="env-1", name="workers")

    # Nothing else hangs off the folder: only how its events are planned matters here
    def nothing_related(self, related_model, related_fields, objs):
        return related_model._base_manager.none()

    with patch.object(Collector, "related_objects", nothing_related):
        collector = Collector(using="default")
        collector.collect([old_folder])

    events_folder = SecretEvent._meta.get_field("folder")
    assert (events_folder, None) in collector.field_updates
    assert set(collector.data) == {SecretFolder}
    assert not collector.fast_deletes
