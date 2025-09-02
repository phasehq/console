from datetime import timedelta
from api.utils.access.permissions import (
    user_can_access_environment,
    user_has_permission,
    user_is_org_member,
)
from ee.integrations.secrets.dynamic.utils import renew_dynamic_secret_lease
from ee.integrations.secrets.dynamic.aws.graphene.types import (
    AwsCredentialsType,
)
from ee.integrations.secrets.dynamic.aws.utils import (
    create_aws_dynamic_secret_lease,
    revoke_aws_dynamic_secret_lease,
)
from ee.integrations.secrets.dynamic.graphene.types import DynamicSecretLeaseType
import graphene
from graphql import GraphQLError
from api.models import (
    DynamicSecret,
    DynamicSecretLease,
    OrganisationMember,
)
from django.utils import timezone
from django.core.exceptions import ValidationError
import logging

logger = logging.getLogger(__name__)


class DeleteDynamicSecretMutation(graphene.Mutation):
    class Arguments:
        secret_id = graphene.ID(required=True)

    ok = graphene.Boolean()

    @classmethod
    def mutate(
        cls,
        root,
        info,
        secret_id,
    ):
        user = info.context.user

        secret = DynamicSecret.objects.get(id=secret_id, deleted_at=None)
        org = secret.environment.app.organisation

        # --- permission checks ---
        if not user_has_permission(user, "delete", "Secrets", org, True):
            raise GraphQLError(
                "You don't have permission to delete secrets in this organisation"
            )

        secret.delete()

        return DeleteDynamicSecretMutation(ok=True)


class LeaseDynamicSecret(graphene.Mutation):
    class Arguments:
        secret_id = graphene.ID(required=True)
        name = graphene.String(required=False)
        ttl = graphene.Int()  # seconds

    lease = graphene.Field(DynamicSecretLeaseType)

    @classmethod
    def mutate(
        cls,
        root,
        info,
        secret_id,
        name=None,
        ttl=3600,
    ):
        user = info.context.user

        secret = DynamicSecret.objects.get(id=secret_id, deleted_at=None)
        org = secret.environment.app.organisation

        # --- permission checks ---
        if not user_is_org_member(user.userId, org.id):
            raise GraphQLError("You don't have access to this organisation")

        if not user_has_permission(user, "create", "Secrets", org, True):
            raise GraphQLError("You don't have permission to create Dynamic Secrets")

        if not user_can_access_environment(user.userId, secret.environment.id):
            raise GraphQLError("You don't have access to this environment")

        org_member = OrganisationMember.objects.get(organisation=org, user=user)

        # create lease
        lease_name = secret.name if name is None else name
        try:
            if secret.provider == "aws":
                lease, lease_data = create_aws_dynamic_secret_lease(
                    secret=secret,
                    lease_name=lease_name,
                    organisation_member=org_member,
                    ttl_seconds=ttl,
                )

                lease._credentials = AwsCredentialsType(
                    access_key_id=lease_data["access_key_id"],
                    secret_access_key=lease_data["secret_access_key"],
                    username=lease_data["username"],
                )

        except ValidationError as e:
            logger.error(f"Error creating dynamic secret lease: {e}")
            raise GraphQLError(e.message)

        return LeaseDynamicSecret(lease=lease)


class RenewLeaseMutation(graphene.Mutation):
    class Arguments:
        lease_id = graphene.ID(required=True)
        ttl = graphene.Int()  # seconds

    lease = graphene.Field(DynamicSecretLeaseType)

    @classmethod
    def mutate(
        cls,
        root,
        info,
        lease_id,
        ttl=3600,
    ):

        user = info.context.user

        lease = DynamicSecretLease.objects.get(id=lease_id)
        org = lease.secret.environment.app.organisation
        org_member = OrganisationMember.objects.get(organisation=org, user=user)

        # --- permission checks ---
        if not user_is_org_member(user.userId, org.id):
            raise GraphQLError("You don't have access to this organisation")

        if lease.organisation_member.id != org_member.id and not user_has_permission(
            info.context.user, "update", "DynamicSecretLeases", org, True
        ):
            raise GraphQLError(
                "You cannot renew this lease as it wasn't created by you"
            )

        if not user_can_access_environment(user.userId, lease.secret.environment.id):
            raise GraphQLError("You don't have access to this environment")

        lease = renew_dynamic_secret_lease(lease, ttl)

        return RenewLeaseMutation(lease=lease)


class RevokeLeaseMutation(graphene.Mutation):
    class Arguments:
        lease_id = graphene.ID(required=True)

    lease = graphene.Field(DynamicSecretLeaseType)

    @classmethod
    def mutate(
        cls,
        root,
        info,
        lease_id,
    ):

        user = info.context.user

        lease = DynamicSecretLease.objects.get(id=lease_id)
        org = lease.secret.environment.app.organisation
        org_member = OrganisationMember.objects.get(organisation=org, user=user)

        # --- permission checks ---
        if not user_is_org_member(user.userId, org.id):
            raise GraphQLError("You don't have access to this organisation")

        if lease.organisation_member.id != org_member.id and not user_has_permission(
            info.context.user, "delete", "DynamicSecretLeases", org, True
        ):
            raise GraphQLError(
                "You cannot revoke this lease as it wasn't created by you"
            )

        if not user_can_access_environment(user.userId, lease.secret.environment.id):
            raise GraphQLError("You don't have access to this environment")

        if lease.organisation_member.id != org_member.id:
            raise GraphQLError(
                "You cannot revoke this lease as it wasn't created by you"
            )

        else:
            if lease.secret.provider == "aws":
                revoke_aws_dynamic_secret_lease(lease.id, manual=True)

        return RevokeLeaseMutation(lease=lease)
