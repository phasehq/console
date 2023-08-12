import graphene
from enum import Enum
from graphene import ObjectType, relay
from graphene_django import DjangoObjectType
from api.models import CustomUser, Environment, EnvironmentKey, EnvironmentToken, Organisation, App, OrganisationMember, Secret, SecretEvent, SecretFolder, SecretTag, UserToken
from logs.dynamodb_models import KMSLog


class OrganisationType(DjangoObjectType):
    class Meta:
        model = Organisation
        fields = ('id', 'name', 'identity_key', 'created_at', 'plan')


class OrganisationMemberType(DjangoObjectType):
    class Meta:
        model = OrganisationMember
        fields = ('id', 'role', 'identity_key',
                  'wrapped_keyring', 'created_at', 'updated_at')


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
                  'wrapped_salt', 'created_at', 'updated_at')


class EnvironmentTokenType(DjangoObjectType):
    class Meta:
        model = EnvironmentToken
        fields = ('id', 'name', 'identity_key', 'token',
                  'wrapped_key_share', 'created_at', 'updated_at')


class UserTokenType(DjangoObjectType):
    class Meta:
        model = UserToken
        fields = ('id', 'name', 'identity_key', 'token',
                  'wrapped_key_share', 'created_at', 'updated_at')


class SecretFolderType(DjangoObjectType):
    class Meta:
        model = SecretFolder
        fields = ('id', 'environment_id', 'parent_folder_id',
                  'name', 'created_at', 'updated_at')


class SecretTagType(DjangoObjectType):
    class Meta:
        model = SecretTag
        fields = ('id', 'name')


class SecretEventType(DjangoObjectType):
    class Meta:
        model = SecretEvent
        fields = ('id', 'secret', 'collection', 'key', 'value',
                  'version', 'tags', 'comment', 'event_type', 'timestamp')


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
