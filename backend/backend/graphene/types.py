import graphene
from enum import Enum
from graphene import ObjectType, relay
from graphene_django import DjangoObjectType
from api.models import CustomUser, Environment, EnvironmentKey, EnvironmentToken, Organisation, App, OrganisationMember, OrganisationMemberInvite, Secret, SecretEvent, SecretFolder, SecretTag, ServiceToken, UserToken
from logs.dynamodb_models import KMSLog
from allauth.socialaccount.models import SocialAccount


class OrganisationType(DjangoObjectType):
    class Meta:
        model = Organisation
        fields = ('id', 'name', 'identity_key', 'created_at', 'plan')


class OrganisationMemberType(DjangoObjectType):
    email = graphene.String()
    username = graphene.String()
    full_name = graphene.String()
    avatar_url = graphene.String()

    class Meta:
        model = OrganisationMember
        fields = ('id', 'email', 'username', 'full_name', 'avatar_url', 'role',
                  'identity_key', 'wrapped_keyring', 'created_at', 'updated_at')

    def resolve_email(self, info):
        return self.user.email

    def resolve_username(self, info):
        return self.user.username

    def resolve_full_name(self, info):
        social_acc = self.user.socialaccount_set.first()
        if social_acc:
            return social_acc.extra_data.get('name')
        return None

    def resolve_avatar_url(self, info):
        social_acc = self.user.socialaccount_set.first()
        if social_acc:
            if social_acc.provider == 'google':
                return social_acc.extra_data.get('picture')
            return social_acc.extra_data.get('avatar_url')
        return None


class OrganisationMemberInviteType(DjangoObjectType):
    class Meta:
        model = OrganisationMemberInvite
        fields = ('id', 'invited_by', 'invitee_email', 'valid', 'organisation', 'apps', 'role',
                  'created_at', 'updated_at', 'expires_at')


class AppType(DjangoObjectType):
    class Meta:
        model = App
        fields = ('id', 'name', 'identity_key',
                  'wrapped_key_share', 'created_at', 'app_token', 'app_seed', 'app_version')


class EnvironmentType(DjangoObjectType):
    class Meta:
        model = Environment
        fields = ('id', 'name', 'env_type', 'identity_key',
                  'wrapped_seed', 'wrapped_salt', 'created_at', 'updated_at')


class EnvironmentKeyType(DjangoObjectType):
    class Meta:
        model = EnvironmentKey
        fields = ('id', 'identity_key', 'wrapped_seed',
                  'wrapped_salt', 'created_at', 'updated_at', 'environment')


class EnvironmentTokenType(DjangoObjectType):
    class Meta:
        model = EnvironmentToken
        fields = ('id', 'name', 'identity_key', 'token',
                  'wrapped_key_share', 'created_at', 'updated_at')


class UserTokenType(DjangoObjectType):
    class Meta:
        model = UserToken
        fields = ('id', 'name', 'identity_key', 'token',
                  'wrapped_key_share', 'created_at', 'updated_at', 'expires_at')


class ServiceTokenType(DjangoObjectType):
    class Meta:
        model = ServiceToken
        fields = ('id', 'keys', 'identity_key',
                  'token', 'wrapped_key_share', 'name', 'created_by', 'created_at', 'updated_at', 'expires_at')


class SecretFolderType(DjangoObjectType):
    class Meta:
        model = SecretFolder
        fields = ('id', 'environment_id', 'parent_folder_id',
                  'name', 'created_at', 'updated_at')


class SecretTagType(DjangoObjectType):
    class Meta:
        model = SecretTag
        fields = ('id', 'name', 'color')


class SecretEventType(DjangoObjectType):
    class Meta:
        model = SecretEvent
        fields = ('id', 'secret', 'key', 'value',
                  'version', 'tags', 'comment', 'event_type', 'timestamp', 'user')


class SecretType(DjangoObjectType):

    history = graphene.List(SecretEventType)

    class Meta:
        model = Secret
        fields = ('id', 'key', 'value', 'folder', 'version', 'tags',
                  'comment', 'created_at', 'updated_at', 'history')
        # interfaces = (relay.Node, )

    def resolve_history(self, info):
        return SecretEvent.objects.filter(secret_id=self.id).order_by('version')


class KMSLogType(ObjectType):
    class Meta:
        model = KMSLog
        fields = ('id', 'app_id', 'timestamp', 'phase_node',
                  'event_type', 'ip_address', 'ph_size', 'edge_location', 'country', 'city', 'latitude', 'longitude')
        interfaces = (relay.Node, )

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
    HOUR = 'hour'
    DAY = 'day'
    WEEK = 'week'
    MONTH = 'month'
    YEAR = 'year'
    ALL_TIME = 'allTime'
