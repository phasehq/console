from django.apps import AppConfig


class ApiConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'api'

    def ready(self):
        from api.utils.access.org_resolution import register_invalidation_signals
        register_invalidation_signals()
