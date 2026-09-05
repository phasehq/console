"""Env and principal binding regressions for SSE init, environment
creation, and service-account handler provisioning."""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from graphql import GraphQLError


def _make_info(user_id="actor-1"):
    info = MagicMock()
    info.context.user.userId = user_id
    return info


def _make_env_key(env_id):
    return SimpleNamespace(
        env_id=env_id,
        identity_key=f"ik-{env_id}",
        wrapped_seed=f"seed-{env_id}",
        wrapped_salt=f"salt-{env_id}",
    )


# ════════════════════════════════════════════════════════════════════
# InitEnvSync — server keys must cover exactly the app's own envs
# ════════════════════════════════════════════════════════════════════


def _patch_init_env_sync(monkeypatch, app_envs, permission=True):
    from backend.graphene.mutations import syncing as mutations

    app = MagicMock(id="app-1", name="App One", sse_enabled=False)
    app.organisation = MagicMock(id="org-1")

    mock_app_model = MagicMock()
    mock_app_model.objects.get.return_value = app
    monkeypatch.setattr(mutations, "App", mock_app_model)

    mock_env_model = MagicMock()
    mock_env_model.objects.filter.return_value = app_envs
    monkeypatch.setattr(mutations, "Environment", mock_env_model)

    mock_sek_model = MagicMock()
    monkeypatch.setattr(mutations, "ServerEnvironmentKey", mock_sek_model)

    monkeypatch.setattr(mutations, "transaction", MagicMock())
    monkeypatch.setattr(mutations, "user_can_access_app", MagicMock(return_value=True))
    monkeypatch.setattr(
        mutations, "user_can_access_environment", MagicMock(return_value=True)
    )
    monkeypatch.setattr(
        mutations, "user_has_permission", MagicMock(return_value=permission)
    )
    monkeypatch.setattr(
        mutations,
        "get_actor_info_from_graphql",
        MagicMock(return_value=("user", "actor-1", {})),
    )
    monkeypatch.setattr(
        mutations,
        "get_resolver_request_meta",
        MagicMock(return_value=("127.0.0.1", "pytest")),
    )
    monkeypatch.setattr(mutations, "log_audit_event", MagicMock())

    return mutations, app, mock_sek_model


def test_init_env_sync_rejects_foreign_env_id_before_any_write(monkeypatch):
    env = MagicMock(id="env-1")
    mutations, app, sek_model = _patch_init_env_sync(monkeypatch, [env])

    with pytest.raises(GraphQLError, match="do not belong to this app"):
        mutations.InitEnvSync.mutate(
            None,
            _make_info(),
            app_id="app-1",
            env_keys=[_make_env_key("env-1"), _make_env_key("foreign-env")],
        )

    sek_model.objects.filter.assert_not_called()
    sek_model.assert_not_called()
    app.save.assert_not_called()


def test_init_env_sync_rejects_duplicate_env_ids(monkeypatch):
    env = MagicMock(id="env-1")
    mutations, app, sek_model = _patch_init_env_sync(monkeypatch, [env])

    with pytest.raises(GraphQLError, match="Duplicate environment IDs"):
        mutations.InitEnvSync.mutate(
            None,
            _make_info(),
            app_id="app-1",
            env_keys=[_make_env_key("env-1"), _make_env_key("env-1")],
        )

    sek_model.objects.filter.assert_not_called()
    sek_model.assert_not_called()
    app.save.assert_not_called()


def test_init_env_sync_rejects_incomplete_coverage(monkeypatch):
    envs = [MagicMock(id="env-1"), MagicMock(id="env-2")]
    mutations, app, sek_model = _patch_init_env_sync(monkeypatch, envs)

    with pytest.raises(GraphQLError, match="every environment"):
        mutations.InitEnvSync.mutate(
            None, _make_info(), app_id="app-1", env_keys=[_make_env_key("env-1")]
        )

    sek_model.objects.filter.assert_not_called()
    sek_model.assert_not_called()
    app.save.assert_not_called()


def test_init_env_sync_requires_encryption_mode_permission(monkeypatch):
    env = MagicMock(id="env-1")
    mutations, app, sek_model = _patch_init_env_sync(
        monkeypatch, [env], permission=False
    )

    with pytest.raises(GraphQLError, match="encryption mode"):
        mutations.InitEnvSync.mutate(
            None, _make_info(), app_id="app-1", env_keys=[_make_env_key("env-1")]
        )

    permission_call = mutations.user_has_permission.call_args
    assert permission_call.args[1:] == ("update", "EncryptionMode", app.organisation, True)
    assert permission_call.kwargs == {"app": app}
    sek_model.objects.filter.assert_not_called()
    sek_model.assert_not_called()
    app.save.assert_not_called()


def test_init_env_sync_rejects_app_with_no_environments(monkeypatch):
    mutations, app, sek_model = _patch_init_env_sync(monkeypatch, [])

    with pytest.raises(GraphQLError, match="no environments"):
        mutations.InitEnvSync.mutate(
            None, _make_info(), app_id="app-1", env_keys=[]
        )

    app.save.assert_not_called()


def test_init_env_sync_upserts_validated_envs(monkeypatch):
    env_one = MagicMock(id="env-1")
    env_two = MagicMock(id="env-2")
    mutations, app, sek_model = _patch_init_env_sync(monkeypatch, [env_one, env_two])
    existing_key = MagicMock()
    fresh_key = MagicMock()
    sek_model.objects.filter.return_value.first.side_effect = [existing_key, None]
    sek_model.return_value = fresh_key

    mutations.InitEnvSync.mutate(
        None,
        _make_info(),
        app_id="app-1",
        env_keys=[_make_env_key("env-1"), _make_env_key("env-2")],
    )

    assert app.sse_enabled is True
    app.save.assert_called_once()
    mutations.Environment.objects.filter.assert_called_once_with(app=app)
    filtered_envs = [
        call.kwargs["environment"]
        for call in sek_model.objects.filter.call_args_list
    ]
    assert filtered_envs == [env_one, env_two]
    # env-1 had an existing row: it is updated in place, never duplicated.
    assert existing_key.wrapped_seed == "seed-env-1"
    assert existing_key.deleted_at is None
    existing_key.save.assert_called_once()
    # env-2 had none: a fresh row is created for the validated environment.
    sek_model.assert_called_once_with(environment=env_two)
    assert fresh_key.wrapped_seed == "seed-env-2"
    fresh_key.save.assert_called_once()
    mutations.log_audit_event.assert_called_once()


# ════════════════════════════════════════════════════════════════════
# CreateEnvironmentMutation — admin keys only for global-access members
# ════════════════════════════════════════════════════════════════════


def _make_admin_key(user_id):
    return SimpleNamespace(
        user_id=user_id,
        identity_key="ik",
        wrapped_seed="seed",
        wrapped_salt="salt",
    )


def _patch_create_environment(monkeypatch, admin_members, global_access=True):
    from backend.graphene.mutations import environment as mutations

    app = MagicMock(id="app-1", name="App One")
    app.organisation = MagicMock(id="org-1")

    mock_app_model = MagicMock()
    mock_app_model.objects.get.return_value = app
    monkeypatch.setattr(mutations, "App", mock_app_model)

    mock_env_model = MagicMock()
    mock_env_model.objects.filter.return_value.exists.return_value = False
    monkeypatch.setattr(mutations, "Environment", mock_env_model)

    owner = MagicMock(id="owner-1")
    creator = MagicMock(id="creator-1")
    mock_member_model = MagicMock()
    # The owner fetch filters by managed_key; the requester fetch by user.
    mock_member_model.objects.get.side_effect = lambda **kwargs: (
        owner if "role__managed_key" in kwargs else creator
    )
    mock_member_model.objects.filter.return_value.select_related.return_value = (
        admin_members
    )
    monkeypatch.setattr(mutations, "OrganisationMember", mock_member_model)

    mock_key_model = MagicMock()
    monkeypatch.setattr(mutations, "EnvironmentKey", mock_key_model)
    monkeypatch.setattr(mutations, "EnvironmentKeyGrant", MagicMock())
    monkeypatch.setattr(mutations, "ServerEnvironmentKey", MagicMock())
    monkeypatch.setattr(mutations, "transaction", MagicMock())
    monkeypatch.setattr(mutations, "user_can_access_app", MagicMock(return_value=True))
    monkeypatch.setattr(mutations, "user_has_permission", MagicMock(return_value=True))
    monkeypatch.setattr(
        mutations, "role_has_global_access", MagicMock(return_value=global_access)
    )
    monkeypatch.setattr(mutations, "can_use_custom_envs", MagicMock(return_value=True))
    monkeypatch.setattr(mutations, "can_add_environment", MagicMock(return_value=True))
    monkeypatch.setattr(
        mutations,
        "get_actor_info_from_graphql",
        MagicMock(return_value=("user", "actor-1", {})),
    )
    monkeypatch.setattr(
        mutations,
        "get_resolver_request_meta",
        MagicMock(return_value=("127.0.0.1", "pytest")),
    )
    monkeypatch.setattr(mutations, "log_audit_event", MagicMock())

    environment_data = SimpleNamespace(
        app_id="app-1",
        name="Development",
        env_type="dev",
        identity_key="env-ik",
        wrapped_seed="env-seed",
        wrapped_salt="env-salt",
    )

    return (
        mutations,
        environment_data,
        owner,
        creator,
        mock_env_model,
        mock_key_model,
        mock_member_model,
    )


def test_create_environment_rejects_non_org_admin_key_principal(monkeypatch):
    mutations, environment_data, _, _, env_model, key_model, member_model = (
        _patch_create_environment(monkeypatch, admin_members=[])
    )

    with pytest.raises(GraphQLError, match="not members of this organisation"):
        mutations.CreateEnvironmentMutation.mutate(
            None,
            _make_info(),
            environment_data=environment_data,
            admin_keys=[_make_admin_key("foreign-member")],
        )

    env_model.objects.create.assert_not_called()
    key_model.objects.create.assert_not_called()


def test_create_environment_rejects_non_global_admin_key_principal(monkeypatch):
    member = MagicMock(id="member-1")
    mutations, environment_data, _, _, env_model, key_model, _ = (
        _patch_create_environment(
            monkeypatch, admin_members=[member], global_access=False
        )
    )

    with pytest.raises(GraphQLError, match="global access"):
        mutations.CreateEnvironmentMutation.mutate(
            None,
            _make_info(),
            environment_data=environment_data,
            admin_keys=[_make_admin_key("member-1")],
        )

    env_model.objects.create.assert_not_called()
    key_model.objects.create.assert_not_called()


def test_create_environment_rejects_owner_in_admin_keys(monkeypatch):
    mutations, environment_data, owner, _, env_model, key_model, _ = (
        _patch_create_environment(monkeypatch, admin_members=[])
    )

    with pytest.raises(GraphQLError, match="created automatically"):
        mutations.CreateEnvironmentMutation.mutate(
            None,
            _make_info(),
            environment_data=environment_data,
            admin_keys=[_make_admin_key(str(owner.id))],
        )

    env_model.objects.create.assert_not_called()


def test_create_environment_rejects_missing_or_duplicate_principals(monkeypatch):
    mutations, environment_data, _, _, env_model, _, _ = _patch_create_environment(
        monkeypatch, admin_members=[]
    )

    with pytest.raises(GraphQLError, match="principal is required"):
        mutations.CreateEnvironmentMutation.mutate(
            None,
            _make_info(),
            environment_data=environment_data,
            admin_keys=[_make_admin_key(None)],
        )

    with pytest.raises(GraphQLError, match="Duplicate admin key principals"):
        mutations.CreateEnvironmentMutation.mutate(
            None,
            _make_info(),
            environment_data=environment_data,
            admin_keys=[_make_admin_key("member-1"), _make_admin_key("member-1")],
        )

    env_model.objects.create.assert_not_called()


def test_create_environment_writes_keys_for_validated_members(monkeypatch):
    admin = MagicMock(id="member-1")
    mutations, environment_data, owner, _, env_model, key_model, member_model = (
        _patch_create_environment(monkeypatch, admin_members=[admin])
    )
    new_env = MagicMock()
    env_model.objects.create.return_value = new_env

    mutations.CreateEnvironmentMutation.mutate(
        None,
        _make_info(),
        environment_data=environment_data,
        admin_keys=[_make_admin_key("member-1")],
    )

    admin_filter = member_model.objects.filter.call_args.kwargs
    assert admin_filter["organisation"] is env_model.objects.create.call_args.kwargs["app"].organisation
    assert admin_filter["deleted_at"] is None
    key_users = [
        call.kwargs["user"] for call in key_model.objects.create.call_args_list
    ]
    assert key_users == [owner, admin]
    for call in key_model.objects.create.call_args_list:
        assert call.kwargs["environment"] is new_env


def test_create_environment_allows_creators_own_key_without_global_access(monkeypatch):
    creator_member = MagicMock(id="creator-1")
    mutations, environment_data, owner, creator, env_model, key_model, _ = (
        _patch_create_environment(
            monkeypatch, admin_members=[creator_member], global_access=False
        )
    )
    new_env = MagicMock()
    env_model.objects.create.return_value = new_env

    mutations.CreateEnvironmentMutation.mutate(
        None,
        _make_info(),
        environment_data=environment_data,
        admin_keys=[_make_admin_key("creator-1")],
    )

    mutations.role_has_global_access.assert_not_called()
    key_users = [
        call.kwargs["user"] for call in key_model.objects.create.call_args_list
    ]
    assert key_users == [owner, creator_member]


# ════════════════════════════════════════════════════════════════════
# Service account handler provisioning — org-bound SAs and members
# ════════════════════════════════════════════════════════════════════


def _make_handler(service_account_id, member_id):
    return SimpleNamespace(
        service_account_id=service_account_id,
        member_id=member_id,
        wrapped_keyring="wk",
        wrapped_recovery="wr",
    )


def _patch_update_handlers(monkeypatch, org_sas, org_member_ids):
    from backend.graphene.mutations import service_accounts as mutations

    org = MagicMock(id="org-1")
    mock_org_model = MagicMock()
    mock_org_model.objects.get.return_value = org
    monkeypatch.setattr(mutations, "Organisation", mock_org_model)

    mock_sa_model = MagicMock()
    mock_sa_model.objects.filter.return_value.select_related.return_value = org_sas
    monkeypatch.setattr(mutations, "ServiceAccount", mock_sa_model)

    mock_member_model = MagicMock()
    mock_member_model.objects.filter.return_value.values_list.return_value = (
        org_member_ids
    )
    monkeypatch.setattr(mutations, "OrganisationMember", mock_member_model)

    mock_handler_model = MagicMock()
    mock_handler_model.objects.filter.return_value.exists.return_value = False
    monkeypatch.setattr(mutations, "ServiceAccountHandler", mock_handler_model)

    monkeypatch.setattr(mutations, "user_is_org_member", MagicMock(return_value=True))
    monkeypatch.setattr(mutations, "user_has_permission", MagicMock(return_value=True))
    monkeypatch.setattr(mutations, "_check_sa_permission", MagicMock())

    return mutations, mock_sa_model, mock_handler_model


def test_update_handlers_rejects_foreign_service_account_before_delete(monkeypatch):
    mutations, sa_model, handler_model = _patch_update_handlers(
        monkeypatch, org_sas=[], org_member_ids=["member-1"]
    )

    with pytest.raises(GraphQLError, match="do not belong to this organisation"):
        mutations.UpdateServiceAccountHandlersMutation.mutate(
            None,
            _make_info(),
            organisation_id="org-1",
            handlers=[_make_handler("foreign-sa", "member-1")],
        )

    handler_model.objects.filter.assert_not_called()
    handler_model.objects.create.assert_not_called()
    mutations._check_sa_permission.assert_not_called()


def test_update_handlers_rejects_foreign_member_before_delete(monkeypatch):
    sa = MagicMock(id="sa-1")
    mutations, sa_model, handler_model = _patch_update_handlers(
        monkeypatch, org_sas=[sa], org_member_ids=[]
    )

    with pytest.raises(GraphQLError, match="not members of this organisation"):
        mutations.UpdateServiceAccountHandlersMutation.mutate(
            None,
            _make_info(),
            organisation_id="org-1",
            handlers=[_make_handler("sa-1", "foreign-member")],
        )

    handler_model.objects.filter.assert_not_called()
    handler_model.objects.create.assert_not_called()


def test_update_handlers_uses_preflighted_service_accounts(monkeypatch):
    sa = MagicMock(id="sa-1")
    mutations, sa_model, handler_model = _patch_update_handlers(
        monkeypatch, org_sas=[sa], org_member_ids=["member-1"]
    )

    mutations.UpdateServiceAccountHandlersMutation.mutate(
        None,
        _make_info(),
        organisation_id="org-1",
        handlers=[_make_handler("sa-1", "member-1")],
    )

    sa_model.objects.get.assert_not_called()
    sa_filter = sa_model.objects.filter.call_args.kwargs
    assert sa_filter["organisation"] is mutations.Organisation.objects.get.return_value
    assert sa_filter["deleted_at__isnull"] is True
    member_filter = mutations.OrganisationMember.objects.filter.call_args.kwargs
    assert member_filter["organisation"] is mutations.Organisation.objects.get.return_value
    assert member_filter["deleted_at"] is None
    create_kwargs = handler_model.objects.create.call_args.kwargs
    assert create_kwargs["service_account"] is sa
    assert create_kwargs["user_id"] == "member-1"


def test_update_handlers_rejects_duplicate_handler_pairs(monkeypatch):
    sa = MagicMock(id="sa-1")
    mutations, sa_model, handler_model = _patch_update_handlers(
        monkeypatch, org_sas=[sa], org_member_ids=["member-1"]
    )

    with pytest.raises(GraphQLError, match="Duplicate handlers"):
        mutations.UpdateServiceAccountHandlersMutation.mutate(
            None,
            _make_info(),
            organisation_id="org-1",
            handlers=[
                _make_handler("sa-1", "member-1"),
                _make_handler("sa-1", "member-1"),
            ],
        )

    handler_model.objects.filter.assert_not_called()
    handler_model.objects.create.assert_not_called()


def test_create_service_account_rejects_foreign_handler_member(monkeypatch):
    from backend.graphene.mutations import service_accounts as mutations

    org = MagicMock(id="org-1")
    mock_org_model = MagicMock()
    mock_org_model.objects.get.return_value = org
    monkeypatch.setattr(mutations, "Organisation", mock_org_model)

    mock_member_model = MagicMock()
    mock_member_model.objects.filter.return_value.values_list.return_value = []
    monkeypatch.setattr(mutations, "OrganisationMember", mock_member_model)

    mock_role_model = MagicMock()
    monkeypatch.setattr(mutations, "Role", mock_role_model)
    mock_sa_model = MagicMock()
    monkeypatch.setattr(mutations, "ServiceAccount", mock_sa_model)
    monkeypatch.setattr(mutations, "user_has_permission", MagicMock(return_value=True))

    with pytest.raises(GraphQLError, match="not members of this organisation"):
        mutations.CreateServiceAccountMutation.mutate(
            None,
            _make_info(),
            name="automation",
            organisation_id="org-1",
            role_id="role-1",
            handlers=[_make_handler(None, "foreign-member")],
            identity_key="ik",
        )

    mock_role_model.objects.get.assert_not_called()
    mock_sa_model.objects.create.assert_not_called()