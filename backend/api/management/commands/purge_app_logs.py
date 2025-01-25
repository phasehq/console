from django.core.management.base import BaseCommand, CommandError
from api.models import Organisation, SecretEvent
from django.utils import timezone
from datetime import timedelta


class Command(BaseCommand):
    help = "Purge all logs or keep logs newer than a specified number of days for a specific organisation or app."

    def add_arguments(self, parser):
        parser.add_argument("org_name", type=str, help="Name of the organisation")
        parser.add_argument(
            "--keep-days",
            type=int,
            help="Number of days of logs to keep (if not specified, deletes all logs)",
        )
        parser.add_argument(
            "--app-id",
            type=str,
            help="ID of a specific app to delete logs for (optional)",
        )

    def handle(self, *args, **options):
        org_name = options["org_name"]
        keep_days = options.get("keep_days")
        app_id = options.get("app_id")

        if keep_days is not None and keep_days < 0:
            raise CommandError("The --keep-days argument must be a non-negative integer.")

        # Only calculate time_cutoff if keep_days is specified
        time_cutoff = None
        if keep_days is not None:
            time_cutoff = timezone.now() - timedelta(days=keep_days)
            self.stdout.write(
                f"Deleting logs older than {time_cutoff} for organisation '{org_name}'."
            )
        else:
            self.stdout.write(f"Deleting all logs for organisation '{org_name}'.")

        try:
            org = Organisation.objects.get(name=org_name)

            # Build the filter dynamically
            app_filter = {}
            if app_id:
                app_filter["id"] = app_id

            apps = org.apps.filter(**app_filter)

            if not apps.exists():
                raise CommandError(
                    f"No apps found matching the criteria (app_id: {app_id}) in organisation '{org_name}'."
                )

            for app in apps:
                # Base query for logs
                logs_query = SecretEvent.objects.filter(
                    environment__in=app.environments.all()
                ).exclude(event_type=SecretEvent.CREATE)

                # Add time filter only if keep_days is specified
                if time_cutoff:
                    logs_query = logs_query.filter(timestamp__lte=time_cutoff)

                count = logs_query.count()
                logs_query.delete()
                self.stdout.write(f"Deleted {count} logs for app '{app.name}'.")

            self.stdout.write(
                self.style.SUCCESS("Log deletion completed successfully.")
            )
        except Organisation.DoesNotExist:
            raise CommandError(f"Organisation '{org_name}' does not exist.")
