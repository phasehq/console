from django.contrib import admin
from django.urls import path, include, re_path
from django.conf import settings
from graphene_django.views import GraphQLView
from django.views.decorators.csrf import csrf_exempt
from api.views import PrivateGraphQLView, logout_view, health_check, kms, SecretsView, user_token_kms, service_token_kms

CLOUD_HOSTED = settings.APP_HOST == 'cloud'

urlpatterns = [
    re_path(r"^accounts", include("allauth.urls")),
    path('auth/', include('dj_rest_auth.urls')),
    path('social/login/', include('api.urls')),
    path('logout/', csrf_exempt(logout_view)),
    path('graphql/', csrf_exempt(PrivateGraphQLView.as_view(graphiql=True))),
    path('493c5048-99f9-4eac-ad0d-98c3740b491f/health', health_check),
    path('secrets/', SecretsView.as_view()),
    path('tokens/user/', user_token_kms),
    path('tokens/service', service_token_kms)
]

if not CLOUD_HOSTED:
    urlpatterns.append(path('kms/<app_id>', kms))

try:
    if settings.ADMIN_ENABLED:
        urlpatterns.append(path('admin/', admin.site.urls))
except Exception as e:
    pass
