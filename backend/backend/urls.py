from django.contrib import admin
from django.urls import path, include, re_path
from django.conf import settings
from django.views.decorators.csrf import csrf_exempt
from api.views.lockbox import LockboxView
from api.views.graphql import PrivateGraphQLView
from api.views.secrets import E2EESecretsView, PublicSecretsView
from api.views.auth import logout_view, health_check, github_callback, secrets_tokens
from api.views.kms import kms


CLOUD_HOSTED = settings.APP_HOST == "cloud"

urlpatterns = [
    path("accounts/", include("allauth.urls")),
    path("auth/", include("dj_rest_auth.urls")),
    path("social/login/", include("api.urls")),
    path("logout/", csrf_exempt(logout_view)),
    path("graphql/", csrf_exempt(PrivateGraphQLView.as_view(graphiql=True))),
    path("health/", health_check),
    # To not break legacy health checks. TODO: Remove
    path("493c5048-99f9-4eac-ad0d-98c3740b491f/health", health_check),
    path("secrets/", E2EESecretsView.as_view()),
    path("public/v1/secrets/", PublicSecretsView.as_view()),
    path("secrets/tokens/", secrets_tokens),
    path("oauth/github/callback", github_callback),
    path("lockbox/<box_id>", LockboxView.as_view()),
]

if CLOUD_HOSTED:
    from ee.billing.webhooks.stripe import stripe_webhook

    urlpatterns.append(path("kms/<app_id>", kms))
    urlpatterns.append(path("stripe/webhook/", stripe_webhook, name="stripe-webhook"))


try:
    if settings.ADMIN_ENABLED:
        urlpatterns.append(path("admin/", admin.site.urls))
except Exception as e:
    pass
