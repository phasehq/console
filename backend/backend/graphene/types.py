from api.services import Providers, ServiceConfig
from api.utils.syncing.auth import get_credentials
import graphene
from enum import Enum
from graphene import ObjectType, relay, NonNull
from graphene_django import DjangoObjectType
from api.models import (
    CustomUser,
    Environment,
    EnvironmentKey,
    EnvironmentSync,
    EnvironmentSyncEvent,
    EnvironmentToken,
    Organisation,
    App,
    OrganisationMember,
    OrganisationMemberInvite,
    PersonalSecret,
    ProviderCredentials,
    Secret,
    SecretEvent,
    SecretFolder,
    SecretTag,
    ServerEnvironmentKey,
    ServiceToken,
    UserToken,
)
from logs.dynamodb_models import KMSLog
from allauth.socialaccount.models import SocialAccount


class OrganisationType(DjangoObjectType):
    role = graphene.String()
    member_id = graphene.ID()
    keyring = graphene.String()
    recovery = graphene.String()

    class Meta:
        model = Organisation
        fields = (
            "id",
            "name",
            "identity_key",
            "created_at",
            "plan",
            "role",
            "member_id",
            "keyring",
            "recovery",
        )

    def resolve_role(self, info):
        org_member = OrganisationMember.objects.get(
            user=info.context.user, organisation=self, deleted_at=None
        )
        return org_member.role

    def resolve_member_id(self, info):
        org_member = OrganisationMember.objects.get(
            user=info.context.user, organisation=self, deleted_at=None
        )
        return org_member.id

    def resolve_keyring(self, info):
        org_member = OrganisationMember.objects.get(
            user=info.context.user, organisation=self, deleted_at=None
        )
        return org_member.wrapped_keyring

    def resolve_recovery(self, info):
        org_member = OrganisationMember.objects.get(
            user=info.context.user, organisation=self, deleted_at=None
        )
        return org_member.wrapped_recovery

    def resolve_identity_key(self, info):
        org_member = OrganisationMember.objects.get(
            user=info.context.user, organisation=self, deleted_at=None
        )
        return org_member.identity_key


class OrganisationMemberType(DjangoObjectType):
    email = graphene.String()
    username = graphene.String()
    full_name = graphene.String()
    avatar_url = graphene.String()
    self = graphene.Boolean()

    class Meta:
        model = OrganisationMember
        fields = (
            "id",
            "email",
            "username",
            "full_name",
            "avatar_url",
            "role",
            "identity_key",
            "wrapped_keyring",
            "created_at",
            "updated_at",
        )

    def resolve_email(self, info):
        return self.user.email

    def resolve_username(self, info):
        return self.user.username

    def resolve_full_name(self, info):
        social_acc = self.user.socialaccount_set.first()
        if social_acc:
            return social_acc.extra_data.get("name")
        return None

    def resolve_avatar_url(self, info):
        social_acc = self.user.socialaccount_set.first()
        if social_acc:
            if social_acc.provider == "google":
                return social_acc.extra_data.get("picture")
            return social_acc.extra_data.get("avatar_url")
        return None

    def resolve_self(self, info):
        return self.user == info.context.user


class OrganisationMemberInviteType(DjangoObjectType):
    class Meta:
        model = OrganisationMemberInvite
        fields = (
            "id",
            "invited_by",
            "invitee_email",
            "valid",
            "organisation",
            "apps",
            "role",
            "created_at",
            "updated_at",
            "expires_at",
        )


class AppType(DjangoObjectType):
    sync_enabled = graphene.Boolean()

    class Meta:
        model = App
        fields = (
            "id",
            "name",
            "identity_key",
            "wrapped_key_share",
            "created_at",
            "app_token",
            "app_seed",
            "app_version",
        )

    def resolve_sync_enabled(self, info):
        app_envs = Environment.objects.filter(app=self).values_list("id")
        return ServerEnvironmentKey.objects.filter(environment_id__in=app_envs).exists()


class EnvironmentType(DjangoObjectType):
    folder_count = graphene.Int()
    secret_count = graphene.Int()

    class Meta:
        model = Environment
        fields = (
            "id",
            "name",
            "app",
            "env_type",
            "identity_key",
            "wrapped_seed",
            "wrapped_salt",
            "created_at",
            "updated_at",
        )

    def resolve_folder_count(self, info):
        return SecretFolder.objects.filter(environment=self).count()

    def resolve_secret_count(self, info):
        return Secret.objects.filter(environment=self, deleted_at=None).count()

    def resolve_wrapped_seed(self, info):
        org_member = OrganisationMember.objects.get(
            user=info.context.user, organisation=self.app.organisation, deleted_at=None
        )
        user_env_key = EnvironmentKey.objects.get(
            environment=self, user=org_member, deleted_at=None
        )

        return user_env_key.wrapped_seed

    def resolve_wrapped_salt(self, info):
        org_member = OrganisationMember.objects.get(
            user=info.context.user, organisation=self.app.organisation, deleted_at=None
        )
        user_env_key = EnvironmentKey.objects.get(
            environment=self, user=org_member, deleted_at=None
        )

        return user_env_key.wrapped_salt


class EnvironmentKeyType(DjangoObjectType):
    class Meta:
        model = EnvironmentKey
        fields = (
            "id",
            "identity_key",
            "wrapped_seed",
            "wrapped_salt",
            "created_at",
            "updated_at",
            "environment",
        )


class ServerEnvironmentKeyType(DjangoObjectType):
    class Meta:
        model = EnvironmentKey
        fields = (
            "id",
            "identity_key",
            "wrapped_seed",
            "wrapped_salt",
            "created_at",
            "updated_at",
            "environment",
        )


class EnvironmentTokenType(DjangoObjectType):
    class Meta:
        model = EnvironmentToken
        fields = (
            "id",
            "name",
            "identity_key",
            "token",
            "wrapped_key_share",
            "created_at",
            "updated_at",
        )


class ProviderType(graphene.ObjectType):
    id = graphene.String(required=True)
    name = graphene.String(required=True)
    expected_credentials = graphene.List(
        graphene.NonNull(graphene.String), required=True
    )
    optional_credentials = graphene.List(
        graphene.NonNull(graphene.String), required=True
    )
    auth_scheme = graphene.String()


class ServiceType(ObjectType):
    id = graphene.String()
    name = graphene.String()
    resource_type = graphene.String()
    provider = graphene.Field(ProviderType)


class ProviderCredentialsType(DjangoObjectType):
    sync_count = graphene.Int()
    provider = graphene.Field(ProviderType)

    class Meta:
        model = ProviderCredentials
        fields = (
            "id",
            "name",
            "provider",
            "credentials",
            "created_at",
            "updated_at",
            "sync_count",
        )

    def resolve_sync_count(self, info):
        return EnvironmentSync.objects.filter(
            authentication_id=self.id, deleted_at=None
        ).count()

    def resolve_provider(self, info):
        return Providers.get_provider_config(self.provider)

    def resolve_credentials(self, info):
        return get_credentials(self.id)


class EnvironmentSyncEventType(DjangoObjectType):
    class Meta:
        model = EnvironmentSyncEvent
        fields = ("id", "env_sync", "status", "created_at", "completed_at", "meta")


class EnvironmentSyncType(DjangoObjectType):
    service_info = graphene.Field(ServiceType)
    history = graphene.List(NonNull(EnvironmentSyncEventType), required=True)

    class Meta:
        model = EnvironmentSync
        fields = (
            "id",
            "environment",
            "path",
            "service_info",
            "options",
            "is_active",
            "created_at",
            "last_sync",
            "status",
            "authentication",
            "history",
        )

    def resolve_service_info(self, info):
        service_config = ServiceConfig.get_service_config(self.service.lower())
        return service_config

    def resolve_history(self, info):
        return EnvironmentSyncEvent.objects.filter(env_sync=self).order_by(
            "-created_at"
        )


class UserTokenType(DjangoObjectType):
    class Meta:
        model = UserToken
        fields = (
            "id",
            "name",
            "identity_key",
            "token",
            "wrapped_key_share",
            "created_at",
            "updated_at",
            "expires_at",
        )


class ServiceTokenType(DjangoObjectType):
    class Meta:
        model = ServiceToken
        fields = (
            "id",
            "keys",
            "identity_key",
            "token",
            "wrapped_key_share",
            "name",
            "created_by",
            "created_at",
            "updated_at",
            "expires_at",
        )


class SecretFolderType(DjangoObjectType):
    folder_count = graphene.Int()
    secret_count = graphene.Int()

    class Meta:
        model = SecretFolder
        fields = (
            "id",
            "environment",
            "path",
            "name",
            "created_at",
            "updated_at",
        )

    def resolve_folder_count(self, info):
        return SecretFolder.objects.filter(folder=self).count()

    def resolve_secret_count(self, info):
        return Secret.objects.filter(folder=self).count()


class SecretTagType(DjangoObjectType):
    class Meta:
        model = SecretTag
        fields = ("id", "name", "color")


class SecretEventType(DjangoObjectType):
    class Meta:
        model = SecretEvent
        fields = (
            "id",
            "secret",
            "key",
            "value",
            "version",
            "tags",
            "comment",
            "event_type",
            "timestamp",
            "user",
            "service_token",
            "ip_address",
            "user_agent",
            "environment",
            "path",
        )


class PersonalSecretType(DjangoObjectType):
    class Meta:
        model = PersonalSecret
        fields = (
            "id",
            "secret",
            "user",
            "value",
            "is_active",
            "created_at",
            "updated_at",
        )


class SecretType(DjangoObjectType):
    history = graphene.List(SecretEventType)
    override = graphene.Field(PersonalSecretType)

    class Meta:
        model = Secret
        fields = (
            "id",
            "key",
            "value",
            "folder",
            "path",
            "version",
            "tags",
            "comment",
            "created_at",
            "updated_at",
            "history",
            "override",
        )
        # interfaces = (relay.Node, )

    def resolve_history(self, info):
        return SecretEvent.objects.filter(
            secret_id=self.id, event_type__in=[SecretEvent.CREATE, SecretEvent.UPDATE]
        ).order_by("timestamp")

    def resolve_override(self, info):
        if info.context.user:
            org = self.environment.app.organisation
            org_member = OrganisationMember.objects.get(
                organisation=org, user=info.context.user, deleted_at=None
            )

            try:
                override = PersonalSecret.objects.get(secret=self, user=org_member)

                if override is not None:
                    return override
            except:
                return None


class KMSLogType(ObjectType):
    class Meta:
        model = KMSLog
        fields = (
            "id",
            "app_id",
            "timestamp",
            "phase_node",
            "event_type",
            "ip_address",
            "ph_size",
            "edge_location",
            "country",
            "city",
            "latitude",
            "longitude",
        )
        interfaces = (relay.Node,)

    id = graphene.ID(required=True)
    timestamp = graphene.BigInt()
    app_id = graphene.String()
    phase_node = graphene.String()
    event_type = graphene.String()
    ip_address = graphene.String()
    ph_size = graphene.Int()
    asn = graphene.Int()
    isp = graphene.String()
    edge_location = graphene.String()
    country = graphene.String()
    city = graphene.String()
    latitude = graphene.Float()
    longitude = graphene.Float()


class ChartDataPointType(graphene.ObjectType):
    index = graphene.Int()
    date = graphene.BigInt()
    data = graphene.Int()


class TimeRange(Enum):
    HOUR = "hour"
    DAY = "day"
    WEEK = "week"
    MONTH = "month"
    YEAR = "year"
    ALL_TIME = "allTime"


class LogsResponseType(ObjectType):
    kms = graphene.List(KMSLogType)
    secrets = graphene.List(SecretEventType)


class OrganisationPlanType(ObjectType):
    name = graphene.String()
    max_users = graphene.Int()
    max_apps = graphene.Int()
    max_envs_per_app = graphene.Int()
