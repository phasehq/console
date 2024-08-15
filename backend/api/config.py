import logging
from django.apps import AppConfig
from django.conf import settings
from django.db.models.signals import post_migrate


class APIConfig(AppConfig):
    name = "api"

    def ready(self):
        # Connect the post_migrate signal to a custom handler
        post_migrate.connect(self.activate_license_post_migrate, sender=self)

    def activate_license_post_migrate(self, **kwargs):
        if settings.PHASE_LICENSE:
            from ee.licensing.utils import activate_license

            try:
                activate_license(settings.PHASE_LICENSE)
            except Exception as e:
                logging.exception("Failed to activate license: %s", e)
