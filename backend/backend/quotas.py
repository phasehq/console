from django.apps import apps
from django.utils import timezone
from django.conf import settings


# Determine if the application is cloud-hosted based on the APP_HOST setting
CLOUD_HOSTED = settings.APP_HOST == "cloud"

# Adjust the PLAN_CONFIG based on whether the application is cloud-hosted
PLAN_CONFIG = {
    "FR": {
        "name": "Free",
        "max_users": 5 if CLOUD_HOSTED else 20,
        "max_apps": 3 if CLOUD_HOSTED else 20,
        "max_envs_per_app": 3,
        "max_tokens_per_app": 3,
    },
    "PR": {
        "name": "Pro",
        "max_users": None,
        "max_apps": None,
        "max_envs_per_app": 10,
        "max_tokens_per_app": 10,
    },
    "EN": {
        "name": "Enterprise",
        "max_users": None,
        "max_apps": None,
        "max_envs_per_app": None,
        "max_tokens_per_app": None,
    },
}


def can_add_app(organisation):
    """Check if a new app can be added to the organisation."""

    App = apps.get_model("api", "App")
    ActivatedPhaseLicense = apps.get_model("api", "ActivatedPhaseLicense")

    license_exists = ActivatedPhaseLicense.objects.filter(
        organisation=organisation
    ).exists()

    current_app_count = App.objects.filter(
        organisation=organisation, is_deleted=False
    ).count()

    if license_exists:
        return True
    plan_limits = PLAN_CONFIG[organisation.plan]
    if plan_limits["max_apps"] is None:
        return True
    return current_app_count < plan_limits["max_apps"]


def can_add_user(organisation):
    """Check if a new user can be added to the organisation."""

    OrganisationMember = apps.get_model("api", "OrganisationMember")
    OrganisationMemberInvite = apps.get_model("api", "OrganisationMemberInvite")
    ActivatedPhaseLicense = apps.get_model("api", "ActivatedPhaseLicense")

    plan_limits = PLAN_CONFIG[organisation.plan]
    license_exists = ActivatedPhaseLicense.objects.filter(
        organisation=organisation
    ).exists()

    current_user_count = (
        OrganisationMember.objects.filter(
            organisation=organisation, deleted_at=None
        ).count()
        + OrganisationMemberInvite.objects.filter(
            organisation=organisation, valid=True, expires_at__gte=timezone.now()
        ).count()
    )

    if license_exists:
        license = (
            ActivatedPhaseLicense.objects.filter(organisation=organisation)
            .order_by("-activated_at")
            .first()
        )
        user_limit = license.seats

    else:
        user_limit = plan_limits["max_users"]

    if user_limit is None:
        return True
    return current_user_count < user_limit


def can_add_environment(app):
    """Check if a new environment can be added to the app."""

    Environment = apps.get_model("api", "Environment")
    ActivatedPhaseLicense = apps.get_model("api", "ActivatedPhaseLicense")

    plan_limits = PLAN_CONFIG[app.organisation.plan]

    license_exists = ActivatedPhaseLicense.objects.filter(
        organisation=app.organisation
    ).exists()

    if license_exists:
        return True

    current_env_count = Environment.objects.filter(app=app).count()
    plan_limits = PLAN_CONFIG[app.organisation.plan]
    if plan_limits["max_envs_per_app"] is None:
        return True
    return current_env_count < plan_limits["max_envs_per_app"]


def can_use_custom_envs(organisation):
    return organisation.plan != "FR"


def can_add_service_token(app):
    """Check if a new service token can be added to the app."""

    ServiceToken = apps.get_model("api", "ServiceToken")
    ActivatedPhaseLicense = apps.get_model("api", "ActivatedPhaseLicense")

    plan_limits = PLAN_CONFIG[app.organisation.plan]

    license_exists = ActivatedPhaseLicense.objects.filter(
        organisation=app.organisation
    ).exists()

    if license_exists:
        license = (
            ActivatedPhaseLicense.objects.filter(organisation=app.organisation)
            .order_by("-activated_at")
            .first()
        )
        token_limit = license.tokens
    else:
        token_limit = plan_limits["max_tokens_per_app"]

    current_token_count = ServiceToken.objects.filter(app=app, deleted_at=None).count()

    if token_limit is None:
        return True
    return current_token_count < token_limit
