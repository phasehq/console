# Generated by Django 4.1.7 on 2023-03-25 08:45

from django.db import migrations, models
import uuid


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0011_alter_app_id_alter_customuser_userid_and_more'),
    ]

    operations = [
        migrations.AlterField(
            model_name='app',
            name='id',
            field=models.TextField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False),
        ),
        migrations.AlterField(
            model_name='customuser',
            name='userId',
            field=models.TextField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False),
        ),
        migrations.AlterField(
            model_name='organisation',
            name='id',
            field=models.TextField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False),
        ),
    ]
