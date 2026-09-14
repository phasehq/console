"""Security regressions for app-scoped member environment key mutations."""

from unittest.mock import MagicMock

import pytest
from graphql import GraphQLError


def _make_info():
    info = MagicMock()
    info.context.user.userId = "actor-1"
    return info


def _make_key(env_id, principal_id):
    key = MagicMock()
    key.env_id = env_id
    key.user_id = principal_id
    key.identity_key = f"ik-{env_id}"
    key.wrapped_seed = f"seed-{env_id}"
    key.wrapped_salt = f"salt-{env_id}"
    return key


def _make_member_input(member_id, member_type, env_keys):
    member_input = MagicMock()
    member_input.member_id = member_id
    member_input.member_type = member_type
    member_input.env_keys = env_keys
    return member_input


def _iterable_queryset(items):
    queryset = MagicMock()
    queryset.__iter__.return_value = iter(items)
    return queryset


def _patch_app_common(monkeypatch):
    from backend.graphene.mutations import app as app_mutations
    from backend.graphene.mutations import environment as environment_mutations

    app = MagicMock(id="app-1", name="App One")
    app.organisation = MagicMock(id="org-1")

    mock_app_model = MagicMock()
    mock_app_model.objects.get.return_value = app
    monkeypatch.setattr(app_mutations, "App", mock_app_model)
    monkeypatch.setattr(app_mutations, "user_can_access_app", MagicMock(return_value=True))
    monkeypatch.setattr(app_mutations, "user_has_permission", MagicMock(return_value=True))
    monkeypatch.setattr(app_mutations, "_upsert_active_env_key", MagicMock())
    monkeypatch.setattr(app_mutations, "EnvironmentKeyGrant", MagicMock())
    monkeypatch.setattr(app_mutations, "transaction", MagicMock())
    monkeypatch.setattr(app_mutations, "get_actor_info_from_graphql", MagicMock(return_value=("user", "actor-1", {})))
    monkeypatch.setattr(app_mutations, "get_resolver_request_meta", MagicMock(return_value=("127.0.0.1", "pytest")))
    monkeypatch.setattr(app_mutations, "get_member_display_name", MagicMock(return_value="Test Member"))
    monkeypatch.setattr(app_mutations, "log_audit_event", MagicMock())

    mock_environment_model = MagicMock()
    monkeypatch.setattr(environment_mutations, "Environment", mock_environment_model)

    return app_mutations, app, mock_environment_model


def _patch_member_models(monkeypatch, app_mutations, user_members=(), service_accounts=()):
    mock_user_model = MagicMock()
    mock_user_model.objects.get.side_effect = list(user_members)
    monkeypatch.setattr(app_mutations, "OrganisationMember", mock_user_model)

    mock_service_model = MagicMock()
    mock_service_model.objects.get.side_effect = list(service_accounts)
    monkeypatch.setattr(app_mutations, "ServiceAccount", mock_service_model)
    return mock_user_model, mock_service_model


def test_shared_validation_rejects_duplicate_environment_ids(monkeypatch):
    from backend.graphene.mutations import environment as environment_mutations

    app = MagicMock()
    member = MagicMock(id="member-1")
    mock_environment_model = MagicMock()
    monkeypatch.setattr(environment_mutations, "Environment", mock_environment_model)

    with pytest.raises(GraphQLError, match="Duplicate environment IDs"):
        environment_mutations.validate_member_environment_keys(
            app,
            member,
            [_make_key("env-1", "member-1"), _make_key("env-1", "member-1")],
        )

    mock_environment_model.objects.filter.assert_not_called()


@pytest.mark.parametrize("member_type", ["USER", "SERVICE"])
def test_update_scope_happy_path_uses_validated_principal(monkeypatch, member_type):
    from backend.graphene.mutations import environment as mutations
    from backend.graphene.types import MemberType

    member_type = getattr(MemberType, member_type)
    app = MagicMock(id="app-1", name="App One")
    app.organisation = MagicMock(id="org-1")
    member = MagicMock(id="member-1", name="Service Account")
    app.members.all.return_value = [member]
    app.service_accounts.all.return_value = [member]
    environment = MagicMock(id="env-1", name="Development")

    mock_app_model = MagicMock()
    mock_app_model.objects.get.return_value = app
    monkeypatch.setattr(mutations, "App", mock_app_model)
    mock_user_model = MagicMock()
    mock_user_model.objects.get.return_value = member
    monkeypatch.setattr(mutations, "OrganisationMember", mock_user_model)
    mock_service_model = MagicMock()
    mock_service_model.objects.get.return_value = member
    monkeypatch.setattr(mutations, "ServiceAccount", mock_service_model)

    valid_env_qs = _iterable_queryset([environment])
    audit_env_qs = MagicMock()
    audit_env_qs.values_list.return_value = [("env-1", "Development")]
    mock_environment_model = MagicMock()
    mock_environment_model.objects.filter.side_effect = [valid_env_qs, audit_env_qs]
    monkeypatch.setattr(mutations, "Environment", mock_environment_model)

    audit_old_qs = MagicMock()
    audit_old_qs.values_list.return_value = []
    old_keys_qs = _iterable_queryset([])
    soft_delete_qs = MagicMock()
    mock_environment_key_model = MagicMock()
    mock_environment_key_model.objects.filter.side_effect = [
        audit_old_qs,
        old_keys_qs,
        soft_delete_qs,
    ]
    new_environment_key = MagicMock()
    mock_environment_key_model.objects.create.return_value = new_environment_key
    monkeypatch.setattr(mutations, "EnvironmentKey", mock_environment_key_model)

    delete_grants_qs = MagicMock()
    remaining_grants_qs = MagicMock()
    remaining_grants_qs.values_list.return_value = []
    mock_grant_model = MagicMock()
    mock_grant_model.objects.filter.side_effect = [delete_grants_qs, remaining_grants_qs]
    monkeypatch.setattr(mutations, "EnvironmentKeyGrant", mock_grant_model)
    monkeypatch.setattr(mutations, "transaction", MagicMock())
    monkeypatch.setattr(mutations, "user_can_access_app", MagicMock(return_value=True))
    monkeypatch.setattr(mutations, "user_has_permission", MagicMock(return_value=True))
    monkeypatch.setattr(mutations, "role_has_global_access", MagicMock(return_value=False))
    monkeypatch.setattr(mutations, "get_actor_info_from_graphql", MagicMock(return_value=("user", "actor-1", {})))
    monkeypatch.setattr(mutations, "get_resolver_request_meta", MagicMock(return_value=("127.0.0.1", "pytest")))
    monkeypatch.setattr(mutations, "get_member_display_name", MagicMock(return_value="Test Member"))
    monkeypatch.setattr(mutations, "log_audit_event", MagicMock())

    mutations.UpdateMemberEnvScopeMutation.mutate(
        None,
        _make_info(),
        member_id="member-1",
        app_id="app-1",
        env_keys=[_make_key("env-1", "member-1")],
        member_type=member_type,
    )

    create_kwargs = mock_environment_key_model.objects.create.call_args.kwargs
    assert create_kwargs["environment"] is environment
    if member_type == MemberType.USER:
        assert create_kwargs["user"] is member
        assert create_kwargs["service_account"] is None
    else:
        assert create_kwargs["user"] is None
        assert create_kwargs["service_account"] is member


def test_update_scope_rejects_foreign_environment_before_revocation(monkeypatch):
    from backend.graphene.mutations import environment as mutations
    from backend.graphene.types import MemberType

    app = MagicMock(id="app-1")
    app.organisation = MagicMock(id="org-1")
    member = MagicMock(id="member-1")
    app.members.all.return_value = [member]

    mock_app_model = MagicMock()
    mock_app_model.objects.get.return_value = app
    monkeypatch.setattr(mutations, "App", mock_app_model)
    mock_user_model = MagicMock()
    mock_user_model.objects.get.return_value = member
    monkeypatch.setattr(mutations, "OrganisationMember", mock_user_model)
    mock_environment_model = MagicMock()
    mock_environment_model.objects.filter.return_value = _iterable_queryset([])
    monkeypatch.setattr(mutations, "Environment", mock_environment_model)
    mock_environment_key_model = MagicMock()
    monkeypatch.setattr(mutations, "EnvironmentKey", mock_environment_key_model)
    mock_grant_model = MagicMock()
    monkeypatch.setattr(mutations, "EnvironmentKeyGrant", mock_grant_model)
    monkeypatch.setattr(mutations, "user_can_access_app", MagicMock(return_value=True))
    monkeypatch.setattr(mutations, "user_has_permission", MagicMock(return_value=True))
    monkeypatch.setattr(mutations, "role_has_global_access", MagicMock(return_value=False))

    with pytest.raises(GraphQLError, match="do not belong to this app"):
        mutations.UpdateMemberEnvScopeMutation.mutate(
            None,
            _make_info(),
            member_id="member-1",
            app_id="app-1",
            env_keys=[_make_key("foreign-env", "member-1")],
            member_type=MemberType.USER,
        )

    mock_environment_key_model.objects.filter.assert_not_called()
    mock_grant_model.objects.filter.assert_not_called()


def test_update_scope_rejects_mismatched_principal_before_revocation(monkeypatch):
    from backend.graphene.mutations import environment as mutations
    from backend.graphene.types import MemberType

    app = MagicMock(id="app-1")
    app.organisation = MagicMock(id="org-1")
    member = MagicMock(id="member-1")
    app.members.all.return_value = [member]

    mock_app_model = MagicMock()
    mock_app_model.objects.get.return_value = app
    monkeypatch.setattr(mutations, "App", mock_app_model)
    mock_user_model = MagicMock()
    mock_user_model.objects.get.return_value = member
    monkeypatch.setattr(mutations, "OrganisationMember", mock_user_model)
    mock_environment_model = MagicMock()
    monkeypatch.setattr(mutations, "Environment", mock_environment_model)
    mock_environment_key_model = MagicMock()
    monkeypatch.setattr(mutations, "EnvironmentKey", mock_environment_key_model)
    monkeypatch.setattr(mutations, "user_can_access_app", MagicMock(return_value=True))
    monkeypatch.setattr(mutations, "user_has_permission", MagicMock(return_value=True))
    monkeypatch.setattr(mutations, "role_has_global_access", MagicMock(return_value=False))

    with pytest.raises(GraphQLError, match="principal does not match"):
        mutations.UpdateMemberEnvScopeMutation.mutate(
            None,
            _make_info(),
            member_id="member-1",
            app_id="app-1",
            env_keys=[_make_key("env-1", "attacker-selected-member")],
            member_type=MemberType.USER,
        )

    mock_environment_model.objects.filter.assert_not_called()
    mock_environment_key_model.objects.filter.assert_not_called()


@pytest.mark.parametrize("member_type_name", ["USER", "SERVICE"])
def test_add_member_happy_path_uses_validated_principal(monkeypatch, member_type_name):
    from backend.graphene.types import MemberType

    app_mutations, app, mock_environment_model = _patch_app_common(monkeypatch)
    member_type = getattr(MemberType, member_type_name)
    member = MagicMock(id="member-1", name="Service Account")
    mock_user_model, mock_service_model = _patch_member_models(
        monkeypatch,
        app_mutations,
        user_members=[member] if member_type == MemberType.USER else [],
        service_accounts=[member] if member_type == MemberType.SERVICE else [],
    )
    environment = MagicMock(id="env-1", name="Development")
    mock_environment_model.objects.filter.return_value = _iterable_queryset([environment])
    app_mutations._upsert_active_env_key.return_value = MagicMock()

    app_mutations.AddAppMemberMutation.mutate(
        None,
        _make_info(),
        member_id="member-1",
        app_id="app-1",
        env_keys=[_make_key("env-1", "member-1")],
        member_type=member_type,
    )

    condition = app_mutations._upsert_active_env_key.call_args.args[0]
    assert condition["environment"] is environment
    if member_type == MemberType.USER:
        assert condition["user"] is member
        assert condition["service_account"] is None
        app.members.add.assert_called_once_with(member)
        mock_user_model.objects.get.assert_called_once_with(
            id="member-1", organisation=app.organisation, deleted_at=None
        )
    else:
        assert condition["user"] is None
        assert condition["service_account"] is member
        app.service_accounts.add.assert_called_once_with(member)
        mock_service_model.objects.get.assert_called_once_with(
            id="member-1", organisation=app.organisation, deleted_at=None
        )


def test_add_member_rejects_foreign_environment_and_mismatched_principal(monkeypatch):
    from backend.graphene.types import MemberType

    app_mutations, app, mock_environment_model = _patch_app_common(monkeypatch)
    member = MagicMock(id="member-1")
    _patch_member_models(monkeypatch, app_mutations, user_members=[member, member])

    mock_environment_model.objects.filter.return_value = _iterable_queryset([])
    with pytest.raises(GraphQLError, match="do not belong to this app"):
        app_mutations.AddAppMemberMutation.mutate(
            None,
            _make_info(),
            member_id="member-1",
            app_id="app-1",
            env_keys=[_make_key("foreign-env", "member-1")],
            member_type=MemberType.USER,
        )

    with pytest.raises(GraphQLError, match="principal does not match"):
        app_mutations.AddAppMemberMutation.mutate(
            None,
            _make_info(),
            member_id="member-1",
            app_id="app-1",
            env_keys=[_make_key("env-1", "other-member")],
            member_type=MemberType.USER,
        )

    app.members.add.assert_not_called()
    app_mutations._upsert_active_env_key.assert_not_called()


def test_bulk_add_mixed_batch_is_rejected_before_any_write(monkeypatch):
    from backend.graphene.types import MemberType

    app_mutations, app, mock_environment_model = _patch_app_common(monkeypatch)
    first_member = MagicMock(id="member-1")
    second_member = MagicMock(id="member-2")
    _patch_member_models(
        monkeypatch,
        app_mutations,
        user_members=[first_member, second_member],
    )
    valid_environment = MagicMock(id="env-1", name="Development")
    mock_environment_model.objects.filter.side_effect = [
        _iterable_queryset([valid_environment]),
        _iterable_queryset([]),
    ]
    members = [
        _make_member_input(
            "member-1", MemberType.USER, [_make_key("env-1", "member-1")]
        ),
        _make_member_input(
            "member-2", MemberType.USER, [_make_key("foreign-env", "member-2")]
        ),
    ]

    with pytest.raises(GraphQLError, match="do not belong to this app"):
        app_mutations.BulkAddAppMembersMutation.mutate(
            None, _make_info(), app_id="app-1", members=members
        )

    app.members.add.assert_not_called()
    app.service_accounts.add.assert_not_called()
    app_mutations._upsert_active_env_key.assert_not_called()
    app_mutations.EnvironmentKeyGrant.objects.get_or_create.assert_not_called()
    app_mutations.transaction.atomic.assert_not_called()


def test_bulk_add_user_and_service_happy_paths_are_atomic(monkeypatch):
    from backend.graphene.types import MemberType

    app_mutations, app, mock_environment_model = _patch_app_common(monkeypatch)
    user_member = MagicMock(id="member-1")
    service_account = MagicMock(id="service-1", name="Automation")
    _patch_member_models(
        monkeypatch,
        app_mutations,
        user_members=[user_member],
        service_accounts=[service_account],
    )
    user_environment = MagicMock(id="env-1", name="Development")
    service_environment = MagicMock(id="env-2", name="Production")
    mock_environment_model.objects.filter.side_effect = [
        _iterable_queryset([user_environment]),
        _iterable_queryset([service_environment]),
    ]
    app_mutations._upsert_active_env_key.side_effect = [MagicMock(), MagicMock()]
    members = [
        _make_member_input(
            "member-1", MemberType.USER, [_make_key("env-1", "member-1")]
        ),
        _make_member_input(
            "service-1", MemberType.SERVICE, [_make_key("env-2", "service-1")]
        ),
    ]

    app_mutations.BulkAddAppMembersMutation.mutate(
        None, _make_info(), app_id="app-1", members=members
    )

    conditions = [call.args[0] for call in app_mutations._upsert_active_env_key.call_args_list]
    assert conditions[0] == {
        "environment": user_environment,
        "user": user_member,
        "service_account": None,
    }
    assert conditions[1] == {
        "environment": service_environment,
        "user": None,
        "service_account": service_account,
    }
    app.members.add.assert_called_once_with(user_member)
    app.service_accounts.add.assert_called_once_with(service_account)
    app_mutations.transaction.atomic.assert_called_once_with()
