from rest_framework.views import exception_handler
from rest_framework.exceptions import ValidationError
from django.core.exceptions import PermissionDenied
from django.http import JsonResponse
import traceback
import os


def custom_exception_handler(exc, context):
    """
    Custom exception handler to modify responses for PermissionDenied and ValidationError.
    """
    if os.getenv("DEBUG") == "True":
        print(traceback.format_exc())

    # Handle PermissionDenied
    if isinstance(exc, PermissionDenied):
        return JsonResponse({"error": str(exc)}, status=403)

    # Handle ValidationError as a 403 error instead of 400
    if isinstance(exc, ValidationError):
        # Extract error messages (handle both dict and list formats)
        if isinstance(exc.detail, dict):
            error_message = next(iter(exc.detail.values()))[0]  # Extract first error
        elif isinstance(exc.detail, list):
            error_message = exc.detail[0]
        else:
            error_message = str(exc)

        return JsonResponse({"error": error_message}, status=403)

    # Call REST framework's default exception handler for other exceptions
    response = exception_handler(exc, context)

    if response is not None and "detail" in response.data:
        response.data["error"] = response.data.pop("detail")

    return response
