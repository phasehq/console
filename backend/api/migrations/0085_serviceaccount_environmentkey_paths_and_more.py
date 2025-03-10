# Generated by Django 4.2.15 on 2024-10-20 09:12

from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0084_auto_20241008_0708'),
    ]

    operations = [
        migrations.CreateModel(
            name='ServiceAccount',
            fields=[
                ('id', models.TextField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('name', models.CharField(max_length=255)),
                ('identity_key', models.CharField(blank=True, max_length=256, null=True)),
                ('server_wrapped_keyring', models.TextField(null=True)),
                ('server_wrapped_recovery', models.TextField(null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True, null=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('deleted_at', models.DateTimeField(blank=True, null=True)),
                ('apps', models.ManyToManyField(related_name='apps', to='api.app')),
                ('organisation', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='api.organisation')),
                ('role', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to='api.role')),
            ],
        ),
        migrations.AddField(
            model_name='environmentkey',
            name='paths',
            field=models.TextField(blank=True, null=True),
        ),
        migrations.CreateModel(
            name='ServiceAccountHandler',
            fields=[
                ('id', models.TextField(default=uuid.uuid4, primary_key=True, serialize=False)),
                ('wrapped_keyring', models.TextField()),
                ('wrapped_recovery', models.TextField()),
                ('created_at', models.DateTimeField(auto_now_add=True, null=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('service_account', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='api.serviceaccount')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='api.organisationmember')),
            ],
        ),
        migrations.AddField(
            model_name='environmentkey',
            name='service_account',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, to='api.serviceaccount'),
        ),
        migrations.AddField(
            model_name='servicetoken',
            name='service_account',
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.CASCADE, to='api.serviceaccount'),
        ),
    ]
