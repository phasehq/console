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
