from allauth.socialaccount.providers.oauth2.urls import default_urlpatterns

from .views import AuthentikOpenIDConnectProvider

urlpatterns = default_urlpatterns(AuthentikOpenIDConnectProvider)
