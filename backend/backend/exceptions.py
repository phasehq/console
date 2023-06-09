from rest_framework.views import exception_handler
from django.http import HttpResponse


def custom_exception_handler(exc, context):
    # Call REST framework's default exception handler first,
    # to get the standard error response.
    response = exception_handler(exc, context)

    # set 404 as default response code
    status_code = 404

    # Now add the HTTP status code to the response.
    if response is not None:
        status_code = response.status_code

    return HttpResponse(status=status_code)
