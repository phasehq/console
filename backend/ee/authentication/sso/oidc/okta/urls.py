from allauth.socialaccount.providers.oauth2.urls import default_urlpatterns

from .views import OktaOpenIDConnectProvider


urlpatterns = default_urlpatterns(OktaOpenIDConnectProvider)
