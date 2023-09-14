from .graphene.mutations.environment import CreateEnvironmentKeyMutation, CreateEnvironmentMutation, CreateEnvironmentTokenMutation, CreateSecretFolderMutation, CreateSecretMutation, CreateSecretTagMutation, CreateServiceTokenMutation, CreateUserTokenMutation, DeleteSecretMutation, DeleteServiceTokenMutation, DeleteUserTokenMutation, EditSecretMutation
from .graphene.utils.permissions import user_can_access_app, user_can_access_environment, user_is_admin, user_is_org_member
from .graphene.mutations.app import CreateAppMutation, DeleteAppMutation, RotateAppKeysMutation
from .graphene.mutations.organisation import CreateOrganisationMutation, DeleteInviteMutation, InviteOrganisationMemberMutation
from .graphene.types import AppType, ChartDataPointType, EnvironmentKeyType, EnvironmentTokenType, EnvironmentType, KMSLogType, OrganisationMemberInviteType, OrganisationMemberType, OrganisationType, SecretEventType, SecretTagType, SecretType, ServiceTokenType, TimeRange, UserTokenType
import graphene
from graphql import GraphQLError
from api.models import Environment, EnvironmentKey, EnvironmentToken, Organisation, App, OrganisationMember, OrganisationMemberInvite, Secret, SecretEvent, SecretTag, ServiceToken, UserToken
from logs.queries import get_app_log_count, get_app_log_count_range, get_app_logs
from datetime import datetime, timedelta
from django.conf import settings
from logs.models import KMSDBLog
from itertools import chain
from django.utils import timezone

CLOUD_HOSTED = settings.APP_HOST == 'cloud'


class Query(graphene.ObjectType):
    organisations = graphene.List(OrganisationType)
    organisation_members = graphene.List(OrganisationMemberType, organisation_id=graphene.ID(
    ), user_id=graphene.ID(), role=graphene.List(graphene.String))
    organisation_admins_and_self = graphene.List(
        OrganisationMemberType, organisation_id=graphene.ID())
    organisation_invites = graphene.List(
        OrganisationMemberInviteType, org_id=graphene.ID())
    validate_invite = graphene.Field(
        OrganisationMemberInviteType, invite_id=graphene.ID())
    apps = graphene.List(
        AppType, organisation_id=graphene.ID(), app_id=graphene.ID())
    logs = graphene.List(KMSLogType, app_id=graphene.ID(),

                         start=graphene.BigInt(), end=graphene.BigInt())
    logs_count = graphene.Int(app_id=graphene.ID(),
                              this_month=graphene.Boolean())

    app_activity_chart = graphene.List(ChartDataPointType, app_id=graphene.ID(
    ), period=graphene.Argument(graphene.Enum.from_enum(TimeRange)))

    app_environments = graphene.List(EnvironmentType, app_id=graphene.ID(
    ), environment_id=graphene.ID(required=False))
    secrets = graphene.List(SecretType, env_id=graphene.ID())
    secret_history = graphene.List(SecretEventType, secret_id=graphene.ID())
    secret_tags = graphene.List(SecretTagType, org_id=graphene.ID())
    environment_keys = graphene.List(
        EnvironmentKeyType, environment_id=graphene.ID())
    environment_tokens = graphene.List(
        EnvironmentTokenType, environment_id=graphene.ID())
    user_tokens = graphene.List(UserTokenType, organisation_id=graphene.ID())
    service_tokens = graphene.List(ServiceTokenType, app_id=graphene.ID())

    def resolve_organisations(root, info):
        memberships = OrganisationMember.objects.filter(user=info.context.user)
        return [membership.organisation for membership in memberships]

    def resolve_organisation_members(root, info, organisation_id, role, user_id=None):
        if not user_is_org_member(info.context.user.userId, organisation_id):
            raise GraphQLError("You don't have access to this organisation")

        filter = {
            "organisation_id": organisation_id
        }

        if role:
            roles = [user_role.lower() for user_role in role]
            filter["roles__in"] = roles

        return OrganisationMember.objects.filter(**filter)

    def resolve_organisation_admins_and_self(root, info, organisation_id):
        if not user_is_org_member(info.context.user.userId, organisation_id):
            raise GraphQLError("You don't have access to this organisation")

        roles = ['owner', 'admin']

        members = OrganisationMember.objects.filter(
            organisation_id=organisation_id, role__in=roles)

        if not info.context.user.userId in [member.user_id for member in members]:
            self_member = OrganisationMember.objects.filter(
                organisation_id=organisation_id, user_id=info.context.user.userId)
            members = list(chain(members, self_member))

        return members

    def resolve_organisation_invites(root, info, org_id):
        if not user_is_org_member(info.context.user.userId, org_id):
            raise GraphQLError("You don't have access to this organisation")

        invites = OrganisationMemberInvite.objects.filter(
            organisation_id=org_id, valid=True)

        return invites

    def resolve_validate_invite(root, info, invite_id):
        try:
            invite = OrganisationMemberInvite.objects.get(
                id=invite_id, valid=True)
        except:
            raise GraphQLError("This invite is invalid")

        if invite.expires_at < timezone.now():
            raise GraphQLError("This invite has expired")

        if invite.invitee_email == info.context.user.email:
            return invite
        else:
            raise GraphQLError("This invite is for another user")

    def resolve_apps(root, info, organisation_id, app_id):
        filter = {
            'organisation_id': organisation_id,
            'is_deleted': False
        }
        if app_id != '':
            filter['id'] = app_id
        return App.objects.filter(**filter)

    def resolve_app_environments(root, info, app_id, environment_id):
        if not user_can_access_app(info.context.user.userId, app_id):
            raise GraphQLError("You don't have access to this app")

        app = App.objects.get(id=app_id)

        org_member = OrganisationMember.objects.get(
            organisation=app.organisation, user_id=info.context.user.userId)

        filter = {
            'app_id': app_id
        }

        if environment_id:
            filter['id'] = environment_id

        app_environments = Environment.objects.filter(**filter)
        return [app_env for app_env in app_environments if EnvironmentKey.objects.filter(user=org_member, environment_id=app_env.id).exists()]

    def resolve_secrets(root, info, env_id):
        if not user_can_access_environment(info.context.user.userId, env_id):
            raise GraphQLError("You don't have access to this environment")

        return Secret.objects.filter(environment_id=env_id, deleted_at=None).order_by('created_at')

    def resolve_secret_history(root, info, secret_id):
        secret = Secret.objects.get(id=secret_id)
        if not user_can_access_environment(info.context.user.userId, secret.environment.id):
            raise GraphQLError("You don't have access to this secret")
        return SecretEvent.objects.filter(secret_id=secret_id)

    def resolve_secret_tags(root, info, org_id):
        if not user_is_org_member(info.context.user.userId, org_id):
            raise GraphQLError("You don't have access to this Organisation")

        return SecretTag.objects.filter(organisation_id=org_id)

    def resolve_environment_keys(root, info, environment_id):
        if not user_can_access_environment(info.context.user.userId, environment_id):
            raise GraphQLError("You don't have access to this secret")

        env = Environment.objects.get(id=environment_id)
        org_member = OrganisationMember.objects.get(
            user=info.context.user, organisation=env.app.organisation)
        return EnvironmentKey.objects.filter(environment=env, user=org_member)

    def resolve_environment_tokens(root, info, environment_id):
        if not user_can_access_environment(info.context.user.userId, environment_id):
            raise GraphQLError("You don't have access to this secret")

        env = Environment.objects.get(id=environment_id)
        org_member = OrganisationMember.objects.get(
            user=info.context.user, organisation=env.app.organisation)
        return EnvironmentToken.objects.filter(environment=env, user=org_member)

    def resolve_user_tokens(root, info, organisation_id):
        if not user_is_org_member(info.context.user.userId, organisation_id):
            raise GraphQLError("You don't have access to this organisation")

        org_member = OrganisationMember.objects.get(
            user=info.context.user, organisation_id=organisation_id)
        return UserToken.objects.filter(user=org_member, deleted_at=None)

    def resolve_service_tokens(root, info, app_id):
        app = App.objects.get(id=app_id)
        if not user_is_org_member(info.context.user.userId, app.organisation.id):
            raise GraphQLError("You don't have access to this organisation")

        return ServiceToken.objects.filter(app=app, deleted_at=None)

    def resolve_logs(root, info, app_id, start=0, end=0):
        if not user_can_access_app(info.context.user.userId, app_id):
            raise GraphQLError("You don't have access to this app")

        app = App.objects.get(id=app_id)

        if end == 0:
            end = datetime.now().timestamp() * 1000

        if CLOUD_HOSTED:
            return get_app_logs(f"phApp:v{app.app_version}:{app.identity_key}", start, end, 25)

        logs = KMSDBLog.objects.filter(
            app_id=f"phApp:v{app.app_version}:{app.identity_key}", timestamp__lte=end, timestamp__gte=start).order_by('-timestamp')[:25]

        return list(logs.values())

    def resolve_logs_count(root, info, app_id):
        if not user_can_access_app(info.context.user.userId, app_id):
            raise GraphQLError("You don't have access to this app")

        app = App.objects.get(id=app_id)

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

        app = App.objects.get(id=app_id)
        if not user_can_access_app(info.context.user.userId, app_id):
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
                decrypts = KMSDBLog.objects.filter(
                    app_id=f"phApp:v{app.app_version}:{app.identity_key}", timestamp__lte=end_unix, timestamp__gte=start_unix).count()

            time_series_logs.append(ChartDataPointType(
                index=str(index), date=end_unix, data=decrypts))

            # Increment current_date by one time iteration
            current_date += time_iteration
            index += 1

        return time_series_logs


class Mutation(graphene.ObjectType):
    create_organisation = CreateOrganisationMutation.Field()
    invite_organisation_member = InviteOrganisationMemberMutation.Field()
    delete_invitation = DeleteInviteMutation.Field()
    create_app = CreateAppMutation.Field()
    rotate_app_keys = RotateAppKeysMutation.Field()
    delete_app = DeleteAppMutation.Field()
    create_environment = CreateEnvironmentMutation.Field()
    create_environment_key = CreateEnvironmentKeyMutation.Field()
    create_environment_token = CreateEnvironmentTokenMutation.Field()
    create_user_token = CreateUserTokenMutation.Field()
    delete_user_token = DeleteUserTokenMutation.Field()
    create_service_token = CreateServiceTokenMutation.Field()
    delete_service_token = DeleteServiceTokenMutation.Field()
    create_secret_folder = CreateSecretFolderMutation.Field()
    create_secret_tag = CreateSecretTagMutation.Field()
    create_secret = CreateSecretMutation.Field()
    edit_secret = EditSecretMutation.Field()
    delete_secret = DeleteSecretMutation.Field()


schema = graphene.Schema(query=Query, mutation=Mutation)
