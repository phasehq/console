default_roles = {
    "Owner": {
        "permissions": {
            "Organisation": ["create", "read", "update", "delete"],
            "Billing": ["create", "read", "update", "delete"],
            "Apps": ["create", "read", "update", "delete"],
            "Members": ["create", "read", "update", "delete"],
            "ServiceAccounts": ["create", "read", "update", "delete"],
            "Roles": ["create", "read", "update", "delete"],
        },
        "app_permissions": {
            "Environments": ["create", "read", "update", "delete"],
            "Secrets": ["create", "read", "update", "delete"],
            "Logs": ["create", "read", "update", "delete"],
            "Tokens": ["create", "read", "update", "delete"],
            "Members": ["create", "read", "update", "delete"],
            "Integrations": ["create", "read", "update", "delete"],
            "EncryptionMode": ["read", "update"],
        },
    },
    "Admin": {
        "permissions": {
            "Organisation": ["read", "update"],
            "Billing": ["create", "read", "update", "delete"],
            "Apps": ["create", "read", "update", "delete"],
            "Members": ["create", "read", "update", "delete"],
            "ServiceAccounts": ["create", "read", "update", "delete"],
            "Roles": ["create", "read", "update", "delete"],
        },
        "app_permissions": {
            "Environments": ["create", "read", "update", "delete"],
            "Secrets": ["create", "read", "update", "delete"],
            "Logs": ["create", "read", "update", "delete"],
            "Tokens": ["create", "read", "update", "delete"],
            "Members": ["create", "read", "update", "delete"],
            "Integrations": ["create", "read", "update", "delete"],
            "EncryptionMode": ["read", "update"],
        },
    },
    "Developer": {
        "permissions": {
            "Organisation": [],
            "Billing": [],
            "Apps": ["read"],
            "Members": ["read"],
            "ServiceAccounts": [],
            "Roles": [],
        },
        "app_permissions": {
            "Environments": ["read", "create", "update"],
            "Secrets": ["create", "read", "update", "delete"],
            "Logs": ["read"],
            "Tokens": ["read", "create"],
            "Members": ["read"],
            "Integrations": ["create", "read", "update", "delete"],
            "EncryptionMode": ["read", "update"],
        },
    },
}
