# Generated by Django 4.1.7 on 2023-03-08 08:01

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0003_organisation_owner'),
    ]

    operations = [
        migrations.RenameField(
            model_name='customuser',
            old_name='created_on',
            new_name='created_at',
        ),
        migrations.AddField(
            model_name='organisation',
            name='created_at',
            field=models.DateTimeField(auto_now_add=True, null=True),
        ),
        migrations.AddField(
            model_name='organisation',
            name='updated_at',
            field=models.DateTimeField(auto_now=True),
        ),
    ]
