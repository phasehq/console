from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0121_backfill_environment_key_grants"),
    ]

    operations = [
        migrations.AddField(
            model_name="serviceaccount",
            name="team",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="owned_service_accounts",
                to="api.team",
            ),
        ),
    ]
