from django.conf import settings
from django.http import JsonResponse


class ServicePrefixMiddleware:
    """Strip the ``/service`` URL prefix before routing.

    Cloud ALB forwards ``console.phase.dev/service/*`` to the backend verbatim.
    Stripping it here lets every route — current and future — resolve at both
    ``/<path>`` and ``/service/<path>`` without per-route registration.
    """

    PREFIX = "/service"

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path_info == self.PREFIX or request.path_info.startswith(
            self.PREFIX + "/"
        ):
            request.path_info = request.path_info[len(self.PREFIX) :] or "/"
        return self.get_response(request)


class HealthCheckMiddleware:
    """Short-circuit ``/health/`` before host validation runs.

    ALB target group health checks send ``Host: <task-ip>:<port>`` (the ALB
    has no setting for a custom Host header on health checks). Django's
    ``CommonMiddleware`` rejects that with ``DisallowedHost`` when
    ``ALLOWED_HOSTS`` is set to specific domains, so handling the endpoint
    here lets the setting stay tight without breaking ALB.

    Mirrors the ``api.views.auth.health_check`` view's response shape.
    Place after ``ServicePrefixMiddleware`` so the canonical post-strip path
    is the only one to match.
    """

    PATH = "/health/"

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path_info == self.PATH:
            return JsonResponse({"status": "alive", "version": settings.VERSION})
        return self.get_response(request)
