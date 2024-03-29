# Generated by Django 4.2.7 on 2024-01-11 09:50

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0055_alter_providercredentials_provider'),
    ]

    operations = [
        migrations.AlterField(
            model_name='environmentsync',
            name='service',
            field=models.CharField(choices=[('cloudflare_pages', 'Cloudflare Pages'), ('cloudflare_workers', 'Cloudflare Workers'), ('aws_secrets_manager', 'AWS Secrets Manager'), ('github_actions', 'GitHub Actions'), ('hashicorp_vault', 'Hashicorp Vault')], max_length=50),
        ),
    ]
