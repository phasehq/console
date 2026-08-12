# Choices-only sync for EnvironmentSync.service / ProviderCredentials.provider
# (label recasing + openai/litellm/datadog additions from earlier commits).
# CharField choices are validation-level only — no DB DDL is emitted.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0134_logstream_unresolved_idx_and_drop_job_id'),
    ]

    operations = [
        migrations.AlterField(
            model_name='environmentsync',
            name='service',
            field=models.CharField(choices=[('cloudflare_pages', 'Cloudflare Pages'), ('cloudflare_workers', 'Cloudflare Workers'), ('aws_secrets_manager', 'AWS Secrets Manager'), ('github_actions', 'GitHub Actions'), ('github_dependabot', 'GitHub Dependabot'), ('gitlab_ci', 'GitLab CI'), ('hashicorp_vault', 'HashiCorp Vault'), ('hashicorp_nomad', 'HashiCorp Nomad'), ('railway', 'Railway'), ('vercel', 'Vercel'), ('render', 'Render'), ('azure_key_vault', 'Azure Key Vault')], max_length=50),
        ),
        migrations.AlterField(
            model_name='providercredentials',
            name='provider',
            field=models.CharField(choices=[('cloudflare', 'Cloudflare'), ('aws', 'AWS'), ('aws_assume_role', 'AWS Assume Role'), ('github', 'GitHub'), ('gitlab', 'GitLab'), ('hashicorp_vault', 'HashiCorp Vault'), ('hashicorp_nomad', 'HashiCorp Nomad'), ('railway', 'Railway'), ('vercel', 'Vercel'), ('render', 'Render'), ('azure', 'Azure'), ('openai', 'OpenAI'), ('litellm', 'LiteLLM'), ('datadog', 'Datadog')], max_length=50),
        ),
    ]
