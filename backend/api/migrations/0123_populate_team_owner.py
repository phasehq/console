from django.db import migrations, models


def populate_team_owner(apps, schema_editor):
    """Set owner = created_by for all existing teams."""
    Team = apps.get_model("api", "Team")
    Team.objects.filter(owner__isnull=True, created_by__isnull=False).update(
        owner=models.F("created_by")
    )


def reverse(apps, schema_editor):
    """No-op reverse — owner data is additive."""
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0122_teams_and_scim'),
    ]

    operations = [
        migrations.RunPython(populate_team_owner, reverse),
    ]
