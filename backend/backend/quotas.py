from django.apps import apps
from django.utils import timezone
from django.conf import settings


# Determine if the application is cloud-hosted based on the APP_HOST setting
CLOUD_HOSTED = settings.APP_HOST == "cloud"

# Adjust the PLAN_CONFIG based on whether the application is cloud-hosted
PLAN_CONFIG = {
    "FR": {
        "name": "Free",
        "max_users": 5 if CLOUD_HOSTED else None,
        "max_apps": 3 if CLOUD_HOSTED else None,
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


def can_add_account(organisation, count=1, account_type="user"):
    """Check if a new human or service account can be added to the organisation."""

    Organisation = apps.get_model("api", "Organisation")
    OrganisationMember = apps.get_model("api", "OrganisationMember")
    OrganisationMemberInvite = apps.get_model("api", "OrganisationMemberInvite")
    ServiceAccount = apps.get_model("api", "ServiceAccount")

    if not CLOUD_HOSTED and organisation.plan == Organisation.FREE_PLAN:
        return True

    # If the organisation is on pricing version 2 and not on the free plan,
    # service accounts are not limited by quotas.
    if (
        organisation.pricing_version == Organisation.PRICING_V2
        and organisation.plan != Organisation.FREE_PLAN
        and account_type == "service_account"
    ):
        return True

    from ee.billing.utils import get_org_seat_limit

    # Calculate the current count of users
    current_human_user_count = (
        OrganisationMember.objects.filter(
            organisation=organisation, deleted_at=None
        ).count()
        + OrganisationMemberInvite.objects.filter(
            organisation=organisation, valid=True, expires_at__gte=timezone.now()
        ).count()
    )

    current_service_account_count = 0
    # Include service accounts in the count only if strictly required based on plan/version
    if (
        organisation.pricing_version == Organisation.PRICING_V1
        or organisation.plan == Organisation.FREE_PLAN
    ):
        current_service_account_count = ServiceAccount.objects.filter(
            organisation=organisation, deleted_at=None
        ).count()

    total_account_count = current_human_user_count + current_service_account_count

    seats = get_org_seat_limit(organisation)

    # If there's no limit, allow unlimited additions
    if seats is None:
        return True

    # Check if the total account count is below the limit
    return total_account_count + count <= seats


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
