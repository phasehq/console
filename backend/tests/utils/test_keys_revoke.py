"""Defense-in-depth: revoke_team_environment_keys must wipe wrapping
material when it soft-deletes orphaned EnvironmentKey rows. Otherwise a
stale row whose wrapped_seed/wrapped_salt are intact can leak the env
private key to consumers that forget to filter `deleted_at__isnull=True`
(e.g. legacy serializers exposing `fields = "__all__"`).
"""

from unittest.mock import MagicMock, patch


_M = "api.utils.keys"


@patch(f"{_M}.apps.get_model")
def test_soft_delete_blanks_wrapping_material(mock_get_model):
    """When the last grant is removed, the EnvironmentKey row is
    soft-deleted AND its wrapped_seed/wrapped_salt/identity_key are
    cleared so the row carries no useful crypto material."""
    from api.utils.keys import revoke_team_environment_keys

    MockEnvKey = MagicMock(name="EnvironmentKey")
    MockGrant = MagicMock(name="EnvironmentKeyGrant")

    def model_loader(_app, name):
        return {"EnvironmentKey": MockEnvKey, "EnvironmentKeyGrant": MockGrant}[name]

    mock_get_model.side_effect = model_loader

    # The team-grant deletion finds one orphan-able EnvironmentKey.
    grants_qs = MagicMock()
    grants_qs.values_list.return_value = ["ek-1"]
    MockGrant.objects.filter.side_effect = [
        grants_qs,         # initial team-grant lookup
        MagicMock(exists=MagicMock(return_value=False)),  # remaining-grants check
    ]

    update_target = MagicMock()
    MockEnvKey.objects.filter.return_value = update_target

    team = MagicMock()
    revoke_team_environment_keys(team)

    # The orphan was soft-deleted via .update() — verify the update kwargs
    # include the crypto-wipe alongside deleted_at.
    update_target.update.assert_called_once()
    update_kwargs = update_target.update.call_args.kwargs
    assert update_kwargs["wrapped_seed"] == ""
    assert update_kwargs["wrapped_salt"] == ""
    assert update_kwargs["identity_key"] == ""
    assert update_kwargs["deleted_at"] is not None


@patch(f"{_M}.apps.get_model")
def test_soft_delete_skipped_when_remaining_grants_exist(mock_get_model):
    """If another grant still references the EnvironmentKey, no
    soft-delete or wipe runs — only the orphan path mutates the row."""
    from api.utils.keys import revoke_team_environment_keys

    MockEnvKey = MagicMock(name="EnvironmentKey")
    MockGrant = MagicMock(name="EnvironmentKeyGrant")
    mock_get_model.side_effect = lambda _a, name: {
        "EnvironmentKey": MockEnvKey,
        "EnvironmentKeyGrant": MockGrant,
    }[name]

    grants_qs = MagicMock()
    grants_qs.values_list.return_value = ["ek-1"]
    MockGrant.objects.filter.side_effect = [
        grants_qs,
        # Another grant still references ek-1 — orphan check returns True.
        MagicMock(exists=MagicMock(return_value=True)),
    ]

    revoke_team_environment_keys(MagicMock())

    MockEnvKey.objects.filter.assert_not_called()
