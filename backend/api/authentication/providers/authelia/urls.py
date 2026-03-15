from allauth.socialaccount.providers.oauth2.urls import default_urlpatterns

from .views import AutheliaOpenIDConnectProvider

urlpatterns = default_urlpatterns(AutheliaOpenIDConnectProvider)
