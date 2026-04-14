from django.urls import path

from ee.authentication.scim.views.discovery import (
    resource_types,
    schemas,
    service_provider_config,
)
from ee.authentication.scim.views.groups import groups_detail, groups_list
from ee.authentication.scim.views.users import users_detail, users_list

urlpatterns = [
    # Discovery endpoints (RFC 7643)
    path("ServiceProviderConfig", service_provider_config, name="scim-service-provider-config"),
    path("Schemas", schemas, name="scim-schemas"),
    path("ResourceTypes", resource_types, name="scim-resource-types"),
    # User provisioning (RFC 7644)
    path("Users", users_list, name="scim-users-list"),
    path("Users/<str:scim_user_id>", users_detail, name="scim-users-detail"),
    # Group provisioning (RFC 7644)
    path("Groups", groups_list, name="scim-groups-list"),
    path("Groups/<str:scim_group_id>", groups_detail, name="scim-groups-detail"),
]
