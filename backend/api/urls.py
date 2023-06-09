from django.urls import path, include
from .views import GoogleLoginView, GitHubLoginView, GitLabLoginView

urlpatterns = [
    path('google/', GoogleLoginView.as_view(), name='google'),
    path('github/', GitHubLoginView.as_view(), name='github'),
    path('gitlab/', GitLabLoginView.as_view(), name='gitlab')
]
