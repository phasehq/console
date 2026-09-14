import importlib
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from django.core.exceptions import ValidationError


MIGRATION_0090_APPLIED = datetime(2024, 11, 4, 8, 35, tzinfo=timezone.utc)
MIGRATION_0091_APPLIED = datetime(2024, 11, 4, 8, 36, tzinfo=timezone.utc)


def _default_roles(organisation_id="org-1", *, legacy=False):
    managed_keys = (
        ("owner", "admin", "developer", "manager", "service")
        if legacy
        else ("owner", "admin", "manager", "developer", "service")
    )
    if legacy:
        created_at = [
            MIGRATION_0090_APPLIED - timedelta(days=1, seconds=3 - index)
            for index in range(3)
        ] + [
            MIGRATION_0090_APPLIED + timedelta(seconds=index + 1)
            for index in range(2)
        ]
    else:
        created_at = [
            MIGRATION_0091_APPLIED + timedelta(days=1, seconds=index)
            for index in range(5)
        ]

    return [
        SimpleNamespace(
            id=f"role-{managed_key}",
            organisation_id=organisation_id,
            name=managed_key.title(),
            created_at=created_at[index],
        )
        for index, managed_key in enumerate(managed_keys)
    ]


def _assignments(roles, custom_roles=(), operator_role_map=None):
    migration = importlib.import_module("api.migrations.0139_role_managed_key")
    return migration._build_managed_role_assignments(
        ["org-1"],
        roles,
        custom_roles,
        MIGRATION_0090_APPLIED,
        MIGRATION_0091_APPLIED,
        operator_role_map,
    )


def test_migration_assigns_each_canonical_managed_key():
    assignments = _assignments(_default_roles())

    assert set(assignments) == {
        ("role-owner", "owner"),
        ("role-admin", "admin"),
        ("role-manager", "manager"),
        ("role-developer", "developer"),
        ("role-service", "service"),
    }


def test_migration_assigns_legacy_creation_order_without_using_names_as_identity():
    assert set(_assignments(_default_roles(legacy=True))) == {
        ("role-owner", "owner"),
        ("role-admin", "admin"),
        ("role-manager", "manager"),
        ("role-developer", "developer"),
        ("role-service", "service"),
    }


@pytest.mark.parametrize(
    "roles",
    [
        _default_roles()[:-1],
        [*_default_roles(), _default_roles()[0]],
        [
            SimpleNamespace(
                id="renamed-owner",
                organisation_id="org-1",
                name="Superuser",
                created_at=_default_roles()[0].created_at,
            ),
            *_default_roles()[1:],
        ],
    ],
)
def test_migration_fails_closed_for_missing_duplicate_or_renamed_defaults(roles):
    with pytest.raises(RuntimeError, match="ambiguous or unsafe role data"):
        _assignments(roles)


def test_migration_rejects_canonical_name_permutation():
    roles = _default_roles()
    owner = next(role for role in roles if role.id == "role-owner")
    manager = next(role for role in roles if role.id == "role-manager")
    owner.name, manager.name = manager.name, owner.name

    with pytest.raises(
        RuntimeError,
        match="identified by creation history as 'owner'.*currently named 'Manager'",
    ):
        _assignments(roles)


@pytest.mark.parametrize("global_access", [True, "true", 1])
def test_migration_rejects_legacy_custom_global_access(global_access):
    custom_role = SimpleNamespace(
        id="custom-global",
        organisation_id="org-1",
        name="Legacy global",
        permissions={"global_access": global_access},
    )

    with pytest.raises(
        RuntimeError,
        match="custom role custom-global.*has legacy global_access enabled",
    ):
        _assignments(_default_roles(), [custom_role])


def test_migration_allows_legacy_false_custom_global_access():
    custom_role = SimpleNamespace(
        id="custom-scoped",
        organisation_id="org-1",
        name="Scoped",
        permissions={"global_access": False},
    )

    assert len(_assignments(_default_roles(), [custom_role])) == 5


def test_migration_preflight_runs_before_managed_key_field_is_added():
    migration = importlib.import_module("api.migrations.0139_role_managed_key")

    assert isinstance(
        migration.Migration.operations[0], migration.migrations.RunPython
    )
    assert (
        migration.Migration.operations[0].code
        is migration.preflight_managed_role_keys
    )
    assert isinstance(
        migration.Migration.operations[1], migration.migrations.AddField
    )


def test_migration_requires_explicit_operator_mapping_for_ambiguous_history():
    roles = _default_roles()
    for index, role in enumerate(roles):
        role.created_at = MIGRATION_0090_APPLIED + timedelta(seconds=index + 1)

    with pytest.raises(RuntimeError, match="PHASE_MANAGED_ROLE_ID_MAP"):
        _assignments(roles)


def test_migration_accepts_valid_operator_mapping_for_ambiguous_history():
    roles = _default_roles()
    for index, role in enumerate(roles):
        role.created_at = MIGRATION_0090_APPLIED + timedelta(seconds=index + 1)
    operator_mapping = {
        "org-1": {
            managed_key: f"role-{managed_key}"
            for managed_key in ("owner", "admin", "manager", "developer", "service")
        }
    }

    assert set(_assignments(roles, operator_role_map=operator_mapping)) == {
        ("role-owner", "owner"),
        ("role-admin", "admin"),
        ("role-manager", "manager"),
        ("role-developer", "developer"),
        ("role-service", "service"),
    }


def test_migration_does_not_override_deterministic_history_from_process_input():
    operator_mapping = {
        "org-1": {
            "owner": "role-manager",
            "admin": "role-admin",
            "manager": "role-owner",
            "developer": "role-developer",
            "service": "role-service",
        }
    }

    with pytest.raises(RuntimeError, match="unused organisation IDs: org-1"):
        _assignments(_default_roles(), operator_role_map=operator_mapping)


def test_role_managed_key_is_not_editable_and_has_database_constraints():
    from api.models import Role

    field = Role._meta.get_field("managed_key")
    constraint_names = {constraint.name for constraint in Role._meta.constraints}

    assert field.editable is False
    assert "unique_managed_role_key_per_org" in constraint_names
    assert "role_default_requires_managed_key" in constraint_names


def test_role_save_rejects_managed_key_changes_before_database_write():
    from api.models import Role

    role = Role(
        id="role-owner",
        name="Renamed owner",
        organisation_id="org-1",
        is_default=True,
        managed_key="admin",
    )
    role._state.adding = False

    with patch.object(Role.objects, "filter") as mock_filter:
        (
            mock_filter.return_value.values_list.return_value.first.return_value
        ) = "owner"

        with pytest.raises(ValidationError, match="Managed role keys are immutable"):
            role.save()
