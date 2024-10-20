from api.utils.access.permissions import user_has_permission
from api.models import Organisation, ServiceAccount


def resolve_service_accounts(root, info, org_id):
    org = Organisation.objects.get(id=org_id)
    if user_has_permission(info.context.user.userId, "read", "ServiceAccounts", org):
        return ServiceAccount.objects.filter(organisation=org)
