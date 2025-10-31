from django.contrib import admin
from django.urls import path, include, re_path
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
from api.views.identities.aws.iam import aws_iam_auth
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
    path("accounts/", include("allauth.urls")),
    path("auth/", include("dj_rest_auth.urls")),
    path("social/login/", include("api.urls")),
    path("logout/", csrf_exempt(logout_view)),
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
