class ServiceConfig:
    CLOUDFLARE_PAGES = {
        "id": "cloudflare_pages",
        "name": "Cloudflare Pages",
        "api_url": "https://api.cloudflare.com/client/v4",
        "auth_scheme": "token",
        "expected_credentials": ["CLOUDFLARE_ACCESS_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
        "resource_type": "project",
        "subresource_options": ["production", "preview"],
    }

    CLOUDFLARE_SECRETS = {
        "id": "cloudflare_secrets",
        "name": "Cloudflare Secrets",
        "api_url": "https://api.cloudflare.com/client/v4",
        "auth_scheme": "token",
        "expected_credentials": ["CLOUDFLARE_ACCESS_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
        "resource_type": "project",
        "subresource_options": ["production", "preview"],
    }

    CLOUDFLARE_WORKERS = {
        "id": "cloudflare_workers",
        "name": "Cloudflare Workers",
        "api_url": "https://api.cloudflare.com/client/v4",
        "auth_scheme": "token",
        "expected_credentials": ["CLOUDFLARE_ACCESS_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
        "resource_type": "project",
        "subresource_options": ["production", "preview"],
    }

    # Define other services in the same way...

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


# # Example usage:
# service_config = get_service_config('cloudflare')
# api_url = service_config['api_url']
# # ... use api_url ...
