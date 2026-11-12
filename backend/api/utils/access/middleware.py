# permissions.py

from api.models import NetworkAccessPolicy, Organisation
from api.utils.access.ip import get_client_ip
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

        # Only the account's own organisation's policies are ever enforced
        if org_member:
            org = org_member.organisation
            account_policies = org_member.network_policies.filter(organisation=org)
        elif service_account:
            org = service_account.organisation
            account_policies = service_account.network_policies.filter(organisation=org)

        if org is None or org.plan == Organisation.FREE_PLAN:
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
