from django.apps import AppConfig
from django.conf import settings


class APIConfig(AppConfig):
    name = "api"

    def ready(self):
        if settings.PHASE_LICENSE:
            from ee.license.utils import activate_license

            try:
                activate_license(settings.PHASE_LICENSE)
            except:
                pass
