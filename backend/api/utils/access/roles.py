default_roles = {
    "Owner": {
        "permissions": [
            {
                "resource": "Organisation",
                "actions": ["create", "read", "update", "delete"],
            },
            {"resource": "Billing", "actions": ["create", "read", "update", "delete"]},
            {"resource": "Apps", "actions": ["create", "read", "update", "delete"]},
            {"resource": "Members", "actions": ["create", "read", "update", "delete"]},
            {
                "resource": "ServiceAccounts",
                "actions": ["create", "read", "update", "delete"],
            },
            {"resource": "Roles", "actions": ["create", "read", "update", "delete"]},
            {
                "app_permissions": [
                    {
                        "resource": "Environments",
                        "actions": ["create", "read", "update", "delete"],
                    },
                    {
                        "resource": "Secrets",
                        "actions": ["create", "read", "update", "delete"],
                    },
                    {
                        "resource": "Logs",
                        "actions": ["create", "read", "update", "delete"],
                    },
                    {
                        "resource": "Tokens",
                        "actions": ["create", "read", "update", "delete"],
                    },
                    {
                        "resource": "Members",
                        "actions": ["create", "read", "update", "delete"],
                    },
                ]
            },
        ]
    },
    "Admin": {
        "permissions": [
            {
                "resource": "Organisation",
                "actions": [
                    "read",
                    "update",
                ],
            },
            {"resource": "Billing", "actions": ["create", "read", "update", "delete"]},
            {"resource": "Apps", "actions": ["create", "read", "update", "delete"]},
            {"resource": "Members", "actions": ["create", "read", "update", "delete"]},
            {
                "resource": "ServiceAccounts",
                "actions": ["create", "read", "update", "delete"],
            },
            {"resource": "Roles", "actions": ["create", "read", "update", "delete"]},
            {
                "app_permissions": [
                    {
                        "resource": "Environments",
                        "actions": ["create", "read", "update", "delete"],
                    },
                    {
                        "resource": "Secrets",
                        "actions": ["create", "read", "update", "delete"],
                    },
                    {
                        "resource": "Logs",
                        "actions": ["create", "read", "update", "delete"],
                    },
                    {
                        "resource": "Tokens",
                        "actions": ["create", "read", "update", "delete"],
                    },
                    {
                        "resource": "Members",
                        "actions": ["create", "read", "update", "delete"],
                    },
                ]
            },
        ]
    },
    "Developer": {
        "permissions": [
            {"resource": "Organisation", "actions": []},
            {"resource": "Billing", "actions": []},
            {"resource": "Apps", "actions": ["read"]},
            {"resource": "Members", "actions": ["read"]},
            {"resource": "ServiceAccounts", "actions": []},
            {"resource": "Roles", "actions": []},
            {
                "app_permissions": [
                    {
                        "resource": "Environments",
                        "actions": ["read", "create", "update"],
                    },
                    {
                        "resource": "Secrets",
                        "actions": ["create", "read", "update", "delete"],
                    },
                    {"resource": "Logs", "actions": ["read"]},
                    {"resource": "Tokens", "actions": ["read", "create"]},
                    {"resource": "Members", "actions": ["read"]},
                ]
            },
        ]
    },
}
