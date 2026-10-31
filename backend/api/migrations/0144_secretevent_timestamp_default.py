import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):
    """State-only change (no SQL): auto_now_add -> default=timezone.now so a
    supplied event time survives bulk inserts from the write-behind buffer."""

    dependencies = [
        ("api", "0143_organisation_purge_blocked_at"),
    ]

    operations = [
        migrations.AlterField(
            model_name="secretevent",
            name="timestamp",
            field=models.DateTimeField(
                default=django.utils.timezone.now, editable=False
            ),
        ),
    ]
