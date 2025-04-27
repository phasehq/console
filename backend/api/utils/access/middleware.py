# permissions.py

from api.models import NetworkAccessPolicy, Organisation
from rest_framework.permissions import BasePermission
from itertools import chain


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

        org_member = request.auth.get("org_member", None)
        service_account = request.auth.get("service_account", None)

        org = None
        account_policies = NetworkAccessPolicy.objects.none()

        if org_member:
            account_policies = org_member.network_policies.all()
            org = org_member.organisation
        elif service_account:
            account_policies = service_account.network_policies.all()
            org = service_account.organisation

        if org.plan == Organisation.FREE_PLAN:
            return True
        else:
            from ee.access.utils.network import is_ip_allowed

            global_policies = (
                (
                    NetworkAccessPolicy.objects.filter(organisation=org, is_global=True)
                    if org
                    else NetworkAccessPolicy.objects.none()
                )
                if org.plan == Organisation.ENTERPRISE_PLAN
                else []
            )

            all_policies = list(chain(account_policies, global_policies))

            if not all_policies:
                return True  # Allow if no policies defined

            return is_ip_allowed(ip, all_policies)
