import logging
from django.apps import AppConfig
from django.conf import settings
from django.db.models.signals import post_migrate


class APIConfig(AppConfig):
    name = "api"

    def ready(self):
        import api.signals  # noqa: F401
        import certifi
        import stripe

        # stripe-python ships its own CA bundle; use certifi so CA removals apply.
        stripe.ca_bundle_path = certifi.where()

        # Connect the post_migrate signal to a custom handler
        post_migrate.connect(self.validate_licenses_post_migrate, sender=self)
        post_migrate.connect(self.init_log_streams_post_migrate, sender=self)
        # The deletion sweeps and the session purge are not scheduled here but
        # when a worker starts (rqworker). A migrate runs before the new
        # workers exist, and a job scheduled then is taken by an old worker,
        # which fails a job it can't import.

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

    def init_log_streams_post_migrate(self, **kwargs):
        try:
            from ee.integrations.logs.streams.jobs import init_log_stream_sweeper

            init_log_stream_sweeper()
        except Exception:
            logging.exception("Failed to initialise log stream sweeper")
