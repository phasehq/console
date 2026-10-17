# permissions.py

from api.models import NetworkAccessPolicy
from api.utils.access.ip import get_client_ip
from backend.quotas import org_has_feature
from rest_framework.permissions import BasePermission
from itertools import chain


class IsIPAllowed(BasePermission):
    """
    Checks if the client's IP is allowed based on attached network access policies.
    """

    message = (
        "Access denied: a network access policy restricts access from your IP address."
    )

    def get_client_ip(self, request):
        return get_client_ip(request)

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

        if org is None or not org_has_feature(org, "network_access_policies"):
            return True
        else:
            from ee.access.utils.network import is_ip_allowed

            global_policies = (
                (
                    NetworkAccessPolicy.objects.filter(organisation=org, is_global=True)
                    if org
                    else NetworkAccessPolicy.objects.none()
                )
                if org_has_feature(org, "global_network_access_policies")
                else []
            )

            all_policies = list(chain(account_policies, global_policies))

            if not all_policies:
                return True  # Allow if no policies defined

            return is_ip_allowed(ip, all_policies)
