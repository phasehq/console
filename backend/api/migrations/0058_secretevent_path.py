# Generated by Django 4.2.7 on 2024-02-10 09:03

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0057_remove_secretfolder_parent_secret_path_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='secretevent',
            name='path',
            field=models.TextField(default='/'),
        ),
    ]
