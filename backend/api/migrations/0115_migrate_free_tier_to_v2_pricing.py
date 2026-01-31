from django.db import migrations


def migrate_free_tier_to_v2(apps, schema_editor):
    Organisation = apps.get_model("api", "Organisation")
    # Update all Free tier organisations currently on V1 pricing to V2 pricing
    Organisation.objects.filter(plan="FR", pricing_version=1).update(pricing_version=2)


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0114_alter_environmentsync_service"),
    ]

    operations = [
        migrations.RunPython(migrate_free_tier_to_v2),
    ]
