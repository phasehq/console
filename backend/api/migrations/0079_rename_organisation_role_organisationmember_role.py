# Generated by Django 4.2.15 on 2024-09-10 13:16

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0078_remove_organisationmember_role'),
    ]

    operations = [
        migrations.RenameField(
            model_name='organisationmember',
            old_name='organisation_role',
            new_name='role',
        ),
    ]
