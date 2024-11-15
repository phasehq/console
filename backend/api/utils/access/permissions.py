from api.models import (
    App,
    Environment,
    EnvironmentKey,
    OrganisationMember,
    ServiceAccount,
)
from api.utils.access.roles import default_roles

# middlewares.py
from django.http import JsonResponse
from django.utils.deprecation import MiddlewareMixin


admin_roles = ["Owner", "Admin"]


def user_is_admin(user_id, org_id):
    member = OrganisationMember.objects.get(
        user_id=user_id, organisation_id=org_id, deleted_at=None
    )
    return member.role.name in admin_roles


def user_is_org_member(user_id, org_id):
    return OrganisationMember.objects.filter(
        user_id=user_id, organisation_id=org_id, deleted_at=None
    ).exists()


def user_can_access_app(user_id, app_id):
    app = App.objects.get(id=app_id)
    org_member = OrganisationMember.objects.get(
        user_id=user_id, organisation=app.organisation, deleted_at=None
    )
    return org_member in app.members.all()


def user_can_access_environment(user_id, env_id):
    env = Environment.objects.get(id=env_id)
    org_member = OrganisationMember.objects.get(
        organisation=env.app.organisation, user_id=user_id, deleted_at=None
    )
    return EnvironmentKey.objects.filter(
        user_id=org_member, environment_id=env_id
    ).exists()


def service_account_can_access_environment(account_id, env_id):
    env = Environment.objects.get(id=env_id)
    service_account = ServiceAccount.objects.get(
        organisation=env.app.organisation, id=account_id, deleted_at=None
    )
    return EnvironmentKey.objects.filter(
        service_account=service_account, environment_id=env_id
    ).exists()


def member_can_access_org(member_id, org_id):
    return OrganisationMember.objects.filter(
        id=member_id, organisation_id=org_id, deleted_at=None
    ).exists()


def user_has_permission(
    account,
    action,
    resource,
    organisation,
    is_app_resource=False,
    is_service_account=False,
):
    """Check if the user has the specified permission for a resource in an organization."""
    try:
        # Get the user's membership in the organization
        if is_service_account:
            org_member = account
        else:
            org_member = OrganisationMember.objects.get(
                user=account, organisation=organisation, deleted_at=None
            )
        role = org_member.role
        if not role:
            return False  # No role assigned, hence no permissions

        # Check if the role is a default role
        if role.is_default:
            # Get permissions from the default_roles dictionary
            role_name = role.name.capitalize()
            permissions = default_roles.get(role_name, {})
        else:
            # Use the permissions stored in the role object
            permissions = role.permissions

        # Determine the correct key to check
        permission_key = "app_permissions" if is_app_resource else "permissions"

        # Check if the resource exists and if the action is permitted
        resource_permissions = permissions.get(permission_key, {}).get(resource, [])
        return action in resource_permissions

    except OrganisationMember.DoesNotExist:
        return False  # User is not a member of the organization


class PermissionMiddleware(MiddlewareMixin):

    def process_view(self, request, view_func, view_args, view_kwargs):
        """
        This method gets called before calling the view.
        """

        account = None

        # Determine account type
        if request.auth["auth_type"] == "User":
            account = request.auth["org_member"].user
        elif request.auth["auth_type"] == "ServiceAccount":
            account = request.auth["service_account"]

        # Check permissions
        if account is not None:
            # Customize for each view using the view's kwargs (like `resource`, `action`, etc.)
            action = view_kwargs.get("action", "read")  # Default to 'read'
            resource = view_kwargs.get("resource", "Secrets")  # Default to 'Secrets'
            organisation = view_kwargs.get(
                "organisation", None
            )  # Get the organisation from view kwargs or None
            env = view_kwargs.get(
                "env", None
            )  # Assuming environment is passed in view kwargs

            if env and not user_has_permission(
                account,
                action,
                resource,
                organisation,
                True,
                request.auth.get("service_account") is not None,
            ):
                return JsonResponse(
                    {
                        "error": f"You don't have permission to {action} {resource.lower()} in this environment"
                    },
                    status=403,
                )

        # Check env access
        if request.auth["auth_type"] == "User" and not user_can_access_environment(
            request.auth["org_member"].user.userId, env.id
        ):
            return JsonResponse(
                {"error": "You don't have access to this environment"}, status=403
            )

        elif request.auth[
            "auth_type"
        ] == "ServiceAccount" and not service_account_can_access_environment(
            request.auth["service_account"].id, env.id
        ):
            return JsonResponse(
                {"error": "You don't have access to this environment"}, status=403
            )

        # If everything is fine, proceed to the view
        return None
