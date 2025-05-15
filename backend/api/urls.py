from django.urls import path, include
from .views.auth import (
    GitHubEnterpriseLoginView,
    GoogleLoginView,
    GitHubLoginView,
    GitLabLoginView,
    OIDCLoginView,
    JumpCloudLoginView,
    EntraIDLoginView,
)

urlpatterns = [
    path("google/", GoogleLoginView.as_view(), name="google"),
    path("github/", GitHubLoginView.as_view(), name="github"),
    path(
        "github-enterprise/",
        GitHubEnterpriseLoginView.as_view(),
        name="github-enterprise",
    ),
    path("gitlab/", GitLabLoginView.as_view(), name="gitlab"),
    path("google-oidc/", OIDCLoginView.as_view(), name="google-oidc"),
    path("jumpcloud-oidc/", JumpCloudLoginView.as_view(), name="jumpcloud-oidc"),
    path("entra-id-oidc/", EntraIDLoginView.as_view(), name="microsoft"),
]
