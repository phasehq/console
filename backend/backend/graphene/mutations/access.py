from api.models import (
    NetworkAccessPolicy,
    Organisation,
    OrganisationMember,
    Role,
    ServiceAccount,
)
from api.utils.access.permissions import user_has_permission
from backend.graphene.types import NetworkAccessPolicyType, RoleType
import graphene
from graphql import GraphQLError


class CreateCustomRoleMutation(graphene.Mutation):
    class Arguments:
        name = graphene.String()
        color = graphene.String()
        description = graphene.String()
        permissions = graphene.JSONString()
        organisation_id = graphene.ID(required=True)

    role = graphene.Field(RoleType)

    @classmethod
    def mutate(cls, root, info, name, description, color, permissions, organisation_id):
        user = info.context.user
        org = Organisation.objects.get(id=organisation_id)

        if org.plan == Organisation.FREE_PLAN:
            raise GraphQLError(
                "Custom roles are not available on your organisation's plan"
            )

        if not user_has_permission(user, "create", "Roles", org):
            raise GraphQLError(
                "You don't have the permissions required to create Roles in this organisation"
            )

        if Role.objects.filter(organisation=org, name__iexact=name).exists():
            raise GraphQLError("A role with this name already exists!")

        role = Role.objects.create(
            organisation=org,
            name=name,
            description=description,
            color=color,
            permissions=permissions,
        )

        return CreateCustomRoleMutation(role=role)


class UpdateCustomRoleMutation(graphene.Mutation):
    class Arguments:
        id = graphene.ID(required=True)
        name = graphene.String()
        description = graphene.String()
        color = graphene.String()
        permissions = graphene.JSONString()

    role = graphene.Field(RoleType)

    @classmethod
    def mutate(cls, root, info, id, name, description, color, permissions):
        user = info.context.user
        role = Role.objects.get(id=id)

        if role.organisation.plan == Organisation.FREE_PLAN:
            raise GraphQLError(
                "Custom roles are not available on your organisation's plan"
            )

        if not user_has_permission(user, "update", "Roles", role.organisation):
            raise GraphQLError(
                "You don't have the permissions required to update Roles in this organisation"
            )

        if (
            Role.objects.filter(organisation=role.organisation, name__iexact=name)
            .exclude(id=id)
            .exists()
        ):
            raise GraphQLError("A role with this name already exists!")

        role.name = name
        role.description = description
        role.color = color
        role.permissions = permissions
        role.save()

        return UpdateCustomRoleMutation(role=role)


class DeleteCustomRoleMutation(graphene.Mutation):
    class Arguments:
        id = graphene.ID(required=True)

    ok = graphene.Boolean()

    @classmethod
    def mutate(cls, root, info, id):
        user = info.context.user
        role = Role.objects.get(id=id)

        if not user_has_permission(user, "delete", "Roles", role.organisation):
            raise GraphQLError(
                "You don't have the permissions required to delete Roles in this organisation"
            )
        if OrganisationMember.objects.filter(role=role, deleted_at=None).exists():
            raise GraphQLError(
                "Members of your organisation are currently assigned to this role, so it cannot be deleted."
            )

        if role.is_default:
            raise GraphQLError("This is a default role and cannot be deleted!")

        role.delete()

        return DeleteCustomRoleMutation(ok=True)


class CreateNetworkAccessPolicyMutation(graphene.Mutation):
    class Arguments:
        name = graphene.String()
        allowed_ips = graphene.String(required=True)
        is_global = graphene.Boolean(required=True)
        organisation_id = graphene.ID(required=True)

    network_access_policy = graphene.Field(NetworkAccessPolicyType)

    @classmethod
    def mutate(cls, root, info, name, allowed_ips, is_global, organisation_id):
        user = info.context.user
        org = Organisation.objects.get(id=organisation_id)

        if not user_has_permission(user, "create", "NetworkAccessPolicies", org):
            raise GraphQLError(
                "You don't have the permissions required to create Network Access Policies in this organisation"
            )
        org_member = OrganisationMember.objects.get(
            organisation=org, user=user, deleted_at=None
        )

        policy = NetworkAccessPolicy.objects.create(
            organisation=org,
            name=name,
            allowed_ips=allowed_ips,
            is_global=is_global,
            created_by=org_member,
            updated_by=org_member,
        )

        return CreateNetworkAccessPolicyMutation(network_access_policy=policy)


class UpdatePolicyInput(graphene.InputObjectType):
    id = graphene.ID(required=True)
    name = graphene.String()
    allowed_ips = graphene.String()
    is_global = graphene.Boolean()


class UpdateNetworkAccessPolicyMutation(graphene.Mutation):
    class Arguments:
        policy_inputs = graphene.List(UpdatePolicyInput)

    network_access_policy = graphene.Field(NetworkAccessPolicyType)

    @classmethod
    def mutate(cls, root, info, policy_inputs):
        user = info.context.user

        for policy_input in policy_inputs:
            policy = NetworkAccessPolicy.objects.get(id=policy_input.id)
            org_member = OrganisationMember.objects.get(
                organisation=policy.organisation, user=user, deleted_at=None
            )
            if not user_has_permission(
                user, "update", "NetworkAccessPolicies", policy.organisation
            ):
                raise GraphQLError(
                    "You don't have the permissions required to update Network Access Policies in this organisation"
                )

            if policy_input.name is not None:
                policy.name = policy_input.name

            if policy_input.allowed_ips is not None:
                policy.allowed_ips = policy_input.allowed_ips

            if policy_input.is_global is not None:
                policy.is_global = policy_input.is_global

            policy.updated_by = org_member

            policy.save()

        return UpdateNetworkAccessPolicyMutation(network_access_policy=policy)


class DeleteNetworkAccessPolicyMutation(graphene.Mutation):
    class Arguments:
        id = graphene.ID(required=True)

    ok = graphene.Boolean()

    @classmethod
    def mutate(cls, root, info, id):
        user = info.context.user
        policy = NetworkAccessPolicy.objects.get(id=id)

        if not user_has_permission(
            user, "delete", "NetworkAccessPolicies", policy.organisation
        ):
            raise GraphQLError(
                "You don't have the permissions required to delete Network Access Policies in this organisation"
            )

        policy.delete()

        return DeleteNetworkAccessPolicyMutation(ok=True)


class AccountTypeEnum(graphene.Enum):
    USER = "user"
    SERVICE = "service"


class AccountPolicyInput(graphene.InputObjectType):
    account_type = AccountTypeEnum(required=True)
    account_id = graphene.ID(required=True)
    policy_ids = graphene.List(graphene.ID)


class UpdateAccountNetworkAccessPolicies(graphene.Mutation):
    class Arguments:
        account_inputs = graphene.List(AccountPolicyInput)
        organisation_id = graphene.ID(required=True)

    ok = graphene.Boolean()

    @classmethod
    def mutate(cls, root, info, account_inputs, organisation_id):

        if not user_has_permission(
            info.context.user,
            "update",
            "Members",
            Organisation.objects.get(id=organisation_id),
        ):
            raise GraphQLError(
                "You don't have the permissions required to delete Network Access Policies in this organisation"
            )

        for account_input in account_inputs:
            account_filter = {
                "organisation_id": organisation_id,
                "id": account_input.account_id,
            }

            account = (
                OrganisationMember.objects.get(**account_filter)
                if account_input.account_type == AccountTypeEnum.USER
                else ServiceAccount.objects.get(**account_filter)
            )

            account.network_policies.set(
                NetworkAccessPolicy.objects.filter(id__in=account_input.policy_ids)
            )

        return UpdateAccountNetworkAccessPolicies(ok=True)
