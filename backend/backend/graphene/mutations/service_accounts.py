import graphene
from django.db import transaction
from graphql import GraphQLError
from api.models import (
    Organisation,
    OrganisationMember,
    Role,
    ServiceAccount,
    ServiceAccountHandler,
    ServiceAccountToken,
    Identity,
)
from api.utils.access.permissions import (
    role_has_global_access,
    user_has_permission,
    user_is_org_member,
)
from api.utils.audit_logging import log_audit_event, get_actor_info_from_graphql
from api.utils.rest import get_resolver_request_meta
from backend.graphene.types import ServiceAccountTokenType, ServiceAccountType
from datetime import datetime
from django.conf import settings


class ServiceAccountHandlerInput(graphene.InputObjectType):
    service_account_id = graphene.ID(required=False)
    member_id = graphene.ID(required=False)
    wrapped_keyring = graphene.String(required=True)
    wrapped_recovery = graphene.String(required=True)


class CreateServiceAccountMutation(graphene.Mutation):
    class Arguments:
        name = graphene.String()
        organisation_id = graphene.ID()
        role_id = graphene.ID()
        handlers = graphene.List(ServiceAccountHandlerInput)
        identity_key = graphene.String()
        server_wrapped_keyring = graphene.String(required=False)
        server_wrapped_recovery = graphene.String(required=False)

    service_account = graphene.Field(ServiceAccountType)

    @classmethod
    def mutate(
        cls,
        root,
        info,
        name,
        organisation_id,
        role_id,
        handlers,
        identity_key,
        server_wrapped_keyring=None,
        server_wrapped_recovery=None,
    ):
        user = info.context.user
        org = Organisation.objects.get(id=organisation_id)

        if not user_has_permission(user, "create", "ServiceAccounts", org):
            raise GraphQLError(
                "You don't have the permissions required to create Service Accounts in this organisation"
            )

        if handlers is None or len(handlers) == 0:
            raise GraphQLError("At least one service account handler must be provided")

        role = Role.objects.get(id=role_id, organisation=org)

        if role_has_global_access(role):
            raise GraphQLError(
                f"Service Accounts cannot be assigned the '{role.name}' role."
            )

        with transaction.atomic():
            service_account = ServiceAccount.objects.create(
                name=name,
                organisation=org,
                role=role,
                identity_key=identity_key,
                server_wrapped_keyring=server_wrapped_keyring,
                server_wrapped_recovery=server_wrapped_recovery,
            )

            for handler in handlers:
                ServiceAccountHandler.objects.create(
                    service_account=service_account,
                    user_id=handler.member_id,
                    wrapped_keyring=handler.wrapped_keyring,
                    wrapped_recovery=handler.wrapped_recovery,
                )

        if settings.APP_HOST == "cloud":
            from ee.billing.stripe import update_stripe_subscription_seats

            update_stripe_subscription_seats(org)

        actor_type, actor_id, actor_metadata = get_actor_info_from_graphql(info)
        ip_address, user_agent = get_resolver_request_meta(info.context)
        log_audit_event(
            organisation=org,
            event_type="C",
            resource_type="sa",
            resource_id=service_account.id,
            actor_type=actor_type,
            actor_id=actor_id,
            actor_metadata=actor_metadata,
            resource_metadata={"name": name},
            description=f"Created service account '{name}'",
            ip_address=ip_address,
            user_agent=user_agent,
        )

        return CreateServiceAccountMutation(service_account=service_account)


class EnableServiceAccountServerSideKeyManagementMutation(graphene.Mutation):
    class Arguments:
        service_account_id = graphene.ID()
        server_wrapped_keyring = graphene.String()
        server_wrapped_recovery = graphene.String()

    service_account = graphene.Field(ServiceAccountType)

    @classmethod
    def mutate(
        cls,
        root,
        info,
        service_account_id,
        server_wrapped_keyring,
        server_wrapped_recovery,
    ):
        user = info.context.user
        service_account = ServiceAccount.objects.get(id=service_account_id)

        if not user_has_permission(
            user, "update", "ServiceAccounts", service_account.organisation
        ):
            raise GraphQLError(
                "You don't have the permissions required to update Service Accounts in this organisation"
            )

        service_account.server_wrapped_keyring = server_wrapped_keyring
        service_account.server_wrapped_recovery = server_wrapped_recovery
        service_account.save()

        return EnableServiceAccountServerSideKeyManagementMutation(
            service_account=service_account
        )


class EnableServiceAccountClientSideKeyManagementMutation(graphene.Mutation):
    class Arguments:
        service_account_id = graphene.ID()

    service_account = graphene.Field(ServiceAccountType)

    @classmethod
    def mutate(cls, root, info, service_account_id):
        user = info.context.user
        service_account = ServiceAccount.objects.get(id=service_account_id)

        if not user_has_permission(
            user, "update", "ServiceAccounts", service_account.organisation
        ):
            raise GraphQLError(
                "You don't have the permissions required to update Service Accounts in this organisation"
            )

        # Delete server-wrapped keys to disable server-side key management
        service_account.server_wrapped_keyring = None
        service_account.server_wrapped_recovery = None
        service_account.save()

        return EnableServiceAccountClientSideKeyManagementMutation(
            service_account=service_account
        )


class UpdateServiceAccountMutation(graphene.Mutation):
    class Arguments:
        service_account_id = graphene.ID()
        name = graphene.String()
        role_id = graphene.ID()
        identity_ids = graphene.List(graphene.NonNull(graphene.ID), required=False)

    service_account = graphene.Field(ServiceAccountType)

    @classmethod
    def mutate(cls, root, info, service_account_id, name, role_id, identity_ids=None):
        user = info.context.user
        service_account = ServiceAccount.objects.get(id=service_account_id)

        if not user_has_permission(
            user, "update", "ServiceAccounts", service_account.organisation
        ):
            raise GraphQLError(
                "You don't have the permissions required to update Service Accounts in this organisation"
            )

        role = Role.objects.get(id=role_id, organisation=service_account.organisation)

        if role_has_global_access(role):
            raise GraphQLError(
                f"Service Accounts cannot be assigned the '{role.name}' role."
            )
        service_account.name = name
        service_account.role = role
        if identity_ids is not None:
            identities = Identity.objects.filter(
                id__in=identity_ids,
                organisation=service_account.organisation,
                deleted_at=None,
            )
            service_account.identities.set(identities)
        service_account.save()

        return UpdateServiceAccountMutation(service_account=service_account)


class UpdateServiceAccountHandlersMutation(graphene.Mutation):
    class Arguments:
        organisation_id = graphene.ID()
        handlers = graphene.List(ServiceAccountHandlerInput)

    ok = graphene.Boolean()

    @classmethod
    def mutate(cls, root, info, organisation_id, handlers):
        user = info.context.user
        org = Organisation.objects.get(id=organisation_id)

        if not user_is_org_member(user.userId, organisation_id):
            raise GraphQLError(
                "You are not a member of this organisation and cannot perform this operation"
            )

        ServiceAccountHandler.objects.filter(service_account__organisation=org).delete()

        for handler in handlers:
            service_account = ServiceAccount.objects.get(id=handler.service_account_id)

            if not ServiceAccountHandler.objects.filter(
                service_account=service_account, user_id=handler.member_id
            ).exists():
                ServiceAccountHandler.objects.create(
                    service_account=service_account,
                    user_id=handler.member_id,
                    wrapped_keyring=handler.wrapped_keyring,
                    wrapped_recovery=handler.wrapped_recovery,
                )

        return UpdateServiceAccountHandlersMutation(ok=True)


class DeleteServiceAccountMutation(graphene.Mutation):
    class Arguments:
        service_account_id = graphene.ID()

    ok = graphene.Boolean()

    @classmethod
    def mutate(cls, root, info, service_account_id):
        user = info.context.user
        service_account = ServiceAccount.objects.get(id=service_account_id)

        if not user_has_permission(
            user, "delete", "ServiceAccounts", service_account.organisation
        ):
            raise GraphQLError(
                "You don't have the permissions required to delete Service Accounts in this organisation"
            )

        sa_name = service_account.name
        sa_id = service_account.id
        sa_org = service_account.organisation

        service_account.delete()

        if settings.APP_HOST == "cloud":
            from ee.billing.stripe import update_stripe_subscription_seats

            update_stripe_subscription_seats(sa_org)

        actor_type, actor_id, actor_metadata = get_actor_info_from_graphql(info)
        ip_address, user_agent = get_resolver_request_meta(info.context)
        log_audit_event(
            organisation=sa_org,
            event_type="D",
            resource_type="sa",
            resource_id=sa_id,
            actor_type=actor_type,
            actor_id=actor_id,
            actor_metadata=actor_metadata,
            resource_metadata={"name": sa_name},
            description=f"Deleted service account '{sa_name}'",
            ip_address=ip_address,
            user_agent=user_agent,
        )

        return DeleteServiceAccountMutation(ok=True)


class CreateServiceAccountTokenMutation(graphene.Mutation):
    class Arguments:
        service_account_id = graphene.ID()
        name = graphene.String(required=True)
        identity_key = graphene.String(required=True)
        token = graphene.String(required=True)
        wrapped_key_share = graphene.String(required=True)
        expiry = graphene.BigInt(required=False)

    token = graphene.Field(ServiceAccountTokenType)

    @classmethod
    def mutate(
        cls,
        root,
        info,
        service_account_id,
        name,
        identity_key,
        token,
        wrapped_key_share,
        expiry,
    ):
        user = info.context.user
        service_account = ServiceAccount.objects.get(id=service_account_id)
        org_member = OrganisationMember.objects.get(
            user=user, organisation=service_account.organisation, deleted_at=None
        )

        if not user_has_permission(
            user, "create", "ServiceAccountTokens", service_account.organisation
        ):
            raise GraphQLError(
                "You don't have the permissions required to create Service Tokens in this organisation"
            )

        if expiry is not None:
            expires_at = datetime.fromtimestamp(expiry / 1000)
        else:
            expires_at = None

        token = ServiceAccountToken.objects.create(
            service_account=service_account,
            name=name,
            identity_key=identity_key,
            token=token,
            wrapped_key_share=wrapped_key_share,
            created_by=org_member,
            expires_at=expires_at,
        )

        actor_type, actor_id, actor_metadata = get_actor_info_from_graphql(info)
        ip_address, user_agent = get_resolver_request_meta(info.context)
        log_audit_event(
            organisation=service_account.organisation,
            event_type="C",
            resource_type="sa_token",
            resource_id=token.id,
            actor_type=actor_type,
            actor_id=actor_id,
            actor_metadata=actor_metadata,
            resource_metadata={"name": name, "service_account": service_account.name, "service_account_id": str(service_account.id)},
            description=f"Created service account token '{name}' for '{service_account.name}'",
            ip_address=ip_address,
            user_agent=user_agent,
        )

        return CreateServiceAccountTokenMutation(token=token)


class DeleteServiceAccountTokenMutation(graphene.Mutation):
    class Arguments:
        token_id = graphene.ID()

    ok = graphene.Boolean()

    @classmethod
    def mutate(cls, root, info, token_id):
        user = info.context.user
        token = ServiceAccountToken.objects.get(id=token_id)

        if not user_has_permission(
            user, "delete", "ServiceAccountTokens", token.service_account.organisation
        ):
            raise GraphQLError(
                "You don't have the permissions required to delete Service Tokens in this organisation"
            )

        token_name = token.name
        token_id = token.id
        token_org = token.service_account.organisation
        sa_name = token.service_account.name
        sa_id = str(token.service_account.id)

        token.delete()

        actor_type, actor_id, actor_metadata = get_actor_info_from_graphql(info)
        ip_address, user_agent = get_resolver_request_meta(info.context)
        log_audit_event(
            organisation=token_org,
            event_type="D",
            resource_type="sa_token",
            resource_id=token_id,
            actor_type=actor_type,
            actor_id=actor_id,
            actor_metadata=actor_metadata,
            resource_metadata={"name": token_name, "service_account": sa_name, "service_account_id": sa_id},
            description=f"Deleted service account token '{token_name}' from '{sa_name}'",
            ip_address=ip_address,
            user_agent=user_agent,
        )

        return DeleteServiceAccountTokenMutation(ok=True)
