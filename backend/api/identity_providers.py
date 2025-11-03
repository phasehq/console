class IdentityProviders:
    """
    Configuration for supported identity providers.
    Similar to Providers in services.py but specifically for identity authentication.
    """
    
    AWS_IAM = {
        "id": "aws_iam",
        "name": "AWS IAM",
        "description": "Use AWS STS GetCallerIdentity to authenticate.",
        "icon_id": "aws",  # Maps to ProviderIcon component
        "supported": True,
    }
    
    # Future identity providers can be added here:
    # GitHub OIDC
    #     "id": "github_oidc", 
    #     "name": "GitHub OIDC",
    #     "description": "Use GitHub OIDC for authentication.",
    #     "icon_id": "github",
    #     "supported": False,
    # }
    #
    # Kubernetes OIDC
    #     "id": "kubernetes_oidc",
    #     "name": "Kubernetes OIDC", 
    #     "description": "Use Kubernetes OIDC for authentication.",
    #     "icon_id": "kubernetes",
    #     "supported": False,
    # }

    @classmethod
    def get_all_providers(cls):
        """Get all identity providers, including unsupported ones for future roadmap display."""
        return [
            provider
            for provider in cls.__dict__.values()
            if isinstance(provider, dict)
        ]
    
    @classmethod
    def get_supported_providers(cls):
        """Get only currently supported identity providers."""
        return [
            provider
            for provider in cls.__dict__.values()
            if isinstance(provider, dict) and provider.get("supported", False)
        ]
    
    @classmethod
    def get_provider_config(cls, provider_id):
        """Get configuration for a specific provider by ID."""
        for provider in cls.__dict__.values():
            if isinstance(provider, dict) and provider["id"] == provider_id:
                return provider
        raise ValueError(f"Identity provider '{provider_id}' not found")

