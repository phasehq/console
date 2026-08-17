from rest_framework.views import exception_handler
from rest_framework.exceptions import ValidationError
from django.core.exceptions import PermissionDenied
from django.http import JsonResponse
import logging
import os
import traceback

logger = logging.getLogger(__name__)


def custom_exception_handler(exc, context):
    """Convert REST framework exceptions to JSON. Anything DRF doesn't
    recognise (AttributeError, TypeError, RecursionError, etc.) is
    funnelled through here too so the public API never returns Django's
    HTML 500 debug page."""
    if os.getenv("DEBUG") == "True":
        print(traceback.format_exc())

    if isinstance(exc, PermissionDenied):
        return JsonResponse({"error": str(exc)}, status=403)

    if isinstance(exc, ValidationError):
        if isinstance(exc.detail, dict):
            error_message = next(iter(exc.detail.values()))[0]
        elif isinstance(exc.detail, list):
            error_message = exc.detail[0]
        else:
            error_message = str(exc)
        return JsonResponse({"error": error_message}, status=403)

    response = exception_handler(exc, context)
    if response is not None:
        if "detail" in response.data:
            response.data["error"] = response.data.pop("detail")
        return response

    # No DRF mapping → unhandled. Log the stack and return JSON 500
    # instead of letting Django render its HTML debug page (info-leak
    # and breaks the JSON contract).
    logger.exception("Unhandled exception in API view", exc_info=exc)
    return JsonResponse(
        {"error": "Internal server error."},
        status=500,
    )
