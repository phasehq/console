import logging
from django.apps import AppConfig
from django.conf import settings
from django.db.models.signals import post_migrate


class APIConfig(AppConfig):
    name = "api"

    def ready(self):
        # Connect the post_migrate signal to a custom handler
        post_migrate.connect(self.validate_licenses_post_migrate, sender=self)

    def validate_licenses_post_migrate(self, **kwargs):

        CLOUD_HOSTED = settings.APP_HOST == "cloud"

        if not CLOUD_HOSTED:
            from ee.licensing.utils import activate_license
            from ee.licensing.jobs import init_license_checker

            init_license_checker()

            if settings.PHASE_LICENSE:
                try:
                    activate_license(settings.PHASE_LICENSE)
                except Exception as e:
                    logging.exception("Failed to activate license: %s", e)
