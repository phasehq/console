class Providers:
    CLOUDFLARE = {
        "id": "cloudflare",
        "name": "Cloudflare",
        "expected_credentials": ["account_id", "access_token"],
        "auth_scheme": "token",
    }

    AWS = {
        "id": "aws",
        "name": "AWS",
        "expected_credentials": ["access_key_id", "secret_access_key"],
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
        "api_url": "https://api.cloudflare.com/client/v4",
        "resource_type": "project",
        "subresource_options": ["production", "preview"],
    }

    CLOUDFLARE_WORKERS = {
        "id": "cloudflare_workers",
        "name": "Cloudflare Workers",
        "provider": Providers.CLOUDFLARE,
        "api_url": "https://api.cloudflare.com/client/v4",
        "resource_type": "project",
        "subresource_options": ["production", "preview"],
    }

    AWS_SECRETS_MANAGER = {
        "id": "aws_secrets_manager",
        "name": "AWS Secrets Manager",
        "provider": Providers.AWS,
        "resource_type": "secret",
        "subresource_options": [],
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
