# Generated by Django 4.2.15 on 2024-11-13 14:47

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0091_add_managed_manager_service_roles'),
    ]

    operations = [
        migrations.AddField(
            model_name='secretevent',
            name='service_account_token',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to='api.serviceaccounttoken'),
        ),
    ]