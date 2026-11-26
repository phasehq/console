"""Migration 0148 drops the secret event indexes that another index already
covers, or that only serve LIKE queries, and leaves the foreign keys and every
index the app queries through in place. It keeps an index when no other valid
index starts with the same column."""

import importlib
from unittest.mock import MagicMock

from django.db import migrations

from api.models import SecretEvent

migration = importlib.import_module(
    "api.migrations.0148_secretevent_drop_redundant_indexes"
)


def _index(table, column, opclass, name, single_column=True, valid=True):
    return (table, column, opclass, name, 8192, single_column, valid)


# Single-column, non-unique indexes as Django creates them: a plain and a
# text_pattern_ops ("_like") index per foreign key, and a _like one on the key.
DJANGO_INDEXES = [
    _index(
        "api_secretevent", "id", "text_pattern_ops", "api_secretevent_id_ed22ddff_like"
    )
] + [
    _index(table, column, opclass, f"{table}_{column}_{digest}{suffix}")
    for table, column, digest in (
        ("api_secretevent", "secret_id", "738a0205"),
        ("api_secretevent", "environment_id", "3bdb60e1"),
        ("api_secretevent", "folder_id", "c999052f"),
        ("api_secretevent", "user_id", "2592fcc2"),
        ("api_secretevent", "service_token_id", "9f7f79ff"),
        ("api_secretevent", "service_account_id", "8d3ea700"),
        ("api_secretevent", "service_account_token_id", "150acaaf"),
        ("api_secretevent_tags", "secretevent_id", "9270341e"),
        ("api_secretevent_tags", "secrettag_id", "f4d7f748"),
    )
    for opclass, suffix in (("text_ops", ""), ("text_pattern_ops", "_like"))
]

# The keys, the composites from 0112 and the tag pair, which stand in for them
COVERING_INDEXES = [
    _index("api_secretevent", "id", "text_ops", "api_secretevent_pkey", False),
    _index(
        "api_secretevent", "secret_id", "text_ops", "secret_event_history_idx", False
    ),
    _index(
        "api_secretevent", "environment_id", "text_ops", "secret_logs_env_idx", False
    ),
    _index(
        "api_secretevent",
        "service_account_token_id",
        "text_ops",
        "sa_token_last_used_idx",
        False,
    ),
    _index(
        "api_secretevent_tags", "id", "int8_ops", "api_secretevent_tags_pkey", False
    ),
    _index(
        "api_secretevent_tags",
        "secretevent_id",
        "text_ops",
        "api_secretevent_tags_secretevent_id_secrettag_id_uniq",
        False,
    ),
]

# Serve deletes of a member, service account, service token, folder or tag.
KEPT = {
    "api_secretevent_folder_id_c999052f",
    "api_secretevent_user_id_2592fcc2",
    "api_secretevent_service_token_id_9f7f79ff",
    "api_secretevent_service_account_id_8d3ea700",
    "api_secretevent_tags_secrettag_id_f4d7f748",
}


def _schema_editor(indexes):
    schema_editor = MagicMock()
    cursor = schema_editor.connection.cursor.return_value.__enter__.return_value
    cursor.fetchall.return_value = indexes
    schema_editor.quote_name.side_effect = lambda name: f'"{name}"'
    return schema_editor


def _executed(schema_editor):
    return [call.args[0] for call in schema_editor.execute.call_args_list]


def _dropped(schema_editor):
    prefix = 'DROP INDEX CONCURRENTLY IF EXISTS "'
    return {sql[len(prefix) : -1] for sql in _executed(schema_editor)}


def _redundant(*kept):
    return {name for *_, name, _, _, _ in DJANGO_INDEXES} - KEPT - set(kept)


def test_drops_covered_and_pattern_indexes_concurrently():
    schema_editor = _schema_editor(DJANGO_INDEXES + COVERING_INDEXES)

    migration.drop_redundant_indexes(None, schema_editor)

    assert sorted(_executed(schema_editor)) == sorted(
        f'DROP INDEX CONCURRENTLY IF EXISTS "{name}"' for name in _redundant()
    )
    assert len(_executed(schema_editor)) == 14


def test_matches_indexes_by_definition_not_name():
    schema_editor = _schema_editor(
        [
            _index("api_secretevent", "id", "text_pattern_ops", "renamed_by_hand"),
            _index("api_secretevent", "user_id", "text_ops", "also_renamed"),
        ]
        + COVERING_INDEXES
    )

    migration.drop_redundant_indexes(None, schema_editor)

    assert _executed(schema_editor) == [
        'DROP INDEX CONCURRENTLY IF EXISTS "renamed_by_hand"'
    ]


def test_keeps_indexes_whose_covering_index_is_invalid(capsys):
    covering = [
        (
            _index(*index[:4], single_column=False, valid=False)
            if index[3] == "secret_logs_env_idx"
            else index
        )
        for index in COVERING_INDEXES
    ]
    schema_editor = _schema_editor(DJANGO_INDEXES + covering)

    migration.drop_redundant_indexes(None, schema_editor)

    kept = (
        "api_secretevent_environment_id_3bdb60e1",
        "api_secretevent_environment_id_3bdb60e1_like",
    )
    assert _dropped(schema_editor) == _redundant(*kept)
    assert (
        "Keeping api_secretevent_environment_id_3bdb60e1 on api_secretevent: "
        "no other valid index starts with environment_id"
    ) in capsys.readouterr().out


def test_keeps_indexes_whose_covering_index_is_missing():
    covering = [i for i in COVERING_INDEXES if i[3] != "sa_token_last_used_idx"]
    schema_editor = _schema_editor(DJANGO_INDEXES + covering)

    migration.drop_redundant_indexes(None, schema_editor)

    assert _dropped(schema_editor) == _redundant(
        "api_secretevent_service_account_token_id_150acaaf",
        "api_secretevent_service_account_token_id_150acaaf_like",
    )


def test_drops_an_invalid_index_left_by_an_interrupted_run():
    leftover = [
        _index(*index[:4], valid=False) if index[3].endswith("738a0205") else index
        for index in DJANGO_INDEXES
    ]
    schema_editor = _schema_editor(leftover + COVERING_INDEXES)

    migration.drop_redundant_indexes(None, schema_editor)

    assert "api_secretevent_secret_id_738a0205" in _dropped(schema_editor)


def test_only_changes_state_and_runs_outside_a_transaction():
    assert migration.Migration.atomic is False
    state_only, drop = migration.Migration.operations
    assert isinstance(state_only, migrations.SeparateDatabaseAndState)
    assert state_only.database_operations == []
    assert {operation.name for operation in state_only.state_operations} == {
        "secret",
        "environment",
        "service_account_token",
    }
    assert all(
        operation.field.db_index is False for operation in state_only.state_operations
    )
    assert isinstance(drop, migrations.RunPython)


def test_model_matches_the_migrated_state():
    indexed = {
        field.name: field.db_index
        for field in SecretEvent._meta.get_fields()
        if field.is_relation and field.many_to_one
    }
    assert indexed == {
        "secret": False,
        "environment": False,
        "service_account_token": False,
        "folder": True,
        "user": True,
        "service_token": True,
        "service_account": True,
    }


def test_reverse_restores_the_foreign_key_indexes():
    schema_editor = _schema_editor([])

    migration.restore_foreign_key_indexes(None, schema_editor)

    assert _executed(schema_editor) == [
        f'CREATE INDEX CONCURRENTLY IF NOT EXISTS "{index}" '
        f'ON "api_secretevent" ("{column}")'
        for index, column in migration.FOREIGN_KEY_INDEXES.items()
    ]
