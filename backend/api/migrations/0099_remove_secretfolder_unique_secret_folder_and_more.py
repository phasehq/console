# Generated by Django 4.2.16 on 2025-04-02 08:48

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0098_cleanup_duplicate_folders"),
    ]

    operations = [
        migrations.AddConstraint(
            model_name="secretfolder",
            constraint=models.UniqueConstraint(
                condition=models.Q(("folder__isnull", False)),
                fields=("environment", "folder", "name", "path"),
                name="unique_secret_folder",
            ),
        ),
        migrations.AddConstraint(
            model_name="secretfolder",
            constraint=models.UniqueConstraint(
                condition=models.Q(("folder__isnull", True)),
                fields=("environment", "name", "path"),
                name="unique_root_folder",
            ),
        ),
    ]
