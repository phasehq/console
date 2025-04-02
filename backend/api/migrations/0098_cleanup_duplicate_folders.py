# Generated by Django 4.2.16 on 2025-04-02 09:45

from django.db import migrations
from django.db.models import Count


def deduplicate_folders(apps, schema_editor):
    SecretFolder = apps.get_model("api", "SecretFolder")
    Secret = apps.get_model("api", "Secret")

    while True:  # Keep processing until no duplicates remain
        duplicates = (
            SecretFolder.objects.values("environment_id", "folder_id", "name", "path")
            .annotate(count=Count("id"))
            .filter(count__gt=1)  # More than one folder exists with the same attributes
        )

        if not duplicates:  # If no duplicates left, we're done
            break

        for duplicate in duplicates:
            env_id = duplicate["environment_id"]
            folder_id = duplicate["folder_id"]  # Could be NULL for root folders
            name = duplicate["name"]
            path = duplicate["path"]

            # Get all duplicate folder instances, ensuring consistent ordering
            folders = list(
                SecretFolder.objects.filter(
                    environment_id=env_id, folder_id=folder_id, name=name, path=path
                ).order_by(
                    "created_at", "id"
                )  # Prefer older folders
            )

            if len(folders) < 2:
                continue  # Skip if no real duplicates

            canonical_folder = folders[0]  # Pick the oldest as canonical
            duplicate_ids = [f.id for f in folders[1:]]  # The rest are duplicates

            # Update all Secrets pointing to duplicate folders
            Secret.objects.filter(folder_id__in=duplicate_ids).update(
                folder=canonical_folder
            )

            # Update subfolders that reference duplicate folders
            SecretFolder.objects.filter(folder_id__in=duplicate_ids).update(
                folder=canonical_folder
            )

            # Delete all but the canonical folder
            SecretFolder.objects.filter(id__in=duplicate_ids).delete()


class Migration(migrations.Migration):

    dependencies = [
        # ("api", "0098_remove_secretfolder_unique_secret_folder_and_more"),
        ("api", "0097_alter_secretfolder_unique_together_and_more")
    ]

    operations = [
        migrations.RunPython(deduplicate_folders),
    ]
