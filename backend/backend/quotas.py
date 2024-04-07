from django.apps import apps
from django.utils import timezone
from django.conf import settings

# Determine if the application is cloud-hosted based on the APP_HOST setting
CLOUD_HOSTED = settings.APP_HOST == "cloud"

# Adjust the PLAN_CONFIG based on whether the application is cloud-hosted
if CLOUD_HOSTED:
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
else:
    # If self-hosted remove all user and app limits
    PLAN_CONFIG = {
        "FR": {"name": "Free", "max_users": None, "max_apps": None, "max_envs_per_app": 3},
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
    if plan_limits["max_apps"] is None:
        return True
    return current_app_count < plan_limits["max_apps"]


def can_add_user(organisation):
    """Check if a new user can be added to the organisation."""

    OrganisationMember = apps.get_model("api", "OrganisationMember")
    OrganisationMemberInvite = apps.get_model("api", "OrganisationMemberInvite")

    current_user_count = (
        OrganisationMember.objects.filter(
            organisation=organisation, deleted_at=None
        ).count()
        + OrganisationMemberInvite.objects.filter(
            organisation=organisation, valid=True, expires_at__gte=timezone.now()
        ).count()
    )
    plan_limits = PLAN_CONFIG[organisation.plan]
    if plan_limits["max_users"] is None:
        return True
    return current_user_count < plan_limits["max_users"]


def can_add_environment(app):
    """Check if a new environment can be added to the app."""

    Environment = apps.get_model("api", "Environment")

    current_env_count = Environment.objects.filter(app=app).count()
    plan_limits = PLAN_CONFIG[app.organisation.plan]
    if plan_limits["max_envs_per_app"] is None:
        return True
    return current_env_count < plan_limits["max_envs_per_app"]
