from api.models import (
    NetworkAccessPolicy,
    Organisation,
    OrganisationMember,
    Role,
    ServiceAccount,
)
from api.utils.access.permissions import user_has_permission
from backend.graphene.types import NetworkAccessPolicyType, RoleType, IdentityType
from api.models import Identity
from django.utils import timezone
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


class CreateIdentityMutation(graphene.Mutation):
    class Arguments:
        organisation_id = graphene.ID(required=True)
        provider = graphene.String(required=True)
        name = graphene.String(required=True)
        description = graphene.String(required=False)
        trusted_principals = graphene.String(required=True)
        signature_ttl_seconds = graphene.Int(required=False)
        sts_endpoint = graphene.String(required=False)
        token_name_pattern = graphene.String(required=False)
        default_ttl_seconds = graphene.Int(required=True)
        max_ttl_seconds = graphene.Int(required=True)

    identity = graphene.Field(IdentityType)

    @classmethod
    def mutate(
        cls,
        root,
        info,
        organisation_id,
        provider,
        name,
        trusted_principals,
        default_ttl_seconds,
        max_ttl_seconds,
        description=None,
        signature_ttl_seconds=60,
        sts_endpoint="https://sts.amazonaws.com",
        token_name_pattern=None,
    ):
        user = info.context.user
        org = Organisation.objects.get(id=organisation_id)

        if not user_has_permission(user, "create", "Identities", org):
            raise GraphQLError(
                "You don't have the permissions required to create identities in this organisation"
            )

        if default_ttl_seconds is not None and max_ttl_seconds is not None:
            if int(default_ttl_seconds) > int(max_ttl_seconds):
                raise GraphQLError(
                    "Default token expiry must be less than or equal to Maximum token expiry"
                )

        # Store provider-specific configuration in a generic config field
        # Convert comma-separated trusted_principals to list for consistency
        trusted_list = [p.strip() for p in trusted_principals.split(",") if p.strip()]
        config = {
            "trustedPrincipals": trusted_list,
            "signatureTtlSeconds": signature_ttl_seconds,
            "stsEndpoint": sts_endpoint,
        }

        identity = Identity.objects.create(
            organisation=org,
            provider=provider,
            name=name,
            description=description,
            config=config,
            token_name_pattern=token_name_pattern,
            default_ttl_seconds=default_ttl_seconds,
            max_ttl_seconds=max_ttl_seconds,
        )

        return CreateIdentityMutation(identity=identity)


class UpdateIdentityMutation(graphene.Mutation):
    class Arguments:
        id = graphene.ID(required=True)
        name = graphene.String(required=False)
        description = graphene.String(required=False)
        trusted_principals = graphene.String(required=False)
        signature_ttl_seconds = graphene.Int(required=False)
        sts_endpoint = graphene.String(required=False)
        token_name_pattern = graphene.String(required=False)
        default_ttl_seconds = graphene.Int(required=False)
        max_ttl_seconds = graphene.Int(required=False)

    identity = graphene.Field(IdentityType)

    @classmethod
    def mutate(
        cls,
        root,
        info,
        id,
        name=None,
        description=None,
        trusted_principals=None,
        signature_ttl_seconds=None,
        sts_endpoint=None,
        token_name_pattern=None,
        default_ttl_seconds=None,
        max_ttl_seconds=None,
    ):
        user = info.context.user
        identity = Identity.objects.get(id=id, deleted_at=None)

        org = identity.organisation
        if not user_has_permission(user, "update", "Identities", org):
            raise GraphQLError(
                "You don't have the permissions required to update identities in this organisation"
            )

        # Update basic fields using dictionary unpacking
        basic_updates = {
            k: v for k, v in {
                'name': name,
                'description': description,
                'token_name_pattern': token_name_pattern,
                'default_ttl_seconds': default_ttl_seconds,
                'max_ttl_seconds': max_ttl_seconds,
            }.items() if v is not None
        }
        for field, value in basic_updates.items():
            setattr(identity, field, value)

        # Update provider-specific config atomically
        config_updates = {}
        if trusted_principals is not None:
            config_updates["trustedPrincipals"] = [p.strip() for p in trusted_principals.split(",") if p.strip()]
        if signature_ttl_seconds is not None:
            config_updates["signatureTtlSeconds"] = signature_ttl_seconds
        if sts_endpoint is not None:
            config_updates["stsEndpoint"] = sts_endpoint
        
        if config_updates:
            identity.config = {**(identity.config or {}), **config_updates}

        if identity.default_ttl_seconds is not None and identity.max_ttl_seconds is not None:
            if int(identity.default_ttl_seconds) > int(identity.max_ttl_seconds):
                raise GraphQLError(
                    "Default token expiry must be less than or equal to Maximum token expiry"
                )

        identity.save()

        return UpdateIdentityMutation(identity=identity)


class DeleteIdentityMutation(graphene.Mutation):
    class Arguments:
        id = graphene.ID(required=True)

    ok = graphene.Boolean()

    @classmethod
    def mutate(cls, root, info, id):
        user = info.context.user
        identity = Identity.objects.get(id=id, deleted_at=None)

        org = identity.organisation
        if not user_has_permission(user, "delete", "Identities", org):
            raise GraphQLError(
                "You don't have the permissions required to delete identities in this organisation"
            )

        identity.deleted_at = timezone.now()
        identity.save()

        return DeleteIdentityMutation(ok=True)


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
