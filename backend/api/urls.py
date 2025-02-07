from django.urls import path, include
from .views.auth import GoogleLoginView, GitHubLoginView, GitLabLoginView, OIDCLoginView, JumpCloudLoginView

urlpatterns = [
    path("google/", GoogleLoginView.as_view(), name="google"),
    path("github/", GitHubLoginView.as_view(), name="github"),
    path("gitlab/", GitLabLoginView.as_view(), name="gitlab"),
    path("google-oidc/", OIDCLoginView.as_view(), name="google-oidc"),
    path("jumpcloud-oidc/", JumpCloudLoginView.as_view(), name="jumpcloud-oidc"),
]
