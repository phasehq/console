from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.views.decorators.csrf import csrf_exempt
from api.views.lockbox import LockboxView
from api.views.graphql import PrivateGraphQLView
from api.views.secrets import E2EESecretsView, PublicSecretsView
from api.views.auth import (
    logout_view,
    health_check,
    github_integration_callback,
    secrets_tokens,
    root_endpoint,
)
from api.views.sso import (
    auth_me,
    OrgSSOAuthorizeView,
    SSOAuthorizeView,
    SSOCallbackView,
)
from api.views.auth_password import (
    password_register,
    password_login,
    password_change,
    password_reset_via_recovery,
    verify_email,
    resend_verification,
    email_check,
)
from api.views.identities.aws.iam import aws_iam_auth
from api.views.identities.azure.entra import azure_entra_auth
from api.views.kms import kms

CLOUD_HOSTED = settings.APP_HOST == "cloud"

# Core API and System URLs
urlpatterns = [
    # System health and info
    path("health/", health_check),
    path(
        "493c5048-99f9-4eac-ad0d-98c3740b491f/health", health_check
    ),  # Legacy health check - TODO: Remove
    # Authentication and user management
    path("logout/", csrf_exempt(logout_view)),
    # Auth endpoints
    path("auth/me/", auth_me),
    path("auth/sso/org/<str:config_id>/authorize/", OrgSSOAuthorizeView.as_view()),
    path("auth/sso/<str:provider>/authorize/", SSOAuthorizeView.as_view()),
    path("auth/sso/<str:provider>/callback/", SSOCallbackView.as_view()),
    # Password auth
    path("auth/password/register/", password_register),
    path("auth/password/login/", password_login),
    path("auth/password/change/", password_change),
    path("auth/password/reset-via-recovery/", password_reset_via_recovery),
    path("auth/verify-email/resend/", resend_verification),
    path("auth/verify-email/<str:token>/", verify_email),
    path("auth/email/check/", email_check),
    # GraphQL API
    path("graphql/", csrf_exempt(PrivateGraphQLView.as_view(graphiql=True))),
    # OAuth integrations
    path("oauth/github/callback", github_integration_callback),
    # Secrets management
    path("secrets/", E2EESecretsView.as_view()),
    path("secrets/tokens/", secrets_tokens),
    # Lockbox
    path("lockbox/<box_id>", LockboxView.as_view()),
]

# Public API URLs
public_urls = [
    path("public/", root_endpoint),
    path("public/v1/secrets/", PublicSecretsView.as_view()),
    path(
        "public/v1/secrets/dynamic/",
        include("ee.integrations.secrets.dynamic.rest.urls"),
    ),
    path("public/identities/external/v1/aws/iam/auth/", aws_iam_auth),
    path("public/identities/external/v1/azure/entra/auth/", azure_entra_auth),
]

# Add public URLs to main urlpatterns
urlpatterns.extend(public_urls)

# Cloud-hosted specific URLs
if CLOUD_HOSTED:
    from ee.billing.webhooks.stripe import stripe_webhook

    cloud_urls = [
        path("kms/<app_id>", kms),
        path("stripe/webhook/", stripe_webhook, name="stripe-webhook"),
    ]
    urlpatterns.extend(cloud_urls)

# Admin interface (if enabled)
try:
    if settings.ADMIN_ENABLED:
        urlpatterns.append(path("admin/", admin.site.urls))
except Exception as e:
    pass
