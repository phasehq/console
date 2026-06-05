import pytest
from unittest.mock import patch, MagicMock, call
from api.tasks.syncing import trigger_syncs_for_referencing_envs


@patch("api.tasks.syncing.trigger_sync_tasks")
@patch("api.tasks.syncing.apps.get_model")
def test_trigger_syncs_for_referencing_envs_with_references(
    mock_get_model, mock_trigger_sync
):
    """Test that syncs are triggered for environments whose secrets reference the changed env"""
    changed_env = MagicMock()
    changed_env.id = "changed-env-id"
    changed_env.name = "staging"
    changed_env.app.name = "my-app"
    changed_env.app_id = "app-1"
    changed_env.app.organisation = MagicMock()

    candidate_sync = MagicMock()
    candidate_sync.environment_id = "candidate-env-id"
    candidate_sync.environment = MagicMock()

    MockEnvironmentSync = MagicMock()
    MockEnvironmentSync.objects.filter.return_value.exclude.return_value.select_related.return_value = [
        candidate_sync
    ]

    def get_model_side_effect(app_label, model_name):
        if model_name == "EnvironmentSync":
            return MockEnvironmentSync
        return MagicMock()

    mock_get_model.side_effect = get_model_side_effect

    with patch(
        "api.utils.secrets.env_has_references_to", return_value=True
    ) as mock_has_refs:
        trigger_syncs_for_referencing_envs(changed_env)

        mock_has_refs.assert_called_once_with(
            "candidate-env-id", "staging", "my-app", "app-1"
        )

    mock_trigger_sync.assert_called_once_with(candidate_sync)


@patch("api.tasks.syncing.trigger_sync_tasks")
@patch("api.tasks.syncing.apps.get_model")
def test_trigger_syncs_for_referencing_envs_no_references(
    mock_get_model, mock_trigger_sync
):
    """Test that syncs are NOT triggered when no references exist"""
    changed_env = MagicMock()
    changed_env.id = "changed-env-id"
    changed_env.name = "staging"
    changed_env.app.name = "my-app"
    changed_env.app_id = "app-1"
    changed_env.app.organisation = MagicMock()

    candidate_sync = MagicMock()
    candidate_sync.environment_id = "candidate-env-id"
    candidate_sync.environment = MagicMock()

    MockEnvironmentSync = MagicMock()
    MockEnvironmentSync.objects.filter.return_value.exclude.return_value.select_related.return_value = [
        candidate_sync
    ]

    def get_model_side_effect(app_label, model_name):
        if model_name == "EnvironmentSync":
            return MockEnvironmentSync
        return MagicMock()

    mock_get_model.side_effect = get_model_side_effect

    with patch("api.utils.secrets.env_has_references_to", return_value=False):
        trigger_syncs_for_referencing_envs(changed_env)

    mock_trigger_sync.assert_not_called()


@patch("api.tasks.syncing.trigger_sync_tasks")
@patch("api.tasks.syncing.apps.get_model")
def test_trigger_syncs_for_referencing_envs_no_candidate_syncs(
    mock_get_model, mock_trigger_sync
):
    """Test early return when no other active syncs exist in the org"""
    changed_env = MagicMock()
    changed_env.id = "changed-env-id"
    changed_env.name = "staging"
    changed_env.app.name = "my-app"
    changed_env.app_id = "app-1"
    changed_env.app.organisation = MagicMock()

    MockEnvironmentSync = MagicMock()
    # Empty queryset — no candidate syncs
    MockEnvironmentSync.objects.filter.return_value.exclude.return_value.select_related.return_value = (
        []
    )

    def get_model_side_effect(app_label, model_name):
        if model_name == "EnvironmentSync":
            return MockEnvironmentSync
        return MagicMock()

    mock_get_model.side_effect = get_model_side_effect

    trigger_syncs_for_referencing_envs(changed_env)

    mock_trigger_sync.assert_not_called()


@patch("api.tasks.syncing.trigger_sync_tasks")
@patch("api.tasks.syncing.apps.get_model")
def test_trigger_syncs_multiple_envs_only_matching_triggered(
    mock_get_model, mock_trigger_sync
):
    """Test that only syncs for environments with references are triggered"""
    changed_env = MagicMock()
    changed_env.id = "changed-env-id"
    changed_env.name = "staging"
    changed_env.app.name = "my-app"
    changed_env.app_id = "app-1"
    changed_env.app.organisation = MagicMock()

    # Two candidate syncs on different environments
    sync_with_ref = MagicMock()
    sync_with_ref.environment_id = "env-with-ref"
    sync_with_ref.environment = MagicMock()

    sync_without_ref = MagicMock()
    sync_without_ref.environment_id = "env-without-ref"
    sync_without_ref.environment = MagicMock()

    MockEnvironmentSync = MagicMock()
    MockEnvironmentSync.objects.filter.return_value.exclude.return_value.select_related.return_value = [
        sync_with_ref,
        sync_without_ref,
    ]

    def get_model_side_effect(app_label, model_name):
        if model_name == "EnvironmentSync":
            return MockEnvironmentSync
        return MagicMock()

    mock_get_model.side_effect = get_model_side_effect

    def has_refs_side_effect(source_env_id, *args):
        return source_env_id == "env-with-ref"

    with patch(
        "api.utils.secrets.env_has_references_to", side_effect=has_refs_side_effect
    ):
        trigger_syncs_for_referencing_envs(changed_env)

    mock_trigger_sync.assert_called_once_with(sync_with_ref)
