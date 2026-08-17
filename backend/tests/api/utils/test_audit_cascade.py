"""Regression tests for cascade-audit helpers used by app/team delete.

Without these helpers, deleting an app or a team emitted only a single
audit row for the parent — every cascaded env / SA / SA-token was
hard-removed (or soft-deleted, for team-owned SAs) with no trace in the
audit log. Each helper enumerates the children that are about to be
cascade-killed and emits a per-resource D event before the cascade fires.
"""

from unittest.mock import MagicMock, patch


def _make_env(env_id, name):
    env = MagicMock()
    env.id = env_id
    env.name = name
    return env


def _make_sa(sa_id, name):
    sa = MagicMock()
    sa.id = sa_id
    sa.name = name
    return sa


def _make_token(token_id, name):
    tok = MagicMock()
    tok.id = token_id
    tok.name = name
    return tok


# ════════════════════════════════════════════════════════════════════
# audit_app_cascade_envs
# ════════════════════════════════════════════════════════════════════


@patch("api.utils.audit_logging.log_audit_event")
def test_audit_app_cascade_envs_emits_one_event_per_env(mock_log):
    from api.utils import audit_logging

    app = MagicMock()
    app.id = "app-1"
    app.name = "victim-app"
    org = MagicMock()
    app.organisation = org

    envs = [
        _make_env("env-dev", "Development"),
        _make_env("env-staging", "Staging"),
        _make_env("env-prod", "Production"),
    ]

    with patch("api.models.Environment") as MockEnv:
        MockEnv.objects.filter.return_value = envs
        audit_logging.audit_app_cascade_envs(
            app,
            actor_type="user",
            actor_id="actor-1",
            actor_metadata={"email": "a@b.com"},
            ip_address="127.0.0.1",
            user_agent="pytest",
        )

    assert mock_log.call_count == 3
    emitted_env_ids = [c.kwargs["resource_id"] for c in mock_log.call_args_list]
    assert emitted_env_ids == ["env-dev", "env-staging", "env-prod"]
    for call in mock_log.call_args_list:
        assert call.kwargs["event_type"] == "D"
        assert call.kwargs["resource_type"] == "env"
        assert call.kwargs["organisation"] is org
        assert call.kwargs["actor_id"] == "actor-1"
        assert call.kwargs["resource_metadata"]["app_id"] == "app-1"
        assert call.kwargs["resource_metadata"]["app_name"] == "victim-app"
        assert "Cascade-deleted" in call.kwargs["description"]


@patch("api.utils.audit_logging.log_audit_event")
def test_audit_app_cascade_envs_emits_nothing_when_no_envs(mock_log):
    from api.utils import audit_logging

    app = MagicMock()
    app.organisation = MagicMock()

    with patch("api.models.Environment") as MockEnv:
        MockEnv.objects.filter.return_value = []
        audit_logging.audit_app_cascade_envs(
            app, "user", "a-1", {}, "127.0.0.1", "pytest"
        )

    mock_log.assert_not_called()


# ════════════════════════════════════════════════════════════════════
# audit_team_cascade_sas
# ════════════════════════════════════════════════════════════════════


@patch("api.utils.audit_logging.log_audit_event")
def test_audit_team_cascade_sas_emits_sa_and_token_events(mock_log):
    from api.utils import audit_logging

    team = MagicMock()
    team.id = "team-1"
    team.name = "victim-team"
    org = MagicMock()
    team.organisation = org

    sa1 = _make_sa("sa-1", "deploy-bot")
    sa2 = _make_sa("sa-2", "ci-bot")

    sa1_tokens = [_make_token("tok-1a", "ci"), _make_token("tok-1b", "staging")]
    sa2_tokens = [_make_token("tok-2a", "prod")]

    def _token_filter(service_account, deleted_at__isnull):
        if service_account is sa1:
            return sa1_tokens
        if service_account is sa2:
            return sa2_tokens
        return []

    with patch("api.models.ServiceAccount") as MockSA, \
         patch("api.models.ServiceAccountToken") as MockTok:
        MockSA.objects.filter.return_value = [sa1, sa2]
        MockTok.objects.filter.side_effect = _token_filter

        audit_logging.audit_team_cascade_sas(
            team,
            actor_type="user",
            actor_id="actor-1",
            actor_metadata={"email": "a@b.com"},
            ip_address="127.0.0.1",
            user_agent="pytest",
        )

    # Expected emission order per SA: each of its tokens, then the SA itself.
    # Two SAs × (their tokens + 1 SA event) = 2+1 + 1+1 = 5 events total.
    assert mock_log.call_count == 5

    types_in_order = [
        (c.kwargs["resource_type"], c.kwargs["resource_id"])
        for c in mock_log.call_args_list
    ]
    assert types_in_order == [
        ("sa_token", "tok-1a"),
        ("sa_token", "tok-1b"),
        ("sa", "sa-1"),
        ("sa_token", "tok-2a"),
        ("sa", "sa-2"),
    ]
    for call in mock_log.call_args_list:
        assert call.kwargs["event_type"] == "D"
        assert call.kwargs["organisation"] is org
        if call.kwargs["resource_type"] == "sa_token":
            assert call.kwargs["resource_metadata"]["service_account_id"] in ("sa-1", "sa-2")
        else:
            assert call.kwargs["resource_metadata"]["team_id"] == "team-1"


@patch("api.utils.audit_logging.log_audit_event")
def test_audit_team_cascade_sas_emits_nothing_when_no_owned_sas(mock_log):
    from api.utils import audit_logging

    team = MagicMock()
    team.organisation = MagicMock()

    with patch("api.models.ServiceAccount") as MockSA, \
         patch("api.models.ServiceAccountToken"):
        MockSA.objects.filter.return_value = []
        audit_logging.audit_team_cascade_sas(
            team, "user", "a-1", {}, "127.0.0.1", "pytest"
        )

    mock_log.assert_not_called()
