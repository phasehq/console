class Providers:
    CLOUDFLARE = {
        "id": "cloudflare",
        "name": "Cloudflare",
        "expected_credentials": ["account_id", "access_token"],
        "optional_credentials": [],
        "auth_scheme": "token",
    }

    AWS = {
        "id": "aws",
        "name": "AWS",
        "expected_credentials": ["access_key_id", "secret_access_key", "region"],
        "optional_credentials": [],
        "auth_scheme": "token",
    }

    GITHUB = {
        "id": "github",
        "name": "GitHub",
        "expected_credentials": ["access_token"],
        "optional_credentials": [],
        "auth_scheme": "oauth",
    }

    GITLAB = {
        "id": "gitlab",
        "name": "GitLab",
        "expected_credentials": ["gitlab_host", "gitlab_token"],
        "optional_credentials": [],
        "auth_scheme": "token",
    }

    HASHICORP_VAULT = {
        "id": "hashicorp_vault",
        "name": "Hashicorp Vault",
        "expected_credentials": [
            "vault_addr",
            "vault_role_id",
            "vault_secret_id",
        ],
        "optional_credentials": ["vault_namespace"],
        "auth_scheme": "token",
    }

    HASHICORP_NOMAD = {
        "id": "hashicorp_nomad",
        "name": "Hashicorp Nomad",
        "expected_credentials": [
            "nomad_addr",
            "nomad_token_secret",
        ],
        "optional_credentials": [],
        "auth_scheme": "token",
    }

    RAILWAY = {
        "id": "railway",
        "name": "Railway",
        "expected_credentials": ["api_token"],
        "optional_credentials": [],
        "auth_scheme": "token",
    }

    VERCEL = {
        "id": "vercel",
        "name": "Vercel",
        "expected_credentials": ["api_token"],
        "optional_credentials": [],
        "auth_scheme": "token",
    }

    @classmethod
    def get_provider_choices(cls):
        return [
            (provider["id"], provider["name"])
            for provider in cls.__dict__.values()
            if isinstance(provider, dict)
        ]

    def get_provider_config(provider_id):
        for provider in Providers.__dict__.values():
            if isinstance(provider, dict) and provider["id"] == provider_id:
                return provider
        raise ValueError("Provider not found")


class ServiceConfig:
    CLOUDFLARE_PAGES = {
        "id": "cloudflare_pages",
        "name": "Cloudflare Pages",
        "provider": Providers.CLOUDFLARE,
        "resource_type": "project",
    }

    # CLOUDFLARE_WORKERS = {
    #     "id": "cloudflare_workers",
    #     "name": "Cloudflare Workers",
    #     "provider": Providers.CLOUDFLARE,
    #     "resource_type": "project",
    # }

    AWS_SECRETS_MANAGER = {
        "id": "aws_secrets_manager",
        "name": "AWS Secrets Manager",
        "provider": Providers.AWS,
        "resource_type": "secret",
    }

    GITHUB_ACTIONS = {
        "id": "github_actions",
        "name": "GitHub Actions",
        "provider": Providers.GITHUB,
        "resource_type": "repo",
    }

    GITLAB_CI = {
        "id": "gitlab_ci",
        "name": "GitLab CI",
        "provider": Providers.GITLAB,
        "resource_type": "repo",
    }

    HASHICORP_VAULT = {
        "id": "hashicorp_vault",
        "name": "Hashicorp Vault",
        "provider": Providers.HASHICORP_VAULT,
        "resource_type": "path",
    }

    HASHICORP_NOMAD = {
        "id": "hashicorp_nomad",
        "name": "Hashicorp Nomad",
        "provider": Providers.HASHICORP_NOMAD,
        "resource_type": "path",
    }

    RAILWAY = {
        "id": "railway",
        "name": "Railway",
        "provider": Providers.RAILWAY,
        "resource_type": "environment",
    }

    @classmethod
    def get_service_choices(cls):
        return [
            (service["id"], service["name"])
            for service in cls.__dict__.values()
            if isinstance(service, dict)
        ]

    def get_service_config(service_id):
        for service in ServiceConfig.__dict__.values():
            if isinstance(service, dict) and service["id"] == service_id:
                return service
        raise ValueError("Service not found")
