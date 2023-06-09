from enum import Enum
import graphene
from django.utils import timezone
from graphene import ObjectType, relay
from graphene_django import DjangoObjectType
from graphql import GraphQLError
from api.models import CustomUser, Organisation, App
from backend.api.kv import delete, purge
from ee.feature_flags import allow_new_app
from logs.dynamodb_models import KMSLog
from logs.queries import get_app_log_count, get_app_log_count_range, get_app_logs
from datetime import datetime, timedelta
from django.conf import settings
from logs.models import KMSDBLog

CLOUD_HOSTED = settings.APP_HOST == 'cloud'

class OrganisationType(DjangoObjectType):
    class Meta:
        model = Organisation
        fields = ('id', 'name', 'identity_key', 'created_at', 'plan')


class AppType(DjangoObjectType):
    class Meta:
        model = App
        fields = ('id', 'name', 'identity_key',
                  'wrapped_key_share', 'created_at', 'app_token', 'app_seed', 'app_version')


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


class CreateOrganisationMutation(graphene.Mutation):
    class Arguments:
        id = graphene.ID(required=True)
        name = graphene.String(required=True)
        identity_key = graphene.String(required=True)

    organisation = graphene.Field(OrganisationType)

    @classmethod
    def mutate(cls, root, info, id, name, identity_key):
        if Organisation.objects.filter(name__iexact=name).exists():
            raise GraphQLError('This organisation name is not available.')
        if Organisation.objects.filter(owner__userId=info.context.user.userId).exists():
            raise GraphQLError(
                'Your current plan only supports one organisation.')

        owner = CustomUser.objects.get(userId=info.context.user.userId)
        org = Organisation.objects.create(
            id=id, name=name, identity_key=identity_key, owner=owner)

        return CreateOrganisationMutation(organisation=org)


class CreateAppMutation(graphene.Mutation):
    class Arguments:
        id = graphene.ID(required=True)
        organisation_id = graphene.ID(required=True)
        name = graphene.String(required=True)
        identity_key = graphene.String(required=True)
        app_token = graphene.String(required=True)
        app_seed = graphene.String(required=True)
        wrapped_key_share = graphene.String(required=True)
        app_version = graphene.Int(required=True)

    app = graphene.Field(AppType)

    @classmethod
    def mutate(cls, root, info, id, organisation_id, name, identity_key, app_token, app_seed, wrapped_key_share, app_version):
        owner = info.context.user
        org = Organisation.objects.get(id=organisation_id)
        if not Organisation.objects.filter(id=organisation_id, owner__userId=owner.userId).exists():
            raise GraphQLError("You don't have access to this organisation")

        if allow_new_app(org) == False:
            raise GraphQLError(
                'You have reached the App limit for your current plan. Please upgrade your account to add more.')

        if App.objects.filter(identity_key=identity_key).exists():
            raise GraphQLError("This app already exists")

        app = App.objects.create(id=id, organisation=org, name=name, identity_key=identity_key,
                                 app_token=app_token, app_seed=app_seed, wrapped_key_share=wrapped_key_share, app_version=app_version)

        return CreateAppMutation(app=app)


class RotateAppKeysMutation(graphene.Mutation):
    class Arguments:
        id = graphene.ID(required=True)
        app_token = graphene.String(required=True)
        wrapped_key_share = graphene.String(required=True)

    app = graphene.Field(AppType)

    @classmethod
    def mutate(cls, root, info, id, app_token, wrapped_key_share):
        owner = info.context.user
        org = Organisation.objects.filter(
            owner__userId=owner.userId).first()
        app = App.objects.get(id=id)
        if not app.organisation.id == org.id:
            raise GraphQLError("You don't have access to this app")

        if CLOUD_HOSTED:
            # delete current keys from cloudflare KV
            deleted = delete(app.app_token)

            # purge keys from cloudflare cache
            purged = purge(
                f"phApp:v{app.app_version}:{app.identity_key}/{app.app_token}")

            if not deleted or not purged:
                raise GraphQLError("Failed to delete app keys. Please try again.")

        app.app_token = app_token
        app.wrapped_key_share = wrapped_key_share
        app.save()

        return RotateAppKeysMutation(app=app)


class DeleteAppMutation(graphene.Mutation):
    class Arguments:
        id = graphene.ID(required=True)

    app = graphene.Field(AppType)

    @classmethod
    def mutate(cls, root, info, id):
        owner = info.context.user
        org = Organisation.objects.filter(
            owner__userId=owner.userId).first()
        app = App.objects.get(id=id)
        if not app.organisation.id == org.id:
            raise GraphQLError("You don't have access to this app")

        if CLOUD_HOSTED:
            # delete current keys from cloudflare KV
            deleted = delete(app.app_token)

            # purge keys from cloudflare cache
            purged = purge(
                f"phApp:v{app.app_version}:{app.identity_key}/{app.app_token}")

            if not deleted or not purged:
                raise GraphQLError("Failed to delete app keys. Please try again.")

        app.wrapped_key_share = ""
        app.is_deleted = True
        app.deleted_at = timezone.now()
        app.save()

        return DeleteAppMutation(app=app)


class Query(graphene.ObjectType):
    organisations = graphene.List(OrganisationType)
    apps = graphene.List(
        AppType, organisation_id=graphene.ID(), app_id=graphene.ID())
    logs = graphene.List(KMSLogType, app_id=graphene.ID(),

                         start=graphene.BigInt(), end=graphene.BigInt())
    logs_count = graphene.Int(app_id=graphene.ID(),
                              this_month=graphene.Boolean())

    app_activity_chart = graphene.List(ChartDataPointType, app_id=graphene.ID(
    ), period=graphene.Argument(graphene.Enum.from_enum(TimeRange)))

    def resolve_organisations(root, info):
        return Organisation.objects.filter(owner__userId=info.context.user.userId)

    def resolve_apps(root, info, organisation_id, app_id):
        filter = {
            'organisation_id': organisation_id,
            'is_deleted': False
        }
        if app_id != '':
            filter['id'] = app_id
        return App.objects.filter(**filter)

    def resolve_logs(root, info, app_id, start=0, end=0):
        owner = info.context.user
        org = Organisation.objects.filter(
            owner__userId=owner.userId).first()
        app = App.objects.get(id=app_id)
        if not app.organisation.id == org.id:
            raise GraphQLError("You don't have access to this app")
        if end == 0:
            end = datetime.now().timestamp() * 1000
        if CLOUD_HOSTED:
            return get_app_logs(f"phApp:v{app.app_version}:{app.identity_key}", start, end, 25)
        logs = KMSDBLog.objects.filter(app_id=f"phApp:v{app.app_version}:{app.identity_key}",timestamp__lte=end, timestamp__gte=start).order_by('-timestamp')[:25]
        return list(logs.values())

    def resolve_logs_count(root, info, app_id):
        owner = info.context.user
        org = Organisation.objects.filter(
            owner__userId=owner.userId).first()
        app = App.objects.get(id=app_id)
        if not app.organisation.id == org.id:
            raise GraphQLError("You don't have access to this app")
        if CLOUD_HOSTED:
            return get_app_log_count(f"phApp:v{app.app_version}:{app.identity_key}")
        return KMSDBLog.objects.filter(app_id=f"phApp:v{app.app_version}:{app.identity_key}").count()

    def resolve_app_activity_chart(root, info, app_id, period=TimeRange.DAY):
        """
        Converts app log activity for the chosen time period into time series data that can be used to draw a chart

        Args:
            app_id (string): app uuid
            period (TimeRange, optional): The desired time period. Defaults to 'day'.

        Raises:
            GraphQLError: If the requesting user does not have access to this app

        Returns:
            List[ChartDataPointType]: Time series decrypt count data
        """
        owner = info.context.user
        org = Organisation.objects.filter(
            owner__userId=owner.userId).first()
        app = App.objects.get(id=app_id)
        if not app.organisation.id == org.id:
            raise GraphQLError("You don't have access to this app")

        end_date = datetime.now()  # current time

        # default values for period='day'
        # 24 hours before current time
        start_date = end_date - timedelta(hours=24)
        time_iteration = timedelta(hours=1)

        match period:
            case TimeRange.HOUR:
                # 7 days before current time
                start_date = end_date - timedelta(hours=1)
                time_iteration = timedelta(minutes=5)
            case TimeRange.WEEK:
                # 7 days before current time
                start_date = end_date - timedelta(days=7)
                time_iteration = timedelta(days=1)
            case TimeRange.MONTH:
                # 30 days before current time
                start_date = end_date - timedelta(days=30)
                time_iteration = timedelta(days=1)
            case TimeRange.YEAR:
                # 365 days before current time
                start_date = end_date - timedelta(days=365)
                time_iteration = timedelta(days=5)
            case TimeRange.ALL_TIME:
                # 365 days before current time
                start_date = end_date - timedelta(days=365)
                time_iteration = timedelta(days=7)

        time_series_logs = []

        # initialize the iterators
        current_date = start_date
        index = 0

        # loop through each iteration in the period and calculate the number of decrypts per time_iteration
        while current_date <= end_date:
            # Get the start and end of the current measurement period as datetime objects
            start_of_measurement_period = current_date.replace(
                second=0, microsecond=0)
            if (current_date + time_iteration) > end_date:
                end_of_measurement_period = end_date
            else:
                end_of_measurement_period = start_of_measurement_period + time_iteration

            # Convert the start and end of the measurement period to unix timestamps
            start_unix = int(start_of_measurement_period.timestamp() * 1000)
            end_unix = int(end_of_measurement_period.timestamp() * 1000)

            # Get the count of decrypts in the measurement period
            if CLOUD_HOSTED:
                decrypts = get_app_log_count_range(
                    f"phApp:v{app.app_version}:{app.identity_key}", start_unix, end_unix)
            else:
                decrypts = KMSDBLog.objects.filter(app_id=f"phApp:v{app.app_version}:{app.identity_key}",timestamp__lte=end_unix, timestamp__gte=start_unix).count()

            time_series_logs.append(ChartDataPointType(
                index=str(index), date=end_unix, data=decrypts))

            # Increment current_date by one time iteration
            current_date += time_iteration
            index += 1

        return time_series_logs


class Mutation(graphene.ObjectType):
    create_organisation = CreateOrganisationMutation.Field()
    create_app = CreateAppMutation.Field()
    rotate_app_keys = RotateAppKeysMutation.Field()
    delete_app = DeleteAppMutation.Field()


schema = graphene.Schema(query=Query, mutation=Mutation)
