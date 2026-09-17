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

ORGANISATION_PERMISSIONS_KEY = "permissions"
APP_PERMISSIONS_KEY = "app_permissions"
AGENT_PERMISSIONS_KEY = "agent_permissions"

# Resources that act *within* an Agent, kept apart from organisation-wide ones
# the same way app_permissions sits beside permissions. Agent lifecycle
# (`Agents`), the reusable Connections and the org-wide request queue stay
# organisation scoped, exactly as `Apps` does for apps. This is the seam
# team-owned Agents will resolve through, like `_check_app_permission`.
AGENT_PERMISSION_RESOURCES = frozenset(
    {"AgentWorkflows", "AgentMemberships", "AgentTokens", "AgentSessions"}
)


def permission_key_for(resource, is_app_resource=False):
    """Return the policy map a resource's grants live in.

    Apps need an explicit flag because app and organisation resources share
    names (`Members`, `Logs`, `Teams`, `ServiceAccounts`). Agent resources are
    uniquely named, so they route by name and no call site can read the wrong
    map. A test pins that the names stay disjoint.
    """
    if is_app_resource:
        return APP_PERMISSIONS_KEY
    if resource in AGENT_PERMISSION_RESOURCES:
        return AGENT_PERMISSIONS_KEY
    return ORGANISATION_PERMISSIONS_KEY


default_roles = {
    "Owner": {
        "meta": {
            "version": 4,
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
            "Agents": ["create", "read", "update", "delete"],
            "AgentConnections": ["create", "read", "update", "delete"],
            "AgentRequests": ["create", "read", "update", "delete"],
        },
        "app_permissions": {
            "Environments": ["create", "read", "update", "delete"],
            "Secrets": ["create", "read", "update", "delete"],
            "DynamicSecretLeases": ["create", "read", "update", "delete"],
            "RotatingSecrets": ["create", "read", "update", "delete"],
            "Lockbox": ["create", "read", "update", "delete"],
            "Logs": ["create", "read", "update", "delete"],
            "Members": ["create", "read", "update", "delete"],
            "ServiceAccounts": ["create", "read", "update", "delete"],
            "Integrations": ["create", "read", "update", "delete"],
            "EncryptionMode": ["read", "update"],
            "Teams": ["create", "read", "update", "delete"],
        },
        "agent_permissions": {
            "AgentWorkflows": ["create", "read", "update", "delete"],
            "AgentMemberships": ["create", "read", "update", "delete"],
            "AgentTokens": ["create", "read", "update", "delete"],
            "AgentSessions": ["create", "read", "update", "delete"],
        },
        "global_access": True,
    },
    "Admin": {
        "meta": {
            "version": 4,
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
            "Agents": ["create", "read", "update", "delete"],
            "AgentConnections": ["create", "read", "update", "delete"],
            "AgentRequests": ["create", "read", "update", "delete"],
        },
        "app_permissions": {
            "Environments": ["create", "read", "update", "delete"],
            "Secrets": ["create", "read", "update", "delete"],
            "DynamicSecretLeases": ["create", "read", "update", "delete"],
            "RotatingSecrets": ["create", "read", "update", "delete"],
            "Lockbox": ["create", "read", "update", "delete"],
            "Logs": ["create", "read", "update", "delete"],
            "Members": ["create", "read", "update", "delete"],
            "ServiceAccounts": ["create", "read", "update", "delete"],
            "Integrations": ["create", "read", "update", "delete"],
            "EncryptionMode": ["read", "update"],
            "Teams": ["create", "read", "update", "delete"],
        },
        "agent_permissions": {
            "AgentWorkflows": ["create", "read", "update", "delete"],
            "AgentMemberships": ["create", "read", "update", "delete"],
            "AgentTokens": ["create", "read", "update", "delete"],
            "AgentSessions": ["create", "read", "update", "delete"],
        },
        "global_access": True,
    },
    "Manager": {
        "meta": {
            "version": 4,
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
            "Agents": ["create", "read", "update", "delete"],
            "AgentConnections": ["create", "read", "update", "delete"],
            "AgentRequests": ["create", "read", "update", "delete"],
        },
        "app_permissions": {
            "Environments": ["read", "create", "update", "delete"],
            "Secrets": ["create", "read", "update", "delete"],
            "DynamicSecretLeases": ["create", "read", "update", "delete"],
            "RotatingSecrets": ["create", "read", "update", "delete"],
            "Lockbox": ["create", "read", "update", "delete"],
            "Logs": ["create", "read", "update", "delete"],
            "Members": ["create", "read", "update", "delete"],
            "ServiceAccounts": ["create", "read", "update", "delete"],
            "Integrations": ["create", "read", "update", "delete"],
            "EncryptionMode": ["read", "update"],
            "Teams": ["create", "read", "update", "delete"],
        },
        "agent_permissions": {
            "AgentWorkflows": ["create", "read", "update", "delete"],
            "AgentMemberships": [],
            "AgentTokens": ["create", "read", "delete"],
            "AgentSessions": ["create", "read", "delete"],
        },
        "global_access": False,
    },
    "Developer": {
        "meta": {
            "version": 3,
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
            "Agents": ["create", "read", "update"],
            "AgentConnections": [],
            "AgentRequests": ["create", "read", "delete"],
        },
        "app_permissions": {
            "Environments": ["read", "create", "update"],
            "Secrets": ["create", "read", "update", "delete"],
            "DynamicSecretLeases": ["create", "read"],
            "RotatingSecrets": ["read"],
            "Lockbox": ["create", "read", "update", "delete"],
            "Logs": ["read"],
            "Members": ["read"],
            "ServiceAccounts": ["create"],
            "Integrations": ["create", "read", "update", "delete"],
            "EncryptionMode": ["read", "update"],
            "Teams": ["read"],
        },
        "agent_permissions": {
            "AgentWorkflows": ["create", "read", "update", "delete"],
            "AgentMemberships": [],
            "AgentTokens": ["create", "read", "delete"],
            "AgentSessions": ["create", "read", "delete"],
        },
        "global_access": False,
    },
    "Service": {
        "meta": {
            "version": 3,
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
            "Agents": [],
            "AgentConnections": [],
            "AgentRequests": [],
        },
        "app_permissions": {
            "Environments": ["read", "create", "update", "delete"],
            "Secrets": ["create", "read", "update", "delete"],
            "DynamicSecretLeases": ["create", "read"],
            "RotatingSecrets": ["read"],
            "Lockbox": [],
            "Logs": [],
            "Members": ["read"],
            "ServiceAccounts": ["read"],
            "Integrations": ["read"],
            "EncryptionMode": ["read"],
            "Teams": ["read"],
        },
        "agent_permissions": {
            "AgentWorkflows": [],
            "AgentMemberships": [],
            "AgentTokens": [],
            "AgentSessions": [],
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
VALID_AGENT_PERMISSIONS = {
    resource: set(actions)
    for resource, actions in _owner_policy["agent_permissions"].items()
}

def prune_retired_permissions(permissions):
    """Drop resource classes outside the Owner template. Stored custom roles
    keep keys for permissions the product has since retired."""
    if not isinstance(permissions, dict):
        return permissions
    pruned = dict(permissions)
    for scope, universe in (
        ("permissions", VALID_ORG_PERMISSIONS),
        ("app_permissions", VALID_APP_PERMISSIONS),
    ):
        scoped = permissions.get(scope)
        if isinstance(scoped, dict):
            pruned[scope] = {
                resource: actions
                for resource, actions in scoped.items()
                if resource in universe
            }
    return pruned


def normalize_custom_role_permissions(permissions):
    """Normalise camelCase keys so API responses can be round-tripped."""
    if not isinstance(permissions, dict):
        return permissions
    key_map = {
        "appPermissions": "app_permissions",
        "agentPermissions": "agent_permissions",
    }
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
    allowed_keys = {"permissions", "app_permissions", "agent_permissions"}
    if allow_false_global_access and "global_access" in permissions:
        if permissions["global_access"] is not False:
            return "global_access is reserved for managed roles and must be false."
        allowed_keys.add("global_access")

    unknown_keys = set(permissions.keys()) - allowed_keys
    if unknown_keys:
        return (
            f"Unknown top-level keys: {', '.join(sorted(unknown_keys))}. "
            "Allowed keys: permissions, app_permissions, agent_permissions."
        )

    # agent_permissions is optional so clients written before it existed keep
    # working; a role without it simply grants nothing within Agents.
    required_keys = {"permissions", "app_permissions"}
    missing_keys = required_keys - set(permissions.keys())
    if missing_keys:
        return (
            f"Missing required keys: {', '.join(sorted(missing_keys))}. "
            "Required keys: permissions, app_permissions."
        )

    for key, valid_permissions, label in (
        (ORGANISATION_PERMISSIONS_KEY, VALID_ORG_PERMISSIONS, "org"),
        (APP_PERMISSIONS_KEY, VALID_APP_PERMISSIONS, "app"),
        (AGENT_PERMISSIONS_KEY, VALID_AGENT_PERMISSIONS, "agent"),
    ):
        error = _validate_permission_map(
            permissions.get(key), key, valid_permissions, label
        )
        if error:
            return error

    return None


def _validate_permission_map(policy_map, key, valid_permissions, label):
    if policy_map is None:
        return None
    if not isinstance(policy_map, dict):
        return f"{key} must be a JSON object."
    for resource, actions in policy_map.items():
        if resource not in valid_permissions:
            if (
                key == ORGANISATION_PERMISSIONS_KEY
                and resource in AGENT_PERMISSION_RESOURCES
            ):
                return (
                    f"'{resource}' is an agent permission class; "
                    "set it under agent_permissions."
                )
            return (
                f"Unknown {label} permission class: '{resource}'. Valid classes: "
                f"{', '.join(sorted(valid_permissions.keys()))}."
            )
        if not isinstance(actions, list):
            return f"Actions for '{resource}' must be an array."
        valid_actions = valid_permissions[resource]
        for action in actions:
            if action not in valid_actions:
                return (
                    f"Unknown action '{action}' for {label} permission class "
                    f"'{resource}'. Valid actions: "
                    f"{', '.join(sorted(valid_actions))}."
                )
    return None
