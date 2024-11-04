import graphene
from graphql import GraphQLError
from api.models import (
    Organisation,
    OrganisationMember,
    Role,
    ServiceAccount,
    ServiceAccountHandler,
    ServiceAccountToken,
)
from api.utils.access.permissions import user_has_permission, user_is_org_member
from backend.graphene.types import ServiceAccountTokenType, ServiceAccountType
from datetime import datetime


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

        service_account = ServiceAccount.objects.create(
            name=name,
            organisation=org,
            role=Role.objects.get(id=role_id),
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

        return CreateServiceAccountMutation(service_account=service_account)


class EnableServiceAccountThirdPartyAuthMutation(graphene.Mutation):
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

        return EnableServiceAccountThirdPartyAuthMutation(
            service_account=service_account
        )


class UpdateServiceAccountMutation(graphene.Mutation):
    class Arguments:
        service_account_id = graphene.ID()
        name = graphene.String()
        role_id = graphene.ID()

    service_account = graphene.Field(ServiceAccountType)

    @classmethod
    def mutate(cls, root, info, service_account_id, name, role_id):
        user = info.context.user
        service_account = ServiceAccount.objects.get(id=service_account_id)

        if not user_has_permission(
            user, "update", "ServiceAccounts", service_account.organisation
        ):
            raise GraphQLError(
                "You don't have the permissions required to update Service Accounts in this organisation"
            )

        role = Role.objects.get(id=role_id)
        service_account.name = name
        service_account.role = role
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

        for account in org.service_accounts.all():
            [handler.delete() for handler in account.handlers.all()]

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

        service_account.delete()

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

        token.delete()

        return DeleteServiceAccountTokenMutation(ok=True)
