from django.http import JsonResponse
from rest_framework.decorators import (
    api_view,
    authentication_classes,
    permission_classes,
    renderer_classes,
)
from rest_framework.renderers import JSONRenderer

from ee.authentication.scim.negotiation import SCIMJSONRenderer

from ee.authentication.scim.constants import (
    SCIM_GROUP_SCHEMA,
    SCIM_RESOURCE_TYPE_SCHEMA,
    SCIM_SCHEMA_SCHEMA,
    SCIM_SERVICE_PROVIDER_CONFIG_SCHEMA,
    SCIM_USER_SCHEMA,
)


@api_view(["GET"])
@authentication_classes([])
@permission_classes([])
@renderer_classes([SCIMJSONRenderer, JSONRenderer])
def service_provider_config(request):
    """GET /scim/v2/ServiceProviderConfig — RFC 7643 Section 5."""
    return JsonResponse(
        {
            "schemas": [SCIM_SERVICE_PROVIDER_CONFIG_SCHEMA],
            "documentationUri": "https://docs.phase.dev/scim",
            "patch": {"supported": True},
            "bulk": {
                "supported": False,
                "maxOperations": 0,
                "maxPayloadSize": 0,
            },
            "filter": {
                "supported": True,
                "maxResults": 100,
            },
            "changePassword": {"supported": False},
            "sort": {"supported": False},
            "etag": {"supported": False},
            "authenticationSchemes": [
                {
                    "type": "oauthbearertoken",
                    "name": "OAuth Bearer Token",
                    "description": "Authentication scheme using a bearer token",
                    "specUri": "https://www.rfc-editor.org/info/rfc6750",
                    "primary": True,
                }
            ],
        }
    )


@api_view(["GET"])
@authentication_classes([])
@permission_classes([])
@renderer_classes([SCIMJSONRenderer, JSONRenderer])
def schemas(request):
    """GET /scim/v2/Schemas — RFC 7643 Section 7."""
    return JsonResponse(
        {
            "schemas": [SCIM_SCHEMA_SCHEMA],
            "totalResults": 2,
            "itemsPerPage": 2,
            "startIndex": 1,
            "Resources": [
                {
                    "id": SCIM_USER_SCHEMA,
                    "name": "User",
                    "description": "User Account",
                    "attributes": [
                        {
                            "name": "userName",
                            "type": "string",
                            "multiValued": False,
                            "required": True,
                            "caseExact": False,
                            "mutability": "readWrite",
                            "returned": "default",
                            "uniqueness": "server",
                        },
                        {
                            "name": "displayName",
                            "type": "string",
                            "multiValued": False,
                            "required": False,
                            "caseExact": False,
                            "mutability": "readWrite",
                            "returned": "default",
                            "uniqueness": "none",
                        },
                        {
                            "name": "active",
                            "type": "boolean",
                            "multiValued": False,
                            "required": False,
                            "mutability": "readWrite",
                            "returned": "default",
                        },
                        {
                            "name": "emails",
                            "type": "complex",
                            "multiValued": True,
                            "required": True,
                            "mutability": "readWrite",
                            "returned": "default",
                            "subAttributes": [
                                {
                                    "name": "value",
                                    "type": "string",
                                    "multiValued": False,
                                    "required": True,
                                },
                                {
                                    "name": "type",
                                    "type": "string",
                                    "multiValued": False,
                                    "required": False,
                                },
                                {
                                    "name": "primary",
                                    "type": "boolean",
                                    "multiValued": False,
                                    "required": False,
                                },
                            ],
                        },
                        {
                            "name": "name",
                            "type": "complex",
                            "multiValued": False,
                            "required": False,
                            "mutability": "readWrite",
                            "returned": "default",
                            "subAttributes": [
                                {
                                    "name": "givenName",
                                    "type": "string",
                                    "multiValued": False,
                                    "required": False,
                                },
                                {
                                    "name": "familyName",
                                    "type": "string",
                                    "multiValued": False,
                                    "required": False,
                                },
                                {
                                    "name": "formatted",
                                    "type": "string",
                                    "multiValued": False,
                                    "required": False,
                                },
                            ],
                        },
                        {
                            "name": "externalId",
                            "type": "string",
                            "multiValued": False,
                            "required": False,
                            "caseExact": True,
                            "mutability": "readWrite",
                            "returned": "default",
                            "uniqueness": "global",
                        },
                    ],
                    "meta": {
                        "resourceType": "Schema",
                        "location": "/scim/v2/Schemas/" + SCIM_USER_SCHEMA,
                    },
                },
                {
                    "id": SCIM_GROUP_SCHEMA,
                    "name": "Group",
                    "description": "Group (maps to Phase Team)",
                    "attributes": [
                        {
                            "name": "displayName",
                            "type": "string",
                            "multiValued": False,
                            "required": True,
                            "caseExact": False,
                            "mutability": "readWrite",
                            "returned": "default",
                            "uniqueness": "none",
                        },
                        {
                            "name": "description",
                            "type": "string",
                            "multiValued": False,
                            "required": False,
                            "caseExact": False,
                            "mutability": "readWrite",
                            "returned": "default",
                            "uniqueness": "none",
                        },
                        {
                            "name": "members",
                            "type": "complex",
                            "multiValued": True,
                            "required": False,
                            "mutability": "readWrite",
                            "returned": "default",
                            "subAttributes": [
                                {
                                    "name": "value",
                                    "type": "string",
                                    "multiValued": False,
                                    "required": True,
                                    "mutability": "immutable",
                                },
                                {
                                    "name": "display",
                                    "type": "string",
                                    "multiValued": False,
                                    "required": False,
                                    "mutability": "readOnly",
                                },
                            ],
                        },
                        {
                            "name": "externalId",
                            "type": "string",
                            "multiValued": False,
                            "required": False,
                            "caseExact": True,
                            "mutability": "readWrite",
                            "returned": "default",
                            "uniqueness": "global",
                        },
                    ],
                    "meta": {
                        "resourceType": "Schema",
                        "location": "/scim/v2/Schemas/" + SCIM_GROUP_SCHEMA,
                    },
                },
            ],
        }
    )


@api_view(["GET"])
@authentication_classes([])
@permission_classes([])
@renderer_classes([SCIMJSONRenderer, JSONRenderer])
def resource_types(request):
    """GET /scim/v2/ResourceTypes — RFC 7643 Section 6."""
    return JsonResponse(
        {
            "schemas": [SCIM_RESOURCE_TYPE_SCHEMA],
            "totalResults": 2,
            "itemsPerPage": 2,
            "startIndex": 1,
            "Resources": [
                {
                    "schemas": [SCIM_RESOURCE_TYPE_SCHEMA],
                    "id": "User",
                    "name": "User",
                    "endpoint": "/scim/v2/Users",
                    "schema": SCIM_USER_SCHEMA,
                    "meta": {
                        "resourceType": "ResourceType",
                        "location": "/scim/v2/ResourceTypes/User",
                    },
                },
                {
                    "schemas": [SCIM_RESOURCE_TYPE_SCHEMA],
                    "id": "Group",
                    "name": "Group",
                    "endpoint": "/scim/v2/Groups",
                    "schema": SCIM_GROUP_SCHEMA,
                    "meta": {
                        "resourceType": "ResourceType",
                        "location": "/scim/v2/ResourceTypes/Group",
                    },
                },
            ],
        }
    )
