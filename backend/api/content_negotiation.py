from rest_framework.negotiation import DefaultContentNegotiation

from djangorestframework_camel_case.render import (
    CamelCaseJSONRenderer,
)


class CamelCaseContentNegotiation(DefaultContentNegotiation):
    def select_renderer(self, request, renderers, format_suffix=None):

        # If the request has the custom header, prefer CamelCaseJSONRenderer
        if request.headers.get("X-Use-Camel-Case") == "true":
            for renderer in renderers:
                if isinstance(renderer, CamelCaseJSONRenderer):
                    return renderer, renderer.media_type

        # Otherwise, fall back to default DRF behavior
        return super().select_renderer(request, renderers, format_suffix)
