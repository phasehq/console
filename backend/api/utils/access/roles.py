OWNER_ROLE_KEY = "owner"
ADMIN_ROLE_KEY = "admin"
MANAGER_ROLE_KEY = "manager"
DEVELOPER_ROLE_KEY = "developer"
SERVICE_ROLE_KEY = "service"

MANAGED_ROLE_NAMES = {
    OWNER_ROLE_KEY: "Owner",
    ADMIN_ROLE_KEY: "Admin",
    MANAGER_ROLE_KEY: "Manager",
    DEVELOPER_ROLE_KEY: "Developer",
    SERVICE_ROLE_KEY: "Service",
}

MANAGED_ROLE_CHOICES = tuple(
    (managed_key, display_name)
    for managed_key, display_name in MANAGED_ROLE_NAMES.items()
)


default_roles = {
    "Owner": {
        "meta": {
            "version": 2,
            "description": "The organisation owner, limited to a single user, with full access to all resources and actions.",
        },
        "permissions": {
            "Organisation": ["create", "read", "update", "delete"],
            "Billing": ["create", "read", "update", "delete"],
            "Apps": ["create", "read", "update", "delete"],
            "Members": ["create", "read", "update", "delete"],
            "MemberPersonalAccessTokens": ["create", "read", "update", "delete"],
            "ServiceAccounts": ["create", "read", "update", "delete"],
            "ServiceAccountTokens": ["create", "read", "update", "delete"],
            "ExternalIdentities": ["create", "read", "update", "delete"],
            "Roles": ["create", "read", "update", "delete"],
            "IntegrationCredentials": ["create", "read", "update", "delete"],
            "NetworkAccessPolicies": ["create", "read", "update", "delete"],
            "Logs": ["read"],
            "SSO": ["create", "read", "update", "delete"],
            "Teams": ["create", "read", "update", "delete"],
            "SCIM": ["create", "read", "update", "delete"],
            "LogStreams": ["create", "read", "update", "delete"],
        },
        "app_permissions": {
            "Environments": ["create", "read", "update", "delete"],
            "Secrets": ["create", "read", "update", "delete"],
            "DynamicSecretLeases": ["create", "read", "update", "delete"],
            "RotatingSecrets": ["create", "read", "update", "delete"],
            "Lockbox": ["create", "read", "update", "delete"],
            "Logs": ["create", "read", "update", "delete"],
            "Tokens": ["create", "read", "update", "delete"],
            "Members": ["create", "read", "update", "delete"],
            "ServiceAccounts": ["create", "read", "update", "delete"],
            "Integrations": ["create", "read", "update", "delete"],
            "EncryptionMode": ["read", "update"],
            "Teams": ["create", "read", "update", "delete"],
        },
        "global_access": True,
    },
    "Admin": {
        "meta": {
            "version": 2,
            "description": "Administrative users with broad access to resources and global access to all Apps and Environments.",
        },
        "permissions": {
            "Organisation": ["read", "update"],
            "Billing": ["create", "read", "update", "delete"],
            "Apps": ["create", "read", "update", "delete"],
            "Members": ["create", "read", "update", "delete"],
            "MemberPersonalAccessTokens": ["create", "read", "update", "delete"],
            "ServiceAccounts": ["create", "read", "update", "delete"],
            "ServiceAccountTokens": ["create", "read", "update", "delete"],
            "ExternalIdentities": ["create", "read", "update", "delete"],
            "Roles": ["create", "read", "update", "delete"],
            "IntegrationCredentials": ["create", "read", "update", "delete"],
            "NetworkAccessPolicies": ["create", "read", "update", "delete"],
            "Logs": ["read"],
            "SSO": ["create", "read", "update", "delete"],
            "Teams": ["create", "read", "update", "delete"],
            "SCIM": ["create", "read", "update", "delete"],
            "LogStreams": ["create", "read", "update", "delete"],
        },
        "app_permissions": {
            "Environments": ["create", "read", "update", "delete"],
            "Secrets": ["create", "read", "update", "delete"],
            "DynamicSecretLeases": ["create", "read", "update", "delete"],
            "RotatingSecrets": ["create", "read", "update", "delete"],
            "Lockbox": ["create", "read", "update", "delete"],
            "Logs": ["create", "read", "update", "delete"],
            "Tokens": ["create", "read", "update", "delete"],
            "Members": ["create", "read", "update", "delete"],
            "ServiceAccounts": ["create", "read", "update", "delete"],
            "Integrations": ["create", "read", "update", "delete"],
            "EncryptionMode": ["read", "update"],
            "Teams": ["create", "read", "update", "delete"],
        },
        "global_access": True,
    },
    "Manager": {
        "meta": {
            "version": 2,
            "description": "Management users with broad access to environments, secrets, and service accounts at the organisation level. Requires explicit access to Apps and Environments.",
        },
        "permissions": {
            "Organisation": ["read"],
            "Billing": ["create", "read", "update", "delete"],
            "Apps": ["create", "read", "update", "delete"],
            "Members": ["create", "read", "update", "delete"],
            "ServiceAccounts": ["create", "read", "update", "delete"],
            "ServiceAccountTokens": ["create", "read", "update", "delete"],
            "ExternalIdentities": ["create", "read", "update", "delete"],
            "Roles": ["create", "read", "update", "delete"],
            "IntegrationCredentials": ["create", "read", "update", "delete"],
            "NetworkAccessPolicies": ["create", "read", "update", "delete"],
            "Logs": ["read"],
            "SSO": [],
            "Teams": ["create", "read", "update", "delete"],
            "SCIM": [],
            "LogStreams": [],
        },
        "app_permissions": {
            "Environments": ["read", "create", "update"],
            "Secrets": ["create", "read", "update", "delete"],
            "DynamicSecretLeases": ["create", "read", "update", "delete"],
            "RotatingSecrets": ["create", "read", "update", "delete"],
            "Lockbox": ["create", "read", "update", "delete"],
            "Logs": ["create", "read", "update", "delete"],
            "Tokens": ["create", "read", "update", "delete"],
            "Members": ["create", "read", "update", "delete"],
            "ServiceAccounts": ["create", "read", "update", "delete"],
            "Integrations": ["create", "read", "update", "delete"],
            "EncryptionMode": ["read", "update"],
            "Teams": ["create", "read", "update", "delete"],
        },
        "global_access": False,
    },
    "Developer": {
        "meta": {
            "version": 1,
            "description": "Development users with limited organisation-level permissions. Requires explicit access to Apps and Environments.",
        },
        "permissions": {
            "Organisation": [],
            "Billing": [],
            "Apps": ["read"],
            "Members": ["read"],
            "ServiceAccounts": [],
            "ServiceAccountTokens": [],
            "ExternalIdentities": [],
            "Roles": ["read"],
            "IntegrationCredentials": [
                "create",
                "read",
                "update",
            ],
            "NetworkAccessPolicies": ["read"],
            "Logs": ["read"],
            "SSO": [],
            "Teams": ["read"],
            "SCIM": [],
            "LogStreams": [],
        },
        "app_permissions": {
            "Environments": ["read", "create", "update"],
            "Secrets": ["create", "read", "update", "delete"],
            "DynamicSecretLeases": ["create", "read"],
            "RotatingSecrets": ["read"],
            "Lockbox": ["create", "read", "update", "delete"],
            "Logs": ["read"],
            "Tokens": ["read", "create"],
            "Members": ["read"],
            "ServiceAccounts": ["create"],
            "Integrations": ["create", "read", "update", "delete"],
            "EncryptionMode": ["read", "update"],
            "Teams": ["read"],
        },
        "global_access": False,
    },
    "Service": {
        "meta": {
            "version": 1,
            "description": "Default role for Service Accounts, providing programmatic access to secrets without access to other organisation or app resources.",
        },
        "permissions": {
            "Organisation": [],
            "Billing": [],
            "Apps": ["create", "read", "update"],
            "Members": ["read"],
            "ServiceAccounts": ["read"],
            "ServiceAccountTokens": ["read"],
            "ExternalIdentities": ["read"],
            "Roles": ["read"],
            "IntegrationCredentials": ["read"],
            "NetworkAccessPolicies": ["read"],
            "Logs": [],
            "SSO": [],
            "Teams": [],
            "SCIM": [],
            "LogStreams": [],
        },
        "app_permissions": {
            "Environments": ["read", "create", "update", "delete"],
            "Secrets": ["create", "read", "update", "delete"],
            "DynamicSecretLeases": ["create", "read"],
            "RotatingSecrets": ["read"],
            "Lockbox": [],
            "Logs": [],
            "Tokens": [],
            "Members": ["read"],
            "ServiceAccounts": ["read"],
            "Integrations": ["read"],
            "EncryptionMode": ["read"],
            "Teams": ["read"],
        },
        "global_access": False,
    },
}


default_roles_by_key = {
    managed_key: default_roles[display_name]
    for managed_key, display_name in MANAGED_ROLE_NAMES.items()
}


def get_default_role_template(role):
    """Return a managed role's built-in policy, failing closed for invalid state."""
    if role is None or not getattr(role, "is_default", False):
        return None
    return default_roles_by_key.get(getattr(role, "managed_key", None))


def role_has_managed_key(role, managed_key):
    """Match security-sensitive role semantics without consulting display names."""
    return bool(
        role is not None
        and getattr(role, "is_default", False)
        and getattr(role, "managed_key", None) == managed_key
    )


_owner_policy = default_roles_by_key[OWNER_ROLE_KEY]
VALID_ORG_PERMISSIONS = {
    resource: set(actions)
    for resource, actions in _owner_policy["permissions"].items()
}
VALID_APP_PERMISSIONS = {
    resource: set(actions)
    for resource, actions in _owner_policy["app_permissions"].items()
}


def normalize_custom_role_permissions(permissions):
    """Normalise camelCase keys so API responses can be round-tripped."""
    if not isinstance(permissions, dict):
        return permissions
    key_map = {"appPermissions": "app_permissions"}
    return {key_map.get(key, key): value for key, value in permissions.items()}


def validate_custom_role_permissions(
    permissions, *, allow_false_global_access=False
):
    """Return an error string for invalid custom-role policy input, else None."""
    if not isinstance(permissions, dict):
        return "Permissions must be a JSON object."

    # global_access is intentionally reserved for the managed Owner/Admin
    # templates. GraphQL historically stored an explicit false value for
    # custom roles, so retain that harmless shape for client compatibility.
    allowed_keys = {"permissions", "app_permissions"}
    if allow_false_global_access and "global_access" in permissions:
        if permissions["global_access"] is not False:
            return "global_access is reserved for managed roles and must be false."
        allowed_keys.add("global_access")

    unknown_keys = set(permissions.keys()) - allowed_keys
    if unknown_keys:
        return (
            f"Unknown top-level keys: {', '.join(sorted(unknown_keys))}. "
            "Allowed keys: permissions, app_permissions."
        )

    required_keys = {"permissions", "app_permissions"}
    missing_keys = required_keys - set(permissions.keys())
    if missing_keys:
        return (
            f"Missing required keys: {', '.join(sorted(missing_keys))}. "
            "Required keys: permissions, app_permissions."
        )

    org_permissions = permissions["permissions"]
    if org_permissions is not None:
        if not isinstance(org_permissions, dict):
            return "permissions must be a JSON object."
        for resource, actions in org_permissions.items():
            if resource not in VALID_ORG_PERMISSIONS:
                return (
                    f"Unknown org permission class: '{resource}'. Valid classes: "
                    f"{', '.join(sorted(VALID_ORG_PERMISSIONS.keys()))}."
                )
            if not isinstance(actions, list):
                return f"Actions for '{resource}' must be an array."
            valid_actions = VALID_ORG_PERMISSIONS[resource]
            for action in actions:
                if action not in valid_actions:
                    return (
                        f"Unknown action '{action}' for org permission class "
                        f"'{resource}'. Valid actions: "
                        f"{', '.join(sorted(valid_actions))}."
                    )

    app_permissions = permissions["app_permissions"]
    if app_permissions is not None:
        if not isinstance(app_permissions, dict):
            return "app_permissions must be a JSON object."
        for resource, actions in app_permissions.items():
            if resource not in VALID_APP_PERMISSIONS:
                return (
                    f"Unknown app permission class: '{resource}'. Valid classes: "
                    f"{', '.join(sorted(VALID_APP_PERMISSIONS.keys()))}."
                )
            if not isinstance(actions, list):
                return f"Actions for '{resource}' must be an array."
            valid_actions = VALID_APP_PERMISSIONS[resource]
            for action in actions:
                if action not in valid_actions:
                    return (
                        f"Unknown action '{action}' for app permission class "
                        f"'{resource}'. Valid actions: "
                        f"{', '.join(sorted(valid_actions))}."
                    )

    return None
