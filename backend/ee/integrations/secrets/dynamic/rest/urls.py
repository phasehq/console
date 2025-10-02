from django.urls import path

from ee.integrations.secrets.dynamic.rest.views import (
    DynamicSecretLeaseView,
    DynamicSecretsView,
)

urlpatterns = [
    path("", DynamicSecretsView.as_view(), name="dynamic-secrets"),
    path("leases/", DynamicSecretLeaseView.as_view(), name="dynamic-secret-lease"),
]
