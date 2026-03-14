import logging

from django.core.exceptions import ObjectDoesNotExist

from api.auth import PhaseTokenAuthentication
from api.models import Organisation, OrganisationMember, Role, ServiceAccount
from api.utils.access.permissions import user_has_permission
from api.utils.access.roles import default_roles
from api.utils.audit_logging import log_audit_event, get_actor_info, build_change_values
from api.utils.rest import METHOD_TO_ACTION, get_resolver_request_meta
from api.throttling import PlanBasedRateThrottle
from api.utils.access.middleware import IsIPAllowed

from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework import status
from djangorestframework_camel_case.render import CamelCaseJSONRenderer

logger = logging.getLogger(__name__)

# Derive valid permission classes and actions from the Owner role (which has full access to everything)
_owner = default_roles["Owner"]
VALID_ORG_PERMISSIONS = {
    resource: set(actions) for resource, actions in _owner["permissions"].items()
}
VALID_APP_PERMISSIONS = {
    resource: set(actions) for resource, actions in _owner["app_permissions"].items()
}


def _validate_permissions(permissions):
    """
    Validate the shape of a permissions object against the Owner role template.
    Returns (None) on success, or (error_string) on failure.
    """
    if not isinstance(permissions, dict):
        return "Permissions must be a JSON object."

    allowed_keys = {"permissions", "app_permissions", "global_access"}
    unknown_keys = set(permissions.keys()) - allowed_keys
    if unknown_keys:
        return f"Unknown top-level keys: {', '.join(sorted(unknown_keys))}. Allowed keys: permissions, app_permissions, global_access."

    # Validate global_access
    if "global_access" in permissions:
        if not isinstance(permissions["global_access"], bool):
            return "global_access must be a boolean."

    # Validate org-level permissions
    org_perms = permissions.get("permissions")
    if org_perms is not None:
        if not isinstance(org_perms, dict):
            return "permissions must be a JSON object."
        for resource, actions in org_perms.items():
            if resource not in VALID_ORG_PERMISSIONS:
                return f"Unknown org permission class: '{resource}'. Valid classes: {', '.join(sorted(VALID_ORG_PERMISSIONS.keys()))}."
            if not isinstance(actions, list):
                return f"Actions for '{resource}' must be an array."
            valid_actions = VALID_ORG_PERMISSIONS[resource]
            for action in actions:
                if action not in valid_actions:
                    return f"Unknown action '{action}' for org permission class '{resource}'. Valid actions: {', '.join(sorted(valid_actions))}."

    # Validate app-level permissions
    app_perms = permissions.get("app_permissions")
    if app_perms is not None:
        if not isinstance(app_perms, dict):
            return "app_permissions must be a JSON object."
        for resource, actions in app_perms.items():
            if resource not in VALID_APP_PERMISSIONS:
                return f"Unknown app permission class: '{resource}'. Valid classes: {', '.join(sorted(VALID_APP_PERMISSIONS.keys()))}."
            if not isinstance(actions, list):
                return f"Actions for '{resource}' must be an array."
            valid_actions = VALID_APP_PERMISSIONS[resource]
            for action in actions:
                if action not in valid_actions:
                    return f"Unknown action '{action}' for app permission class '{resource}'. Valid actions: {', '.join(sorted(valid_actions))}."

    return None


def _get_role_permissions(role):
    """Get permissions for a role — from default_roles dict if default, otherwise from the stored JSONField."""
    if role.is_default and role.name in default_roles:
        return default_roles[role.name]
    return role.permissions


def _serialize_role(role, include_permissions=False):
    """Serialize a Role to a dict."""
    data = {
        "id": role.id,
        "name": role.name,
        "description": role.description,
        "color": role.color,
        "is_default": role.is_default,
        "created_at": role.created_at,
    }
    if include_permissions:
        data["permissions"] = _get_role_permissions(role)
    return data


class PublicRolesView(APIView):
    """List roles and create custom roles for an organisation."""

    authentication_classes = [PhaseTokenAuthentication]
    permission_classes = [IsAuthenticated, IsIPAllowed]
    throttle_classes = [PlanBasedRateThrottle]
    renderer_classes = [CamelCaseJSONRenderer]

    def _get_org(self, request):
        if request.auth.get("organisation"):
            return request.auth["organisation"]
        if request.auth.get("app"):
            return request.auth["app"].organisation
        raise PermissionDenied("Could not resolve organisation from request.")

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)

        action = METHOD_TO_ACTION.get(request.method)
        if not action:
            raise PermissionDenied(f"Unsupported HTTP method: {request.method}")

        account = None
        is_sa = False
        if request.auth["auth_type"] == "User":
            account = request.auth["org_member"].user
        elif request.auth["auth_type"] == "ServiceAccount":
            account = request.auth["service_account"]
            is_sa = True

        if account is not None:
            org = self._get_org(request)
            if not user_has_permission(account, action, "Roles", org, False, is_sa):
                raise PermissionDenied(
                    f"You don't have permission to {action} roles."
                )

    def get(self, request, *args, **kwargs):
        org = self._get_org(request)
        roles = Role.objects.filter(organisation=org).order_by("created_at")
        return Response(
            [_serialize_role(r) for r in roles],
            status=status.HTTP_200_OK,
        )

    def post(self, request, *args, **kwargs):
        org = self._get_org(request)

        # Free plan gate
        if org.plan == Organisation.FREE_PLAN:
            return Response(
                {"error": "Custom roles are not available on your organisation's plan."},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Validate name
        name = request.data.get("name")
        if not name or not str(name).strip():
            return Response(
                {"error": "Missing required field: name"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        name = str(name).strip()
        if len(name) > 64:
            return Response(
                {"error": "Role name cannot exceed 64 characters."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Duplicate name check
        if Role.objects.filter(organisation=org, name__iexact=name).exists():
            return Response(
                {"error": "A role with this name already exists."},
                status=status.HTTP_409_CONFLICT,
            )

        # Validate permissions
        permissions = request.data.get("permissions")
        if not permissions or not isinstance(permissions, dict):
            return Response(
                {"error": "Missing required field: permissions (must be a JSON object)"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        perm_error = _validate_permissions(permissions)
        if perm_error:
            return Response(
                {"error": perm_error},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Optional fields
        description = request.data.get("description", "")
        if description and len(str(description)) > 500:
            return Response(
                {"error": "Role description cannot exceed 500 characters."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        color = request.data.get("color", "")
        if color and len(str(color)) > 7:
            return Response(
                {"error": "Role color cannot exceed 7 characters."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        role = Role.objects.create(
            organisation=org,
            name=name,
            description=description or "",
            color=color or "",
            permissions=permissions,
        )

        # Audit log
        actor_type, actor_id, actor_meta = get_actor_info(request)
        ip_address, user_agent = get_resolver_request_meta(request)
        log_audit_event(
            organisation=org,
            event_type="C",
            resource_type="role",
            resource_id=role.id,
            actor_type=actor_type,
            actor_id=actor_id,
            actor_metadata=actor_meta,
            resource_metadata={"name": role.name},
            new_values={"name": role.name, "permissions": permissions},
            description=f"Created role '{role.name}'",
            ip_address=ip_address,
            user_agent=user_agent,
        )

        return Response(
            _serialize_role(role, include_permissions=True),
            status=status.HTTP_201_CREATED,
        )


class PublicRoleDetailView(APIView):
    """Get, update, or delete a specific role."""

    authentication_classes = [PhaseTokenAuthentication]
    permission_classes = [IsAuthenticated, IsIPAllowed]
    throttle_classes = [PlanBasedRateThrottle]
    renderer_classes = [CamelCaseJSONRenderer]

    def _get_org(self, request):
        if request.auth.get("organisation"):
            return request.auth["organisation"]
        if request.auth.get("app"):
            return request.auth["app"].organisation
        raise PermissionDenied("Could not resolve organisation from request.")

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)

        action = METHOD_TO_ACTION.get(request.method)
        if not action:
            raise PermissionDenied(f"Unsupported HTTP method: {request.method}")

        account = None
        is_sa = False
        if request.auth["auth_type"] == "User":
            account = request.auth["org_member"].user
        elif request.auth["auth_type"] == "ServiceAccount":
            account = request.auth["service_account"]
            is_sa = True

        if account is not None:
            org = self._get_org(request)
            if not user_has_permission(account, action, "Roles", org, False, is_sa):
                raise PermissionDenied(
                    f"You don't have permission to {action} roles."
                )

    def get(self, request, role_id, *args, **kwargs):
        org = self._get_org(request)
        try:
            role = Role.objects.get(id=role_id, organisation=org)
        except ObjectDoesNotExist:
            return Response(
                {"error": "Role not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        return Response(
            _serialize_role(role, include_permissions=True),
            status=status.HTTP_200_OK,
        )

    def put(self, request, role_id, *args, **kwargs):
        org = self._get_org(request)
        try:
            role = Role.objects.get(id=role_id, organisation=org)
        except ObjectDoesNotExist:
            return Response(
                {"error": "Role not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if role.is_default:
            return Response(
                {"error": "Default roles cannot be modified."},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Free plan gate
        if org.plan == Organisation.FREE_PLAN:
            return Response(
                {"error": "Custom roles are not available on your organisation's plan."},
                status=status.HTTP_403_FORBIDDEN,
            )

        name = request.data.get("name")
        description = request.data.get("description")
        color = request.data.get("color")
        permissions = request.data.get("permissions")

        old_values, new_values = build_change_values(
            role, ["name", "description", "color", "permissions"], request.data
        )

        if name is None and description is None and color is None and permissions is None:
            return Response(
                {"error": "At least one field must be provided."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if name is not None:
            if not str(name).strip():
                return Response(
                    {"error": "Role name cannot be blank."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            name = str(name).strip()
            if len(name) > 64:
                return Response(
                    {"error": "Role name cannot exceed 64 characters."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            # Duplicate name check (exclude self)
            if (
                Role.objects.filter(organisation=org, name__iexact=name)
                .exclude(id=role_id)
                .exists()
            ):
                return Response(
                    {"error": "A role with this name already exists."},
                    status=status.HTTP_409_CONFLICT,
                )
            role.name = name

        if description is not None:
            if len(str(description)) > 500:
                return Response(
                    {"error": "Role description cannot exceed 500 characters."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            role.description = description

        if color is not None:
            if len(str(color)) > 7:
                return Response(
                    {"error": "Role color cannot exceed 7 characters."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            role.color = color

        if permissions is not None:
            if not isinstance(permissions, dict):
                return Response(
                    {"error": "Permissions must be a JSON object."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            perm_error = _validate_permissions(permissions)
            if perm_error:
                return Response(
                    {"error": perm_error},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            role.permissions = permissions

        role.save()

        # Audit log
        if old_values:
            actor_type, actor_id, actor_meta = get_actor_info(request)
            ip_address, user_agent = get_resolver_request_meta(request)
            log_audit_event(
                organisation=org,
                event_type="U",
                resource_type="role",
                resource_id=role.id,
                actor_type=actor_type,
                actor_id=actor_id,
                actor_metadata=actor_meta,
                resource_metadata={"name": role.name},
                old_values=old_values,
                new_values=new_values,
                description=f"Updated role '{role.name}'",
                ip_address=ip_address,
                user_agent=user_agent,
            )

        return Response(
            _serialize_role(role, include_permissions=True),
            status=status.HTTP_200_OK,
        )

    def delete(self, request, role_id, *args, **kwargs):
        org = self._get_org(request)
        try:
            role = Role.objects.get(id=role_id, organisation=org)
        except ObjectDoesNotExist:
            return Response(
                {"error": "Role not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if role.is_default:
            return Response(
                {"error": "Default roles cannot be deleted."},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Check for assigned members
        if OrganisationMember.objects.filter(role=role, deleted_at=None).exists():
            return Response(
                {"error": "Cannot delete a role that has members assigned to it."},
                status=status.HTTP_409_CONFLICT,
            )

        # Check for assigned service accounts
        if ServiceAccount.objects.filter(role=role, deleted_at=None).exists():
            return Response(
                {"error": "Cannot delete a role that has service accounts assigned to it."},
                status=status.HTTP_409_CONFLICT,
            )

        role_name = role.name
        role.delete()

        # Audit log
        actor_type, actor_id, actor_meta = get_actor_info(request)
        ip_address, user_agent = get_resolver_request_meta(request)
        log_audit_event(
            organisation=org,
            event_type="D",
            resource_type="role",
            resource_id=role_id,
            actor_type=actor_type,
            actor_id=actor_id,
            actor_metadata=actor_meta,
            resource_metadata={"name": role_name},
            old_values={"name": role_name},
            description=f"Deleted role '{role_name}'",
            ip_address=ip_address,
            user_agent=user_agent,
        )

        return Response(status=status.HTTP_204_NO_CONTENT)
