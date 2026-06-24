"""Backfill: EnvironmentKey rows for service accounts that were soft-deleted
before the SA delete cascade also wiped EnvironmentKeys still had live
wrapped_seed / wrapped_salt material. Soft-delete those rows and clear
the wrapping fields so a DB-compromise on backup can't recover the
deleted principal's env access.
"""
from django.db import migrations
from django.utils import timezone


def wipe_orphan_envkeys(apps, schema_editor):
    EnvironmentKey = apps.get_model("api", "EnvironmentKey")
    orphans = EnvironmentKey.objects.filter(
        service_account__deleted_at__isnull=False,
        deleted_at__isnull=True,
    )
    orphans.update(
        deleted_at=timezone.now(),
        wrapped_seed="",
        wrapped_salt="",
        identity_key="",
    )


def noop_reverse(apps, schema_editor):
    # Irreversible — we've zeroed the wrapping material on purpose.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0128_add_team_audit_resource_and_sa_token_last_used"),
    ]

    operations = [
        migrations.RunPython(wipe_orphan_envkeys, noop_reverse),
    ]
