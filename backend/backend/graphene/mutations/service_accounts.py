from backend.graphene.mutations.environment import EnvironmentKeyInput
import graphene
from graphql import GraphQLError
from api.models import Organisation, Role, ServiceAccount, ServiceAccountHandler
from api.utils.access.permissions import user_has_permission
from backend.graphene.types import ServiceAccountType


class ServiceAccountHandlerInput(graphene.InputObjectType):
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


class UpdateServiceAccountHandlersMutation(graphene.Mutation):
    class Arguments:
        service_account_id = graphene.ID()
        handlers = graphene.List(ServiceAccountHandlerInput)

    service_account = graphene.Field(ServiceAccountType)

    @classmethod
    def mutate(cls, root, info, service_account_id, handlers):
        user = info.context.user
        service_account = ServiceAccount.objects.get(id=service_account_id)

        if not user_has_permission(
            user, "update", "ServiceAccounts", service_account.organisation
        ):
            raise GraphQLError(
                "You don't have the permissions required to update Service Accounts in this organisation"
            )

        for handler in handlers:
            if not ServiceAccountHandler.objects.filter(
                service_account=service_account, user_id=handler.member_id
            ).exists():
                ServiceAccountHandler.objects.create(
                    service_account=service_account,
                    user_id=handler.member_id,
                    wrapped_keyring=handler.wrapped_keyring,
                    wrapped_recovery=handler.wrapped_recovery,
                )

        return EnableServiceAccountThirdPartyAuthMutation(
            service_account=service_account
        )


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
