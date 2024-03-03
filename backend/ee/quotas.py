from django.apps import apps

PLAN_CONFIG = {
    "FR": {"name": "Free", "max_users": 5, "max_apps": 3, "max_envs_per_app": 3},
    "PR": {
        "name": "Pro",
        "max_users": None,
        "max_apps": None,
        "max_envs_per_app": 10,
    },
    "EN": {
        "name": "Enterprise",
        "max_users": None,
        "max_apps": None,
        "max_envs_per_app": None,
    },
}


def can_add_app(organisation):
    """Check if a new app can be added to the organisation."""

    App = apps.get_model("api", "App")

    current_app_count = App.objects.filter(
        organisation=organisation, is_deleted=False
    ).count()
    plan_limits = PLAN_CONFIG[organisation.plan]
    return current_app_count < plan_limits["max_apps"]


def can_add_user(organisation):
    """Check if a new user can be added to the organisation."""

    OrganisationMember = apps.get_model("api", "OrganisationMember")

    current_user_count = OrganisationMember.objects.filter(
        organisation=organisation, deleted_at=None
    ).count()
    plan_limits = PLAN_CONFIG[organisation.plan]
    return current_user_count < plan_limits["max_users"]


def can_add_environment(app):
    """Check if a new environment can be added to the app."""

    Environment = apps.get_model("api", "Environment")

    current_env_count = Environment.objects.filter(app=app).count()
    plan_limits = PLAN_CONFIG[app.organisation.plan]
    return current_env_count < plan_limits["max_envs_per_app"]
