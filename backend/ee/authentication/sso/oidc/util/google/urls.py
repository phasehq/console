from allauth.socialaccount.providers.oauth2.urls import default_urlpatterns

from .views import GoogleOpenIDConnectProvider


urlpatterns = default_urlpatterns(GoogleOpenIDConnectProvider)
