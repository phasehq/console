from api.models import Organisation, OrganisationMember, Role
from api.utils.access.permissions import user_has_permission
from backend.graphene.types import RoleType
import graphene
from graphql import GraphQLError


class CreateCustomRoleMutation(graphene.Mutation):
    class Arguments:
        name = graphene.String()
        description = graphene.String()
        permissions = graphene.JSONString()
        organisation_id = graphene.ID(required=True)

    role = graphene.Field(RoleType)

    @classmethod
    def mutate(cls, root, info, name, description, permissions, organisation_id):
        user = info.context.user
        org = Organisation.objects.get(id=organisation_id)

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
            permissions=permissions,
        )

        return CreateCustomRoleMutation(role=role)


class UpdateCustomRoleMutation(graphene.Mutation):
    class Arguments:
        id = graphene.ID(required=True)
        name = graphene.String()
        description = graphene.String()
        permissions = graphene.JSONString()

    role = graphene.Field(RoleType)

    @classmethod
    def mutate(cls, root, info, id, name, description, permissions):
        user = info.context.user
        role = Role.objects.get(id=id)

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
