# Generated by Django 4.1.7 on 2023-03-20 15:18

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0006_app'),
    ]

    operations = [
        migrations.AlterField(
            model_name='organisation',
            name='name',
            field=models.CharField(max_length=64, unique=True),
        ),
    ]
