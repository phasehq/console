import json
import os

from django.db import migrations, models
from django.db.migrations.recorder import MigrationRecorder


MANAGED_KEYS_BY_NAME = {
    "owner": "owner",
    "admin": "admin",
    "manager": "manager",
    "developer": "developer",
    "service": "service",
}


# Default roles have had two repository-defined creation orders.  Existing
# organisations received Owner/Admin/Developer in 0077 and Manager/Service in
# 0091.  Fresh installs (and organisations created after 0091) create all five
# in the current template order.  Unlike display names, ``created_at`` was not
# writable through either vulnerable role-update API, so it is safe provenance
# for this migration's threat model.
CURRENT_CREATION_ORDER = ("owner", "admin", "manager", "developer", "service")
LEGACY_CREATION_ORDER = ("owner", "admin", "developer", "manager", "service")

HISTORY_BOUNDARY_MIGRATIONS = (
    "0090_alter_serviceaccount_organisation",
    "0091_add_managed_manager_service_roles",
)
OPERATOR_ROLE_MAP_ENV = "PHASE_MANAGED_ROLE_ID_MAP"


def _load_operator_role_map():
    raw_mapping = os.getenv(OPERATOR_ROLE_MAP_ENV)
    if not raw_mapping:
        return {}
    try:
        mapping = json.loads(raw_mapping)
    except (TypeError, ValueError) as error:
        raise RuntimeError(
            f"{OPERATOR_ROLE_MAP_ENV} must be a JSON object keyed by "
            "organisation ID."
        ) from error
    if not isinstance(mapping, dict):
        raise RuntimeError(
            f"{OPERATOR_ROLE_MAP_ENV} must be a JSON object keyed by "
            "organisation ID."
        )
    return mapping


def _get_role_history_boundaries(schema_editor):
    records = dict(
        MigrationRecorder(schema_editor.connection)
        .migration_qs.filter(
            app="api",
            name__in=HISTORY_BOUNDARY_MIGRATIONS,
        )
        .values_list("name", "applied")
    )
    missing = set(HISTORY_BOUNDARY_MIGRATIONS) - set(records)
    if missing:
        raise RuntimeError(
            "Cannot assign immutable managed role keys because role creation "
            "history is unavailable. Missing django_migrations records: "
            f"{', '.join(sorted(missing))}. Restore the migration history "
            "records before retrying."
        )
    return tuple(records[name] for name in HISTORY_BOUNDARY_MIGRATIONS)


def _creation_order_for_roles(roles, migration_0090_applied, migration_0091_applied):
    """Return the history-backed managed-key order, or ``None`` if ambiguous."""
    created_at_values = [role.created_at for role in roles]
    if any(created_at is None for created_at in created_at_values):
        return None
    if len(set(created_at_values)) != len(created_at_values):
        return None

    before_0091_window = [
        role for role in roles if role.created_at <= migration_0090_applied
    ]
    during_0091_window = [
        role
        for role in roles
        if migration_0090_applied < role.created_at <= migration_0091_applied
    ]
    after_0091 = [
        role for role in roles if role.created_at > migration_0091_applied
    ]

    # Fresh migration replay: 0077 imports the current five-role template.
    if len(before_0091_window) == len(CURRENT_CREATION_ORDER):
        return CURRENT_CREATION_ORDER

    # Historical production upgrade: 0077 created three roles, then 0091
    # appended Manager and Service.
    if (
        len(before_0091_window) == 3
        and len(during_0091_window) == 2
        and not after_0091
    ):
        return LEGACY_CREATION_ORDER

    # Organisation created after 0091: all five came from the current loop.
    if len(after_0091) == len(CURRENT_CREATION_ORDER):
        return CURRENT_CREATION_ORDER

    return None


def _build_managed_role_assignments(
    organisation_ids,
    default_roles,
    custom_roles,
    migration_0090_applied,
    migration_0091_applied,
    operator_role_map=None,
):
    organisation_ids = set(organisation_ids)
    roles_by_organisation = {
        organisation_id: [] for organisation_id in organisation_ids
    }
    problems = []
    operator_role_map = operator_role_map or {}
    unused_operator_mappings = set(operator_role_map)

    for role in default_roles:
        roles_by_organisation.setdefault(role.organisation_id, []).append(role)

    for role in custom_roles:
        permissions = role.permissions
        if isinstance(permissions, dict) and permissions.get("global_access"):
            problems.append(
                f"custom role {role.id} ({role.name!r}) in organisation "
                f"{role.organisation_id} has legacy global_access enabled"
            )

    assignments = []
    for organisation_id, roles_for_org in roles_by_organisation.items():
        if len(roles_for_org) != len(CURRENT_CREATION_ORDER):
            problems.append(
                f"organisation {organisation_id} has {len(roles_for_org)} default "
                f"roles; expected {len(CURRENT_CREATION_ORDER)}"
            )
            continue

        if any(getattr(role, "created_at", None) is None for role in roles_for_org):
            problems.append(
                f"organisation {organisation_id} has default roles without "
                "creation history"
            )
            continue

        roles_for_org = sorted(roles_for_org, key=lambda role: role.created_at)
        creation_order = _creation_order_for_roles(
            roles_for_org,
            migration_0090_applied,
            migration_0091_applied,
        )
        if creation_order is None:
            operator_mapping = operator_role_map.get(str(organisation_id))
            if operator_mapping is None:
                role_history = ", ".join(
                    f"{role.id}@{role.created_at!s}" for role in roles_for_org
                )
                problems.append(
                    f"organisation {organisation_id} has ambiguous default-role "
                    f"creation history ({role_history})"
                )
                continue

            unused_operator_mappings.discard(str(organisation_id))
            expected_keys = set(CURRENT_CREATION_ORDER)
            if not isinstance(operator_mapping, dict) or set(
                operator_mapping
            ) != expected_keys:
                problems.append(
                    f"operator mapping for organisation {organisation_id} must "
                    f"contain exactly: {', '.join(CURRENT_CREATION_ORDER)}"
                )
                continue

            role_by_id = {str(role.id): role for role in roles_for_org}
            mapped_role_ids = [
                str(role_id) for role_id in operator_mapping.values()
            ]
            if (
                len(set(mapped_role_ids)) != len(CURRENT_CREATION_ORDER)
                or set(mapped_role_ids) != set(role_by_id)
            ):
                problems.append(
                    f"operator mapping for organisation {organisation_id} must "
                    "reference each listed default-role ID exactly once"
                )
                continue
            role_key_pairs = [
                (role_by_id[str(role_id)], managed_key)
                for managed_key, role_id in operator_mapping.items()
            ]
        else:
            # Deterministic histories cannot be overridden by process input.
            role_key_pairs = list(zip(roles_for_org, creation_order))

        for role, managed_key in role_key_pairs:
            expected_name = next(
                name
                for name, key in MANAGED_KEYS_BY_NAME.items()
                if key == managed_key
            ).title()
            if role.name.casefold() != expected_name.casefold():
                problems.append(
                    f"role {role.id} in organisation {organisation_id} is "
                    f"identified by creation history as {managed_key!r} "
                    f"(expected name {expected_name!r}) but is currently named "
                    f"{role.name!r}"
                )
                continue
            assignments.append((role.id, managed_key))

    if unused_operator_mappings:
        problems.append(
            f"{OPERATOR_ROLE_MAP_ENV} contains unused organisation IDs: "
            f"{', '.join(sorted(unused_operator_mappings))}"
        )

    if problems:
        preview = "; ".join(problems[:20])
        if len(problems) > 20:
            preview += f"; and {len(problems) - 20} more"
        raise RuntimeError(
            "Cannot assign immutable managed role keys because the preflight "
            f"found ambiguous or unsafe role data: {preview}. Remediation: "
            "restore each listed default-role ID to its expected canonical "
            "name; for each listed custom role, explicitly reassign human "
            "members that still need global access to the built-in Admin role "
            "and remove the legacy global_access key. For an organisation with "
            "ambiguous creation history, set PHASE_MANAGED_ROLE_ID_MAP to an "
            "explicit JSON mapping of that organisation ID to all five "
            "managed keys and the listed stable role IDs, deriving that map "
            "from trusted ownership/audit records rather than current display "
            "names. Then rerun this migration and remove the environment "
            "variable."
        )

    return assignments


def _get_managed_role_assignments(apps, schema_editor):
    Organisation = apps.get_model("api", "Organisation")
    Role = apps.get_model("api", "Role")

    migration_0090_applied, migration_0091_applied = _get_role_history_boundaries(
        schema_editor
    )
    organisation_ids = Organisation.objects.values_list("id", flat=True).iterator()
    default_roles = Role.objects.filter(is_default=True).only(
        "id", "organisation_id", "name", "created_at"
    ).iterator()
    custom_roles = Role.objects.filter(is_default=False).only(
        "id", "organisation_id", "name", "permissions"
    ).iterator()
    return _build_managed_role_assignments(
        organisation_ids,
        default_roles,
        custom_roles,
        migration_0090_applied,
        migration_0091_applied,
        _load_operator_role_map(),
    )


def preflight_managed_role_keys(apps, schema_editor):
    # Intentionally run before AddField so unsafe data cannot leave a partial
    # schema change behind on databases without transactional DDL.
    _get_managed_role_assignments(apps, schema_editor)


def backfill_managed_role_keys(apps, schema_editor):
    Role = apps.get_model("api", "Role")
    assignments = _get_managed_role_assignments(apps, schema_editor)

    for role_id, managed_key in assignments:
        Role.objects.filter(id=role_id).update(managed_key=managed_key)


def clear_managed_role_keys(apps, schema_editor):
    Role = apps.get_model("api", "Role")
    Role.objects.filter(managed_key__isnull=False).update(managed_key=None)


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0138_user_totp_and_recovery_codes"),
    ]

    operations = [
        migrations.RunPython(
            preflight_managed_role_keys,
            migrations.RunPython.noop,
        ),
        migrations.AddField(
            model_name="role",
            name="managed_key",
            field=models.CharField(
                blank=True,
                choices=[
                    ("owner", "Owner"),
                    ("admin", "Admin"),
                    ("manager", "Manager"),
                    ("developer", "Developer"),
                    ("service", "Service"),
                ],
                editable=False,
                max_length=16,
                null=True,
            ),
        ),
        migrations.RunPython(
            backfill_managed_role_keys,
            clear_managed_role_keys,
        ),
        migrations.AddConstraint(
            model_name="role",
            constraint=models.UniqueConstraint(
                condition=models.Q(managed_key__isnull=False),
                fields=("organisation", "managed_key"),
                name="unique_managed_role_key_per_org",
            ),
        ),
        migrations.AddConstraint(
            model_name="role",
            constraint=models.CheckConstraint(
                check=(
                    models.Q(is_default=True, managed_key__isnull=False)
                    | models.Q(is_default=False, managed_key__isnull=True)
                ),
                name="role_default_requires_managed_key",
            ),
        ),
    ]
