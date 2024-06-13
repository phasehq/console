from rest_framework.views import exception_handler
from django.http import HttpResponse
from rest_framework import status


def custom_exception_handler(exc, context):
    # Call REST framework's default exception handler first,
    # to get the standard error response.
    response = exception_handler(exc, context)

    if response is not None:
        return response  # Return the default response if it's available

    # Define custom mappings of exception classes to HTTP status codes
    exception_mappings = {
        # Authentication exceptions
        'AuthenticationFailed': status.HTTP_401_UNAUTHORIZED,

        # Permission exceptions
        'PermissionDenied': status.HTTP_403_FORBIDDEN,

        # Validation exceptions
        'ValidationError': status.HTTP_400_BAD_REQUEST,

        # Not Found exception
        'ObjectDoesNotExist': status.HTTP_404_NOT_FOUND,

        # Any other unhandled exceptions
        Exception: status.HTTP_500_INTERNAL_SERVER_ERROR,
    }

    # Get the exception class of the raised exception
    exception_class = exc.__class__

    # Check if the exception class is in the mappings
    if exception_class in exception_mappings:
        status_code = exception_mappings[exception_class]
    else:
        # Default to 500 for unhandled exceptions
        status_code = exception_mappings[Exception]

    return HttpResponse(status=status_code)
