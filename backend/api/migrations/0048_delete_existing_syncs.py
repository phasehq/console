from django.db import migrations, models


def delete_existing_syncs(apps, schema_editor):
    EnvironmentSync = apps.get_model("api", "EnvironmentSync")
    # This will delete all rows in EnvironmentSync
    EnvironmentSync.objects.all().delete()


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0047_environmentsync_status"),
    ]

    operations = [
        migrations.RunPython(delete_existing_syncs),
    ]
