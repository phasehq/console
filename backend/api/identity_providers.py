class IdentityProviders:
    """
    Configuration for supported identity providers.
    Similar to Providers in services.py but specifically for identity authentication.
    """

    AWS_IAM = {
        "id": "aws_iam",
        "name": "AWS IAM",
        "description": "Use AWS STS GetCallerIdentity to authenticate.",
        "icon_id": "aws",
    }

    AZURE_ENTRA = {
        "id": "azure_entra",
        "name": "Azure",
        "description": "Use Azure Managed Identity or Service Principal for authentication.",
        "icon_id": "azure",
    }

    @classmethod
    def get_all_providers(cls):
        """Get all identity providers."""
        return [
            provider
            for provider in cls.__dict__.values()
            if isinstance(provider, dict)
        ]

    @classmethod
    def get_provider_config(cls, provider_id):
        """Get configuration for a specific provider by ID."""
        for provider in cls.__dict__.values():
            if isinstance(provider, dict) and provider["id"] == provider_id:
                return provider
        raise ValueError(f"Identity provider '{provider_id}' not found")
