import time
from datetime import timedelta

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from api.models import Organisation, SecretEvent


class Command(BaseCommand):
    help = "Purge READ logs older than a specified number of days for an org or app."

    def add_arguments(self, parser):
        parser.add_argument("org_name", type=str, help="Name of the organisation")
        parser.add_argument(
            "--retain",
            type=int,
            default=30,
            help="Number of days of logs to retain (default: 30, 0 to delete all)",
        )
        parser.add_argument(
            "--app-id",
            type=str,
            help="ID of a specific app to delete logs for (optional)",
        )
        parser.add_argument(
            "--batch-size",
            type=int,
            default=10_000,
            help="Rows deleted per transaction (default: 10000)",
        )
        parser.add_argument(
            "--sleep-ms",
            type=int,
            default=500,
            help="Pause between batches in ms. Gives autovacuum and replication "
            "headroom; raise if replicas lag (default: 500)",
        )

    def _purge_env(self, env_id, env_name, cutoff, batch_size, sleep_ms):
        # Per-environment range scan exploits the
        # (environment_id, -timestamp) composite index. ORDER BY timestamp ASC
        # deletes oldest-first so we walk the cold end of the index.
        base_qs = SecretEvent.objects.filter(
            environment_id=env_id,
            event_type=SecretEvent.READ,
            timestamp__lte=cutoff,
        ).order_by("timestamp")

        deleted_total = 0
        batch_num = 0
        while True:
            batch_num += 1
            with transaction.atomic():
                # SKIP LOCKED so a concurrent purge or any other locker is
                # routed around rather than blocking this batch.
                batch_ids = list(
                    base_qs.select_for_update(skip_locked=True).values_list(
                        "id", flat=True
                    )[:batch_size]
                )
                if not batch_ids:
                    break

                # M2M FK is ON DELETE NO ACTION at the DB level — Django
                # handles cascade in the ORM, but _raw_delete bypasses that,
                # so we must clear the through-table rows ourselves.
                SecretEvent.tags.through.objects.filter(
                    secretevent_id__in=batch_ids
                )._raw_delete("default")

                deleted = SecretEvent.objects.filter(id__in=batch_ids)._raw_delete(
                    "default"
                )

            deleted_total += deleted
            self.stdout.write(
                f"    {env_name} batch {batch_num}: deleted={deleted} "
                f"total={deleted_total}"
            )
            if sleep_ms:
                time.sleep(sleep_ms / 1000.0)
        return deleted_total

    def handle(self, *args, **options):
        org_name = options["org_name"]
        retain_days = options["retain"]
        app_id = options.get("app_id")
        batch_size = options["batch_size"]
        sleep_ms = options["sleep_ms"]

        if retain_days < 0:
            raise CommandError("The --retain argument must be a non-negative integer.")

        cutoff = (
            timezone.now()
            if retain_days == 0
            else timezone.now() - timedelta(days=retain_days)
        )

        try:
            org = Organisation.objects.get(name=org_name)
        except Organisation.DoesNotExist:
            raise CommandError(f"Organisation '{org_name}' does not exist.")

        app_filter = {"id": app_id} if app_id else {}
        apps = list(org.apps.filter(**app_filter))
        if not apps:
            if app_id:
                raise CommandError(
                    f"App with id '{app_id}' not found in organisation '{org_name}'."
                )
            self.stdout.write(f"Organisation '{org_name}' has no apps; nothing to do.")
            return 0

        if not app_id:
            self.stdout.write(
                f"Deleting READ logs older than {cutoff} "
                f"(retaining {retain_days} days) for organisation '{org_name}'."
            )

        grand_total = 0
        grand_start = time.monotonic()
        for app in apps:
            app_total = 0
            app_start = time.monotonic()
            for env in app.environments.all():
                n = self._purge_env(env.id, env.name, cutoff, batch_size, sleep_ms)
                app_total += n
                self.stdout.write(
                    f"  env '{env.name}' ({env.id}): deleted {n} READ events"
                )
            elapsed = time.monotonic() - app_start
            self.stdout.write(
                f"Deleted {app_total} logs for app '{app.name}' (id: {app.id}) "
                f"in {elapsed:.1f}s"
            )
            grand_total += app_total

        elapsed = time.monotonic() - grand_start
        self.stdout.write(
            self.style.SUCCESS(
                f"Log deletion completed: {grand_total} rows in {elapsed:.1f}s."
            )
        )
        return grand_total
