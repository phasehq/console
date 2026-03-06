from api.services import Providers, ServiceConfig
from api.utils.syncing.auth import get_credentials
from api.utils.access.permissions import (
    user_can_access_environment,
    user_has_permission,
)
from ee.integrations.secrets.dynamic.graphene.queries import resolve_dynamic_secrets
from ee.integrations.secrets.dynamic.graphene.types import DynamicSecretType
from backend.quotas import PLAN_CONFIG
import graphene
from enum import Enum
from graphene import ObjectType, relay, NonNull
from graphene_django import DjangoObjectType
from api.models import (
    ActivatedPhaseLicense,
    CustomUser,
    DynamicSecret,
    Environment,
    EnvironmentKey,
    EnvironmentSync,
    EnvironmentSyncEvent,
    EnvironmentToken,
    Lockbox,
    NetworkAccessPolicy,
    Organisation,
    App,
    OrganisationMember,
    OrganisationMemberInvite,
    PersonalSecret,
    ProviderCredentials,
    Role,
    Secret,
    SecretEvent,
    SecretFolder,
    SecretTag,
    ServiceAccount,
    ServiceAccountHandler,
    ServiceAccountToken,
    ServiceToken,
    UserToken,
    Identity,
)
from logs.dynamodb_models import KMSLog
from django.utils import timezone
from api.utils.access.roles import default_roles
from graphql import GraphQLError
from itertools import chain


class SeatsUsed(ObjectType):
    users = graphene.Int()
    service_accounts = graphene.Int()
    total = graphene.Int()


class OrganisationPlanType(ObjectType):
    name = graphene.String()
    max_users = graphene.Int()
    max_apps = graphene.Int()
    max_envs_per_app = graphene.Int()
    seat_limit = graphene.Int()
    seats_used = graphene.Field(SeatsUsed)
    app_count = graphene.Int()


class RoleType(DjangoObjectType):
    name = graphene.String()
    description = graphene.String()
    color = graphene.String()
    permissions = graphene.JSONString()
    is_default = graphene.Boolean()

    class Meta:
        model = Role
        fields = ("id", "name", "description")

    def resolve_permissions(self, info):
        if self.is_default:
            return default_roles.get(self.name, {})
        return self.permissions

    def resolve_description(self, info):
        if self.is_default:
            return default_roles.get(self.name, {})["meta"]["description"]
        return self.description


class OrganisationType(DjangoObjectType):
    role = graphene.Field(RoleType)
    member_id = graphene.ID()
    keyring = graphene.String()
    recovery = graphene.String()
    plan_detail = graphene.Field(OrganisationPlanType)

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
            "pricing_version",
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

    def resolve_plan_detail(self, info):

        plan = PLAN_CONFIG[self.plan]

        plan["seats_used"] = {
            "users": (
                OrganisationMember.objects.filter(
                    organisation=self, deleted_at=None
                ).count()
                + OrganisationMemberInvite.objects.filter(
                    organisation=self, valid=True, expires_at__gte=timezone.now()
                ).count()
            ),
            "service_accounts": ServiceAccount.objects.filter(
                organisation=self, deleted_at=None
            ).count(),
        }

        plan["seats_used"]["total"] = (
            plan["seats_used"]["users"] + plan["seats_used"]["service_accounts"]
        )

        plan["app_count"] = App.objects.filter(
            organisation=self, deleted_at=None
        ).count()

        return plan


class OrganisationMemberType(DjangoObjectType):
    email = graphene.String()
    username = graphene.String()
    full_name = graphene.String()
    avatar_url = graphene.String()
    role = graphene.Field(RoleType)
    self = graphene.Boolean()
    last_login = graphene.DateTime()
    app_memberships = graphene.List(graphene.NonNull(lambda: AppMembershipType))
    tokens = graphene.List(graphene.NonNull(lambda: UserTokenType))
    network_policies = graphene.List(graphene.NonNull(lambda: NetworkAccessPolicyType))

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

    def resolve_last_login(self, info):
        return self.user.last_login

    def resolve_app_memberships(self, info):
        # Find all EnvironmentKeys for this user
        user_env_keys = EnvironmentKey.objects.filter(
            user=self, deleted_at=None
        ).select_related("environment__app")

        # Get unique app IDs the user has access to
        app_ids = set(key.environment.app.id for key in user_env_keys)
        apps = App.objects.filter(id__in=app_ids)

        # Create a dictionary to store accessible environments per app
        app_envs_map = {app_id: set() for app_id in app_ids}
        for key in user_env_keys:
            app_envs_map[key.environment.app.id].add(key.environment.id)

        filtered_apps = []
        for app in apps:
            # Fetch all environments for the current app
            all_app_environments = Environment.objects.filter(app=app).order_by("index")
            # Filter environments to only those the user has access to
            accessible_environment_ids = app_envs_map.get(app.id, set())
            app.filtered_environments = [
                env
                for env in all_app_environments
                if env.id in accessible_environment_ids
            ]
            filtered_apps.append(app)

        return filtered_apps

    def resolve_tokens(self, info):
        # Check using the new permission name
        can_view_tokens = user_has_permission(
            info.context.user, "read", "MemberPersonalAccessTokens", self.organisation
        )

        if not can_view_tokens and self.user != info.context.user:
            return []

        return UserToken.objects.filter(user=self, deleted_at=None).order_by(
            "-created_at"
        )

    def resolve_network_policies(self, info):
        global_policies = NetworkAccessPolicy.objects.filter(
            organisation=self.organisation, is_global=True
        )
        account_policies = self.network_policies.all()

        return list(chain(account_policies, global_policies))


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


class ServiceAccountHandlerType(DjangoObjectType):
    class Meta:
        model = ServiceAccountHandler
        fields = "__all__"


class ServiceAccountTokenType(DjangoObjectType):

    last_used = graphene.DateTime()

    class Meta:
        model = ServiceAccountToken
        fields = "__all__"

    def resolve_last_used(self, info):
        latest_event = (
            SecretEvent.objects.filter(service_account_token=self)
            .only("timestamp")
            .order_by("-timestamp")
            .first()
        )

        return latest_event.timestamp if latest_event else None


class MemberType(graphene.Enum):
    USER = "user"
    SERVICE = "service"


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


class IdentityProviderType(graphene.ObjectType):
    id = graphene.String(required=True)
    name = graphene.String(required=True)
    description = graphene.String(required=True)
    icon_id = graphene.String(required=True)
    supported = graphene.Boolean(required=True)


class ServiceType(ObjectType):
    id = graphene.String()
    name = graphene.String()
    resource_type = graphene.String()
    provider = graphene.Field(ProviderType)


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
        return (
            Secret.objects.filter(folder=self).count()
            + DynamicSecret.objects.filter(folder=self, deleted_at=None).count()
        )


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
            "service_account",
            "service_account_token",
            "ip_address",
            "user_agent",
            "environment",
            "path",
        )

    def resolve_user(self, info):
        # use the precomputed permission flag; return None if not allowed
        if getattr(info.context, "can_view_members", False):
            return self.user
        return None

    def resolve_service_account(self, info):
        if self.service_account_token_id and getattr(
            self, "service_account_token", None
        ):
            return self.service_account_token.service_account
        return self.service_account


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
            "environment",
        )
        # interfaces = (relay.Node, )

    def resolve_history(self, info):
        user = info.context.user

        # Compute can_view_members only once per request
        organisation = self.environment.app.organisation
        can_view_members = user_has_permission(
            user, "read", "Members", organisation, True
        ) or user_has_permission(user, "read", "Members", organisation, False)
        setattr(info.context, "can_view_members", can_view_members)

        qs = SecretEvent.objects.filter(
            secret_id=self.id,
            event_type__in=[SecretEvent.CREATE, SecretEvent.UPDATE],
        ).order_by("timestamp")

        return qs

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


class EnvironmentType(DjangoObjectType):
    folders = graphene.NonNull(graphene.List(SecretFolderType))
    secrets = graphene.NonNull(
        graphene.List(SecretType), path=graphene.String(required=False)
    )
    dynamic_secrets = graphene.NonNull(
        graphene.List(DynamicSecretType), path=graphene.String(required=False)
    )
    folder_count = graphene.Int()
    secret_count = graphene.Int()
    members = graphene.NonNull(graphene.List(OrganisationMemberType))
    syncs = graphene.NonNull(graphene.List(EnvironmentSyncType))
    wrapped_seed = graphene.String(required=False)
    wrapped_salt = graphene.String(required=False)

    class Meta:
        model = Environment
        fields = (
            "id",
            "name",
            "app",
            "env_type",
            "index",
            "identity_key",
            "wrapped_seed",
            "wrapped_salt",
            "created_at",
            "updated_at",
        )

    def resolve_secrets(self, info, path=None):

        org = self.app.organisation
        if not user_has_permission(
            info.context.user, "read", "Secrets", org, True
        ) or not user_has_permission(
            info.context.user, "read", "Environments", org, True
        ):
            raise GraphQLError("You don't have access to read secrets")

        if not user_can_access_environment(info.context.user.userId, self.id):
            raise GraphQLError("You don't have access to this environment")

        filter = {"environment": self, "deleted_at": None}

        if path is not None:
            filter["path"] = path

        return Secret.objects.filter(**filter).order_by("-created_at")

    def resolve_dynamic_secrets(self, info, path=None):
        # Reuse the existing resolver from queries.py
        return resolve_dynamic_secrets(root=None, info=info, env_id=self.id, path=path)

    def resolve_folders(self, info, path=None):
        if not user_can_access_environment(info.context.user.userId, self.id):
            raise GraphQLError("You don't have access to this environment")

        filter = {"environment": self}

        if path:
            filter["path"] = path

        return SecretFolder.objects.filter(**filter).order_by("created_at")

    def resolve_folder_count(self, info):
        return SecretFolder.objects.filter(environment=self).count()

    def resolve_secret_count(self, info):
        return (
            Secret.objects.filter(environment=self, deleted_at=None).count()
            + DynamicSecret.objects.filter(environment=self, deleted_at=None).count()
        )

    def resolve_wrapped_seed(self, info):
        org_member = OrganisationMember.objects.get(
            user=info.context.user, organisation=self.app.organisation, deleted_at=None
        )

        try:
            user_env_key = EnvironmentKey.objects.get(
                environment=self, user=org_member, deleted_at=None
            )
            return user_env_key.wrapped_seed
        except EnvironmentKey.DoesNotExist:
            return None

    def resolve_wrapped_salt(self, info):
        org_member = OrganisationMember.objects.get(
            user=info.context.user, organisation=self.app.organisation, deleted_at=None
        )

        try:
            user_env_key = EnvironmentKey.objects.get(
                environment=self, user=org_member, deleted_at=None
            )
            return user_env_key.wrapped_salt
        except EnvironmentKey.DoesNotExist:
            return None

    def resolve_members(self, info):
        return [
            env_key.user
            for env_key in EnvironmentKey.objects.filter(
                environment=self, deleted_at=None, user__deleted_at=None
            )
        ]

    def resolve_syncs(self, info):
        return EnvironmentSync.objects.filter(environment=self)


class AppType(DjangoObjectType):
    environments = graphene.NonNull(graphene.List(EnvironmentType))
    members = graphene.NonNull(graphene.List(OrganisationMemberType))
    service_accounts = graphene.NonNull(graphene.List(lambda: ServiceAccountType))

    class Meta:
        model = App
        fields = (
            "id",
            "name",
            "description",
            "identity_key",
            "wrapped_key_share",
            "created_at",
            "updated_at",
            "app_token",
            "app_seed",
            "app_version",
            "sse_enabled",
            "service_accounts",
        )

    def resolve_environments(self, info):

        if hasattr(self, "filtered_environments"):
            return self.filtered_environments

        org_member = OrganisationMember.objects.get(
            organisation=self.organisation,
            user_id=info.context.user.userId,
            deleted_at=None,
        )

        app_environments = Environment.objects.filter(app=self).order_by("index")

        return [
            app_env
            for app_env in app_environments
            if EnvironmentKey.objects.filter(
                user=org_member, environment_id=app_env.id
            ).exists()
        ]

    def resolve_updated_at(self, info):
        app_updated_at = self.updated_at

        # Get the latest updated_at from environments
        environments = self.environments.all()
        latest_environment_updated_at = None
        if environments.exists():
            latest_environment_updated_at = max(env.updated_at for env in environments)

        # Return the most recent updated_at between app and its environments
        return (
            max(app_updated_at, latest_environment_updated_at)
            if latest_environment_updated_at
            else app_updated_at
        )

    def resolve_members(self, info):
        return self.members.filter(deleted_at=None)

    def resolve_service_accounts(self, info):
        return self.service_accounts.filter(deleted_at=None)


class AppMembershipType(DjangoObjectType):
    environments = graphene.NonNull(graphene.List(EnvironmentType))

    class Meta:
        model = App
        fields = (
            "id",
            "name",
            "sse_enabled",
        )

    def resolve_environments(self, info):
        # Only return filtered environments if set
        return getattr(self, "filtered_environments", [])


class ServiceAccountType(DjangoObjectType):

    server_side_key_management_enabled = graphene.Boolean()
    handlers = graphene.List(ServiceAccountHandlerType)
    tokens = graphene.List(ServiceAccountTokenType)
    app_memberships = graphene.List(graphene.NonNull(AppMembershipType))
    network_policies = graphene.List(graphene.NonNull(lambda: NetworkAccessPolicyType))
    identities = graphene.List(graphene.NonNull(lambda: IdentityType))

    class Meta:
        model = ServiceAccount
        fields = (
            "id",
            "name",
            "role",
            "identity_key",
            "created_at",
            "updated_at",
            "deleted_at",
        )

    def resolve_server_side_key_management_enabled(self, info):
        return (
            self.server_wrapped_keyring is not None
            and self.server_wrapped_recovery is not None
        )

    def resolve_handlers(self, info):
        return ServiceAccountHandler.objects.filter(service_account=self)

    def resolve_tokens(self, info):
        return ServiceAccountToken.objects.filter(service_account=self, deleted_at=None)

    def resolve_app_memberships(self, info):
        # Fetch all apps that this service account is related to
        apps = self.apps.all()

        filtered_apps = []
        for app in apps:
            # Get environments for the app
            app_environments = Environment.objects.filter(app=app).order_by("index")

            # Check which environments the service account has access to
            accessible_environments = [
                env
                for env in app_environments
                if EnvironmentKey.objects.filter(
                    service_account=self, environment=env
                ).exists()
            ]

            # Manually override the 'environments' field for this app instance
            app.filtered_environments = accessible_environments

            # Add this app to the filtered list
            filtered_apps.append(app)

        return filtered_apps

    def resolve_network_policies(self, info):
        global_policies = NetworkAccessPolicy.objects.filter(
            organisation=self.organisation, is_global=True
        )
        account_policies = self.network_policies.all()

        return list(chain(account_policies, global_policies))

    def resolve_identities(self, info):
        return self.identities.filter(deleted_at=None)


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
        if not user_has_permission(
            info.context.user, "read", "IntegrationCredentials", self.organisation
        ):
            return None
        return get_credentials(self.id)


class UserTokenType(DjangoObjectType):
    created_by = graphene.Field(lambda: OrganisationMemberType)

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
            "created_by",
        )

    def resolve_created_by(self, info):
        # Check using the new permission name
        can_view_creator = user_has_permission(
            info.context.user,
            "read",
            "MemberPersonalAccessTokens",
            self.user.organisation,
        )

        if not can_view_creator and self.user.user != info.context.user:
            return None

        return self.user


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


class SecretTagType(DjangoObjectType):
    class Meta:
        model = SecretTag
        fields = ("id", "name", "color")


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


class KMSLogsResponseType(ObjectType):
    logs = graphene.List(KMSLogType)
    count = graphene.Int()


class SecretLogsResponseType(ObjectType):
    logs = graphene.List(SecretEventType)
    count = graphene.Int()


class LockboxType(DjangoObjectType):
    class Meta:
        model = Lockbox
        fields = "__all__"


class PlanTier(graphene.Enum):
    PRO_PLAN = "PRO"
    ENTERPRISE_PLAN = "ENTERPRISE"


class PhaseLicenseType(graphene.ObjectType):

    id = graphene.String()
    customer_name = graphene.String()
    organisation_name = graphene.String()
    plan = graphene.Field(PlanTier)
    seats = graphene.Int()
    tokens = graphene.Int()
    issued_at = graphene.Date()
    expires_at = graphene.Date()
    environment = graphene.String()
    license_type = graphene.String()
    signature_date = graphene.String()
    issuing_authority = graphene.String()
    is_activated = graphene.Boolean()
    organisation_owner = graphene.Field(OrganisationMemberType)

    def resolve_is_activated(self, info):
        return ActivatedPhaseLicense.objects.filter(id=self.id).exists()

    def resolve_organisation_owner(self, info):
        if ActivatedPhaseLicense.objects.filter(id=self.id).exists():
            activated_license = ActivatedPhaseLicense.objects.get(id=self.id)

            owner_role = Role.objects.get(
                organisation=activated_license.organisation, name__iexact="owner"
            )

            return OrganisationMember.objects.get(
                organisation=activated_license.organisation,
                role=owner_role,
            )


class ActivatedPhaseLicenseType(DjangoObjectType):
    class Meta:
        model = ActivatedPhaseLicense
        fields = "__all__"


class NetworkAccessPolicyType(DjangoObjectType):
    organisation_members = graphene.List(
        graphene.NonNull(lambda: OrganisationMemberType)
    )
    service_accounts = graphene.List(graphene.NonNull(lambda: ServiceAccountType))

    class Meta:
        model = NetworkAccessPolicy
        fields = "__all__"


class AWSValidationResultType(graphene.ObjectType):
    valid = graphene.Boolean(required=True)
    message = graphene.String(required=True)
    method = graphene.String()
    error = graphene.String()
    assumed_role_arn = graphene.String()


class AwsIamConfigType(graphene.ObjectType):
    trusted_principals = graphene.List(graphene.String)
    signature_ttl_seconds = graphene.Int()
    sts_endpoint = graphene.String()


class IdentityConfigUnion(graphene.Union):
    class Meta:
        types = (AwsIamConfigType,)


class IdentityType(DjangoObjectType):
    config = graphene.Field(IdentityConfigUnion)

    class Meta:
        model = Identity
        fields = "__all__"

    def resolve_config(self, info):
        """Map provider-specific config into typed objects"""
        provider = (self.provider or "").lower()
        cfg = self.config or {}

        if provider == "aws_iam":
            try:
                ttl = int(cfg.get("signatureTtlSeconds", 60))
            except Exception:
                ttl = 60
            return AwsIamConfigType(
                trusted_principals=self.get_trusted_list(),
                signature_ttl_seconds=ttl,
                sts_endpoint=cfg.get("stsEndpoint"),
            )

        return None
