# Generated by Django 4.2.7 on 2024-02-16 10:23

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0061_environmentsync_path'),
    ]

    operations = [
        migrations.AddField(
            model_name='secretevent',
            name='service_token',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to='api.servicetoken'),
        ),
    ]
