"""UpdateSecretFolderMutation renames a folder or moves it under another.

The folder's contents are linked to it by foreign key, so only the text paths
of what's inside have to follow: subfolders, secrets, dynamic and rotating
secrets, and the syncs that send the folder.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from graphql import GraphQLError

_M = "backend.graphene.mutations.environment"
_MODELS = ("SecretFolder", "Secret", "DynamicSecret", "RotatingSecret", "EnvironmentSync")


def _info():
    info = MagicMock()
    info.context.user.userId = "user-1"
    return info


def _folder(name="workers", path="/"):
    env = SimpleNamespace(id="env-1", app=SimpleNamespace(organisation="org"), save=MagicMock())
    return SimpleNamespace(id="folder-1", name=name, path=path, folder=None, environment=env, save=MagicMock())


class _Run:
    """Runs the mutation against mocked models; exposes them for assertions."""

    def __init__(self, folder, inside=None, permitted=True, has_rotation=False, conflict=False):
        self.folder = folder
        self.inside = inside or {}
        self.permitted = permitted
        self.has_rotation = has_rotation
        self.conflict = conflict
        self.models = {}
        self.parent = object()

    def __call__(self, **kwargs):
        from backend.graphene.mutations.environment import UpdateSecretFolderMutation

        patches = [patch(f"{_M}.{name}") for name in _MODELS]
        with patch(f"{_M}.user_has_permission", side_effect=self._permission), patch(
            f"{_M}.user_can_access_environment", return_value=True
        ), patch(f"{_M}._descendant_folder_ids", return_value={"folder-1"}), patch(
            f"{_M}.create_environment_folder_structure", return_value=self.parent
        ) as self.create_folders, patch(f"{_M}.transaction"):
            mocks = [p.start() for p in patches]
            try:
                for name, mock in zip(_MODELS, mocks):
                    self.models[name] = mock
                    found = mock.objects.filter.return_value
                    found.values_list.return_value = self.inside.get(name, [])
                    found.exclude.return_value.exists.return_value = self.conflict
                    found.exists.return_value = self.has_rotation
                self.models["SecretFolder"].objects.get.return_value = self.folder
                return UpdateSecretFolderMutation.mutate(None, _info(), "folder-1", **kwargs)
            finally:
                for p in patches:
                    p.stop()

    def _permission(self, user, action, resource, *args, **kwargs):
        return self.permitted if resource == "Secrets" else False

    def updates(self, name):
        """(old path, new path) for each rewrite issued on a model."""
        objects = self.models[name].objects
        # The name-clash check filters by path and name; the rewrites by path alone
        selected = [
            c.kwargs["path"]
            for c in objects.filter.call_args_list
            if "path" in c.kwargs and "name" not in c.kwargs
        ]
        written = [c.kwargs["path"] for c in objects.filter.return_value.update.call_args_list]
        return sorted(zip(selected, written))


def test_path_under_swaps_the_leading_folder_only():
    from backend.graphene.mutations.environment import _path_under

    assert _path_under("/workers", "/workers", "/jobs") == "/jobs"
    assert _path_under("/workers/queues/dlq", "/workers", "/jobs") == "/jobs/queues/dlq"
    # A sibling that merely starts with the same letters is not inside it
    assert _path_under("/workers-old", "/workers", "/jobs") is None
    assert _path_under("/", "/workers", "/jobs") is None


def test_rename_rewrites_the_paths_of_everything_inside():
    folder = _folder(name="workers", path="/")
    run = _Run(
        folder,
        inside={
            "SecretFolder": ["/workers", "/workers/queues"],
            "Secret": ["/workers", "/workers/queues"],
            "EnvironmentSync": ["/workers"],
        },
    )

    run(name="jobs")

    assert (folder.name, folder.path, folder.folder) == ("jobs", "/", None)
    folder.save.assert_called_once()
    assert run.updates("SecretFolder") == [("/workers", "/jobs"), ("/workers/queues", "/jobs/queues")]
    assert run.updates("Secret") == [("/workers", "/jobs"), ("/workers/queues", "/jobs/queues")]
    assert run.updates("EnvironmentSync") == [("/workers", "/jobs")]
    assert run.updates("DynamicSecret") == []
    # One save of the env, after the paths, queues its syncs once
    folder.environment.save.assert_called_once()


def test_move_links_the_folder_under_its_new_parent():
    folder = _folder(name="queues", path="/workers")
    run = _Run(folder, inside={"Secret": ["/workers/queues"]})

    run(path="/billing")

    run.create_folders.assert_called_once_with("/billing", "env-1")
    assert (folder.name, folder.path) == ("queues", "/billing")
    assert folder.folder is run.parent
    assert run.updates("Secret") == [("/workers/queues", "/billing/queues")]


def test_same_name_and_place_changes_nothing():
    folder = _folder(name="workers", path="/")
    run = _Run(folder)

    run(name="workers", path="/")

    folder.save.assert_not_called()
    folder.environment.save.assert_not_called()


@pytest.mark.parametrize(
    "kwargs, message",
    [
        ({"name": "has space"}, "Folder names can only include"),
        ({"name": ""}, "Folder names can only include"),
        ({"name": "Settings"}, "reserved name"),
        ({"path": "/workers"}, "moved into itself"),
        ({"path": "/workers/queues"}, "moved into itself"),
    ],
)
def test_rejects_names_and_places_a_folder_cannot_take(kwargs, message):
    folder = _folder(name="workers", path="/")

    with pytest.raises(GraphQLError, match=message):
        _Run(folder)(**kwargs)

    folder.save.assert_not_called()


def test_rejects_a_name_another_folder_has_there():
    folder = _folder(name="workers", path="/")

    with pytest.raises(GraphQLError, match="already exists"):
        _Run(folder, conflict=True)(name="jobs")

    folder.save.assert_not_called()


def test_needs_permission_to_update_secrets():
    folder = _folder()

    with pytest.raises(GraphQLError, match="permission to update folders"):
        _Run(folder, permitted=False)(name="jobs")


def test_a_folder_holding_a_rotation_needs_permission_over_rotations():
    folder = _folder()

    with pytest.raises(GraphQLError, match="rotating secrets"):
        _Run(folder, has_rotation=True)(name="jobs")

    folder.save.assert_not_called()
