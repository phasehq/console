from api.utils.syncing.cloudflare.pages import CloudFlarePagesType
from api.utils.syncing.cloudflare.workers import CloudflareWorkerType
from api.utils.syncing.aws.secrets_manager import AWSSecretType
from api.utils.syncing.github.actions import GitHubRepoType, GitHubOrgType
from api.utils.syncing.gitlab.main import GitLabGroupType, GitLabProjectType
from api.utils.syncing.railway.main import RailwayProjectType
from api.utils.syncing.render.main import RenderEnvGroupType, RenderServiceType
from api.utils.database import get_approximate_count
from ee.integrations.secrets.dynamic.graphene.mutations import (
    DeleteDynamicSecretMutation,
    LeaseDynamicSecret,
    RenewLeaseMutation,
    RevokeLeaseMutation,
)
from ee.integrations.secrets.dynamic.graphene.types import (
    DynamicSecretProviderType,
    DynamicSecretType,
)
from ee.integrations.secrets.dynamic.aws.graphene.mutations import (
    CreateAWSDynamicSecretMutation,
    UpdateAWSDynamicSecretMutation,
)
from ee.integrations.secrets.dynamic.graphene.queries import (
    resolve_dynamic_secret_providers,
    resolve_dynamic_secrets,
)
from backend.graphene.mutations.service_accounts import (
    CreateServiceAccountMutation,
    CreateServiceAccountTokenMutation,
    DeleteServiceAccountMutation,
    DeleteServiceAccountTokenMutation,
    EnableServiceAccountClientSideKeyManagementMutation,
    EnableServiceAccountServerSideKeyManagementMutation,
    UpdateServiceAccountHandlersMutation,
    UpdateServiceAccountMutation,
)
from api.utils.syncing.vercel.main import VercelTeamProjectsType
from .graphene.queries.syncing import (
    resolve_vercel_projects,
)
from .graphene.mutations.syncing import CreateRenderSync, CreateVercelSync
from .graphene.mutations.access import (
    CreateCustomRoleMutation,
    CreateNetworkAccessPolicyMutation,
    DeleteCustomRoleMutation,
    DeleteNetworkAccessPolicyMutation,
    CreateIdentityMutation,
    UpdateIdentityMutation,
    DeleteIdentityMutation,
    UpdateAccountNetworkAccessPolicies,
    UpdateCustomRoleMutation,
    UpdateNetworkAccessPolicyMutation,
)
from ee.billing.graphene.queries.stripe import (
    StripeCheckoutDetails,
    StripeSubscriptionDetails,
    StripePlanEstimate,
    resolve_stripe_checkout_details,
    resolve_stripe_subscription_details,
    resolve_stripe_customer_portal_url,
    resolve_estimate_stripe_subscription,
)
from ee.billing.graphene.types import BillingPeriodEnum, PlanTypeEnum
from ee.billing.graphene.mutations.stripe import (
    CancelSubscriptionMutation,
    CreateSubscriptionCheckoutSession,
    CreateSetupIntentMutation,
    DeletePaymentMethodMutation,
    ModifySubscriptionMutation,
    ResumeSubscriptionMutation,
    SetDefaultPaymentMethodMutation,
    MigratePricingMutation,
)
from .graphene.mutations.lockbox import CreateLockboxMutation
from .graphene.queries.syncing import (
    resolve_aws_secret_manager_secrets,
    resolve_gh_repos,
    resolve_gh_orgs,
    resolve_github_environments,
    resolve_gitlab_projects,
    resolve_gitlab_groups,
    resolve_server_public_key,
    resolve_providers,
    resolve_services,
    resolve_sse_enabled,
    resolve_saved_credentials,
    resolve_cloudflare_pages_projects,
    resolve_cloudflare_workers,
    resolve_syncs,
    resolve_env_syncs,
    resolve_test_vault_creds,
    resolve_test_nomad_creds,
    resolve_railway_projects,
    resolve_render_services,
    resolve_render_envgroups,
    resolve_validate_aws_assume_role_auth,
    resolve_validate_aws_assume_role_credentials,
)
from .graphene.queries.identity import (
    resolve_aws_sts_endpoints,
    resolve_identity_providers,
)
from .graphene.queries.access import (
    resolve_roles,
    resolve_organisation_global_access_users,
    resolve_network_access_policies,
    resolve_client_ip,
    resolve_identities,
)
from .graphene.queries.service_accounts import (
    resolve_service_accounts,
    resolve_service_account_handlers,
    resolve_app_service_accounts,
)
from .graphene.queries.quotas import resolve_organisation_plan
from .graphene.queries.license import resolve_license, resolve_organisation_license
from .graphene.mutations.environment import (
    BulkCreateSecretMutation,
    BulkDeleteSecretMutation,
    BulkEditSecretMutation,
    CreateEnvironmentKeyMutation,
    CreateEnvironmentMutation,
    CreateEnvironmentTokenMutation,
    CreatePersonalSecretMutation,
    CreateSecretFolderMutation,
    CreateSecretMutation,
    CreateSecretTagMutation,
    CreateServiceTokenMutation,
    CreateUserTokenMutation,
    DeleteEnvironmentMutation,
    DeletePersonalSecretMutation,
    DeleteSecretFolderMutation,
    DeleteSecretMutation,
    DeleteServiceTokenMutation,
    DeleteUserTokenMutation,
    EditSecretMutation,
    ReadSecretMutation,
    RenameEnvironmentMutation,
    SwapEnvironmentOrderMutation,
    UpdateEnvironmentOrderMutation,
    UpdateMemberEnvScopeMutation,
)
from .graphene.mutations.syncing import (
    CreateCloudflareWorkersSync,
    CreateAWSSecretsManagerSync,
    CreateCloudflarePagesSync,
    CreateGitHubActionsSync,
    CreateGitHubDependabotSync,
    CreateGitLabCISync,
    CreateNomadSync,
    CreateProviderCredentials,
    CreateRailwaySync,
    CreateVaultSync,
    DeleteProviderCredentials,
    DeleteSync,
    InitEnvSync,
    ToggleSyncActive,
    TriggerSync,
    UpdateProviderCredentials,
    UpdateSyncAuthentication,
)
from api.utils.access.permissions import (
    user_can_access_app,
    user_can_access_environment,
    user_has_permission,
    user_is_org_member,
)
from .graphene.mutations.app import (
    AddAppMemberMutation,
    BulkAddAppMembersMutation,
    CreateAppMutation,
    DeleteAppMutation,
    MemberType,
    RemoveAppMemberMutation,
    RotateAppKeysMutation,
    UpdateAppInfoMutation,
)
from .graphene.mutations.organisation import (
    BulkInviteOrganisationMembersMutation,
    CreateOrganisationMemberMutation,
    CreateOrganisationMutation,
    DeleteInviteMutation,
    DeleteOrganisationMemberMutation,
    TransferOrganisationOwnershipMutation,
    UpdateOrganisationMemberRole,
    UpdateUserWrappedSecretsMutation,
)
from .graphene.types import (
    ActivatedPhaseLicenseType,
    AppType,
    ChartDataPointType,
    EnvironmentKeyType,
    EnvironmentSyncType,
    EnvironmentTokenType,
    EnvironmentType,
    KMSLogsResponseType,
    NetworkAccessPolicyType,
    OrganisationMemberInviteType,
    OrganisationMemberType,
    OrganisationPlanType,
    OrganisationType,
    PhaseLicenseType,
    ProviderCredentialsType,
    ProviderType,
    IdentityProviderType,
    RoleType,
    SecretEventType,
    SecretFolderType,
    SecretTagType,
    SecretType,
    SecretLogsResponseType,
    ServiceAccountHandlerType,
    ServiceAccountType,
    ServiceTokenType,
    ServiceType,
    TimeRange,
    UserTokenType,
    AWSValidationResultType,
    IdentityType,
)
import graphene
from graphql import GraphQLError
from api.models import (
    Environment,
    EnvironmentKey,
    EnvironmentToken,
    Organisation,
    App,
    OrganisationMember,
    OrganisationMemberInvite,
    Role,
    Secret,
    SecretEvent,
    SecretFolder,
    SecretTag,
    ServiceAccount,
    ServiceToken,
    UserToken,
)
from logs.queries import get_app_log_count, get_app_log_count_range, get_app_logs
from datetime import datetime, timedelta
from django.conf import settings
from logs.models import KMSDBLog
from django.utils import timezone
from itertools import chain
import time
import logging
import heapq
from django.db.models import prefetch_related_objects

logger = logging.getLogger(__name__)

CLOUD_HOSTED = settings.APP_HOST == "cloud"


class Query(graphene.ObjectType):
    client_ip = graphene.String()

    organisations = graphene.List(OrganisationType)

    roles = graphene.List(RoleType, org_id=graphene.ID())
    network_access_policies = graphene.List(
        NetworkAccessPolicyType, organisation_id=graphene.ID()
    )
    identities = graphene.List(IdentityType, organisation_id=graphene.ID())

    organisation_name_available = graphene.Boolean(name=graphene.String())

    license = graphene.Field(PhaseLicenseType)

    organisation_license = graphene.Field(
        ActivatedPhaseLicenseType, organisation_id=graphene.ID()
    )

    organisation_plan = graphene.Field(
        OrganisationPlanType, organisation_id=graphene.ID()
    )
    organisation_members = graphene.List(
        OrganisationMemberType,
        organisation_id=graphene.ID(),
        member_id=graphene.ID(required=False),
        role=graphene.List(graphene.String, required=False),
    )
    organisation_global_access_users = graphene.List(
        OrganisationMemberType, organisation_id=graphene.ID()
    )
    organisation_invites = graphene.List(
        OrganisationMemberInviteType, org_id=graphene.ID()
    )
    validate_invite = graphene.Field(
        OrganisationMemberInviteType, invite_id=graphene.ID()
    )
    apps = graphene.List(
        AppType, organisation_id=graphene.ID(), app_id=graphene.ID(required=False)
    )

    kms_logs = graphene.Field(
        KMSLogsResponseType,
        app_id=graphene.ID(),
        start=graphene.BigInt(),
        end=graphene.BigInt(),
    )

    secret_logs = graphene.Field(
        SecretLogsResponseType,
        app_id=graphene.ID(),
        start=graphene.BigInt(),
        end=graphene.BigInt(),
        event_types=graphene.List(graphene.String),
        member_id=graphene.ID(),
        member_type=MemberType(),
        environment_id=graphene.ID(),
    )

    app_activity_chart = graphene.List(
        ChartDataPointType,
        app_id=graphene.ID(),
        period=graphene.Argument(graphene.Enum.from_enum(TimeRange)),
    )

    app_environments = graphene.List(
        EnvironmentType,
        app_id=graphene.ID(),
        environment_id=graphene.ID(required=False),
        member_id=graphene.ID(required=False),
        member_type=MemberType(),
    )
    app_users = graphene.List(OrganisationMemberType, app_id=graphene.ID())

    app_service_accounts = graphene.List(ServiceAccountType, app_id=graphene.ID())

    secrets = graphene.List(
        SecretType,
        env_id=graphene.ID(),
        path=graphene.String(required=False),
        id=graphene.ID(required=False),
    )

    folders = graphene.List(
        SecretFolderType, env_id=graphene.ID(), path=graphene.String(required=False)
    )
    secret_history = graphene.List(SecretEventType, secret_id=graphene.ID())
    secret_tags = graphene.List(SecretTagType, org_id=graphene.ID())
    environment_keys = graphene.List(
        EnvironmentKeyType,
        app_id=graphene.ID(required=False),
        environment_id=graphene.ID(required=False),
        member_id=graphene.ID(required=False),
    )
    environment_tokens = graphene.List(
        EnvironmentTokenType, environment_id=graphene.ID()
    )
    user_tokens = graphene.List(UserTokenType, organisation_id=graphene.ID())
    service_tokens = graphene.List(ServiceTokenType, app_id=graphene.ID())

    service_accounts = graphene.List(
        ServiceAccountType,
        org_id=graphene.ID(),
        service_account_id=graphene.ID(required=False),
    )

    service_account_handlers = graphene.List(
        OrganisationMemberType, org_id=graphene.ID()
    )

    server_public_key = graphene.String()

    sse_enabled = graphene.Boolean(app_id=graphene.ID())

    providers = graphene.List(ProviderType)

    services = graphene.List(ServiceType)
    aws_sts_endpoints = graphene.List(graphene.JSONString)
    identity_providers = graphene.List(IdentityProviderType)

    saved_credentials = graphene.List(ProviderCredentialsType, org_id=graphene.ID())

    syncs = graphene.List(
        EnvironmentSyncType,
        org_id=graphene.ID(required=False),
        app_id=graphene.ID(required=False),
        env_id=graphene.ID(required=False),
    )

    env_syncs = graphene.List(EnvironmentSyncType, env_id=graphene.ID())

    cloudflare_pages_projects = graphene.List(
        CloudFlarePagesType,
        credential_id=graphene.ID(),
    )

    cloudflare_workers = graphene.List(
        CloudflareWorkerType,
        credential_id=graphene.ID(),
    )

    aws_secrets = graphene.List(
        AWSSecretType,
        credential_id=graphene.ID(),
    )

    github_repos = graphene.List(
        GitHubRepoType,
        credential_id=graphene.ID(),
    )
    github_orgs = graphene.List(
        GitHubOrgType,
        credential_id=graphene.ID(),
    )
    github_environments = graphene.List(
        graphene.String,
        credential_id=graphene.ID(),
        owner=graphene.String(),
        repo_name=graphene.String(),
    )

    gitlab_projects = graphene.List(GitLabProjectType, credential_id=graphene.ID())
    gitlab_groups = graphene.List(GitLabGroupType, credential_id=graphene.ID())

    railway_projects = graphene.List(RailwayProjectType, credential_id=graphene.ID())

    vercel_projects = graphene.List(VercelTeamProjectsType, credential_id=graphene.ID())

    render_services = graphene.List(RenderServiceType, credential_id=graphene.ID())
    render_envgroups = graphene.List(RenderEnvGroupType, credential_id=graphene.ID())

    test_vercel_creds = graphene.Field(graphene.Boolean, credential_id=graphene.ID())

    test_vault_creds = graphene.Field(graphene.Boolean, credential_id=graphene.ID())

    test_nomad_creds = graphene.Field(graphene.Boolean, credential_id=graphene.ID())

    validate_aws_assume_role_auth = graphene.Field(AWSValidationResultType)

    validate_aws_assume_role_credentials = graphene.Field(
        AWSValidationResultType,
        role_arn=graphene.String(required=True),
        region=graphene.String(),
        external_id=graphene.String(),
    )

    stripe_checkout_details = graphene.Field(
        StripeCheckoutDetails, stripe_session_id=graphene.String(required=True)
    )

    stripe_subscription_details = graphene.Field(
        StripeSubscriptionDetails, organisation_id=graphene.ID()
    )

    stripe_customer_portal_url = graphene.String(
        organisation_id=graphene.ID(required=True)
    )

    estimate_stripe_subscription = graphene.Field(
        StripePlanEstimate,
        organisation_id=graphene.ID(required=True),
        plan_type=PlanTypeEnum(required=True),
        billing_period=BillingPeriodEnum(required=True),
        preview_v2=graphene.Boolean(default_value=False),
    )

    # Dynamic secrets
    dynamic_secret_providers = graphene.List(DynamicSecretProviderType)
    dynamic_secrets = graphene.List(
        DynamicSecretType,
        secret_id=graphene.ID(required=False),
        app_id=graphene.ID(required=False),
        env_id=graphene.ID(required=False),
        path=graphene.String(required=False),
        org_id=graphene.ID(),
    )

    # --------------------------------------------------------------------

    resolve_server_public_key = resolve_server_public_key

    resolve_client_ip = resolve_client_ip

    resolve_sse_enabled = resolve_sse_enabled

    resolve_providers = resolve_providers

    resolve_services = resolve_services

    resolve_saved_credentials = resolve_saved_credentials

    resolve_syncs = resolve_syncs

    resolve_env_syncs = resolve_env_syncs

    resolve_cloudflare_pages_projects = resolve_cloudflare_pages_projects

    resolve_cloudflare_workers = resolve_cloudflare_workers

    resolve_aws_secrets = resolve_aws_secret_manager_secrets

    resolve_github_repos = resolve_gh_repos
    resolve_github_orgs = resolve_gh_orgs
    resolve_github_environments = resolve_github_environments

    resolve_gitlab_projects = resolve_gitlab_projects
    resolve_gitlab_groups = resolve_gitlab_groups

    resolve_railway_projects = resolve_railway_projects

    resolve_vercel_projects = resolve_vercel_projects

    resolve_render_services = resolve_render_services
    resolve_render_envgroups = resolve_render_envgroups

    resolve_test_vault_creds = resolve_test_vault_creds

    resolve_test_nomad_creds = resolve_test_nomad_creds

    resolve_validate_aws_assume_role_auth = resolve_validate_aws_assume_role_auth

    resolve_validate_aws_assume_role_credentials = (
        resolve_validate_aws_assume_role_credentials
    )

    resolve_dynamic_secret_providers = resolve_dynamic_secret_providers
    resolve_dynamic_secrets = resolve_dynamic_secrets

    def resolve_organisations(root, info):
        memberships = OrganisationMember.objects.filter(
            user=info.context.user, deleted_at=None
        )

        return [membership.organisation for membership in memberships]

    resolve_roles = resolve_roles
    resolve_network_access_policies = resolve_network_access_policies

    # Identities
    resolve_identities = resolve_identities
    resolve_aws_sts_endpoints = resolve_aws_sts_endpoints
    resolve_identity_providers = resolve_identity_providers

    resolve_organisation_plan = resolve_organisation_plan

    def resolve_organisation_name_available(root, info, name):
        return not Organisation.objects.filter(name__iexact=name).exists()

    resolve_license = resolve_license
    resolve_organisation_license = resolve_organisation_license

    def resolve_organisation_members(
        root, info, organisation_id, role=None, member_id=None
    ):
        if not user_is_org_member(info.context.user.userId, organisation_id):
            raise GraphQLError("You don't have access to this organisation")

        filter = {"organisation_id": organisation_id, "deleted_at": None}

        if member_id is not None:
            filter["id"] = member_id

        if role is not None:
            roles = [user_role.lower() for user_role in role]
            filter["roles__in"] = roles

        return OrganisationMember.objects.filter(**filter)

    resolve_organisation_global_access_users = resolve_organisation_global_access_users

    def resolve_organisation_invites(root, info, org_id):
        if not user_is_org_member(info.context.user.userId, org_id):
            raise GraphQLError("You don't have access to this organisation")

        invites = OrganisationMemberInvite.objects.filter(
            organisation_id=org_id, valid=True
        )

        return invites

    def resolve_validate_invite(root, info, invite_id):
        try:
            invite = OrganisationMemberInvite.objects.get(id=invite_id, valid=True)
        except:
            raise GraphQLError("This invite is invalid")

        if invite.expires_at < timezone.now():
            raise GraphQLError("This invite has expired")

        if invite.invitee_email == info.context.user.email:
            return invite
        else:
            raise GraphQLError("This invite is for another user")

    def resolve_apps(root, info, organisation_id, app_id=None):
        org_member = OrganisationMember.objects.get(
            organisation_id=organisation_id,
            user_id=info.context.user.userId,
            deleted_at=None,
        )

        if not user_has_permission(
            info.context.user, "read", "Apps", org_member.organisation
        ):
            return []

        filter = {
            "organisation_id": organisation_id,
            "id__in": org_member.apps.all(),
            "is_deleted": False,
        }

        if app_id:
            filter["id"] = app_id
        return App.objects.filter(**filter)

    def resolve_app_environments(
        root, info, app_id, environment_id, member_id=None, member_type=MemberType.USER
    ):

        app = App.objects.get(id=app_id)

        if not user_has_permission(
            info.context.user, "read", "Environments", app.organisation, True
        ):
            return []

        if not user_can_access_app(info.context.user.userId, app_id):
            raise GraphQLError("You don't have access to this app")

        if member_id is not None:
            if member_type == MemberType.USER:
                org_member = OrganisationMember.objects.get(id=member_id)
            else:
                org_member = ServiceAccount.objects.get(id=member_id)
        else:
            org_member = OrganisationMember.objects.get(
                organisation=app.organisation,
                user_id=info.context.user.userId,
                deleted_at=None,
            )

        filter = {"app_id": app_id}

        if environment_id:
            filter["id"] = environment_id

        app_environments = Environment.objects.filter(**filter).order_by("index")

        if member_type == MemberType.USER:
            return [
                app_env
                for app_env in app_environments
                if EnvironmentKey.objects.filter(
                    user=org_member, environment_id=app_env.id
                ).exists()
            ]

        else:
            return [
                app_env
                for app_env in app_environments
                if EnvironmentKey.objects.filter(
                    service_account=org_member, environment_id=app_env.id
                ).exists()
            ]

    def resolve_app_users(root, info, app_id):
        app = App.objects.get(id=app_id)

        if not user_has_permission(
            info.context.user, "read", "Members", app.organisation, True
        ):
            raise GraphQLError("You don't have permission to read members of this App")

        if not user_can_access_app(info.context.user.userId, app_id):
            raise GraphQLError("You don't have access to this app")

        return app.members.filter(deleted_at=None)

    resolve_app_service_accounts = resolve_app_service_accounts

    def resolve_secrets(root, info, env_id, path=None, id=None):

        org = Environment.objects.get(id=env_id).app.organisation
        if not user_has_permission(
            info.context.user, "read", "Secrets", org, True
        ) or not user_has_permission(
            info.context.user, "read", "Environments", org, True
        ):
            raise GraphQLError("You don't have access to read secrets")

        if not user_can_access_environment(info.context.user.userId, env_id):
            raise GraphQLError("You don't have access to this environment")

        filter = {"environment_id": env_id, "deleted_at": None}

        if id:
            filter["id"] = id
        if path:
            filter["path"] = path

        return Secret.objects.filter(**filter).order_by("-created_at")

    def resolve_folders(root, info, env_id, path=None):
        if not user_can_access_environment(info.context.user.userId, env_id):
            raise GraphQLError("You don't have access to this environment")

        filter = {"environment_id": env_id}

        if path:
            filter["path"] = path

        return SecretFolder.objects.filter(**filter).order_by("created_at")

    def resolve_secret_history(root, info, secret_id):
        user = info.context.user

        secret = Secret.objects.get(id=secret_id)

        if not user_can_access_environment(user.userId, secret.environment.id):
            raise GraphQLError("You don't have access to this secret")

        # compute permission once and store it on the request context
        can_view_members = user_has_permission(
            user, "read", "Members", secret.environment.app.organisation, True
        ) or user_has_permission(
            user, "read", "Members", secret.environment.app.organisation, False
        )

        setattr(info.context, "can_view_members", can_view_members)

        # return a queryset with all necessary relations preloaded to avoid N+1s
        qs = SecretEvent.objects.filter(secret_id=secret_id).order_by("-timestamp")

        return qs

    def resolve_secret_tags(root, info, org_id):
        if not user_is_org_member(info.context.user.userId, org_id):
            raise GraphQLError("You don't have access to this Organisation")

        return SecretTag.objects.filter(organisation_id=org_id)

    def resolve_environment_keys(
        root, info, app_id=None, environment_id=None, member_id=None
    ):
        if app_id is None and environment_id is None:
            return None
        elif app_id is not None:
            app = App.objects.get(id=app_id)
        else:
            app = Environment.objects.get(id=environment_id).app

        if not user_can_access_app(info.context.user.userId, app.id):
            raise GraphQLError("You don't have access to this app")

        filter = {"environment__app": app, "deleted_at": None}

        if environment_id:
            filter["environment_id"] = environment_id

        if member_id is not None:
            org_member = OrganisationMember.objects.get(id=member_id, deleted_at=None)
        else:
            org_member = OrganisationMember.objects.get(
                user=info.context.user, organisation=app.organisation, deleted_at=None
            )

        filter["user"] = org_member

        return EnvironmentKey.objects.filter(**filter)

    def resolve_environment_tokens(root, info, environment_id):
        if not user_can_access_environment(info.context.user.userId, environment_id):
            raise GraphQLError("You don't have access to this secret")

        env = Environment.objects.get(id=environment_id)
        org_member = OrganisationMember.objects.get(
            user=info.context.user, organisation=env.app.organisation, deleted_at=None
        )
        return EnvironmentToken.objects.filter(environment=env, user=org_member)

    def resolve_user_tokens(root, info, organisation_id):
        if not user_is_org_member(info.context.user.userId, organisation_id):
            raise GraphQLError("You don't have access to this organisation")

        org_member = OrganisationMember.objects.get(
            user=info.context.user, organisation_id=organisation_id, deleted_at=None
        )
        return UserToken.objects.filter(user=org_member, deleted_at=None)

    def resolve_service_tokens(root, info, app_id):
        app = App.objects.get(id=app_id)
        if not user_has_permission(
            info.context.user, "read", "Tokens", app.organisation, True
        ):
            raise GraphQLError("You don't have permission to view Tokens in this App")

        return ServiceToken.objects.filter(app=app, deleted_at=None)

    resolve_service_accounts = resolve_service_accounts
    resolve_service_account_handlers = resolve_service_account_handlers

    def resolve_kms_logs(root, info, app_id, start=0, end=0):
        if not user_can_access_app(info.context.user.userId, app_id):
            raise GraphQLError("You don't have access to this app")

        app = App.objects.get(id=app_id)

        if end == 0:
            end = datetime.now().timestamp() * 1000

        if CLOUD_HOSTED:
            try:
                kms_logs = get_app_logs(
                    f"phApp:v{app.app_version}:{app.identity_key}", start, end, 25
                )
                count = get_app_log_count(
                    f"phApp:v{app.app_version}:{app.identity_key}"
                )
            except:
                print("Error fetching KMS logs")
                kms_logs = []
                count = 0

        else:
            kms_logs = list(
                KMSDBLog.objects.filter(
                    app_id=f"phApp:v{app.app_version}:{app.identity_key}",
                    timestamp__lte=end,
                    timestamp__gte=start,
                )
                .order_by("-timestamp")[:25]
                .values()
            )
            count = KMSDBLog.objects.filter(
                app_id=f"phApp:v{app.app_version}:{app.identity_key}"
            ).count()

        return SecretLogsResponseType(logs=kms_logs, count=count)

    def resolve_secret_logs(
        root,
        info,
        app_id,
        start=0,
        end=0,
        event_types=None,
        member_id=None,
        member_type=None,
        environment_id=None,
    ):
        PAGE_SIZE = 25
        start_time = time.time()
        user = info.context.user

        # Access checks
        if not user_can_access_app(user.userId, app_id):
            raise GraphQLError("You don't have access to this app")

        app = App.objects.get(id=app_id)

        # Time range defaults
        if end == 0:
            end = timezone.now().timestamp() * 1000
        if start == 0:
            start = (timezone.now() - timedelta(days=30)).timestamp() * 1000

        org_member = OrganisationMember.objects.get(
            user=user, organisation=app.organisation, deleted_at=None
        )

        env_keys_filter = {
            "environment__app": app,
            "user": org_member,
            "deleted_at": None,
        }
        if environment_id is not None:
            env_keys_filter["environment_id"] = environment_id

        env_ids = list(
            EnvironmentKey.objects.filter(**env_keys_filter)
            .values_list("environment_id", flat=True)
            .distinct()
        )

        # Nothing to fetch, early return
        if not env_ids:
            return SecretLogsResponseType(logs=[], count=0)

        start_dt = datetime.fromtimestamp(start / 1000, tz=timezone.utc)
        end_dt = datetime.fromtimestamp(end / 1000, tz=timezone.utc)

        # Permissions
        can_see_members = user_has_permission(
            user, "read", "Members", app.organisation, True
        ) or user_has_permission(user, "read", "Members", app.organisation, False)
        setattr(info.context, "can_view_members", can_see_members)

        if not user_has_permission(user, "read", "Logs", app.organisation, True):
            return SecretLogsResponseType(logs=[], count=0)

        # Base filter
        base_filter = {
            "timestamp__gte": start_dt,
            "timestamp__lte": end_dt,
        }
        if event_types:
            base_filter["event_type__in"] = event_types
        if member_id:
            if member_type == MemberType.USER or member_type is None:
                base_filter["user_id"] = member_id
            elif member_type == MemberType.SERVICE:
                base_filter["service_account_id"] = member_id

        if len(env_ids) == 1:
            # Single environment → simple fast path
            logs_qs = (
                SecretEvent.objects.filter(environment_id=env_ids[0], **base_filter)
                .order_by("-timestamp", "-id")
                .prefetch_related("tags")[:PAGE_SIZE]
            )

        else:
            # Multiple environments — always do per-env small scans + merge
            per_env_qs = [
                SecretEvent.objects.filter(
                    environment_id=env_id, **base_filter
                ).order_by("-timestamp", "-id")[:PAGE_SIZE]
                for env_id in env_ids
            ]
            combined = list(
                chain.from_iterable(per_env_qs)
            )  # Flatten all per-env querysets into one list of events (evaluate them)
            logs_qs = heapq.nlargest(
                PAGE_SIZE, combined, key=lambda e: e.timestamp
            )  # Efficiently select the newest 25 events overall
            prefetch_related_objects(logs_qs, "tags")

        # Approximate count (on combined filter)
        count_qs = SecretEvent.objects.filter(environment_id__in=env_ids, **base_filter)
        count = get_approximate_count(count_qs)

        # --- Timing log ---
        elapsed = (time.time() - start_time) * 1000
        logger.info(
            "resolve_secret_logs executed in %.2f ms (envs=%d, count≈%d)",
            elapsed,
            len(env_ids),
            count,
        )

        return SecretLogsResponseType(logs=logs_qs, count=count)

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
            start_of_measurement_period = current_date.replace(second=0, microsecond=0)
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
                    f"phApp:v{app.app_version}:{app.identity_key}", start_unix, end_unix
                )
            else:
                decrypts = KMSDBLog.objects.filter(
                    app_id=f"phApp:v{app.app_version}:{app.identity_key}",
                    timestamp__lte=end_unix,
                    timestamp__gte=start_unix,
                ).count()

            time_series_logs.append(
                ChartDataPointType(index=str(index), date=end_unix, data=decrypts)
            )

            # Increment current_date by one time iteration
            current_date += time_iteration
            index += 1

        return time_series_logs

    resolve_stripe_checkout_details = resolve_stripe_checkout_details
    resolve_stripe_subscription_details = resolve_stripe_subscription_details
    resolve_stripe_customer_portal_url = resolve_stripe_customer_portal_url
    resolve_estimate_stripe_subscription = resolve_estimate_stripe_subscription


class Mutation(graphene.ObjectType):
    create_organisation = CreateOrganisationMutation.Field()
    bulk_invite_organisation_members = BulkInviteOrganisationMembersMutation.Field()
    create_organisation_member = CreateOrganisationMemberMutation.Field()
    delete_organisation_member = DeleteOrganisationMemberMutation.Field()
    update_organisation_member_role = UpdateOrganisationMemberRole.Field()
    transfer_organisation_ownership = TransferOrganisationOwnershipMutation.Field()
    update_member_wrapped_secrets = UpdateUserWrappedSecretsMutation.Field()

    delete_invitation = DeleteInviteMutation.Field()

    create_app = CreateAppMutation.Field()
    rotate_app_keys = RotateAppKeysMutation.Field()
    delete_app = DeleteAppMutation.Field()
    update_app_info = UpdateAppInfoMutation.Field()
    add_app_member = AddAppMemberMutation.Field()
    bulk_add_app_members = BulkAddAppMembersMutation.Field()
    remove_app_member = RemoveAppMemberMutation.Field()
    update_member_environment_scope = UpdateMemberEnvScopeMutation.Field()

    create_environment = CreateEnvironmentMutation.Field()
    delete_environment = DeleteEnvironmentMutation.Field()
    rename_environment = RenameEnvironmentMutation.Field()
    swap_environment_order = SwapEnvironmentOrderMutation.Field()
    update_environment_order = UpdateEnvironmentOrderMutation.Field()
    create_environment_key = CreateEnvironmentKeyMutation.Field()
    create_environment_token = CreateEnvironmentTokenMutation.Field()

    # Access
    create_custom_role = CreateCustomRoleMutation.Field()
    update_custom_role = UpdateCustomRoleMutation.Field()
    delete_custom_role = DeleteCustomRoleMutation.Field()

    # IP allowlist
    create_network_access_policy = CreateNetworkAccessPolicyMutation.Field()
    update_network_access_policy = UpdateNetworkAccessPolicyMutation.Field()
    delete_network_access_policy = DeleteNetworkAccessPolicyMutation.Field()
    update_account_network_access_policies = UpdateAccountNetworkAccessPolicies.Field()

    # Identities
    create_identity = CreateIdentityMutation.Field()
    update_identity = UpdateIdentityMutation.Field()
    delete_identity = DeleteIdentityMutation.Field()

    # Service Accounts
    create_service_account = CreateServiceAccountMutation.Field()
    enable_service_account_server_side_key_management = (
        EnableServiceAccountServerSideKeyManagementMutation.Field()
    )
    enable_service_account_client_side_key_management = (
        EnableServiceAccountClientSideKeyManagementMutation.Field()
    )
    update_service_account_handlers = UpdateServiceAccountHandlersMutation.Field()
    update_service_account = UpdateServiceAccountMutation.Field()
    delete_service_account = DeleteServiceAccountMutation.Field()
    create_service_account_token = CreateServiceAccountTokenMutation.Field()
    delete_service_account_token = DeleteServiceAccountTokenMutation.Field()

    init_env_sync = InitEnvSync.Field()
    delete_env_sync = DeleteSync.Field()
    trigger_sync = TriggerSync.Field()
    toggle_sync_active = ToggleSyncActive.Field()
    update_sync_authentication = UpdateSyncAuthentication.Field()

    create_provider_credentials = CreateProviderCredentials.Field()
    update_provider_credentials = UpdateProviderCredentials.Field()
    delete_provider_credentials = DeleteProviderCredentials.Field()

    # Cloudflare Pages
    create_cloudflare_pages_sync = CreateCloudflarePagesSync.Field()

    # Cloudflare Workers
    create_cloudflare_workers_sync = CreateCloudflareWorkersSync.Field()

    # AWS
    create_aws_secret_sync = CreateAWSSecretsManagerSync.Field()

    # GitHub
    create_gh_actions_sync = CreateGitHubActionsSync.Field()
    create_gh_dependabot_sync = CreateGitHubDependabotSync.Field()

    # Vault
    create_vault_sync = CreateVaultSync.Field()

    # Nomad
    create_nomad_sync = CreateNomadSync.Field()

    # GitLab
    create_gitlab_ci_sync = CreateGitLabCISync.Field()

    # Railway
    create_railway_sync = CreateRailwaySync.Field()

    # Vercel
    create_vercel_sync = CreateVercelSync.Field()

    # Render
    create_render_sync = CreateRenderSync.Field()

    create_user_token = CreateUserTokenMutation.Field()
    delete_user_token = DeleteUserTokenMutation.Field()

    create_service_token = CreateServiceTokenMutation.Field()
    delete_service_token = DeleteServiceTokenMutation.Field()

    create_secret_folder = CreateSecretFolderMutation.Field()
    delete_secret_folder = DeleteSecretFolderMutation.Field()

    create_secret_tag = CreateSecretTagMutation.Field()

    create_secret = CreateSecretMutation.Field()
    edit_secret = EditSecretMutation.Field()
    delete_secret = DeleteSecretMutation.Field()
    read_secret = ReadSecretMutation.Field()

    create_secrets = BulkCreateSecretMutation.Field()
    edit_secrets = BulkEditSecretMutation.Field()
    delete_secrets = BulkDeleteSecretMutation.Field()

    create_override = CreatePersonalSecretMutation.Field()
    remove_override = DeletePersonalSecretMutation.Field()

    # Lockbox
    create_lockbox = CreateLockboxMutation.Field()

    # Billing
    create_subscription_checkout_session = CreateSubscriptionCheckoutSession.Field()
    delete_payment_method = DeletePaymentMethodMutation.Field()
    cancel_subscription = CancelSubscriptionMutation.Field()
    resume_subscription = ResumeSubscriptionMutation.Field()
    modify_subscription = ModifySubscriptionMutation.Field()
    create_setup_intent = CreateSetupIntentMutation.Field()
    set_default_payment_method = SetDefaultPaymentMethodMutation.Field()
    migrate_pricing = MigratePricingMutation.Field()

    # Dynamic Secrets
    create_aws_dynamic_secret = CreateAWSDynamicSecretMutation.Field()
    update_aws_dynamic_secret = UpdateAWSDynamicSecretMutation.Field()
    delete_dynamic_secret = DeleteDynamicSecretMutation.Field()
    create_dynamic_secret_lease = LeaseDynamicSecret.Field()
    renew_dynamic_secret_lease = RenewLeaseMutation.Field()
    revoke_dynamic_secret_lease = RevokeLeaseMutation.Field()


schema = graphene.Schema(query=Query, mutation=Mutation)
