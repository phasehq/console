from django.db import migrations, models


def designate_production(apps, schema_editor):
    """The editor compared every environment with the production one: that
    becomes each App's primary environment, the first by place where an App
    has several."""
    Environment = apps.get_model("api", "Environment")
    primary = {}
    for env_id, app_id in (
        Environment.objects.filter(env_type__iexact="prod", deleted_at__isnull=True)
        .order_by("app_id", "index", "created_at")
        .values_list("id", "app_id")
    ):
        primary.setdefault(app_id, env_id)
    ids = list(primary.values())
    for start in range(0, len(ids), 1000):
        Environment.objects.filter(id__in=ids[start : start + 1000]).update(
            is_primary=True
        )


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0147_secretevent_folder_set_null"),
    ]

    operations = [
        migrations.AddField(
            model_name="environment",
            name="is_primary",
            field=models.BooleanField(db_default=False, default=False),
        ),
        migrations.RunPython(designate_production, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="environment",
            constraint=models.UniqueConstraint(
                condition=models.Q(("is_primary", True)),
                fields=("app",),
                name="unique_primary_environment_per_app",
            ),
        ),
    ]
