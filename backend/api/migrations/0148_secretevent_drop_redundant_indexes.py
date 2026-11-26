import django.db.models.deletion
from django.db import migrations, models

# (table, column, operator class) of single-column indexes that an index leading
# with the same column already covers, or that only serve LIKE queries, which
# nothing runs against these UUID columns.
REDUNDANT_INDEXES = {
    ("api_secretevent", "id", "text_pattern_ops"),
    ("api_secretevent", "secret_id", "text_ops"),
    ("api_secretevent", "secret_id", "text_pattern_ops"),
    ("api_secretevent", "environment_id", "text_ops"),
    ("api_secretevent", "environment_id", "text_pattern_ops"),
    ("api_secretevent", "service_account_token_id", "text_ops"),
    ("api_secretevent", "service_account_token_id", "text_pattern_ops"),
    ("api_secretevent", "folder_id", "text_pattern_ops"),
    ("api_secretevent", "user_id", "text_pattern_ops"),
    ("api_secretevent", "service_token_id", "text_pattern_ops"),
    ("api_secretevent", "service_account_id", "text_pattern_ops"),
    ("api_secretevent_tags", "secretevent_id", "text_ops"),
    ("api_secretevent_tags", "secretevent_id", "text_pattern_ops"),
    ("api_secretevent_tags", "secrettag_id", "text_pattern_ops"),
}

# Every index on the two tables: table, leading column and its operator class,
# name, size, whether it is a plain single-column index, and whether queries
# can use it for that column
INDEXES = """
    SELECT t.relname, a.attname, oc.opcname, i.relname, pg_relation_size(i.oid),
           x.indnatts = 1 AND x.indexprs IS NULL AND x.indpred IS NULL
               AND NOT x.indisprimary AND NOT x.indisunique,
           x.indisvalid AND x.indpred IS NULL
    FROM pg_index x
    JOIN pg_class i ON i.oid = x.indexrelid
    JOIN pg_class t ON t.oid = x.indrelid
    JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = x.indkey[0]
    JOIN pg_opclass oc ON oc.oid = x.indclass[0]
    WHERE x.indrelid IN ('api_secretevent'::regclass, 'api_secretevent_tags'::regclass)
"""

FOREIGN_KEY_INDEXES = {
    "api_secretevent_secret_id_738a0205": "secret_id",
    "api_secretevent_environment_id_3bdb60e1": "environment_id",
    "api_secretevent_service_account_token_id_150acaaf": "service_account_token_id",
}


def drop_redundant_indexes(apps, schema_editor):
    # By definition, not name, so installs whose names differ are covered too
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(INDEXES)
        indexes = cursor.fetchall()
    drops = [row for row in indexes if row[5] and row[:3] in REDUNDANT_INDEXES]
    dropping = {row[3] for row in drops}
    # A covering index whose concurrent build failed is invalid and never read
    covered = {
        (table, column)
        for table, column, _, index, _, _, usable in indexes
        if usable and index not in dropping
    }
    for table, column, _, index, size, _, _ in drops:
        if (table, column) not in covered:
            print(
                f"\n  Keeping {index} on {table}: "
                f"no other valid index starts with {column}",
                end="",
                flush=True,
            )
            continue
        print(
            f"\n  Dropping {index} on {table} ({size / 1024**3:.2f} GiB)",
            end="",
            flush=True,
        )
        # Waits for open transactions on the table rather than blocking its writes
        schema_editor.execute(
            f"DROP INDEX CONCURRENTLY IF EXISTS {schema_editor.quote_name(index)}"
        )


def restore_foreign_key_indexes(apps, schema_editor):
    quote = schema_editor.quote_name
    for index, column in FOREIGN_KEY_INDEXES.items():
        schema_editor.execute(
            f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {quote(index)} "
            f"ON {quote('api_secretevent')} ({quote(column)})"
        )


class Migration(migrations.Migration):
    # CONCURRENTLY can't run in a transaction. A failed run is safe to repeat:
    # the state change touches no tables and every drop is IF EXISTS.
    atomic = False

    dependencies = [
        ("api", "0147_secretevent_folder_set_null"),
    ]

    operations = [
        # State only: run against the database, AlterField would drop and re-add
        # each foreign key, re-validating every row while blocking writes.
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.AlterField(
                    model_name="secretevent",
                    name="environment",
                    field=models.ForeignKey(
                        db_index=False,
                        on_delete=django.db.models.deletion.CASCADE,
                        to="api.environment",
                    ),
                ),
                migrations.AlterField(
                    model_name="secretevent",
                    name="secret",
                    field=models.ForeignKey(
                        db_index=False,
                        on_delete=django.db.models.deletion.CASCADE,
                        to="api.secret",
                    ),
                ),
                migrations.AlterField(
                    model_name="secretevent",
                    name="service_account_token",
                    field=models.ForeignKey(
                        blank=True,
                        db_index=False,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        to="api.serviceaccounttoken",
                    ),
                ),
            ],
        ),
        migrations.RunPython(drop_redundant_indexes, restore_foreign_key_indexes),
    ]
