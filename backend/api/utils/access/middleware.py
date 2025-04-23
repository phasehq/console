# permissions.py
from api.utils.access.network import is_ip_allowed
from rest_framework.permissions import BasePermission


class IsIPAllowed(BasePermission):
    """
    Checks if the client's IP is allowed based on attached network access policies.
    """

    def get_client_ip(self, request):
        x_forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR")
        if x_forwarded_for:
            return x_forwarded_for.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR")

    def has_permission(self, request, view):
        ip = self.get_client_ip(request)

        org_member = getattr(request.auth, "org_member", None)
        service_account = getattr(request.auth, "service_account", None)

        policies = []
        if org_member:
            policies = org_member.network_policies.all()
        elif service_account:
            policies = service_account.network_policies.all()

        if not policies:
            return False  # Deny if no policies

        return is_ip_allowed(ip, policies)
