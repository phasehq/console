# Concurrent index build: LogStreamDeliveryEvent takes continuous writes
# from the ship path, so a plain CREATE INDEX would block them. Mirrors
# migration 0112 (SecretEvent).
#
# AddIndexConcurrently must be the ONLY operation in its (atomic=False)
# migration: if the build fails midway, any earlier operation has already
# committed and re-running the migration would crash on it, wedging the
# deploy.

from django.contrib.postgres.operations import AddIndexConcurrently
from django.db import migrations, models


class Migration(migrations.Migration):

    atomic = False

    dependencies = [
        ('api', '0135_sync_provider_service_choices'),
    ]

    operations = [
        AddIndexConcurrently(
            model_name='logstreamdeliveryevent',
            index=models.Index(condition=models.Q(('resolved_at__isnull', True), ('status__in', ['failed', 'skipped'])), fields=['stream', 'source'], name='log_stream_unresolved_idx'),
        ),
    ]
