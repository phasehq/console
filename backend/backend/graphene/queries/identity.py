from graphql import GraphQLError
from api.identity_providers import IdentityProviders
from backend.graphene.types import IdentityProviderType


def resolve_aws_sts_endpoints(root, info):
    """Return STS endpoints dynamically using botocore's endpoint resolver data."""
    try:
        from api.utils.identity.aws import list_sts_endpoints
        return list_sts_endpoints()
    except Exception as ex:
        raise GraphQLError(f"Failed to load AWS STS endpoints: {ex}")


def resolve_identity_providers(root, info):
    """Get all supported identity providers."""
    return [
        IdentityProviderType(**provider)
        for provider in IdentityProviders.get_supported_providers()
    ]
