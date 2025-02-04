from django.core.management.base import BaseCommand, CommandError
from api.models import Organisation, SecretEvent
from django.utils import timezone
from datetime import timedelta


class Command(BaseCommand):
    help = "Purge logs older than a specified number of days for a specific organisation or app."

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

    def handle(self, *args, **options):
        org_name = options["org_name"]
        retain_days = options["retain"]
        app_id = options.get("app_id")
        
        if retain_days < 0:
            raise CommandError("The --retain argument must be a non-negative integer.")

        if retain_days == 0:
            time_cutoff = timezone.now()
        else:
            time_cutoff = timezone.now() - timedelta(days=retain_days)

        # Only show organization-wide message if no app_id is specified
        if not app_id:
            self.stdout.write(
                f"Deleting logs older than {time_cutoff} (retaining {retain_days} days) for organisation '{org_name}'."
            )

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
                logs = SecretEvent.objects.filter(
                    environment__in=app.environments.all(), timestamp__lte=time_cutoff
                ).exclude(event_type=SecretEvent.CREATE)
                count = logs.count()
                logs.delete()
                self.stdout.write(f"Deleted {count} logs for app '{app.name}' (id: {app.id})")

            self.stdout.write(
                self.style.SUCCESS("Log deletion completed successfully.")
            )
        except Organisation.DoesNotExist:
            raise CommandError(f"Organisation '{org_name}' does not exist.")
