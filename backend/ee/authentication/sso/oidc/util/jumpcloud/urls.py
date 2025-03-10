from allauth.socialaccount.providers.oauth2.urls import default_urlpatterns

from .views import JumpCloudOpenIDConnectProvider


urlpatterns = default_urlpatterns(JumpCloudOpenIDConnectProvider)
