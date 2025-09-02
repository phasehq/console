from api.models import DynamicSecret, DynamicSecretLease, OrganisationMember
from api.utils.access.permissions import user_has_permission
import graphene
from graphene_django import DjangoObjectType
from graphene.types.generic import GenericScalar
from ee.integrations.secrets.dynamic.aws.graphene.types import (
    AWSConfigType,
    AwsCredentialsType,
)


class KeyMap(graphene.ObjectType):
    id = graphene.String()
    key_name = graphene.String()


class KeyMapInput(graphene.InputObjectType):
    id = graphene.String(required=True)
    key_name = graphene.String(required=True)


class DynamicSecretProviderType(graphene.ObjectType):
    id = graphene.String(required=True)
    name = graphene.String(required=True)
    credentials = GenericScalar(required=True)
    config_map = GenericScalar(required=True)


class DynamicSecretConfigUnion(graphene.Union):
    class Meta:
        types = (AWSConfigType,)


class LeaseCredentialsUnion(graphene.Union):
    class Meta:
        types = (AwsCredentialsType,)


class DynamicSecretType(DjangoObjectType):
    # Expose JSON config safely
    config = graphene.Field(DynamicSecretConfigUnion)
    key_map = graphene.List(KeyMap)

    # Convenience fields for TTLs
    default_ttl_seconds = graphene.Int()
    max_ttl_seconds = graphene.Int()

    class Meta:
        model = DynamicSecret
        fields = (
            "id",
            "name",
            "description",
            "environment",
            "folder",
            "path",
            "authentication",
            "provider",
            "config",
            "key_map",
            "leases",
            "created_at",
            "updated_at",
            "deleted_at",
        )

    def resolve_config(self, info):
        if self.provider == "aws":
            return AWSConfigType(**self.config)
        return None

    def resolve_default_ttl_seconds(self, info):
        return int(self.default_ttl.total_seconds()) if self.default_ttl else None

    def resolve_max_ttl_seconds(self, info):
        return int(self.max_ttl.total_seconds()) if self.max_ttl else None

    def resolve_leases(self, info):
        filter = {}
        if not user_has_permission(
            info.context.user,
            "read",
            "DynamicSecretLeases",
            self.environment.app.organisation,
            True,
        ):
            filter["organisation_member"] = OrganisationMember.objects.get(
                organisation=self.environment.app.organisation, user=info.context.user
            )
        return self.leases.filter(**filter).order_by("-created_at")


class DynamicSecretLeaseType(DjangoObjectType):

    credentials = graphene.Field(LeaseCredentialsUnion)

    class Meta:
        model = DynamicSecretLease
        fields = "__all__"

    def resolve_credentials(self, info):
        return getattr(self, "_credentials", None)
