from django.core.management.base import BaseCommand, CommandError
from api.models import Organisation, SecretEvent

class Command(BaseCommand):
    help = "Purge all logs for a specific organisation or app."

    def add_arguments(self, parser):
        parser.add_argument(
            "org_name",
            type=str,
            help="Name of the organisation"
        )
        parser.add_argument(
            "--keep-days",
            type=int,
            help="Number of days of logs to keep (optional, deletes all logs if not specified)",
        )
        parser.add_argument(
            "--app_id",
            type=str,
            help="ID of a specific app to delete logs for (optional)",
        )

    def handle(self, *args, **options):
        org_name = options["org_name"]
        days = options["days"]
        app_id = options.get("app_id")

        if days < 0:
            raise CommandError("The --days argument must be a non-negative integer.")

        time_cutoff = timezone.now() - timedelta(days=days)
        self.stdout.write(
            f"Deleting logs older than {time_cutoff} for organisation '{org_name}'."
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
                self.stdout.write(f"Deleted {count} logs for app '{app.name}'.")

            self.stdout.write(
                self.style.SUCCESS("Log deletion completed successfully.")
            )
        except Organisation.DoesNotExist:
            raise CommandError(f"Organisation '{org_name}' does not exist.")
