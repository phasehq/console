from rest_framework.views import exception_handler
from django.core.exceptions import PermissionDenied
from django.http import JsonResponse, HttpResponse


def custom_exception_handler(exc, context):
    """
    Custom exception handler to modify 'PermissionDenied' responses.
    """
    # Handle PermissionDenied
    if isinstance(exc, PermissionDenied):
        # Extract the custom message and replace the key
        error_message = str(exc) if exc else "Permission denied."
        return JsonResponse(
            {"error": error_message},  # Change "detail" to "error"
            status=403,
        )

    # Call REST framework's default exception handler for other exceptions
    response = exception_handler(exc, context)

    if response is not None and "detail" in response.data:
        # If "detail" exists in other exceptions, you can modify it too
        response.data["error"] = response.data.pop("detail")

    return response
