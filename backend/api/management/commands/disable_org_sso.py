"""Helper command to disable SSO enforcement and/or delete SSO provider config.

Usage:
    python manage.py disable_org_sso --org "contoso" --show
    python manage.py disable_org_sso --org "contoso" --disable-enforcement
    python manage.py disable_org_sso --org "contoso" --delete-provider
    python manage.py disable_org_sso --org "contoso" --disable-enforcement --delete-provider
"""

import logging
from django.core.management.base import BaseCommand
from api.models import Organisation, OrganisationSSOProvider

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = "Disable SSO enforcement and/or delete SSO provider config for an organisation"

    def add_arguments(self, parser):
        parser.add_argument(
            "--org", required=True, help="Organisation name"
        )
        parser.add_argument(
            "--show",
            action="store_true",
            help="Show current SSO state for the organisation",
        )
        parser.add_argument(
            "--disable-enforcement",
            action="store_true",
            help="Set require_sso=False on the organisation",
        )
        parser.add_argument(
            "--delete-provider",
            action="store_true",
            help="Delete all SSO provider configs for the organisation",
        )

    def handle(self, *args, **options):
        org_name = options["org"]

        try:
            org = Organisation.objects.get(name=org_name)
        except Organisation.DoesNotExist:
            self.stderr.write(self.style.ERROR(f"Organisation '{org_name}' not found"))
            return

        providers = OrganisationSSOProvider.objects.filter(organisation=org)

        if options["show"]:
            self.stdout.write(f"\nOrganisation: {org.name} (id={org.id})")
            self.stdout.write(f"  require_sso: {org.require_sso}")
            self.stdout.write(f"  SSO providers: {providers.count()}")
            for p in providers:
                self.stdout.write(
                    f"    - {p.name} ({p.provider_type}) enabled={p.enabled} id={p.id}"
                )
            self.stdout.write("")
            return

        if not options["disable_enforcement"] and not options["delete_provider"]:
            self.stderr.write(
                self.style.ERROR(
                    "Specify --show, --disable-enforcement, and/or --delete-provider"
                )
            )
            return

        if options["disable_enforcement"]:
            org.require_sso = False
            org.save()
            msg = f"SSO enforcement disabled for '{org_name}'"
            self.stdout.write(self.style.SUCCESS(msg))
            logger.info(msg)

        if options["delete_provider"]:
            count = providers.count()
            providers.delete()
            msg = f"Deleted {count} SSO provider(s) for '{org_name}'"
            self.stdout.write(self.style.SUCCESS(msg))
            logger.info(msg)
