from rest_framework.parsers import JSONParser
from rest_framework.renderers import JSONRenderer


class SCIMJSONRenderer(JSONRenderer):
    """Renderer that accepts both application/scim+json and application/json."""

    media_type = "application/scim+json"


class SCIMJSONParser(JSONParser):
    """Parser that accepts both application/scim+json and application/json."""

    media_type = "application/scim+json"
