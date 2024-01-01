# Generated by Django 4.2.3 on 2023-11-16 05:46

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0039_personalsecret'),
    ]

    operations = [
        migrations.AddField(
            model_name='personalsecret',
            name='isActive',
            field=models.BooleanField(default=True),
        ),
        migrations.AlterField(
            model_name='personalsecret',
            name='value',
            field=models.TextField(blank=True, null=True),
        ),
    ]
